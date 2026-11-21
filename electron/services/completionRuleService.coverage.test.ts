import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

// 完成规则的兜底路径：跨盘移动、通知默认文案、轮询后规则不匹配与动作抛错。
// 正常路径由 completionRuleService.test.ts 覆盖，这里只补分支。
const holder = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  notifySupported: true,
  notifications: [] as Array<Record<string, unknown>>,
  rpc: vi.fn(async (..._args: unknown[]) => ({})),
  openPath: vi.fn(async (_file: string) => ''),
  warn: vi.fn(),
  info: vi.fn()
}))

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '', getLocale: () => 'en-US' },
  Notification: class {
    static isSupported(): boolean { return holder.notifySupported }
    constructor(options: Record<string, unknown>) { holder.notifications.push(options) }
    show(): void { /* noop */ }
  },
  shell: { openPath: (file: string) => holder.openPath(file) }
}))
vi.mock('electron-log/main', () => ({
  default: { debug: vi.fn(), info: holder.info, warn: holder.warn, error: vi.fn(), transports: { file: {}, console: {} } }
}))
vi.mock('../utils/aria2Rpc', () => ({
  callAria2Rpc: (...args: unknown[]) => holder.rpc(...args)
}))
vi.mock('../utils/activeRpcConfig', () => ({
  activeRpcOptions: () => ({ host: '127.0.0.1', port: 6800, protocol: 'http', path: '/jsonrpc', secret: '' })
}))
vi.mock('../utils/settingsAccessor', () => ({ getSettingsFresh: () => holder.settings }))
vi.mock('./archiveService', () => ({ extractArchive: vi.fn(async () => ({ success: true })) }))
vi.mock('./webhookDispatchService', () => ({ getWebhookDispatchService: () => ({ enqueue: vi.fn() }) }))
vi.mock('../utils/mainProcessCopy', () => ({
  downloadNotificationTitle: (_locale: string, succeeded: boolean) => (succeeded ? 'Download complete' : 'Download failed')
}))
// 语言回调必须真的被调用：生产代码用 mainLocaleFrom(() => app.getLocale()) 取语言
vi.mock('../utils/mainLocale', () => ({
  mainLocaleFrom: (getLocale?: () => string) => {
    if (typeof getLocale === 'function') getLocale()
    return 'en'
  }
}))

const { applyCompletionRules, applyCompletionRulesForTask } = await import('./completionRuleService')

function setRules(rules: unknown[]): void {
  holder.settings = { completionRules: rules }
}

describe('完成规则的分支兜底', () => {
  let tmpDir: string

  beforeEach(() => {
    vi.restoreAllMocks()
    holder.notifications = []
    holder.notifySupported = true
    holder.rpc = vi.fn(async () => ({}))
    holder.openPath = vi.fn(async () => '')
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'completion-coverage-'))
  })

  it('跨盘移动（EXDEV）退化成复制加删除，文件仍然搬到位', async () => {
    const targetDir = path.join(tmpDir, 'moved')
    const source = path.join(tmpDir, 'episode.mkv')
    fs.writeFileSync(source, 'video-bytes')
    setRules([{ id: 'r1', name: 'move', enabled: true, actions: [{ type: 'move', targetDir }] }])

    const renameSpy = vi.spyOn(fs.promises, 'rename').mockRejectedValueOnce(
      Object.assign(new Error('EXDEV: cross-device link not permitted'), { code: 'EXDEV' })
    )
    try {
      await applyCompletionRulesForTask({ status: 'complete', dir: tmpDir, files: [source] })
    } finally {
      renameSpy.mockRestore()
    }

    expect(fs.existsSync(source)).toBe(false)
    expect(fs.readFileSync(path.join(targetDir, 'episode.mkv'), 'utf-8')).toBe('video-bytes')
  })

  it('非 EXDEV 的移动失败只记日志，不把异常抛给调用方', async () => {
    const source = path.join(tmpDir, 'locked.mkv')
    fs.writeFileSync(source, 'x')
    setRules([{ id: 'r1', name: 'move', enabled: true, actions: [{ type: 'move', targetDir: path.join(tmpDir, 'out') }] }])

    const renameSpy = vi.spyOn(fs.promises, 'rename').mockRejectedValueOnce(
      Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' })
    )
    try {
      await expect(applyCompletionRulesForTask({ status: 'complete', dir: tmpDir, files: [source] })).resolves.toBe(true)
    } finally {
      renameSpy.mockRestore()
    }

    expect(fs.existsSync(source)).toBe(true)
    expect(holder.warn.mock.calls.some((call) => String(call[0]).includes('移动文件失败'))).toBe(true)
  })

  it('通知动作没写标题时用默认文案，正文回落到 BT 名称', async () => {
    setRules([{ id: 'r1', name: 'notify', enabled: true, actions: [{ type: 'notify' }] }])

    await applyCompletionRulesForTask({ status: 'complete', dir: tmpDir, files: [path.join(tmpDir, 'a.mkv')], name: '某部剧 S01' })

    expect(holder.notifications).toHaveLength(1)
    expect(holder.notifications[0]).toMatchObject({ title: 'Download complete', body: '某部剧 S01' })
  })

  it('失败任务的通知文案走失败分支', async () => {
    setRules([{ id: 'r1', name: 'notify', enabled: true, actions: [{ type: 'notify' }] }])

    await applyCompletionRulesForTask({ status: 'error', dir: tmpDir, files: [path.join(tmpDir, 'b.mkv')] })

    expect(holder.notifications[0]).toMatchObject({ title: 'Download failed' })
  })

  it('轮询到已结束状态后，不匹配的规则直接跳过', async () => {
    setRules([{ id: 'r1', name: 'only-complete', enabled: true, condition: { status: 'complete' }, actions: [] }])
    holder.rpc = vi.fn(async () => ({ gid: 'g1', status: 'error', dir: tmpDir, files: [] }))

    await expect(applyCompletionRules('g1')).resolves.toBe(false)
  })

  it('轮询后规则命中且动作抛错时只 warn，不中断其它规则', async () => {
    setRules([
      { id: 'r1', name: 'boom', enabled: true, actions: [{ type: 'open' }] },
      { id: 'r2', name: 'second', enabled: true, actions: [{ type: 'open' }] }
    ])
    holder.rpc = vi.fn(async () => ({
      gid: 'g2',
      status: 'complete',
      dir: tmpDir,
      files: [{ path: path.join(tmpDir, 'c.mkv') }]
    }))
    holder.openPath = vi.fn(async () => { throw new Error('open failed') })

    await expect(applyCompletionRules('g2')).resolves.toBe(true)

    const warns = holder.warn.mock.calls.map((call) => String(call[0]))
    expect(warns.some((text) => text.includes('动作 open 失败'))).toBe(true)
  })

  it('轮询时读取任务状态失败直接放弃，不再尝试规则', async () => {
    setRules([{ id: 'r1', name: 'any', enabled: true, actions: [] }])
    holder.rpc = vi.fn(async () => { throw new Error('rpc down') })

    await expect(applyCompletionRules('g3')).resolves.toBe(false)

    const warns = holder.warn.mock.calls.map((call) => String(call[0]))
    expect(warns.some((text) => text.includes('读取任务状态失败'))).toBe(true)
    expect(holder.rpc).toHaveBeenCalledTimes(1)
  })

  it('通知标题显式给出时不走默认文案，且超长标题被截断', async () => {
    const longTitle = 'T'.repeat(200)
    setRules([{ id: 'r1', name: 'notify', enabled: true, actions: [{ type: 'notify', title: longTitle, body: 'custom body' }] }])

    await applyCompletionRulesForTask({ status: 'complete', dir: tmpDir, files: [path.join(tmpDir, 'd.mkv')] })

    expect(holder.notifications).toHaveLength(1)
    expect(holder.notifications[0].title).toBe('T'.repeat(120))
    expect(holder.notifications[0].body).toBe('custom body')
  })
})
