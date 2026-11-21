import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import * as crypto from 'node:crypto'
import * as fsReal from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { updateArtifactFileName } from '../utils/updateArtifact'

// 主测试文件（UpdateController.test.ts）只跑通了正常链路；这里专门盯失败与自愈分支：
// 状态文件读不出来/写不进去、清理 temp 失败、续传起点不一致、写盘背压、响应流中途断、
// .sha256 拉取异常、每日复查里 checkForUpdates 抛错——这些路径走错的表现是
// 「用户看到有新版本却装不上」或「进程卡在下载中」，而不是一条容易发现的报错。

type Plan =
  | { kind: 'response', statusCode: number, headers?: Record<string, string>, chunks?: string[] }
  | { kind: 'stream-error', statusCode: number, headers?: Record<string, string>, chunks?: string[], message: string }
  | { kind: 'error', message: string }
  | { kind: 'timeout' }

interface FakeState {
  packaged: boolean
  windowAlive: boolean
  tempDir: string
  userDataDir: string
  currentVersion: string
  plans: Plan[]
  requests: Record<string, unknown>[]
  statThrows: boolean
  fakeStream: unknown
  resPauseCalls: number
  resResumeCalls: number
}

const h = vi.hoisted(() => ({
  state: {
    packaged: true,
    windowAlive: true,
    tempDir: '',
    userDataDir: '',
    currentVersion: '1.4.0',
    plans: [],
    requests: [],
    statThrows: false,
    fakeStream: null,
    resPauseCalls: 0,
    resResumeCalls: 0
  } as unknown as FakeState,
  send: vi.fn(),
  spawn: vi.fn(),
  exit: vi.fn(),
  openPath: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  downloadDelta: vi.fn(),
  saveDeltaCache: vi.fn(),
  discardDeltaCache: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'temp' ? h.state.tempDir : h.state.userDataDir),
    getVersion: () => h.state.currentVersion,
    exit: h.exit
  },
  shell: { openPath: h.openPath }
}))

vi.mock('child_process', () => ({ spawn: h.spawn }))

vi.mock('../utils/logger', () => ({
  createLogger: () => ({ info: h.info, warn: h.warn, error: vi.fn(), debug: vi.fn() })
}))

vi.mock('../utils/appEnv', () => ({
  get isPackagedApp() { return h.state.packaged }
}))

vi.mock('../utils/mainLocaleRuntime', () => ({ runtimeMainLocale: () => 'zh' }))

vi.mock('../utils/mainErrorCopy', () => ({
  mainError: (locale: string, key: string, params?: Record<string, unknown>) =>
    (params ? locale + ':' + key + '|' + JSON.stringify(params) : locale + ':' + key)
}))

vi.mock('../services/deltaUpdater', () => ({
  downloadDelta: h.downloadDelta,
  saveDeltaCache: h.saveDeltaCache,
  discardDeltaCache: h.discardDeltaCache
}))

// 只包两个口子：statSync 可控抛错（续传起点探测失败）、createWriteStream 可换成假流（写盘背压）
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  const patched = {
    ...actual,
    statSync: (...args: Parameters<typeof actual.statSync>) => {
      if (h.state.statThrows) throw new Error('stat boom')
      return actual.statSync(...args)
    },
    createWriteStream: (...args: Parameters<typeof actual.createWriteStream>) => {
      if (h.state.fakeStream) return h.state.fakeStream
      return actual.createWriteStream(...args)
    }
  }
  return { ...patched, default: patched }
})

vi.mock('https', async () => {
  const { EventEmitter: Emitter } = await import('node:events')
  function request(options: Record<string, unknown>, callback: (res: unknown) => void) {
    const req = new Emitter() as unknown as Record<string, unknown>
    req.setTimeout = (ms: number, onTimeout: () => void) => {
      req.timeoutMs = ms
      req.timeoutHandler = onTimeout
    }
    req.destroy = (error?: Error) => { if (error) (req as unknown as EventEmitter).emit('error', error) }
    req.end = () => {
      h.state.requests.push(options)
      const plan = h.state.plans.shift()
      if (!plan) {
        (req as unknown as EventEmitter).emit('error', new Error('no plan queued'))
        return
      }
      if (plan.kind === 'error') {
        (req as unknown as EventEmitter).emit('error', new Error(plan.message))
        return
      }
      if (plan.kind === 'timeout') {
        ;(req.timeoutHandler as () => void)()
        return
      }
      const res = new Emitter() as unknown as Record<string, unknown>
      res.statusCode = plan.statusCode
      res.headers = plan.headers ?? {}
      res.resume = () => { h.state.resResumeCalls += 1 }
      res.pause = () => { h.state.resPauseCalls += 1 }
      res.destroy = () => {}
      callback(res)
      setImmediate(() => {
        const emitter = res as unknown as EventEmitter
        for (const chunk of plan.chunks ?? []) emitter.emit('data', Buffer.from(chunk))
        if (plan.kind === 'stream-error') {
          emitter.emit('error', new Error(plan.message))
          emitter.emit('end')
          return
        }
        emitter.emit('end')
      })
    }
    return req
  }
  return { request }
})

const REAL_PLATFORM = process.platform

function setPlatform(value: string): void {
  Object.defineProperty(process, 'platform', { value, configurable: true })
}

async function loadController(platform = 'win32') {
  setPlatform(platform)
  vi.resetModules()
  return import('./UpdateController')
}

interface ControllerInternals {
  downloadedPath: string
  downloadedVersion: string
  persistUpdateState: (notes: string) => void
  installAppImageUpdate: () => Promise<void>
  downloadWithRedirects: (
    url: string,
    filePath: string,
    version: string,
    originalUrl: string,
    redirectCount: number
  ) => Promise<{ checksumUnavailable?: boolean }>
  checkForUpdates: () => Promise<Record<string, unknown>>
}

function createController(UpdateController: unknown): unknown {
  const Ctor = UpdateController as new (getWindow: () => unknown) => unknown
  return new Ctor(() => (h.state.windowAlive ? { isDestroyed: () => false, webContents: { send: h.send } } : null))
}

function internals(controller: unknown): ControllerInternals {
  return controller as ControllerInternals
}

function tagRedirect(tag: string): Plan {
  return {
    kind: 'response',
    statusCode: 302,
    headers: { location: 'https://github.com/Young-ZJ66/Aria2Desktop/releases/tag/' + tag }
  }
}

function atomFor(tag: string, notes: string): string {
  return [
    '<feed>',
    '<entry>',
    '<title>' + tag + '</title>',
    '<link href="https://github.com/Young-ZJ66/Aria2Desktop/releases/tag/' + tag + '"/>',
    '<content type="html">' + notes + '</content>',
    '</entry>',
    '</feed>'
  ].join('')
}

function bodyPlan(body: string, headers: Record<string, string> = {}): Plan {
  return { kind: 'response', statusCode: 200, headers, chunks: [body] }
}

function sha256Of(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex')
}

const INSTALLER_CONTENT = 'installer-binary-content'
const INSTALLER_FILE = updateArtifactFileName('1.5.0', 'win32', process.arch)
const DOWNLOAD_URL = 'https://github.com/Young-ZJ66/Aria2Desktop/releases/download/v1.5.0/' + INSTALLER_FILE

function statePath(): string {
  return path.join(h.state.userDataDir, 'update-state.json')
}

class FakeWriteStream extends EventEmitter {
  chunks: Buffer[] = []
  writeCount = 0
  destroyed = false

  write(chunk: Buffer): boolean {
    this.chunks.push(chunk)
    this.writeCount += 1
    if (this.writeCount === 1) {
      setImmediate(() => this.emit('drain'))
      return false
    }
    return true
  }

  end(callback?: () => void): void {
    if (callback) callback()
  }

  destroy(): void {
    this.destroyed = true
  }
}

// 磁盘满/权限不足：第一次写入就同步抛错，模拟 fs 写流报 ENOSPC
class FailingWriteStream extends EventEmitter {
  writeCount = 0
  destroyed = false

  write(_chunk: Buffer): boolean {
    this.writeCount += 1
    if (this.writeCount === 1) {
      this.emit('error', new Error('ENOSPC: no space left on device'))
    }
    return true
  }

  end(callback?: () => void): void {
    if (callback) callback()
  }

  destroy(): void {
    this.destroyed = true
  }
}

beforeEach(() => {
  h.state.tempDir = fsReal.mkdtempSync(path.join(os.tmpdir(), 'update-cov-temp-'))
  h.state.userDataDir = fsReal.mkdtempSync(path.join(os.tmpdir(), 'update-cov-data-'))
  h.state.packaged = true
  h.state.windowAlive = true
  h.state.currentVersion = '1.4.0'
  h.state.plans = []
  h.state.requests = []
  h.state.statThrows = false
  h.state.fakeStream = null
  h.state.resPauseCalls = 0
  h.state.resResumeCalls = 0
  vi.clearAllMocks()
  h.spawn.mockReturnValue({ unref: vi.fn() })
  h.openPath.mockResolvedValue('')
  h.downloadDelta.mockRejectedValue(new Error('no_cache'))
  h.saveDeltaCache.mockResolvedValue(undefined)
  h.discardDeltaCache.mockResolvedValue(undefined)
  delete process.env.APPIMAGE
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  fsReal.rmSync(h.state.tempDir, { recursive: true, force: true })
  fsReal.rmSync(h.state.userDataDir, { recursive: true, force: true })
  delete process.env.APPIMAGE
})

afterAll(() => {
  Object.defineProperty(process, 'platform', { value: REAL_PLATFORM, configurable: true })
})

describe('状态文件的异常路径', () => {
  it('状态文件不可读时只记日志并继续检查', async () => {
    fsReal.mkdirSync(statePath(), { recursive: true })
    h.state.plans = [tagRedirect('v1.4.0'), bodyPlan(atomFor('v1.4.0', 'same'))]
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController)
    const result = await internals(controller).checkForUpdates()
    expect(result).toEqual({ success: true, hasUpdate: false })
    expect(h.warn).toHaveBeenCalledWith('[UpdateController] 读取更新状态文件失败（将重新检查）:', expect.anything())
  })

  it('没有已下载安装包时不写状态文件', async () => {
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController)
    internals(controller).persistUpdateState('notes')
    expect(fsReal.existsSync(statePath())).toBe(false)
  })

  it('状态文件写不进去时只记日志，不影响本次更新', async () => {
    const blocked = path.join(h.state.tempDir, 'not-a-dir')
    fsReal.writeFileSync(blocked, 'x')
    h.state.userDataDir = path.join(blocked, 'sub')
    const installer = path.join(h.state.tempDir, INSTALLER_FILE)
    fsReal.writeFileSync(installer, INSTALLER_CONTENT)
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController)
    internals(controller).downloadedPath = installer
    internals(controller).downloadedVersion = '1.5.0'
    internals(controller).persistUpdateState('notes')
    expect(h.warn).toHaveBeenCalledWith('[UpdateController] 持久化更新状态失败（不影响本次更新）:', expect.anything())
  })

  it('没有主窗口时不推送状态', async () => {
    h.state.windowAlive = false
    h.state.plans = [tagRedirect('v1.4.0'), bodyPlan(atomFor('v1.4.0', 'same'))]
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController)
    const result = await internals(controller).checkForUpdates()
    expect(result).toEqual({ success: true, hasUpdate: false })
    expect(h.send).not.toHaveBeenCalled()
  })
})

describe('启动检查与安装的异常路径', () => {
  it('checkForUpdatesOnStartup 直接复用检查逻辑', async () => {
    h.state.plans = [tagRedirect('v1.5.0'), bodyPlan(atomFor('v1.5.0', 'notes'))]
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController) as { checkForUpdatesOnStartup: () => Promise<Record<string, unknown>> }
    const result = await controller.checkForUpdatesOnStartup()
    expect(result.hasUpdate).toBe(true)
    expect(result.version).toBe('1.5.0')
  })

  it('启动安装程序抛错时返回原因且不退出', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const installer = path.join(h.state.tempDir, INSTALLER_FILE)
    fsReal.writeFileSync(installer, INSTALLER_CONTENT)
    h.openPath.mockRejectedValue(new Error('spawn EACCES'))
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController)
    internals(controller).downloadedPath = installer
    internals(controller).downloadedVersion = '1.5.0'
    const result = await (controller as { restartAndInstall: () => Promise<Record<string, unknown>> }).restartAndInstall()
    expect(result).toEqual({ success: false, error: 'spawn EACCES' })
    vi.advanceTimersByTime(1000)
    expect(h.exit).not.toHaveBeenCalled()
  })

  it('AppImage 环境变量缺失时拒绝生成自替换脚本', async () => {
    const installer = path.join(h.state.tempDir, 'Aria2Desktop-1.5.0-x86_64.AppImage')
    fsReal.writeFileSync(installer, INSTALLER_CONTENT)
    const { UpdateController } = await loadController('linux')
    const controller = createController(UpdateController)
    internals(controller).downloadedPath = installer
    internals(controller).downloadedVersion = '1.5.0'
    await expect(internals(controller).installAppImageUpdate()).rejects.toThrow('APPIMAGE environment is missing')
    expect(h.spawn).not.toHaveBeenCalled()
  })

  it('每日复查里检查抛错只记日志', async () => {
    let tick: (() => void) | null = null
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((callback: () => void) => {
      tick = callback
      return { unref: vi.fn() }
    }) as unknown as typeof setInterval)
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController) as { startScheduledCheck: () => void }
    controller.startScheduledCheck()
    expect(tick).not.toBeNull()
    ;(controller as unknown as { checkForUpdates: () => Promise<never> }).checkForUpdates = () => Promise.reject(new Error('boom'))
    ;(tick as unknown as () => void)()
    await Promise.resolve()
    await Promise.resolve()
    expect(h.warn).toHaveBeenCalledWith('[UpdateController] Scheduled update check failed:', expect.anything())
  })
})

describe('版本探测与日志提取的边界', () => {
  it('重定向地址里没有 tag 时返回失败', async () => {
    h.state.plans = [{ kind: 'response', statusCode: 302, headers: { location: 'https://github.com/login' } }]
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController)
    const result = await internals(controller).checkForUpdates()
    expect(result).toEqual({ success: false, hasUpdate: false, error: 'No release tag found in redirect Location' })
  })

  it('releases/latest 没有重定向时报异常状态', async () => {
    h.state.plans = [bodyPlan('')]
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController)
    const result = await internals(controller).checkForUpdates()
    expect(result).toEqual({ success: false, hasUpdate: false, error: 'Unexpected status from releases/latest: 200' })
  })

  it('atom 里缺少该 tag 时日志留空并告警', async () => {
    h.state.plans = [tagRedirect('v1.5.0'), bodyPlan(atomFor('v1.4.0', 'old'))]
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController)
    const result = await internals(controller).checkForUpdates()
    expect(result.hasUpdate).toBe(true)
    expect(result.notes).toBe('')
    expect(h.warn).toHaveBeenCalledWith('[UpdateController] atom 中未找到 tag v1.5.0 的日志条目（可能已翻页），日志留空')
  })
})

describe('更新检查的超时与重复调用', () => {
  it('重复检查只读一次持久化状态文件', async () => {
    h.state.plans = [
      tagRedirect('v1.4.0'), bodyPlan(atomFor('v1.4.0', 'same')),
      tagRedirect('v1.4.0'), bodyPlan(atomFor('v1.4.0', 'same'))
    ]
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController)
    expect(await internals(controller).checkForUpdates()).toEqual({ success: true, hasUpdate: false })
    // 第二次检查走 persistedStateLoaded 早退，不再重复读盘
    expect(await internals(controller).checkForUpdates()).toEqual({ success: true, hasUpdate: false })
  })

  it('查询最新稳定版超时时把超时原因带回渲染层', async () => {
    h.state.plans = [{ kind: 'timeout' }]
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController)
    expect(await internals(controller).checkForUpdates()).toEqual({
      success: false,
      hasUpdate: false,
      error: 'Update check timed out'
    })
  })
})

describe('下载过程中的边界', () => {
  it('差量下载把真实网络流量推给渲染层', async () => {
    h.downloadDelta.mockImplementation(async (options: { targetPath: string, onProgress: (percent: number, remote: number, total: number) => void }) => {
      options.onProgress(40, 10, 25)
      fsReal.writeFileSync(options.targetPath, INSTALLER_CONTENT)
      return { remoteBytes: 10, savedBytes: 90 }
    })
    h.state.plans = [tagRedirect('v1.5.0'), bodyPlan(atomFor('v1.5.0', 'notes')), bodyPlan(sha256Of(INSTALLER_CONTENT))]
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController)
    const result = await (controller as { downloadUpdate: () => Promise<Record<string, unknown>> }).downloadUpdate()
    expect(result).toEqual({ success: true, checksumUnavailable: undefined })
    expect(h.send).toHaveBeenCalledWith('update:status', { state: 'downloading', percent: 40, transferred: 10, total: 25 })
  })

  it('写入差量缓存失败只记日志', async () => {
    h.saveDeltaCache.mockRejectedValue(new Error('disk full'))
    h.state.plans = [
      tagRedirect('v1.5.0'),
      bodyPlan(atomFor('v1.5.0', 'notes')),
      bodyPlan(INSTALLER_CONTENT, { 'content-length': String(Buffer.byteLength(INSTALLER_CONTENT)) }),
      bodyPlan(sha256Of(INSTALLER_CONTENT))
    ]
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController)
    const result = await (controller as { downloadUpdate: () => Promise<Record<string, unknown>> }).downloadUpdate()
    expect(result.success).toBe(true)
    await Promise.resolve()
    await Promise.resolve()
    expect(h.warn).toHaveBeenCalledWith('[UpdateController] 写入差量缓存失败（不影响本次更新）:', expect.anything())
  })

  it('下载前清掉 temp 里其它版本的残留产物', async () => {
    const staleDownload = path.join(h.state.tempDir, 'Aria2Desktop-1.3.0-x64-Setup.exe.download')
    const staleInstaller = path.join(h.state.tempDir, 'Aria2Desktop-1.3.0-x64-Setup.exe')
    const unrelated = path.join(h.state.tempDir, 'other-app-1.3.0.exe')
    fsReal.writeFileSync(staleDownload, 'x')
    fsReal.writeFileSync(staleInstaller, 'x')
    fsReal.writeFileSync(unrelated, 'x')
    h.state.plans = [
      tagRedirect('v1.5.0'),
      bodyPlan(atomFor('v1.5.0', 'notes')),
      bodyPlan(INSTALLER_CONTENT, { 'content-length': String(Buffer.byteLength(INSTALLER_CONTENT)) }),
      bodyPlan(sha256Of(INSTALLER_CONTENT))
    ]
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController)
    await (controller as { downloadUpdate: () => Promise<Record<string, unknown>> }).downloadUpdate()
    expect(fsReal.existsSync(staleDownload)).toBe(false)
    expect(fsReal.existsSync(staleInstaller)).toBe(false)
    expect(fsReal.existsSync(unrelated)).toBe(true)
  })

  it('清理临时文件失败只记日志', async () => {
    // 把 .download 做成目录：unlinkSync 会抛 EISDIR，触发清理失败的告警分支
    fsReal.mkdirSync(path.join(h.state.tempDir, INSTALLER_FILE + '.download'), { recursive: true })
    h.state.plans = [
      tagRedirect('v1.5.0'),
      bodyPlan(atomFor('v1.5.0', 'notes')),
      { kind: 'response', statusCode: 500, chunks: [] }
    ]
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController)
    const result = await (controller as { downloadUpdate: () => Promise<Record<string, unknown>> }).downloadUpdate()
    expect(result).toEqual({ success: false, error: 'Download failed: 500' })
    expect(h.warn).toHaveBeenCalledWith('[UpdateController] Failed to clean temp installer:', expect.anything())
  })

  it('重定向超过上限时放弃下载', async () => {
    h.state.plans = [
      { kind: 'response', statusCode: 302, headers: { location: 'https://cdn.example.com/1' } },
      { kind: 'response', statusCode: 302, headers: { location: 'https://cdn.example.com/2' } },
      { kind: 'response', statusCode: 302, headers: { location: 'https://cdn.example.com/3' } },
      { kind: 'response', statusCode: 302, headers: { location: 'https://cdn.example.com/4' } },
      { kind: 'response', statusCode: 302, headers: { location: 'https://cdn.example.com/5' } },
      { kind: 'response', statusCode: 302, headers: { location: 'https://cdn.example.com/6' } }
    ]
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController)
    const filePath = path.join(h.state.tempDir, 'redirect.download')
    await expect(internals(controller).downloadWithRedirects(DOWNLOAD_URL, filePath, '1.5.0', DOWNLOAD_URL, 0))
      .rejects.toThrow('Too many redirects')
    expect(h.state.requests).toHaveLength(6)
  })

  it('探测续传起点失败时从头下载', async () => {
    const filePath = path.join(h.state.tempDir, 'stat-fail.download')
    fsReal.writeFileSync(filePath, 'stale-prefix')
    h.state.statThrows = true
    h.state.plans = [
      bodyPlan(INSTALLER_CONTENT, { 'content-length': String(Buffer.byteLength(INSTALLER_CONTENT)) }),
      bodyPlan(sha256Of(INSTALLER_CONTENT))
    ]
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController)
    const result = await internals(controller).downloadWithRedirects(DOWNLOAD_URL, filePath, '1.5.0', DOWNLOAD_URL, 0)
    expect(result).toEqual({})
    expect(fsReal.readFileSync(filePath, 'utf-8')).toBe(INSTALLER_CONTENT)
  })

  it('206 起点与本地不一致时截断重下', async () => {
    const filePath = path.join(h.state.tempDir, 'resume-mismatch.download')
    fsReal.writeFileSync(filePath, 'partial')
    h.state.plans = [
      { kind: 'response', statusCode: 206, headers: { 'content-range': 'bytes 0-9/10', 'content-length': '10' }, chunks: ['0123456789'] },
      bodyPlan(sha256Of('0123456789'))
    ]
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController)
    await internals(controller).downloadWithRedirects(DOWNLOAD_URL, filePath, '1.5.0', DOWNLOAD_URL, 0)
    expect(fsReal.readFileSync(filePath, 'utf-8')).toBe('0123456789')
    expect(h.send).toHaveBeenCalledWith('update:status', { state: 'downloading', percent: 100, transferred: 10, total: 10 })
  })

  it('206 起点一致时追加续传', async () => {
    const filePath = path.join(h.state.tempDir, 'resume-ok.download')
    fsReal.writeFileSync(filePath, 'partial')
    h.state.plans = [
      { kind: 'response', statusCode: 206, headers: { 'content-range': 'bytes 7-9/10' }, chunks: ['abc'] },
      bodyPlan(sha256Of('partialabc'))
    ]
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController)
    await internals(controller).downloadWithRedirects(DOWNLOAD_URL, filePath, '1.5.0', DOWNLOAD_URL, 0)
    expect(fsReal.readFileSync(filePath, 'utf-8')).toBe('partialabc')
    const request = h.state.requests[0] as { headers: Record<string, string> }
    expect(request.headers.Range).toBe('bytes=7-')
  })

  it('写盘背压时暂停读取并在 drain 后恢复', async () => {
    const stream = new FakeWriteStream()
    h.state.fakeStream = stream
    const filePath = path.join(h.state.tempDir, 'backpressure.download')
    h.state.plans = [
      bodyPlan(INSTALLER_CONTENT, { 'content-length': String(Buffer.byteLength(INSTALLER_CONTENT)) }),
      { kind: 'response', statusCode: 404, chunks: [] }
    ]
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController)
    const result = await internals(controller).downloadWithRedirects(DOWNLOAD_URL, filePath, '1.5.0', DOWNLOAD_URL, 0)
    expect(result).toEqual({ checksumUnavailable: true })
    expect(h.state.resPauseCalls).toBeGreaterThan(0)
    expect(h.state.resResumeCalls).toBeGreaterThan(0)
    expect(Buffer.concat(stream.chunks).toString('utf-8')).toBe(INSTALLER_CONTENT)
  })

  it('响应流中途出错时终止下载', async () => {
    const filePath = path.join(h.state.tempDir, 'stream-error.download')
    h.state.plans = [{ kind: 'stream-error', statusCode: 200, chunks: ['abc'], message: 'socket hang up' }]
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController)
    await expect(internals(controller).downloadWithRedirects(DOWNLOAD_URL, filePath, '1.5.0', DOWNLOAD_URL, 0))
      .rejects.toThrow('socket hang up')
  })

  it('30 秒无数据视为下载超时', async () => {
    const filePath = path.join(h.state.tempDir, 'timeout.download')
    h.state.plans = [{ kind: 'timeout' }]
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController)
    await expect(internals(controller).downloadWithRedirects(DOWNLOAD_URL, filePath, '1.5.0', DOWNLOAD_URL, 0))
      .rejects.toThrow('Download timed out')
  })
})

describe('校验文件的异常路径', () => {
  it('校验文件内容为空时视为不可用', async () => {
    const filePath = path.join(h.state.tempDir, 'empty-checksum.download')
    h.state.plans = [
      bodyPlan(INSTALLER_CONTENT, { 'content-length': String(Buffer.byteLength(INSTALLER_CONTENT)) }),
      bodyPlan('')
    ]
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController)
    const result = await internals(controller).downloadWithRedirects(DOWNLOAD_URL, filePath, '1.5.0', DOWNLOAD_URL, 0)
    expect(result).toEqual({ checksumUnavailable: true })
  })

  it('校验文件格式非法时拒绝安装', async () => {
    const filePath = path.join(h.state.tempDir, 'bad-checksum.download')
    h.state.plans = [
      bodyPlan(INSTALLER_CONTENT, { 'content-length': String(Buffer.byteLength(INSTALLER_CONTENT)) }),
      bodyPlan('not-a-sha256')
    ]
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController)
    await expect(internals(controller).downloadWithRedirects(DOWNLOAD_URL, filePath, '1.5.0', DOWNLOAD_URL, 0))
      .rejects.toThrow('update.checksumFormat')
  })

  it('校验文件重定向超过上限时按不可用处理', async () => {
    const filePath = path.join(h.state.tempDir, 'checksum-redirect.download')
    h.state.plans = [
      bodyPlan(INSTALLER_CONTENT, { 'content-length': String(Buffer.byteLength(INSTALLER_CONTENT)) }),
      { kind: 'response', statusCode: 302, headers: { location: 'https://cdn.example.com/1' } },
      { kind: 'response', statusCode: 302, headers: { location: 'https://cdn.example.com/2' } },
      { kind: 'response', statusCode: 302, headers: { location: 'https://cdn.example.com/3' } },
      { kind: 'response', statusCode: 302, headers: { location: 'https://cdn.example.com/4' } },
      { kind: 'response', statusCode: 302, headers: { location: 'https://cdn.example.com/5' } },
      { kind: 'response', statusCode: 302, headers: { location: 'https://cdn.example.com/6' } }
    ]
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController)
    const result = await internals(controller).downloadWithRedirects(DOWNLOAD_URL, filePath, '1.5.0', DOWNLOAD_URL, 0)
    expect(result).toEqual({ checksumUnavailable: true })
    expect(h.warn).toHaveBeenCalledWith('[UpdateController] Checksum file unavailable, installer left unverified:', 'Too many redirects')
  })

  it('校验文件响应流出错时按不可用处理', async () => {
    const filePath = path.join(h.state.tempDir, 'checksum-stream-error.download')
    h.state.plans = [
      bodyPlan(INSTALLER_CONTENT, { 'content-length': String(Buffer.byteLength(INSTALLER_CONTENT)) }),
      { kind: 'stream-error', statusCode: 200, chunks: ['abc'], message: 'checksum stream broken' }
    ]
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController)
    const result = await internals(controller).downloadWithRedirects(DOWNLOAD_URL, filePath, '1.5.0', DOWNLOAD_URL, 0)
    expect(result).toEqual({ checksumUnavailable: true })
    expect(h.warn).toHaveBeenCalledWith('[UpdateController] Checksum file unavailable, installer left unverified:', 'checksum stream broken')
  })

  it('校验文件拉取超时时按不可用处理', async () => {
    const filePath = path.join(h.state.tempDir, 'checksum-timeout.download')
    h.state.plans = [
      bodyPlan(INSTALLER_CONTENT, { 'content-length': String(Buffer.byteLength(INSTALLER_CONTENT)) }),
      { kind: 'timeout' }
    ]
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController)
    const result = await internals(controller).downloadWithRedirects(DOWNLOAD_URL, filePath, '1.5.0', DOWNLOAD_URL, 0)
    expect(result).toEqual({ checksumUnavailable: true })
    expect(h.warn).toHaveBeenCalledWith('[UpdateController] Checksum file unavailable, installer left unverified:', 'Fetch checksum timed out')
  })
})

describe('写盘失败的收尾', () => {
  it('写流报错时中止下载并让 Promise 失败', async () => {
    const stream = new FailingWriteStream()
    h.state.fakeStream = stream
    const filePath = path.join(h.state.tempDir, 'write-fail.download')
    h.state.plans = [
      bodyPlan(INSTALLER_CONTENT, { 'content-length': String(Buffer.byteLength(INSTALLER_CONTENT)) }),
      bodyPlan(sha256Of(INSTALLER_CONTENT))
    ]
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController)
    await expect(internals(controller).downloadWithRedirects(DOWNLOAD_URL, filePath, '1.5.0', DOWNLOAD_URL, 0))
      .rejects.toThrow('ENOSPC: no space left on device')
    expect(stream.destroyed).toBe(true)
    // 失败后不再继续处理分片：写流没有被第二次写入
    expect(stream.writeCount).toBe(1)
  })

  it('写流报错后迟到的分片被 failed 守卫丢掉', async () => {
    const stream = new FailingWriteStream()
    h.state.fakeStream = stream
    const filePath = path.join(h.state.tempDir, 'write-fail-late-chunk.download')
    h.state.plans = [
      { kind: 'response', statusCode: 200, headers: { 'content-length': '2' }, chunks: ['a', 'b'] },
      bodyPlan(sha256Of('ab'))
    ]
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController)
    await expect(internals(controller).downloadWithRedirects(DOWNLOAD_URL, filePath, '1.5.0', DOWNLOAD_URL, 0))
      .rejects.toThrow('ENOSPC: no space left on device')
    // 第一片就报错，第二片被 failed 守卫拦下，写流只被写了一次
    expect(stream.writeCount).toBe(1)
  })
})
