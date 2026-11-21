import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

// completionRuleService 的「动作执行」与「按 gid 反查状态」两块此前没有覆盖。
// 规则一旦匹配就会真的搬文件、改名、开程序、发通知、投 webhook，所以这里逐条锁行为：
// 尤其是「目标已存在绝不覆盖」「EXDEV 退回复制」「多文件不重命名」这几条会伤到用户数据的决策。
const h = vi.hoisted(() => ({
  state: {
    notificationSupported: true,
    notifications: [] as Array<{ title: string; body: string }>,
    shellCalls: [] as string[],
    shellResult: '',
    shellThrows: false,
    rpcCalls: [] as Array<{ method: string; params: unknown[] }>,
    rpcPlan: [] as Array<Record<string, unknown> | Error>,
    extractCalls: [] as string[],
    extractResult: { success: true } as { success: boolean; reason?: string },
    enqueued: [] as Array<{ action: Record<string, unknown>; payload: Record<string, unknown> }>,
    dispatcherAvailable: true,
    settings: {} as Record<string, unknown>,
    logs: { info: [] as string[], warn: [] as string[], error: [] as string[] }
  }
}))

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '', getLocale: () => 'zh-CN' },
  Notification: class {
    static isSupported(): boolean { return h.state.notificationSupported }
    constructor(options: { title: string; body: string }) {
      h.state.notifications.push(options)
    }
    show(): void {}
  },
  shell: {
    openPath: async (target: string) => {
      h.state.shellCalls.push(target)
      if (h.state.shellThrows) throw new Error('shell boom')
      return h.state.shellResult
    }
  }
}))
vi.mock('../utils/logger', () => ({
  createLogger: () => ({
    info: (message: string) => h.state.logs.info.push(String(message)),
    warn: (message: string, error?: unknown) => h.state.logs.warn.push(String(message) + (error ? ':' + String(error) : '')),
    error: (message: string) => h.state.logs.error.push(String(message)),
    debug: () => {}
  })
}))
vi.mock('../utils/mainLocale', () => ({ mainLocaleFrom: () => 'zh' }))
vi.mock('../utils/mainProcessCopy', () => ({
  downloadNotificationTitle: (_locale: string, succeeded: boolean) =>
    succeeded ? '下载完成' : '下载失败'
}))
vi.mock('../utils/aria2Rpc', () => ({
  callAria2Rpc: async (options: { method: string; params: unknown[] }) => {
    h.state.rpcCalls.push({ method: options.method, params: options.params })
    const next = h.state.rpcPlan.shift()
    if (next instanceof Error) throw next
    return next ?? {}
  }
}))
vi.mock('../utils/activeRpcConfig', () => ({ activeRpcOptions: () => ({ host: '127.0.0.1', port: 6800 }) }))
vi.mock('../utils/settingsAccessor', () => ({
  getSettingsFresh: () => h.state.settings
}))
vi.mock('./archiveService', () => ({
  extractArchive: async (file: string) => {
    h.state.extractCalls.push(file)
    return h.state.extractResult
  }
}))
vi.mock('./webhookDispatchService', () => ({
  getWebhookDispatchService: () => (h.state.dispatcherAvailable
    ? {
      enqueue: (action: Record<string, unknown>, payload: Record<string, unknown>) => {
        h.state.enqueued.push({ action, payload })
      }
    }
    : null)
}))

const { applyCompletionRules, applyCompletionRulesForTask } = await import('./completionRuleService')

const state = h.state

function setSettings(partial: Record<string, unknown>): void {
  state.settings = partial
}

let tmpDir = ''

function writeFile(name: string, content = 'x'): string {
  const target = path.join(tmpDir, name)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
  return target
}

function rule(actions: unknown[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 'r1', name: 'test-rule', enabled: true, actions, ...extra }
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'completion-actions-'))
  state.notificationSupported = true
  state.notifications = []
  state.shellCalls = []
  state.shellResult = ''
  state.shellThrows = false
  state.rpcCalls = []
  state.rpcPlan = []
  state.extractCalls = []
  state.extractResult = { success: true }
  state.enqueued = []
  state.dispatcherAvailable = true
  state.logs = { info: [], warn: [], error: [] }
  setSettings({})
})

describe('move 动作的路径安全', () => {
  it('保留任务目录内的相对层级，子目录里的文件搬到目标目录后结构不变', async () => {
    const source = writeFile('show/season1/ep1.mkv')
    const target = path.join(tmpDir, 'library')
    setSettings({ completionRules: [rule([{ type: 'move', targetDir: target }])] })

    const matched = await applyCompletionRulesForTask({
      status: 'complete',
      dir: tmpDir,
      files: [source]
    })

    expect(matched).toBe(true)
    expect(fs.existsSync(path.join(target, 'show/season1/ep1.mkv'))).toBe(true)
    expect(fs.existsSync(source)).toBe(false)
  })

  it('相对路径越出任务目录时退化为平铺文件名，不会把文件搬到上层目录', async () => {
    // taskDir 不是 source 的祖先：path.relative 会给出 ../.. 这样的相对路径
    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'completion-other-'))
    const source = path.join(otherDir, 'escape.mkv')
    fs.writeFileSync(source, 'x')
    const target = path.join(tmpDir, 'library')
    setSettings({ completionRules: [rule([{ type: 'move', targetDir: target }])] })

    await applyCompletionRulesForTask({ status: 'complete', dir: tmpDir, files: [source] })

    expect(fs.existsSync(path.join(target, 'escape.mkv'))).toBe(true)
    expect(fs.existsSync(path.join(tmpDir, '..', 'escape.mkv'))).toBe(false)
    fs.rmSync(otherDir, { recursive: true, force: true })
  })

  it('目标目录已有同名文件时加序号，绝不覆盖用户已有文件', async () => {
    const source = writeFile('movie.mp4', 'new')
    const target = path.join(tmpDir, 'library')
    fs.mkdirSync(target, { recursive: true })
    fs.writeFileSync(path.join(target, 'movie.mp4'), 'existing')
    fs.writeFileSync(path.join(target, 'movie (1).mp4'), 'existing-1')
    setSettings({ completionRules: [rule([{ type: 'move', targetDir: target }])] })

    await applyCompletionRulesForTask({ status: 'complete', dir: tmpDir, files: [source] })

    expect(fs.readFileSync(path.join(target, 'movie.mp4'), 'utf8')).toBe('existing')
    expect(fs.readFileSync(path.join(target, 'movie (1).mp4'), 'utf8')).toBe('existing-1')
    expect(fs.readFileSync(path.join(target, 'movie (2).mp4'), 'utf8')).toBe('new')
  })

  it('源不是普通文件时跳过，不会因为目录/符号链接把整棵树搬走', async () => {
    const dirAsFile = path.join(tmpDir, 'folder')
    fs.mkdirSync(dirAsFile)
    const target = path.join(tmpDir, 'library')
    setSettings({ completionRules: [rule([{ type: 'move', targetDir: target }])] })

    await applyCompletionRulesForTask({ status: 'complete', dir: tmpDir, files: [dirAsFile] })

    expect(fs.existsSync(target)).toBe(false)
  })

  it('源文件不存在时只记警告，不抛给调用方（完成规则不能因一个动作失败而中断）', async () => {
    setSettings({ completionRules: [rule([{ type: 'move', targetDir: path.join(tmpDir, 'library') }])] })

    const matched = await applyCompletionRulesForTask({
      status: 'complete',
      dir: tmpDir,
      files: [path.join(tmpDir, 'missing.mkv')]
    })

    expect(matched).toBe(true)
    expect(state.logs.warn.join('\n')).toContain('移动文件失败')
  })

  it('跨盘 rename 失败（EXDEV）时退回复制再删除源文件', async () => {
    const source = writeFile('cross.mkv', 'payload')
    const target = path.join(tmpDir, 'library')
    setSettings({ completionRules: [rule([{ type: 'move', targetDir: target }])] })
    const renameSpy = vi.spyOn(fs.promises, 'rename').mockRejectedValue(
      Object.assign(new Error('EXDEV: cross-device link not permitted'), { code: 'EXDEV' })
    )
    try {
      await applyCompletionRulesForTask({ status: 'complete', dir: tmpDir, files: [source] })
    } finally {
      renameSpy.mockRestore()
    }

    expect(fs.readFileSync(path.join(target, 'cross.mkv'), 'utf8')).toBe('payload')
    expect(fs.existsSync(source)).toBe(false)
  })
})

describe('rename 动作', () => {
  it('按界面提示的 {name}-{date}{ext} 得到单层扩展名，不会变成 .mkv.mkv', async () => {
    const source = writeFile('episode.mkv')
    const today = new Date().toISOString().slice(0, 10)
    setSettings({ completionRules: [rule([{ type: 'rename', pattern: '{name}-{date}{ext}' }])] })

    await applyCompletionRulesForTask({ status: 'complete', dir: tmpDir, files: [source] })

    const expected = path.join(tmpDir, `episode-${today}.mkv`)
    expect(fs.existsSync(expected)).toBe(true)
    expect(fs.existsSync(source)).toBe(false)
  })

  it('模板不写 {ext} 时自动补回原扩展名', async () => {
    const source = writeFile('clip.mkv')
    setSettings({ completionRules: [rule([{ type: 'rename', pattern: 'renamed' }])] })

    await applyCompletionRulesForTask({ status: 'complete', dir: tmpDir, files: [source] })

    expect(fs.existsSync(path.join(tmpDir, 'renamed.mkv'))).toBe(true)
  })

  it('模板为空或只剩非法字符时退回原名，不会把文件改成奇怪的名字', async () => {
    const source = writeFile('keep.mp4')
    setSettings({ completionRules: [rule([{ type: 'rename', pattern: '' }])] })

    await applyCompletionRulesForTask({ status: 'complete', dir: tmpDir, files: [source] })

    expect(fs.existsSync(source)).toBe(true)
  })

  it('模板里的非法字符替换成下划线，避免在 Windows 上生成非法文件名', async () => {
    const source = writeFile('clip.mp4')
    setSettings({ completionRules: [rule([{ type: 'rename', pattern: 'a/b:c*d?{name}' }])] })

    await applyCompletionRulesForTask({ status: 'complete', dir: tmpDir, files: [source] })

    expect(fs.existsSync(path.join(tmpDir, 'a_b_c_d_clip.mp4'))).toBe(true)
  })

  it('多文件任务跳过重命名并记警告（播放列表不能只改第一个）', async () => {
    const first = writeFile('a.mp4')
    const second = writeFile('b.mp4')
    setSettings({ completionRules: [rule([{ type: 'rename', pattern: 'x{ext}' }])] })

    await applyCompletionRulesForTask({ status: 'complete', dir: tmpDir, files: [first, second] })

    expect(fs.existsSync(first)).toBe(true)
    expect(fs.existsSync(second)).toBe(true)
    expect(state.logs.warn.join('\n')).toContain('重命名动作仅支持单文件任务')
  })

  it('模板结果与原名相同时不做任何 rename（避免无意义 IO 与 mtime 变化）', async () => {
    const source = writeFile('same.mp4')
    const before = fs.statSync(source).mtimeMs
    setSettings({ completionRules: [rule([{ type: 'rename', pattern: '{name}' }])] })

    await applyCompletionRulesForTask({ status: 'complete', dir: tmpDir, files: [source] })

    expect(fs.statSync(source).mtimeMs).toBe(before)
  })
})

describe('open 与 notify 动作', () => {
  it('单文件任务打开文件本身', async () => {
    const source = writeFile('only.mp4')
    setSettings({ completionRules: [rule([{ type: 'open' }])] })

    await applyCompletionRulesForTask({ status: 'complete', dir: tmpDir, files: [source] })

    expect(state.shellCalls).toEqual([source])
  })

  it('多文件任务打开所在目录（打开一堆播放列表文件会炸开一堆播放器）', async () => {
    const first = writeFile('p1.mp4')
    const second = writeFile('p2.mp4')
    setSettings({ completionRules: [rule([{ type: 'open' }])] })

    await applyCompletionRulesForTask({ status: 'complete', dir: tmpDir, files: [first, second] })

    expect(state.shellCalls).toEqual([tmpDir])
  })

  it('没有文件也没有目录时什么都不打开', async () => {
    setSettings({ completionRules: [rule([{ type: 'open' }])] })

    await applyCompletionRulesForTask({ status: 'complete', dir: '', files: [] })

    expect(state.shellCalls).toEqual([])
  })

  it('通知标题与正文过长时截断，避免系统通知被截成乱码或超出平台上限', async () => {
    const longPath = path.join(tmpDir, 'x'.repeat(600) + '.mp4')
    setSettings({
      completionRules: [rule([{ type: 'notify', title: 'T'.repeat(300), body: 'B'.repeat(900) }])]
    })

    await applyCompletionRulesForTask({ status: 'complete', dir: tmpDir, files: [longPath] })

    expect(state.notifications).toHaveLength(1)
    expect(state.notifications[0]!.title).toHaveLength(120)
    expect(state.notifications[0]!.body).toHaveLength(500)
  })

  it('未填标题时按成功/失败给出默认文案', async () => {
    setSettings({ completionRules: [rule([{ type: 'notify' }])] })

    await applyCompletionRulesForTask({ status: 'error', dir: tmpDir, files: [], name: '某视频' })

    expect(state.notifications[0]!.title).toBe('下载失败')
    expect(state.notifications[0]!.body).toBe('某视频')
  })

  it('系统不支持通知时静默跳过（不抛异常、不影响后续规则）', async () => {
    state.notificationSupported = false
    setSettings({ completionRules: [rule([{ type: 'notify' }, { type: 'webhook', url: 'https://example.com/h' }])] })

    const matched = await applyCompletionRulesForTask({ status: 'complete', dir: tmpDir, files: [] })

    expect(matched).toBe(true)
    expect(state.notifications).toHaveLength(0)
    expect(state.enqueued).toHaveLength(1)
  })
})

describe('webhook 与 extract 动作', () => {
  it('webhook 交给队列而不是内联发送（对端 502 不再永久丢事件）', async () => {
    setSettings({ completionRules: [rule([{ type: 'webhook', url: 'https://example.com/hook' }])] })

    await applyCompletionRulesForTask({
      status: 'complete',
      dir: tmpDir,
      files: [path.join(tmpDir, 'done.mp4')],
      name: 'done'
    })

    expect(state.enqueued).toHaveLength(1)
    const { action, payload } = state.enqueued[0]!
    expect(action.url).toBe('https://example.com/hook')
    expect(payload).toMatchObject({
      event: 'download.complete',
      status: 'complete',
      name: 'done',
      dir: tmpDir
    })
  })

  it('投递服务未就绪时只记警告，不抛错', async () => {
    state.dispatcherAvailable = false
    setSettings({ completionRules: [rule([{ type: 'webhook', url: 'https://example.com/hook' }])] })

    const matched = await applyCompletionRulesForTask({ status: 'complete', dir: tmpDir, files: [] })

    expect(matched).toBe(true)
    expect(state.enqueued).toHaveLength(0)
    expect(state.logs.warn.join('\n')).toContain('Webhook 投递服务未就绪')
  })

  it('extract 对每个产物都尝试解压，失败只记警告', async () => {
    const first = writeFile('a.zip')
    const second = writeFile('b.zip')
    setSettings({ completionRules: [rule([{ type: 'extract' }])] })
    state.extractResult = { success: false, reason: 'tar_not_available' }

    await applyCompletionRulesForTask({ status: 'complete', dir: tmpDir, files: [first, second] })

    expect(state.extractCalls).toEqual([first, second])
    expect(state.logs.warn.join('\n')).toContain('自动解压失败')
  })
})

describe('条件匹配', () => {
  it('分类条件按产物所属分类匹配，未命中不执行', async () => {
    const source = writeFile('movie.mp4')
    setSettings({
      category: { categories: [{ id: 'video', name: '视频', extensions: ['mp4'] }] },
      completionRules: [
        rule([{ type: 'open' }], { condition: { category: 'video' } }),
        rule([{ type: 'notify' }], { id: 'r2', condition: { category: 'audio' } })
      ]
    })

    await applyCompletionRulesForTask({ status: 'complete', dir: tmpDir, files: [source] })

    expect(state.shellCalls).toEqual([source])
    expect(state.notifications).toHaveLength(0)
  })

  it('扩展名条件带前导点也能匹配（用户手填 .mp3 与 mp3 等价）', async () => {
    const source = writeFile('song.mp3')
    setSettings({ completionRules: [rule([{ type: 'notify' }], { condition: { extensions: ['.MP3'] } })] })

    const matched = await applyCompletionRulesForTask({ status: 'complete', dir: tmpDir, files: [source] })

    expect(matched).toBe(true)
    expect(state.notifications).toHaveLength(1)
  })

  it('condition.status = complete 的规则不会在失败任务上触发', async () => {
    setSettings({ completionRules: [rule([{ type: 'notify' }], { condition: { status: 'complete' } })] })

    const matched = await applyCompletionRulesForTask({ status: 'error', dir: tmpDir, files: [] })

    expect(matched).toBe(false)
    expect(state.notifications).toHaveLength(0)
  })

  it('单个动作抛错不影响同一规则里的后续动作', async () => {
    const source = writeFile('x.mp4')
    state.shellThrows = true
    setSettings({ completionRules: [rule([{ type: 'open' }, { type: 'notify' }])] })

    const matched = await applyCompletionRulesForTask({ status: 'complete', dir: tmpDir, files: [source] })

    expect(matched).toBe(true)
    expect(state.logs.warn.join('\n')).toContain('失败')
    // open 抛错后 notify 仍然执行
    expect(state.notifications).toHaveLength(1)
  })
})

describe('applyCompletionRules（按 gid 反查状态）', () => {
  it('没有配置规则时连 RPC 都不发', async () => {
    setSettings({ completionRules: [] })

    const matched = await applyCompletionRules('g1')

    expect(matched).toBe(false)
    expect(state.rpcCalls).toHaveLength(0)
  })

  it('tellStatus 读取失败时返回 false，不执行任何动作', async () => {
    setSettings({ completionRules: [rule([{ type: 'notify' }])] })
    state.rpcPlan = [new Error('rpc down')]

    const matched = await applyCompletionRules('g1')

    expect(matched).toBe(false)
    expect(state.notifications).toHaveLength(0)
    expect(state.logs.warn.join('\n')).toContain('读取任务状态失败')
  })

  it('状态仍是 active 时轮询等待，等到 complete 再执行规则', async () => {
    const source = writeFile('late.mp4')
    setSettings({ completionRules: [rule([{ type: 'open' }])] })
    state.rpcPlan = [
      { gid: 'g1', status: 'active', dir: tmpDir, files: [{ path: source }] },
      { gid: 'g1', status: 'complete', dir: tmpDir, files: [{ path: source }] }
    ]
    vi.useFakeTimers()
    try {
      const pending = applyCompletionRules('g1')
      await vi.advanceTimersByTimeAsync(400)
      const matched = await pending
      expect(matched).toBe(true)
    } finally {
      vi.useRealTimers()
    }
    expect(state.shellCalls).toEqual([source])
    expect(state.rpcCalls).toHaveLength(2)
  })

  it('轮询 6 次仍是 active 就放弃，并记录原因（不无限等）', async () => {
    setSettings({ completionRules: [rule([{ type: 'notify' }])] })
    state.rpcPlan = Array.from({ length: 6 }, () => ({
      gid: 'g1', status: 'active', dir: tmpDir, files: []
    }))
    vi.useFakeTimers()
    let matched = false
    try {
      const pending = applyCompletionRules('g1')
      await vi.advanceTimersByTimeAsync(2000)
      matched = await pending
    } finally {
      vi.useRealTimers()
    }

    expect(matched).toBe(false)
    expect(state.rpcCalls).toHaveLength(6)
    expect(state.logs.warn.join('\n')).toContain('跳过完成规则')
  })

  it('相对路径的产物按任务目录还原成绝对路径后再搬', async () => {
    const target = path.join(tmpDir, 'library')
    fs.writeFileSync(path.join(tmpDir, 'rel.mkv'), 'x')
    setSettings({ completionRules: [rule([{ type: 'move', targetDir: target }])] })
    state.rpcPlan = [{
      gid: 'g1',
      status: 'complete',
      dir: tmpDir,
      files: [{ path: 'rel.mkv' }]
    }]

    const matched = await applyCompletionRules('g1')

    expect(matched).toBe(true)
    expect(fs.existsSync(path.join(target, 'rel.mkv'))).toBe(true)
  })

  it('tellStatus 请求带上 gid 与固定字段表（避免每次拉全量状态）', async () => {
    setSettings({ completionRules: [rule([{ type: 'notify' }])] })
    state.rpcPlan = [{ gid: 'g9', status: 'complete', dir: tmpDir, files: [] }]

    await applyCompletionRules('g9')

    expect(state.rpcCalls[0]!.method).toBe('aria2.tellStatus')
    expect(state.rpcCalls[0]!.params).toEqual([
      'g9',
      ['gid', 'status', 'dir', 'files', 'bittorrent', 'errorMessage']
    ])
  })
})
