import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { EventEmitter as NodeEventEmitter } from 'node:events'
import { updateArtifactFileName } from '../utils/updateArtifact'

type Plan =
  | { kind: 'response', statusCode: number, headers?: Record<string, string>, chunks?: string[] }
  | { kind: 'error', message: string }
  | { kind: 'timeout' }

interface FakeState {
  packaged: boolean
  locale: 'zh' | 'en'
  windowAlive: boolean
  tempDir: string
  userDataDir: string
  currentVersion: string
  plans: Plan[]
  requests: Record<string, unknown>[]
}

const h = vi.hoisted(() => ({
  state: {
    packaged: true,
    locale: 'zh',
    windowAlive: true,
    tempDir: '',
    userDataDir: '',
    currentVersion: '1.4.0',
    plans: [],
    requests: []
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

vi.mock('../utils/mainLocaleRuntime', () => ({ runtimeMainLocale: () => h.state.locale }))

vi.mock('../utils/mainErrorCopy', () => ({
  mainError: (locale: string, key: string, params?: Record<string, unknown>) =>
    (params ? `${locale}:${key}|${JSON.stringify(params)}` : `${locale}:${key}`)
}))

vi.mock('../services/deltaUpdater', () => ({
  downloadDelta: h.downloadDelta,
  saveDeltaCache: h.saveDeltaCache,
  discardDeltaCache: h.discardDeltaCache
}))

vi.mock('https', async () => {
  const { EventEmitter } = await import('node:events')
  function request(options: Record<string, unknown>, callback: (res: unknown) => void) {
    const req = new EventEmitter() as unknown as Record<string, unknown>
    req.setTimeout = (ms: number, onTimeout: () => void) => {
      req.timeoutMs = ms
      req.timeoutHandler = onTimeout
    }
    req.destroy = (error?: Error) => { if (error) (req as unknown as NodeEventEmitter).emit('error', error) }
    req.end = () => {
      h.state.requests.push(options)
      const plan = h.state.plans.shift()
      if (!plan) {
        (req as unknown as NodeEventEmitter).emit('error', new Error('no plan queued'))
        return
      }
      if (plan.kind === 'error') {
        (req as unknown as NodeEventEmitter).emit('error', new Error(plan.message))
        return
      }
      if (plan.kind === 'timeout') {
        ;(req.timeoutHandler as () => void)()
        return
      }
      const res = new EventEmitter() as unknown as Record<string, unknown>
      res.statusCode = plan.statusCode
      res.headers = plan.headers ?? {}
      res.resume = () => {}
      res.pause = () => {}
      res.destroy = () => {}
      callback(res)
      setImmediate(() => {
        const emitter = res as unknown as NodeEventEmitter
        for (const chunk of plan.chunks ?? []) emitter.emit('data', Buffer.from(chunk))
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

type GetWindow = () => unknown

function makeWindow(): Record<string, unknown> {
  return {
    isDestroyed: () => !h.state.windowAlive,
    webContents: { send: h.send }
  }
}

function createController(UpdateController: unknown): unknown {
  const Ctor = UpdateController as new (getWindow: GetWindow) => unknown
  return new Ctor(() => (h.state.windowAlive ? makeWindow() : null))
}

interface Internals {
  isDownloading: boolean
  downloadedPath: string
  downloadedVersion: string
}

function internals(controller: unknown): Internals {
  return controller as Internals
}

function tagRedirect(tag: string): Plan {
  return {
    kind: 'response',
    statusCode: 302,
    headers: { location: `https://github.com/Young-ZJ66/Aria2Desktop/releases/tag/${tag}` }
  }
}

function atomFor(tag: string, notes: string): string {
  return [
    '<feed>',
    '<entry>',
    `<title>${tag}</title>`,
    `<link href="https://github.com/Young-ZJ66/Aria2Desktop/releases/tag/${tag}"/>`,
    `<content type="html">${notes}</content>`,
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

function statePath(): string {
  return path.join(h.state.userDataDir, 'update-state.json')
}

function writeStateFile(value: unknown): void {
  fs.writeFileSync(statePath(), JSON.stringify(value), 'utf-8')
}

beforeEach(() => {
  h.state.tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'update-temp-'))
  h.state.userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'update-data-'))
  h.state.packaged = true
  h.state.locale = 'zh'
  h.state.windowAlive = true
  h.state.currentVersion = '1.4.0'
  h.state.plans = []
  h.state.requests = []
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
  fs.rmSync(h.state.tempDir, { recursive: true, force: true })
  fs.rmSync(h.state.userDataDir, { recursive: true, force: true })
  delete process.env.APPIMAGE
})

afterAll(() => {
  Object.defineProperty(process, 'platform', { value: REAL_PLATFORM, configurable: true })
})

describe('parsePersistedUpdateState', () => {
  it('解析合法状态文件', async () => {
    const { parsePersistedUpdateState } = await loadController()
    const parsed = parsePersistedUpdateState(JSON.stringify({
      downloadedPath: '/tmp/a.exe',
      downloadedVersion: ' 1.5.0 ',
      notes: 'notes',
      savedAt: 123
    }))
    expect(parsed).toEqual({
      downloadedPath: '/tmp/a.exe',
      downloadedVersion: '1.5.0',
      notes: 'notes',
      savedAt: 123
    })
  })

  it('非法 JSON 返回 null', async () => {
    const { parsePersistedUpdateState } = await loadController()
    expect(parsePersistedUpdateState('{oops')).toBeNull()
  })

  it('缺少路径或版本时返回 null', async () => {
    const { parsePersistedUpdateState } = await loadController()
    expect(parsePersistedUpdateState(JSON.stringify({ downloadedVersion: '1.5.0' }))).toBeNull()
    expect(parsePersistedUpdateState(JSON.stringify({ downloadedPath: '/tmp/a.exe' }))).toBeNull()
    expect(parsePersistedUpdateState(JSON.stringify({ downloadedPath: '  ', downloadedVersion: '1.5.0' }))).toBeNull()
    expect(parsePersistedUpdateState(JSON.stringify({ downloadedPath: '/tmp/a.exe', downloadedVersion: '' }))).toBeNull()
  })

  it('notes 与 savedAt 类型不符时用安全默认值', async () => {
    const { parsePersistedUpdateState } = await loadController()
    const parsed = parsePersistedUpdateState(JSON.stringify({
      downloadedPath: '/tmp/a.exe',
      downloadedVersion: '1.5.0',
      notes: 42,
      savedAt: 'soon'
    }))
    expect(parsed).toEqual({ downloadedPath: '/tmp/a.exe', downloadedVersion: '1.5.0', notes: '', savedAt: 0 })
  })

  it('顶层不是对象时返回 null', async () => {
    const { parsePersistedUpdateState } = await loadController()
    expect(parsePersistedUpdateState('null')).toBeNull()
    expect(parsePersistedUpdateState('[]')).toBeNull()
    expect(parsePersistedUpdateState('"text"')).toBeNull()
  })
})

describe('checkForUpdates', () => {
  it('开发模式直接拒绝，不发任何请求', async () => {
    h.state.packaged = false
    const { UpdateController } = await loadController()
    const result = await (createController(UpdateController) as { checkForUpdates: () => Promise<Record<string, unknown>> }).checkForUpdates()
    expect(result).toEqual({ success: false, hasUpdate: false, error: 'Development mode does not support auto update' })
    expect(h.state.requests).toHaveLength(0)
  })

  it('没有新版本时推送 not-available', async () => {
    h.state.plans = [tagRedirect('v1.4.0'), bodyPlan(atomFor('v1.4.0', 'same'))]
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController) as { checkForUpdates: () => Promise<Record<string, unknown>> }
    const result = await controller.checkForUpdates()
    expect(result).toEqual({ success: true, hasUpdate: false })
    expect(h.send).toHaveBeenCalledWith('update:status', { state: 'not-available' })
  })

  it('有新版本时推送 available 并带版本与日志', async () => {
    h.state.plans = [tagRedirect('v1.5.0'), bodyPlan(atomFor('v1.5.0', '新版本说明 &amp; 修复'))]
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController) as { checkForUpdates: () => Promise<Record<string, unknown>> }
    const result = await controller.checkForUpdates()
    expect(result).toEqual({
      success: true,
      hasUpdate: true,
      version: '1.5.0',
      notes: '新版本说明 & 修复',
      alreadyDownloaded: false,
      manualDownload: false
    })
    expect(h.send).toHaveBeenCalledWith('update:status', {
      state: 'available',
      version: '1.5.0',
      notes: '新版本说明 & 修复',
      manualDownload: false
    })
  })

  it('atom 拉取失败时用持久化日志兜底', async () => {
    const installer = path.join(h.state.tempDir, 'Aria2Desktop-1.5.0-x64-Setup.exe')
    fs.writeFileSync(installer, INSTALLER_CONTENT)
    writeStateFile({ downloadedPath: installer, downloadedVersion: '1.5.0', notes: '上次的日志', savedAt: 1 })
    h.state.plans = [tagRedirect('v1.5.0'), { kind: 'error', message: 'atom down' }]
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController) as { checkForUpdates: () => Promise<Record<string, unknown>> }
    const result = await controller.checkForUpdates()
    expect(result.hasUpdate).toBe(true)
    expect(result.notes).toBe('上次的日志')
    expect(h.warn).toHaveBeenCalled()
  })

  it('版本探测失败时返回失败原因', async () => {
    h.state.plans = [{ kind: 'error', message: 'network down' }]
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController) as { checkForUpdates: () => Promise<Record<string, unknown>> }
    const result = await controller.checkForUpdates()
    expect(result).toEqual({ success: false, hasUpdate: false, error: 'network down' })
  })
})

describe('downloadUpdate', () => {
  it('开发模式拒绝下载', async () => {
    h.state.packaged = false
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController) as { downloadUpdate: () => Promise<Record<string, unknown>> }
    expect(await controller.downloadUpdate()).toEqual({
      success: false,
      error: 'Development mode does not support auto update'
    })
  })

  it('不支持应用内安装的平台返回 manual_download_required', async () => {
    const { UpdateController } = await loadController('linux')
    const controller = createController(UpdateController) as { downloadUpdate: () => Promise<Record<string, unknown>> }
    expect(await controller.downloadUpdate()).toEqual({ success: false, error: 'manual_download_required' })
    expect(h.state.requests).toHaveLength(0)
  })

  it('正在下载时拒绝重复进入', async () => {
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController)
    internals(controller).isDownloading = true
    const result = await (controller as { downloadUpdate: () => Promise<Record<string, unknown>> }).downloadUpdate()
    expect(result).toEqual({ success: false, error: 'Download already in progress' })
  })

  it('没有新版本时拒绝下载', async () => {
    h.state.plans = [tagRedirect('v1.4.0'), bodyPlan(atomFor('v1.4.0', 'same'))]
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController) as { downloadUpdate: () => Promise<Record<string, unknown>> }
    expect(await controller.downloadUpdate()).toEqual({ success: false, error: 'No update available' })
  })

  it('同版本已下载时直接复用，不重复请求安装包', async () => {
    const installer = path.join(h.state.tempDir, INSTALLER_FILE)
    fs.writeFileSync(installer, INSTALLER_CONTENT)
    h.state.plans = [tagRedirect('v1.5.0'), bodyPlan(atomFor('v1.5.0', 'notes'))]
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController)
    internals(controller).downloadedPath = installer
    internals(controller).downloadedVersion = '1.5.0'
    const result = await (controller as { downloadUpdate: () => Promise<Record<string, unknown>> }).downloadUpdate()
    expect(result).toEqual({ success: true })
    expect(h.state.requests).toHaveLength(2)
    expect(h.send).toHaveBeenCalledWith('update:status', { state: 'downloaded', version: '1.5.0' })
  })

  it('差量可用时只额外拉取校验文件', async () => {
    h.downloadDelta.mockImplementation(async (options: { targetPath: string }) => {
      fs.writeFileSync(options.targetPath, INSTALLER_CONTENT)
      return { remoteBytes: 10, savedBytes: 90 }
    })
    h.state.plans = [tagRedirect('v1.5.0'), bodyPlan(atomFor('v1.5.0', 'notes')), bodyPlan(`${sha256Of(INSTALLER_CONTENT)}  file.exe`)]
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController)
    const result = await (controller as { downloadUpdate: () => Promise<Record<string, unknown>> }).downloadUpdate()
    expect(result).toEqual({ success: true, checksumUnavailable: undefined })
    expect(h.state.requests).toHaveLength(3)
    expect(h.downloadDelta).toHaveBeenCalledTimes(1)
    expect(fs.readFileSync(path.join(h.state.tempDir, INSTALLER_FILE), 'utf-8')).toBe(INSTALLER_CONTENT)
  })

  it('差量不可用时回落全量并跟随重定向', async () => {
    h.state.plans = [
      tagRedirect('v1.5.0'),
      bodyPlan(atomFor('v1.5.0', 'notes')),
      { kind: 'response', statusCode: 302, headers: { location: 'https://cdn.example.com/a.exe' } },
      bodyPlan(INSTALLER_CONTENT, { 'content-length': String(Buffer.byteLength(INSTALLER_CONTENT)) }),
      bodyPlan(`${sha256Of(INSTALLER_CONTENT)}`)
    ]
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController)
    const result = await (controller as { downloadUpdate: () => Promise<Record<string, unknown>> }).downloadUpdate()
    expect(result.success).toBe(true)
    expect(h.state.requests).toHaveLength(5)
    expect(h.info).toHaveBeenCalledWith(
      '[UpdateController] 差量更新不可用，回落全量下载:',
      'no_cache'
    )
    expect(h.send).toHaveBeenCalledWith('update:status', {
      state: 'downloading',
      percent: 100,
      transferred: Buffer.byteLength(INSTALLER_CONTENT),
      total: Buffer.byteLength(INSTALLER_CONTENT)
    })
  })

  it('下载成功后转正并写入 update-state.json', async () => {
    h.state.plans = [
      tagRedirect('v1.5.0'),
      bodyPlan(atomFor('v1.5.0', '本次日志')),
      bodyPlan(INSTALLER_CONTENT, { 'content-length': String(Buffer.byteLength(INSTALLER_CONTENT)) }),
      bodyPlan(`${sha256Of(INSTALLER_CONTENT)}  file.exe`)
    ]
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController)
    await (controller as { downloadUpdate: () => Promise<Record<string, unknown>> }).downloadUpdate()
    const finalPath = path.join(h.state.tempDir, INSTALLER_FILE)
    expect(fs.existsSync(finalPath)).toBe(true)
    expect(fs.existsSync(`${finalPath}.download`)).toBe(false)
    const state = JSON.parse(fs.readFileSync(statePath(), 'utf-8'))
    expect(state.downloadedVersion).toBe('1.5.0')
    expect(state.downloadedPath).toBe(finalPath)
    expect(state.notes).toBe('本次日志')
    expect(h.saveDeltaCache).toHaveBeenCalledWith(finalPath, '1.5.0', expect.stringContaining('releases/download'))
    expect(h.send).toHaveBeenCalledWith('update:status', { state: 'downloaded', version: '1.5.0' })
  })

  it('校验不匹配时删除半截文件并清差量缓存', async () => {
    h.state.plans = [
      tagRedirect('v1.5.0'),
      bodyPlan(atomFor('v1.5.0', 'notes')),
      bodyPlan(INSTALLER_CONTENT, { 'content-length': String(Buffer.byteLength(INSTALLER_CONTENT)) }),
      bodyPlan(`${'a'.repeat(64)}`)
    ]
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController)
    const result = await (controller as { downloadUpdate: () => Promise<Record<string, unknown>> }).downloadUpdate()
    expect(result.success).toBe(false)
    expect(String(result.error)).toContain('update.checksumMismatch')
    expect(h.discardDeltaCache).toHaveBeenCalledTimes(1)
    expect(fs.readdirSync(h.state.tempDir)).toEqual([])
  })

  it('校验文件缺失时返回 checksumUnavailable', async () => {
    h.state.plans = [
      tagRedirect('v1.5.0'),
      bodyPlan(atomFor('v1.5.0', 'notes')),
      bodyPlan(INSTALLER_CONTENT, { 'content-length': String(Buffer.byteLength(INSTALLER_CONTENT)) }),
      { kind: 'response', statusCode: 404, chunks: [] }
    ]
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController)
    const result = await (controller as { downloadUpdate: () => Promise<Record<string, unknown>> }).downloadUpdate()
    expect(result).toEqual({ success: true, checksumUnavailable: true })
    expect(fs.existsSync(path.join(h.state.tempDir, INSTALLER_FILE))).toBe(true)
  })

  it('下载失败时清掉临时文件并返回原因', async () => {
    h.state.plans = [
      tagRedirect('v1.5.0'),
      bodyPlan(atomFor('v1.5.0', 'notes')),
      { kind: 'response', statusCode: 500, chunks: [] }
    ]
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController)
    const result = await (controller as { downloadUpdate: () => Promise<Record<string, unknown>> }).downloadUpdate()
    expect(result).toEqual({ success: false, error: 'Download failed: 500' })
    expect(fs.readdirSync(h.state.tempDir)).toEqual([])
  })
})

describe('restartAndInstall', () => {
  it('没有已下载安装包时拒绝', async () => {
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController) as { restartAndInstall: () => Promise<Record<string, unknown>> }
    expect(await controller.restartAndInstall()).toEqual({ success: false, error: 'Installer not downloaded' })
  })

  it('启动安装程序失败时返回错误且不退出', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const installer = path.join(h.state.tempDir, INSTALLER_FILE)
    fs.writeFileSync(installer, INSTALLER_CONTENT)
    h.openPath.mockResolvedValue('cannot open')
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController)
    internals(controller).downloadedPath = installer
    internals(controller).downloadedVersion = '1.5.0'
    const result = await (controller as { restartAndInstall: () => Promise<Record<string, unknown>> }).restartAndInstall()
    expect(result).toEqual({ success: false, error: 'cannot open' })
    vi.advanceTimersByTime(1000)
    expect(h.exit).not.toHaveBeenCalled()
  })

  it('启动安装程序成功后延迟退出应用', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const installer = path.join(h.state.tempDir, INSTALLER_FILE)
    fs.writeFileSync(installer, INSTALLER_CONTENT)
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController)
    internals(controller).downloadedPath = installer
    internals(controller).downloadedVersion = '1.5.0'
    const result = await (controller as { restartAndInstall: () => Promise<Record<string, unknown>> }).restartAndInstall()
    expect(result).toEqual({ success: true })
    expect(h.openPath).toHaveBeenCalledWith(installer)
    vi.advanceTimersByTime(499)
    expect(h.exit).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(h.exit).toHaveBeenCalledWith(0)
  })

  it('Linux AppImage 走自替换脚本后退出', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    process.env.APPIMAGE = '/opt/Aria2Desktop.AppImage'
    const installer = path.join(h.state.tempDir, 'Aria2Desktop-1.5.0-x86_64.AppImage')
    fs.writeFileSync(installer, INSTALLER_CONTENT)
    const { UpdateController } = await loadController('linux')
    const controller = createController(UpdateController)
    internals(controller).downloadedPath = installer
    internals(controller).downloadedVersion = '1.5.0'
    const result = await (controller as { restartAndInstall: () => Promise<Record<string, unknown>> }).restartAndInstall()
    expect(result).toEqual({ success: true })
    expect(h.openPath).not.toHaveBeenCalled()
    const scriptPath = path.join(h.state.tempDir, 'aria2desktop-appimage-update.sh')
    const script = fs.readFileSync(scriptPath, 'utf-8')
    expect(script).toContain('#!/bin/sh')
    expect(script).toContain("CURRENT='/opt/Aria2Desktop.AppImage'")
    expect(script).toContain("NEXT='" + installer + "'")
    expect(script).toContain('while kill -0 "$PID"')
    expect(h.spawn).toHaveBeenCalledWith('/bin/sh', [scriptPath], { detached: true, stdio: 'ignore' })
    vi.advanceTimersByTime(300)
    expect(h.exit).toHaveBeenCalledWith(0)
  })
})

describe('每日复查定时器', () => {
  it('启动一次每日复查，重复调用无副作用', async () => {
    const handle = { unref: vi.fn() }
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval').mockReturnValue(handle as unknown as ReturnType<typeof setInterval>)
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController) as { startScheduledCheck: () => void }
    controller.startScheduledCheck()
    controller.startScheduledCheck()
    expect(setIntervalSpy).toHaveBeenCalledTimes(1)
    expect(setIntervalSpy.mock.calls[0][1]).toBe(24 * 60 * 60 * 1000)
    expect(handle.unref).toHaveBeenCalledTimes(1)
    setIntervalSpy.mockRestore()
  })

  it('停止复查后可以再次启动', async () => {
    const handle = { unref: vi.fn() }
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval').mockReturnValue(handle as unknown as ReturnType<typeof setInterval>)
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => {})
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController) as { startScheduledCheck: () => void, stopScheduledCheck: () => void }
    controller.startScheduledCheck()
    controller.stopScheduledCheck()
    expect(clearIntervalSpy).toHaveBeenCalledWith(handle)
    controller.stopScheduledCheck()
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1)
    controller.startScheduledCheck()
    expect(setIntervalSpy).toHaveBeenCalledTimes(2)
    setIntervalSpy.mockRestore()
    clearIntervalSpy.mockRestore()
  })
})

describe('ensurePersistedUpdateState', () => {
  it('状态文件损坏时不影响更新检查', async () => {
    fs.writeFileSync(statePath(), 'not-json', 'utf-8')
    h.state.plans = [tagRedirect('v1.5.0'), bodyPlan(atomFor('v1.5.0', 'notes'))]
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController) as { checkForUpdates: () => Promise<Record<string, unknown>> }
    const result = await controller.checkForUpdates()
    expect(result.hasUpdate).toBe(true)
    expect(h.warn).toHaveBeenCalledWith(
      '[UpdateController] 忽略损坏的更新状态文件:',
      statePath()
    )
  })

  it('安装包已不存在时清掉状态文件', async () => {
    writeStateFile({
      downloadedPath: path.join(h.state.tempDir, 'gone.exe'),
      downloadedVersion: '1.5.0',
      notes: 'stale',
      savedAt: 1
    })
    h.state.plans = [tagRedirect('v1.4.0'), bodyPlan(atomFor('v1.4.0', 'same'))]
    const { UpdateController } = await loadController()
    const controller = createController(UpdateController) as { checkForUpdates: () => Promise<Record<string, unknown>> }
    await controller.checkForUpdates()
    expect(fs.existsSync(statePath())).toBe(false)
  })
})
