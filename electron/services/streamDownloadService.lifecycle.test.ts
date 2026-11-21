import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

/**
 * 流媒体下载服务的生命周期测试（startStreamDownload / pause / resume / cancel / discard / 删除文件）。
 *
 * 与同目录的 streamDownloadService.test.ts 分工：那个文件只测纯函数（参数构造、校验、进度解析），
 * 本文件把 spawn 换成可控的假子进程，覆盖"进程真的起来之后"的分支——进度事件、完成/失败/取消判定、
 * 暂停与恢复、退出兜底清理、删除文件的路径边界。这些分支是 yt-dlp 任务唯一的用户可见反馈面。
 */

const h = vi.hoisted(() => {
  const state = {
    children: [] as any[],
    spawnCalls: [] as any[],
    spawnSyncCalls: [] as any[],
    ffmpegAvailable: true,
    notificationSupported: false,
    notifications: [] as any[],
    trashCalls: [] as string[],
    trashError: null as Error | null,
    completionCalls: [] as any[],
    completionThrows: false,
    tempRoot: '',
    logs: { info: [] as any[], warn: [] as any[], error: [] as any[] }
  }
  return { state }
})

const { state } = h

function makeChild(pid: number) {
  const child = new EventEmitter() as any
  child.pid = pid
  child.exitCode = null
  child.signalCode = null
  child.killed = false
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn(() => true)
  child.exitWith = (code: number | null) => {
    child.exitCode = code
    child.emit('exit', code, null)
  }
  return child
}

vi.mock('child_process', () => ({
  spawn: vi.fn((file: string, args: string[], options: unknown) => {
    state.spawnCalls.push({ file, args, options })
    const child = makeChild(2000 + state.children.length)
    state.children.push(child)
    return child
  }),
  spawnSync: vi.fn((file: string, args: string[]) => {
    state.spawnSyncCalls.push({ file, args })
    return { status: 0 }
  })
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => state.tempRoot,
    getLocale: () => 'zh-CN'
  },
  Notification: class FakeNotification {
    static isSupported() {
      return state.notificationSupported
    }
    constructor(options: unknown) {
      state.notifications.push(options)
    }
    show() {}
  },
  shell: {
    trashItem: async (target: string) => {
      state.trashCalls.push(target)
      if (state.trashError) throw state.trashError
    }
  }
}))

vi.mock('electron-log/main', () => {
  const push = (level: keyof typeof state.logs) => (message: unknown) => {
    state.logs[level].push(message)
  }
  return {
    default: {
      debug: push('info'),
      info: push('info'),
      warn: push('warn'),
      error: push('error'),
      transports: { file: {}, console: {} }
    }
  }
})

vi.mock('./ytdlpService', () => ({ getYtdlpExecutablePath: () => '/fake/yt-dlp' }))

vi.mock('./ffmpegService', () => ({
  checkFfmpegAvailable: async () => ({ available: state.ffmpegAvailable }),
  getFfmpegLocation: () => '/fake/ffmpeg'
}))

vi.mock('./completionRuleService', () => ({
  applyCompletionRulesForTask: async (context: unknown) => {
    state.completionCalls.push(context)
    if (state.completionThrows) throw new Error('rules exploded')
  }
}))

// 模块加载时会注册一个 process 退出兜底；先记下既有监听，好把它单独拎出来直接调用，
// 避免在测试进程里真的 emit('exit') 干扰 vitest 自己的退出钩子。
const exitListenersBefore = process.listeners('exit').slice()

const {
  MAX_CONCURRENT_STREAM_DOWNLOADS,
  activeStreamDownloadCount,
  activeStreamDownloadSpeedBytes,
  cancelStreamDownload,
  deleteStreamDownloadFile,
  discardStreamDownload,
  getStreamTask,
  listStreamTasks,
  parseProgressLine,
  registerStreamTask,
  pauseStreamDownload,
  resumeStreamDownload,
  startStreamDownload,
  updateStreamTask
} = await import('./streamDownloadService')

const serviceExitListener = process.listeners('exit').find((listener) => !exitListenersBefore.includes(listener))

let tmpDir = ''

function makeDir(name: string): string {
  const dir = path.join(tmpDir, name)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    url: 'https://example.com/watch?v=abc',
    // 单格式 id + merge:false：默认不碰 ffmpeg，让用例只关心进程生命周期
    formatId: '137',
    merge: false,
    outputDir: makeDir('out'),
    title: '示例视频',
    ...overrides
  } as unknown as Parameters<typeof startStreamDownload>[0]
}

function makeEvents() {
  const events: any[] = []
  return { events, onEvent: (event: unknown) => events.push(event) }
}

/** 写入 --print-to-file 的最终路径文件（id 由 startStreamDownload 返回，文件名规则固定） */
function writeFinalPathFile(id: string, lines: string[]): void {
  fs.writeFileSync(path.join(state.tempRoot, 'ytdlp-final-' + id + '.txt'), lines.join('\n'), 'utf8')
}

function writeTitleFile(id: string, title: string): void {
  fs.writeFileSync(path.join(state.tempRoot, 'ytdlp-title-' + id + '.txt'), title + '\n', 'utf8')
}

function lastChild() {
  return state.children[state.children.length - 1]
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stream-lifecycle-'))
  state.tempRoot = makeDir('temp')
  state.children.length = 0
  state.spawnCalls.length = 0
  state.spawnSyncCalls.length = 0
  state.notifications.length = 0
  state.trashCalls.length = 0
  state.completionCalls.length = 0
  state.completionThrows = false
  state.ffmpegAvailable = true
  state.notificationSupported = false
  state.trashError = null
  state.logs.info.length = 0
  state.logs.warn.length = 0
  state.logs.error.length = 0
})

afterEach(async () => {
  // 把仍活着的假任务全部收掉，避免模块级的 activeDownloads 串到下一个用例。
  // 先让假子进程"退出"：否则 discardStreamDownload 会等满 2 秒的退出宽限期，整个文件慢到没法跑。
  for (const child of state.children) {
    if (child.exitCode === null) {
      child.exitCode = 0
      child.emit('exit', 0, null)
    }
  }
  for (const task of listStreamTasks()) {
    await discardStreamDownload(task.id)
  }
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('startStreamDownload：请求前置校验', () => {
  it('非 http(s) 协议直接拒绝，且不 spawn 子进程', async () => {
    const { onEvent } = makeEvents()
    const result = await startStreamDownload(
      makeRequest({ url: 'file:///etc/passwd' }),
      onEvent
    )
    expect(result.success).toBe(false)
    expect(result.code).toBe('invalid_request')
    expect(state.spawnCalls).toHaveLength(0)
  })

  it('相对输出目录拒绝（yt-dlp 的工作目录不可控，相对路径会写到意料之外的位置）', async () => {
    const { onEvent } = makeEvents()
    const result = await startStreamDownload(makeRequest({ outputDir: 'relative/dir' }), onEvent)
    expect(result.success).toBe(false)
    expect(result.code).toBe('invalid_request')
    expect(result.error).toBe('Invalid output directory')
  })

  it('格式表达式含危险字符时拒绝', async () => {
    const { onEvent } = makeEvents()
    const result = await startStreamDownload(makeRequest({ formatId: 'best;rm -rf /' }), onEvent)
    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid format expression')
  })

  it('需要 ffmpeg 但没装时拒绝，并给出可读原因', async () => {
    state.ffmpegAvailable = false
    const { onEvent } = makeEvents()
    const result = await startStreamDownload(makeRequest({ formatId: undefined, merge: true }), onEvent)
    expect(result.success).toBe(false)
    expect(result.code).toBe('ffmpeg_missing')
    expect(state.spawnCalls).toHaveLength(0)
  })

  it('并发到达上限时拒绝新任务（没有队列机制，只能让界面提示等待）', async () => {
    for (let i = 0; i < MAX_CONCURRENT_STREAM_DOWNLOADS; i += 1) {
      const { onEvent } = makeEvents()
      const started = await startStreamDownload(makeRequest({ url: 'https://example.com/v' + i }), onEvent)
      expect(started.success).toBe(true)
    }
    expect(activeStreamDownloadCount()).toBe(MAX_CONCURRENT_STREAM_DOWNLOADS)
    const { onEvent } = makeEvents()
    const rejected = await startStreamDownload(makeRequest({ url: 'https://example.com/overflow' }), onEvent)
    expect(rejected.success).toBe(false)
    expect(rejected.code).toBe('too_many_downloads')
    expect(state.spawnCalls).toHaveLength(MAX_CONCURRENT_STREAM_DOWNLOADS)
  })

  it('输出目录建不出来时返回可读错误（父级是个文件）', async () => {
    const blocker = path.join(tmpDir, 'blocker')
    fs.writeFileSync(blocker, 'x', 'utf8')
    const { onEvent } = makeEvents()
    const result = await startStreamDownload(
      makeRequest({ outputDir: path.join(blocker, 'nested') }),
      onEvent
    )
    expect(result.success).toBe(false)
    expect(result.code).toBe('invalid_request')
    // 文案由 mainProcessCopy 按语言给出（中文环境是「无法创建保存目录」），只断言关键信息不被吞掉
    expect(result.error).toContain('ENOTDIR')
  })

  it('临时目录建不出来时返回可读错误', async () => {
    state.tempRoot = path.join(tmpDir, 'no-such-parent', 'temp')
    const { onEvent } = makeEvents()
    const result = await startStreamDownload(makeRequest(), onEvent)
    expect(result.success).toBe(false)
    expect(result.code).toBe('invalid_request')
    expect(state.spawnCalls).toHaveLength(0)
  })
})

describe('startStreamDownload：成功启动', () => {
  it('返回任务 id、派发 started 事件并登记到扩展可见的快照表', async () => {
    const { events, onEvent } = makeEvents()
    const result = await startStreamDownload(makeRequest(), onEvent)

    expect(result.success).toBe(true)
    expect(result.id).toMatch(/^sd-/)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'started', url: 'https://example.com/watch?v=abc', merge: false })
    expect(getStreamTask(result.id!)?.status).toBe('active')
    expect(activeStreamDownloadCount()).toBe(1)
  })

  it('以数组参数 spawn（不经 shell），并带上 -o 模板与 --paths home:', async () => {
    const { onEvent } = makeEvents()
    const result = await startStreamDownload(makeRequest(), onEvent)
    const call = state.spawnCalls[0]
    expect(call.file).toBe('/fake/yt-dlp')
    expect(Array.isArray(call.args)).toBe(true)
    expect(call.args).toContain('-o')
    expect(call.args).toContain('%(title)s.%(ext)s')
    expect(call.args).toContain('--no-playlist')
    expect(call.options).toMatchObject({ windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    expect(result.success).toBe(true)
  })

  it('速度汇总只统计 active 任务（暂停后归零，避免页脚显示幽灵速度）', async () => {
    const { onEvent } = makeEvents()
    const result = await startStreamDownload(makeRequest(), onEvent)
    updateStreamTask(result.id!, { speedBytes: 2048 })
    expect(activeStreamDownloadSpeedBytes()).toBe(2048)
    pauseStreamDownload(result.id!)
    expect(activeStreamDownloadSpeedBytes()).toBe(0)
    expect(activeStreamDownloadCount()).toBe(0)
  })
})

describe('子进程输出：进度事件与快照', () => {
  it('进度行解析后派发 progress，并把百分比/速度写进快照', async () => {
    const { events, onEvent } = makeEvents()
    const result = await startStreamDownload(makeRequest(), onEvent)
    const child = lastChild()
    child.stdout.emit(
      'data',
      Buffer.from('__YTDLP_PROGRESS__ 42.5%|4250|10000|NA|1.5MiB/s|00:10|1572864|NA|NA\n', 'utf8')
    )

    const progress = events.find((e) => e.type === 'progress')
    expect(progress).toMatchObject({ id: result.id, percent: 42.5, downloadedBytes: 4250, totalBytes: 10000 })
    expect(getStreamTask(result.id!)).toMatchObject({ percent: 42.5, speedBytes: 1572864 })
  })

  it('标题取自 --print-to-file 的 UTF-8 文件（进度行里的标题是 GBK 乱码，不能用）', async () => {
    const { events, onEvent } = makeEvents()
    const result = await startStreamDownload(makeRequest({ title: undefined }), onEvent)
    writeTitleFile(result.id!, '真正的标题')
    const child = lastChild()
    child.stdout.emit('data', Buffer.from('__YTDLP_PROGRESS__ 10%|1|10|NA|NA|NA|1|NA|NA\n', 'utf8'))

    const progress = events.find((e) => e.type === 'progress')
    expect(progress.entryTitle).toBe('真正的标题')
    expect(getStreamTask(result.id!)?.title).toBe('真正的标题')
  })

  it('中文标题跨 chunk 边界时按 UTF-8 流式解码，不会出现乱码', async () => {
    const { events, onEvent } = makeEvents()
    const result = await startStreamDownload(makeRequest({ title: undefined }), onEvent)
    writeTitleFile(result.id!, '跨块标题')
    const line = '__YTDLP_PROGRESS__ 10%|1|10|NA|NA|NA|1|NA|NA\n'
    const bytes = Buffer.from(line, 'utf8')
    const child = lastChild()
    // 把一行拆成两个 chunk 发出去：缓冲区必须把残行留住，等下一次拼完整再解析
    child.stdout.emit('data', bytes.subarray(0, 10))
    expect(events.filter((e) => e.type === 'progress')).toHaveLength(0)
    child.stdout.emit('data', bytes.subarray(10))
    expect(events.filter((e) => e.type === 'progress')).toHaveLength(1)
    expect(getStreamTask(result.id!)?.percent).toBe(10)
  })

  it('stdout 直接打印绝对路径时作为兜底产物（某些 yt-dlp 版本不写 --print-to-file）', async () => {
    const { events, onEvent } = makeEvents()
    const outputDir = makeDir('out-fallback')
    const result = await startStreamDownload(makeRequest({ outputDir }), onEvent)
    const realFile = path.join(outputDir, 'fallback.mp4')
    fs.writeFileSync(realFile, 'video', 'utf8')
    const child = lastChild()
    child.stdout.emit('data', Buffer.from(realFile + '\n', 'utf8'))
    child.exitWith(0)

    const completed = events.find((e) => e.type === 'completed')
    expect(completed).toMatchObject({ id: result.id, filePath: realFile, filePaths: [realFile] })
  })
})

describe('子进程退出：完成 / 失败 / 取消 / 暂停', () => {
  it('退出码 0 且有产物时派发 completed、写快照、发通知并执行完成规则', async () => {
    state.notificationSupported = true
    const { events, onEvent } = makeEvents()
    const outputDir = makeDir('out-complete')
    const result = await startStreamDownload(makeRequest({ outputDir }), onEvent)
    const file = path.join(outputDir, 'done.mp4')
    fs.writeFileSync(file, 'video', 'utf8')
    writeFinalPathFile(result.id!, [file])
    lastChild().exitWith(0)

    expect(events.find((e) => e.type === 'completed')).toMatchObject({ id: result.id, filePath: file })
    expect(getStreamTask(result.id!)).toMatchObject({ status: 'complete', percent: 100, speedBytes: 0 })
    expect(state.notifications).toHaveLength(1)
    expect(state.notifications[0]).toMatchObject({ body: 'done.mp4' })
    expect(state.completionCalls).toHaveLength(1)
    expect(state.completionCalls[0]).toMatchObject({ status: 'complete', dir: outputDir })
  })

  it('播放列表一次产出多个文件时，completed 事件带全部路径（D-38）', async () => {
    const { events, onEvent } = makeEvents()
    const outputDir = makeDir('out-playlist')
    const result = await startStreamDownload(makeRequest({ outputDir }), onEvent)
    const first = path.join(outputDir, '01.mp4')
    const second = path.join(outputDir, '02.mp4')
    fs.writeFileSync(first, 'a', 'utf8')
    fs.writeFileSync(second, 'b', 'utf8')
    writeFinalPathFile(result.id!, [first, second])
    lastChild().exitWith(0)

    const completed = events.find((e) => e.type === 'completed')
    expect(completed.filePaths).toEqual([first, second])
    expect(getStreamTask(result.id!)?.filePaths).toEqual([first, second])
  })

  it('退出码非 0 时用 stderr 尾部作为失败原因，并执行失败规则', async () => {
    const { events, onEvent } = makeEvents()
    const result = await startStreamDownload(makeRequest(), onEvent)
    const child = lastChild()
    child.stderr.emit('data', Buffer.from('ERROR: 视频不存在\n', 'utf8'))
    child.exitWith(1)

    const failed = events.find((e) => e.type === 'failed')
    expect(failed).toMatchObject({ id: result.id })
    expect(failed.error).toContain('视频不存在')
    expect(getStreamTask(result.id!)?.status).toBe('error')
    expect(state.completionCalls[0]).toMatchObject({ status: 'error' })
  })

  it('退出码 0 但没有产物时按"没有输出文件"报错（不能当成功）', async () => {
    const { events, onEvent } = makeEvents()
    const result = await startStreamDownload(makeRequest(), onEvent)
    lastChild().exitWith(0)

    const failed = events.find((e) => e.type === 'failed')
    expect(failed).toBeDefined()
    expect(getStreamTask(result.id!)?.status).toBe('error')
    expect(state.completionCalls).toHaveLength(0)
  })

  it('spawn 直接报错（yt-dlp 不存在）时提示先下载 yt-dlp', async () => {
    const { events, onEvent } = makeEvents()
    const result = await startStreamDownload(makeRequest(), onEvent)
    const child = lastChild()
    child.emit('error', new Error('spawn /fake/yt-dlp ENOENT'))

    const failed = events.find((e) => e.type === 'failed')
    expect(failed.error).toContain('未检测到 yt-dlp')
    expect(getStreamTask(result.id!)?.status).toBe('error')
  })

  it('同一条任务的迟到 exit 事件不会重复处理（记录已移除）', async () => {
    const { events, onEvent } = makeEvents()
    const result = await startStreamDownload(makeRequest(), onEvent)
    const child = lastChild()
    child.exitWith(0)
    const countAfterFirst = events.length
    child.emit('exit', 0, null)
    expect(events.length).toBe(countAfterFirst)
    expect(getStreamTask(result.id!)?.status).toBe('error')
  })
})

describe('暂停 / 继续 / 取消', () => {
  it('暂停结束进程树并保留任务记录，退出后事件是 paused 而不是 failed', async () => {
    const { events, onEvent } = makeEvents()
    const result = await startStreamDownload(makeRequest(), onEvent)
    const child = lastChild()

    expect(pauseStreamDownload(result.id!)).toBe(true)
    expect(state.spawnSyncCalls.length + 1).toBeGreaterThan(1)
    child.exitWith(null)

    expect(events.find((e) => e.type === 'paused')).toMatchObject({ id: result.id })
    expect(events.some((e) => e.type === 'failed')).toBe(false)
    expect(getStreamTask(result.id!)?.status).toBe('paused')
  })

  it('重复暂停视为成功（事件与双击的竞态不该弹「暂停失败」）', async () => {
    const { onEvent } = makeEvents()
    const result = await startStreamDownload(makeRequest(), onEvent)
    expect(pauseStreamDownload(result.id!)).toBe(true)
    expect(pauseStreamDownload(result.id!)).toBe(true)
  })

  it('暂停不存在的任务返回 false；进程还没起来时也返回 false', async () => {
    expect(pauseStreamDownload('sd-missing')).toBe(false)
    const { onEvent } = makeEvents()
    const result = await startStreamDownload(makeRequest(), onEvent)
    const child = lastChild()
    child.emit('error', new Error('spawn ENOENT'))
    expect(pauseStreamDownload(result.id!)).toBe(false)
  })

  it('继续会重新拉起子进程并沿用同一任务 id', async () => {
    const { events, onEvent } = makeEvents()
    const result = await startStreamDownload(makeRequest(), onEvent)
    pauseStreamDownload(result.id!)
    lastChild().exitWith(null)
    const spawnCountBefore = state.spawnCalls.length

    expect(resumeStreamDownload(result.id!)).toBe(true)
    expect(state.spawnCalls.length).toBe(spawnCountBefore + 1)
    expect(getStreamTask(result.id!)?.status).toBe('active')
    expect(events.filter((e) => e.type === 'started')).toHaveLength(1)
  })

  it('继续一条没暂停的任务返回 false', async () => {
    const { onEvent } = makeEvents()
    const result = await startStreamDownload(makeRequest(), onEvent)
    expect(resumeStreamDownload(result.id!)).toBe(false)
    expect(resumeStreamDownload('sd-missing')).toBe(false)
  })

  it('取消进行中的任务会结束进程并派发 cancelled', async () => {
    const { events, onEvent } = makeEvents()
    const result = await startStreamDownload(makeRequest(), onEvent)
    const child = lastChild()

    expect(cancelStreamDownload(result.id!)).toBe(true)
    child.exitWith(null)

    expect(events.find((e) => e.type === 'cancelled')).toMatchObject({ id: result.id })
    expect(getStreamTask(result.id!)?.status).toBe('cancelled')
  })

  it('取消已暂停的任务（没有子进程）直接收尾并清掉临时目录', async () => {
    const { events, onEvent } = makeEvents()
    const result = await startStreamDownload(makeRequest(), onEvent)
    pauseStreamDownload(result.id!)
    lastChild().exitWith(null)

    expect(cancelStreamDownload(result.id!)).toBe(true)
    expect(events.filter((e) => e.type === 'cancelled')).toHaveLength(1)
    expect(activeStreamDownloadCount()).toBe(0)
  })

  it('重复取消与取消不存在的任务返回 false', async () => {
    const { onEvent } = makeEvents()
    const result = await startStreamDownload(makeRequest(), onEvent)
    expect(cancelStreamDownload(result.id!)).toBe(true)
    expect(cancelStreamDownload(result.id!)).toBe(false)
    expect(cancelStreamDownload('sd-missing')).toBe(false)
  })
})

describe('discardStreamDownload：删除任务时的兜底清理', () => {
  it('不存在的任务视为已丢弃', async () => {
    await expect(discardStreamDownload('sd-missing')).resolves.toBe(true)
  })

  it('进程已退出时立即返回，并清掉记录', async () => {
    const { onEvent } = makeEvents()
    const result = await startStreamDownload(makeRequest(), onEvent)
    const child = lastChild()
    child.exitCode = 0

    await expect(discardStreamDownload(result.id!)).resolves.toBe(true)
    expect(getStreamTask(result.id!)?.status).toBe('cancelled')
  })

  it('进程还活着时先结束再返回（不把临时文件留给下一次启动）', async () => {
    const { onEvent } = makeEvents()
    const result = await startStreamDownload(makeRequest(), onEvent)
    const child = lastChild()

    const pending = discardStreamDownload(result.id!)
    child.exitWith(null)
    await expect(pending).resolves.toBe(true)
    expect(state.spawnSyncCalls.length).toBeGreaterThan(0)
  })
})

describe('deleteStreamDownloadFile：只允许删自己下载目录里的文件', () => {
  it('相对路径直接拒绝', async () => {
    const result = await deleteStreamDownloadFile('relative/file.mp4', path.join(tmpDir, 'out'))
    expect(result).toEqual({ success: false, error: 'Invalid path' })
  })

  it('没登记过的输出目录拒绝（不认任意目录）', async () => {
    const result = await deleteStreamDownloadFile(
      path.join(tmpDir, 'elsewhere', 'file.mp4'),
      path.join(tmpDir, 'elsewhere')
    )
    expect(result).toEqual({ success: false, error: 'Unknown stream download directory' })
  })

  it('登记过目录但文件在其外部时拒绝（防 ../ 越界）', async () => {
    const outputDir = makeDir('out-delete-escape')
    const { onEvent } = makeEvents()
    await startStreamDownload(makeRequest({ outputDir }), onEvent)

    const outside = path.join(tmpDir, 'outside.mp4')
    fs.writeFileSync(outside, 'x', 'utf8')
    const result = await deleteStreamDownloadFile(outside, outputDir)
    expect(result).toEqual({ success: false, error: 'File is outside output directory' })
  })

  it('目标是目录时拒绝', async () => {
    const outputDir = makeDir('out-delete-dir')
    const { onEvent } = makeEvents()
    await startStreamDownload(makeRequest({ outputDir }), onEvent)
    const sub = path.join(outputDir, 'sub')
    fs.mkdirSync(sub)

    const result = await deleteStreamDownloadFile(sub, outputDir)
    expect(result).toEqual({ success: false, error: 'Not a file' })
  })

  it('文件本来就不存在时视为删除成功（重复删除不该报错）', async () => {
    const outputDir = makeDir('out-delete-missing')
    const { onEvent } = makeEvents()
    await startStreamDownload(makeRequest({ outputDir }), onEvent)

    const result = await deleteStreamDownloadFile(path.join(outputDir, 'gone.mp4'), outputDir)
    expect(result).toEqual({ success: true })
  })

  it('正常删除走系统回收站（不是直接抹掉）', async () => {
    const outputDir = makeDir('out-delete-ok')
    const { onEvent } = makeEvents()
    await startStreamDownload(makeRequest({ outputDir }), onEvent)
    const file = path.join(outputDir, 'trash-me.mp4')
    fs.writeFileSync(file, 'x', 'utf8')

    const result = await deleteStreamDownloadFile(file, outputDir)
    expect(result).toEqual({ success: true })
    expect(state.trashCalls).toEqual([file])
  })

  it('回收站失败时把原因带回渲染层', async () => {
    const outputDir = makeDir('out-delete-fail')
    const { onEvent } = makeEvents()
    await startStreamDownload(makeRequest({ outputDir }), onEvent)
    const file = path.join(outputDir, 'locked.mp4')
    fs.writeFileSync(file, 'x', 'utf8')
    state.trashError = new Error('EBUSY: resource busy or locked')

    const result = await deleteStreamDownloadFile(file, outputDir)
    expect(result.success).toBe(false)
    expect(result.error).toContain('EBUSY')
  })
})

describe('流媒体服务的兜底与边界', () => {
  function fakeRecord(url: string) {
    return { request: { url, outputDir: path.join(tmpDir, 'out') } } as unknown as Parameters<typeof registerStreamTask>[1]
  }

  it('任务快照表按容量淘汰最老的条目（进行中 50 / 已结束 20）', () => {
    for (let i = 0; i < 55; i += 1) registerStreamTask('active-' + i, fakeRecord('https://example.com/a' + i))
    const activeIds = listStreamTasks().filter((task) => task.status === 'active').map((task) => task.id)
    expect(activeIds).toHaveLength(50)
    expect(activeIds).not.toContain('active-0')
    expect(activeIds).toContain('active-54')

    for (const id of activeIds) updateStreamTask(id, { status: 'complete' })
    for (let i = 0; i < 25; i += 1) {
      registerStreamTask('done-' + i, fakeRecord('https://example.com/b' + i))
      updateStreamTask('done-' + i, { status: 'complete' })
    }
    const finished = listStreamTasks().filter((task) => task.status === 'complete')
    expect(finished.length).toBeLessThanOrEqual(20)
    expect(finished.map((task) => task.id)).toContain('done-24')
  })

  it('播放列表与 Cookie 校验失败时整单拒绝（不 spawn）', async () => {
    const { onEvent } = makeEvents()
    const badPlaylist = await startStreamDownload(makeRequest({ playlist: { ids: ['ok', 'bad id!'] } }), onEvent)
    expect(badPlaylist.success).toBe(false)
    expect(badPlaylist.code).toBe('invalid_request')

    const badCookie = await startStreamDownload(makeRequest({ cookieFile: path.join(tmpDir, 'missing.txt') }), onEvent)
    expect(badCookie.success).toBe(false)
    expect(badCookie.code).toBe('invalid_request')
    expect(state.spawnCalls).toHaveLength(0)
  })

  it('stdout 的空行被忽略，结尾残行在 end 时补解析', async () => {
    const { events, onEvent } = makeEvents()
    const result = await startStreamDownload(makeRequest(), onEvent)
    const child = lastChild()
    child.stdout.emit('data', Buffer.from('\n   \n', 'utf8'))
    expect(events.filter((e) => e.type === 'progress')).toHaveLength(0)
    child.stdout.emit('data', Buffer.from('__YTDLP_PROGRESS__ 5%|1|20|NA|NA|NA|1|NA|NA', 'utf8'))
    child.stdout.emit('end')
    const progress = events.find((e) => e.type === 'progress')
    expect(progress).toMatchObject({ id: result.id, percent: 5 })
  })

  it('进度行字段全缺失时解析为 null（不派发脏事件）', () => {
    expect(parseProgressLine('__YTDLP_PROGRESS__ NA|0|0|0|NA|NA|NA|NA|NA')).toBeNull()
  })

  it('暂停后再报进程错误只清句柄，不重复派发 failed', async () => {
    const { events, onEvent } = makeEvents()
    const result = await startStreamDownload(makeRequest(), onEvent)
    const child = lastChild()
    expect(pauseStreamDownload(result.id!)).toBe(true)
    child.emit('error', new Error('spawn EACCES'))
    expect(events.filter((e) => e.type === 'failed')).toHaveLength(0)
    expect(getStreamTask(result.id!)?.status).toBe('paused')
  })

  it('暂停不存在的任务返回 false', () => {
    expect(pauseStreamDownload('sd-does-not-exist')).toBe(false)
  })

  it('完成与失败规则执行抛错时只记日志，不影响任务状态', async () => {
    state.completionThrows = true
    const ok = makeEvents()
    const started = await startStreamDownload(makeRequest(), ok.onEvent)
    writeFinalPathFile(started.id!, [path.join(tmpDir, 'out', 'a.mp4')])
    fs.writeFileSync(path.join(tmpDir, 'out', 'a.mp4'), 'x', 'utf8')
    lastChild().exitWith(0)
    expect(getStreamTask(started.id!)?.status).toBe('complete')
    // 规则回调是 void + .catch，错误在微任务里才落到 logger
    await vi.waitFor(() => {
      expect(state.logs.warn.some((line) => String(line).includes('流媒体完成规则执行失败'))).toBe(true)
    })

    const bad = makeEvents()
    const failed = await startStreamDownload(makeRequest({ url: 'https://example.com/fail' }), bad.onEvent)
    const child = lastChild()
    child.stderr.emit('data', Buffer.from('boom', 'utf8'))
    child.exitWith(1)
    expect(getStreamTask(failed.id!)?.status).toBe('error')
    await vi.waitFor(() => {
      expect(state.logs.warn.some((line) => String(line).includes('流媒体失败规则执行失败'))).toBe(true)
    })
  })

  it('取消时按平台结束整棵进程树（Windows 走 taskkill，类 Unix 走进程组）', async () => {
    const { onEvent } = makeEvents()
    const started = await startStreamDownload(makeRequest(), onEvent)
    expect(cancelStreamDownload(started.id!)).toBe(true)
    expect(state.spawnSyncCalls[0]).toMatchObject({ file: 'taskkill' })

    const original = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((() => { throw new Error('ESRCH') }) as unknown as typeof process.kill)
    try {
      const unix = await startStreamDownload(makeRequest({ url: 'https://example.com/unix' }), onEvent)
      const child = lastChild()
      expect(cancelStreamDownload(unix.id!)).toBe(true)
      expect(killSpy).toHaveBeenCalledWith(-child.pid, 'SIGKILL')
      expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    } finally {
      killSpy.mockRestore()
      if (original) Object.defineProperty(process, 'platform', original)
    }
  })
})

describe('进程句柄缺失与退出兜底', () => {
  it('应用退出时兜底结束仍活着的子进程，已暂停无句柄的任务跳过', async () => {
    const original = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    try {
      await startStreamDownload(makeRequest(), makeEvents().onEvent)
      const liveChild = lastChild()
      const paused = await startStreamDownload(makeRequest({ url: 'https://example.com/paused' }), makeEvents().onEvent)
      const pausedChild = lastChild()
      expect(pauseStreamDownload(paused.id!)).toBe(true)
      // 暂停后子进程真的退出：exit 处理器把句柄置空但保留任务记录，正好覆盖 if (!proc) continue
      pausedChild.exitWith(null)
      expect(getStreamTask(paused.id!)?.status).toBe('paused')

      const before = state.spawnSyncCalls.length
      // process.on('exit') 的监听签名带退出码，这里直接喂 0 模拟正常退出
      serviceExitListener?.(0)

      expect(liveChild.kill).toHaveBeenCalledWith('SIGKILL')
      expect(state.spawnSyncCalls.length).toBe(before + 1)
      expect(state.spawnSyncCalls[state.spawnSyncCalls.length - 1]).toMatchObject({
        file: 'taskkill',
        args: ['/PID', String(liveChild.pid), '/T', '/F']
      })
      // 没有句柄的任务不该再被 kill 一次
      expect(pausedChild.kill).not.toHaveBeenCalled()
    } finally {
      if (original) Object.defineProperty(process, 'platform', original)
    }
  })

  it('子进程没有 pid 时结束进程树直接返回（不调 taskkill）', async () => {
    const { onEvent } = makeEvents()
    const started = await startStreamDownload(makeRequest(), onEvent)
    const child = lastChild()
    child.pid = 0

    expect(cancelStreamDownload(started.id!)).toBe(true)
    expect(state.spawnSyncCalls).toHaveLength(0)
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('记录已被丢弃后再报进程错误不派发失败事件', async () => {
    const { events, onEvent } = makeEvents()
    const started = await startStreamDownload(makeRequest(), onEvent)
    const child = lastChild()

    const pending = discardStreamDownload(started.id!)
    child.exitWith(null)
    await expect(pending).resolves.toBe(true)
    expect(getStreamTask(started.id!)?.status).toBe('cancelled')

    // 记录已从表里移除：迟到的 error 必须被陈旧记录守卫挡掉，不能再改任务状态
    child.emit('error', new Error('late spawn failure'))
    expect(events.filter((event) => event.type === 'failed')).toHaveLength(0)
    expect(getStreamTask(started.id!)?.status).toBe('cancelled')
  })

  it('进程句柄已置空时暂停只记日志并返回 false', async () => {
    const { onEvent } = makeEvents()
    const started = await startStreamDownload(makeRequest(), onEvent)
    const child = lastChild()
    expect(pauseStreamDownload(started.id!)).toBe(true)
    child.exitWith(null)
    expect(getStreamTask(started.id!)?.status).toBe('paused')

    // 恢复时 spawn 直接抛错：任务被留在「未暂停但也没有进程」的中间态，正是兜底分支的场景
    const cp = await import('child_process')
    vi.mocked(cp.spawn).mockImplementationOnce(((() => {
      throw new Error('spawn EAGAIN')
    }) as never))
    expect(() => resumeStreamDownload(started.id!)).toThrow(/spawn EAGAIN/)

    expect(pauseStreamDownload(started.id!)).toBe(false)
    expect(state.logs.warn.some((line) => String(line).includes('暂停流媒体下载失败'))).toBe(true)
  })
})
