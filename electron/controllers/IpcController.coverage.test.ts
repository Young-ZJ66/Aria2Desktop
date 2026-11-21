import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => {
  const state = {
    handlers: new Map<string, (event: any, ...args: any[]) => any>(),
    listeners: new Map<string, (event: any, ...args: any[]) => any>(),
    settings: {} as Record<string, any>,
    downloadsPath: 'E:/downloads',
    saved: [] as any[],
    store: { get: vi.fn(), set: vi.fn() } as any,
    commands: [] as { file: string; args: string[] }[],
    commandShouldFail: false,
    clipboardReadThrows: false,
    clipboardWriteThrows: false,
    clipboardWrites: [] as string[],
    notificationSupported: true,
    notificationThrows: false,
    notifications: [] as { title: string; body: string }[],
    notificationClicks: [] as Array<() => void>,
    shellCalls: [] as { kind: string; arg: string }[],
    openPathThrows: false,
    openExternalThrows: false,
    dialogResult: { canceled: true } as Record<string, unknown>,
    openDialogCalls: [] as unknown[],
    trashCalls: [] as string[],
    trashPlan: {} as Record<string, string>,
    repairedPath: null as string | null,
    existsSet: new Set<string>(),
    files: new Set<string>(),
    dirs: new Set<string>(),
    statPlan: {} as Record<string, string>,
    mkdirThrows: false,
    policyThrows: false,
    proxyPlan: [] as string[],
    proxySessionThrows: false,
    autoLaunchThrows: false,
    setAutoLaunchThrows: false,
    autoLaunchSet: true,
    sanitizeSettingsThrows: false,
    importResult: { ok: true, report: { applied: 1 }, next: {} } as Record<string, any>,
    normalizedImport: { next: {}, normalized: [] as string[] },
    engineApply: { requiresRestart: false, changed: [] as string[] },
    engineApplyThrows: false,
    upnpReconcile: vi.fn(),
    updateController: null as any,
    performRestartAndInstall: vi.fn(async (_options: any) => ({ success: true })),
    history: null as any,
    pluginManager: null as any,
    extracted: [] as string[],
    webConsoleStatus: { running: false, port: 0, url: '', tls: false, token: '', tokensCount: 0, audit: [] },
    logs: { info: [] as any[], warn: [] as any[], error: [] as any[], debug: [] as any[] }
  }
  return { state }
})

const { state } = h

vi.mock('electron', () => ({
  app: {
    getVersion: () => '1.5.0',
    getPath: (name: string) => (name === 'downloads' ? state.downloadsPath : 'E:/userData')
  },
  dialog: {
    showSaveDialog: vi.fn(async () => state.dialogResult),
    showOpenDialog: vi.fn(async (...args: unknown[]) => {
      state.openDialogCalls.push(args)
      return state.dialogResult
    })
  },
  shell: {
    openExternal: vi.fn(async (url: string) => {
      if (state.openExternalThrows) throw new Error('open failed')
      state.shellCalls.push({ kind: 'external', arg: url })
    }),
    openPath: vi.fn(async (p: string) => {
      if (state.openPathThrows) throw new Error('openPath boom')
      state.shellCalls.push({ kind: 'open', arg: p })
      return ''
    }),
    showItemInFolder: vi.fn((p: string) => { state.shellCalls.push({ kind: 'reveal', arg: p }) }),
    trashItem: vi.fn(async (p: string) => {
      state.trashCalls.push(p)
      const plan = state.trashPlan[p]
      if (plan) {
        const error = new Error(plan) as NodeJS.ErrnoException
        error.code = plan
        throw error
      }
    })
  },
  Notification: class FakeNotification {
    static isSupported() { return state.notificationSupported }
    show = vi.fn()
    constructor(public options: { title: string; body: string }) {
      if (state.notificationThrows) throw new Error('notification unavailable')
      state.notifications.push(options)
    }
    on(event: string, cb: () => void) {
      if (event === 'click') state.notificationClicks.push(cb)
    }
  },
  clipboard: {
    readText: () => {
      if (state.clipboardReadThrows) throw new Error('clipboard read boom')
      return 'clip'
    },
    writeText: (text: string) => {
      if (state.clipboardWriteThrows) throw new Error('clipboard write boom')
      state.clipboardWrites.push(text)
    }
  },
  session: {
    get defaultSession() {
      if (state.proxySessionThrows) throw new Error('session unavailable')
      return {
        resolveProxy: async () => {
          const next = state.proxyPlan.shift()
          if (next === undefined) return 'DIRECT'
          if (next === 'THROW') throw new Error('probe failed')
          if (next === 'BAD') return { match: () => { throw new Error('bad proxy payload') } }
          return next
        }
      }
    }
  }
}))

vi.mock('child_process', () => ({
  execFile: (file: string, args: string[], callback: (error: Error | null) => void) => {
    state.commands.push({ file, args })
    if (state.commandShouldFail) callback(new Error('command failed'))
    else callback(null)
  }
}))

vi.mock('electron-store', () => ({ default: class FakeStore {} }))
vi.mock('./WindowController', () => ({ WindowController: class {} }))
vi.mock('./TrayController', () => ({ TrayController: class {} }))
vi.mock('./Aria2Controller', () => ({ Aria2Controller: class {} }))
vi.mock('./UpdateController', () => ({
  UpdateController: class FakeUpdateController {
    checkForUpdates = vi.fn(async () => ({ success: true, hasUpdate: true }))
    checkForUpdatesOnStartup = vi.fn(async () => ({ success: true, hasUpdate: false }))
    downloadUpdate = vi.fn(async () => ({ success: true, downloaded: true }))
    restartAndInstall = vi.fn(async () => ({ success: true }))
    startScheduledCheck = vi.fn()
    stopScheduledCheck = vi.fn()
    constructor(getWindow?: () => unknown) {
      if (typeof getWindow === 'function') getWindow()
      state.updateController = this
    }
  }
}))

vi.mock('../utils/ipcSecurity', () => ({
  registerSecureHandler: (channel: string, handler: (event: any, ...args: any[]) => any) => {
    state.handlers.set(channel, handler)
  },
  registerSecureListener: (channel: string, listener: (event: any, ...args: any[]) => any) => {
    state.listeners.set(channel, listener)
  }
}))

vi.mock('../utils/secretCipher', () => ({ isSecretEncryptionAvailable: () => true }))

vi.mock('../utils/settingsAccessor', () => ({
  getSettingsFresh: () => state.settings,
  saveSettings: (next: unknown) => { state.saved.push(next) }
}))

vi.mock('../utils/settingsSync', () => ({
  applySettingsImport: () => state.importResult,
  buildSettingsExport: () => ({ redacted: true }),
  normalizeImportedEngineSettings: () => state.normalizedImport
}))

vi.mock('../utils/activeRpcConfig', () => ({
  activeRpcOptions: () => ({ host: '127.0.0.1', port: 6800, protocol: 'http', path: '/jsonrpc', secret: '' })
}))

vi.mock('../utils/aria2Rpc', () => ({ callAria2Rpc: vi.fn(async () => ({})) }))

vi.mock('../utils/downloadNameProbe', () => ({
  probeDownloadFileName: vi.fn(async () => ''),
  resolveConflictingFileName: vi.fn(async (_dir: string, name: string) => ({ fileName: name, conflict: false }))
}))

vi.mock('../utils/externalUrlCore', () => ({
  isAllowedExternalUrl: (url: unknown) => typeof url === 'string' && url.startsWith('https://github.com/')
}))

vi.mock('../utils/pathRepair', () => ({ undoDuplicatedSegment: () => state.repairedPath }))

vi.mock('../utils/pathContainment', () => ({
  isPathInside: (target: string, root: string) => {
    const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '')
    const t = norm(target)
    const r = norm(root)
    return t === r || t.startsWith(r + '/')
  }
}))

vi.mock('../utils/ipcInputValidation', () => ({
  sanitizeSettingsInput: (value: unknown) => {
    if (state.sanitizeSettingsThrows) throw new Error('sanitize boom')
    return value
  },
  sanitizeWindowStateInput: (value: unknown) => value,
  sanitizeTaskSourcesInput: (value: unknown) => value
}))

vi.mock('../services/ytdlpService', () => ({
  checkYtdlpAvailable: vi.fn(async () => ({ available: true })),
  checkYtdlpUpdate: vi.fn(async () => ({ success: true })),
  installYtdlp: vi.fn(async () => ({ success: true })),
  getVideoInfo: vi.fn(async () => ({})),
  getPlaylistInfo: vi.fn(async () => ({ entries: [] })),
  getFormatUrl: vi.fn(async () => '')
}))

vi.mock('../services/ffmpegService', () => ({
  checkFfmpegAvailable: vi.fn(async () => ({ available: true })),
  checkFfmpegUpdate: vi.fn(async () => ({ success: true })),
  installFfmpeg: vi.fn(async () => ({ success: true }))
}))

vi.mock('../services/streamDownloadService', () => ({
  startStreamDownload: vi.fn(async () => ({ success: true, id: 's1' })),
  cancelStreamDownload: vi.fn(() => true),
  discardStreamDownload: vi.fn(() => true),
  pauseStreamDownload: vi.fn(() => true),
  resumeStreamDownload: vi.fn(() => true),
  deleteStreamDownloadFile: vi.fn(async () => ({ success: true }))
}))

vi.mock('../services/archiveService', () => ({
  extractArchive: vi.fn(async (target: string) => {
    state.extracted.push(target)
    return { success: true, extracted: true }
  })
}))

vi.mock('../services/completionRuleService', () => ({ applyCompletionRules: vi.fn(async () => {}) }))

vi.mock('../services/upnpService', () => ({
  upnpService: {
    reconcile: (...args: unknown[]) => state.upnpReconcile(...args),
    getStatus: () => ({ state: 'idle' }),
    mapNow: async () => ({ state: 'ok', ports: [] })
  }
}))

vi.mock('../services/autoLaunch', () => ({
  getAutoLaunchEnabled: () => {
    if (state.autoLaunchThrows) throw new Error('launch probe failed')
    return state.autoLaunchSet
  },
  setAutoLaunchEnabled: (enabled: boolean) => {
    if (state.setAutoLaunchThrows) throw new Error('launch write failed')
    state.autoLaunchSet = enabled
  }
}))

vi.mock('../services/pluginManager', () => ({
  PluginManager: class FakePluginManager {
    getPlugins = vi.fn(() => [])
    enable = vi.fn(() => true)
    disable = vi.fn(() => true)
    uninstall = vi.fn(() => true)
    getPluginDir = vi.fn(() => 'E:/userData/plugins')
    loadAll = vi.fn(async () => {})
    shutdown = vi.fn()
    emit = vi.fn()
    constructor() { state.pluginManager = this }
  }
}))

vi.mock('../services/pluginMarketService', () => ({
  PluginMarketService: class FakePluginMarket {
    list = vi.fn(async () => ({ success: true, plugins: [] }))
    install = vi.fn(async () => ({ success: true }))
  }
}))

vi.mock('../services/historyDatabase', () => ({
  HistoryDatabase: class FakeHistoryDatabase {
    enabled = true
    loadAll = vi.fn(async () => ({ tasks: {} }))
    saveAll = vi.fn(async () => ({ success: true }))
    saveOne = vi.fn(async () => ({ success: true }))
    deleteMany = vi.fn(async () => ({ success: true }))
    deleteAll = vi.fn(async () => ({ success: true }))
    getStats = vi.fn(async () => ({ count: 0, backend: 'sqlite' }))
    close = vi.fn()
    constructor() { state.history = this }
  }
}))

vi.mock('../services/webConsoleServer', () => ({
  webConsoleServer: { getStatus: () => state.webConsoleStatus, apply: async () => ({}) }
}))

vi.mock('../utils/ipGeo', () => ({ lookupPeerLocations: vi.fn(async () => ({})) }))

vi.mock('../utils/logger', () => ({
  createLogger: () => ({
    info: (...args: unknown[]) => { state.logs.info.push(args) },
    warn: (...args: unknown[]) => { state.logs.warn.push(args) },
    error: (...args: unknown[]) => { state.logs.error.push(args) },
    debug: (...args: unknown[]) => { state.logs.debug.push(args) }
  }),
  getLogFilePaths: () => ({ file: 'E:/userData/logs/main.log', dir: 'E:/userData/logs' })
}))

vi.mock('../services/engineShutdownService', () => ({
  performRestartAndInstall: (options: unknown) => state.performRestartAndInstall(options)
}))

vi.mock('../utils/downloadPathPolicy', () => ({
  isInsideDownloadRoot: async (target: string, root: string) => {
    if (state.policyThrows) throw new Error('policy boom')
    const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '')
    const t = norm(target)
    const r = norm(root)
    return t === r || t.startsWith(r + '/')
  }
}))

vi.mock('../../src/shared/fileCategories', () => ({
  resolveBaseDownloadDir: (settings: any) => settings?.download?.defaultDir || ''
}))

function fsKey(p: string): string {
  return p.replace(/\\/g, '/')
}

vi.mock('fs', () => ({
  existsSync: (p: string) => {
    const key = fsKey(p)
    return state.existsSet.has(key) || state.files.has(key) || state.dirs.has(key)
  },
  constants: { W_OK: 2 },
  promises: {
    stat: async (p: string) => {
      const key = fsKey(p)
      const planned = state.statPlan[key]
      if (planned) {
        const error = new Error(planned) as NodeJS.ErrnoException
        error.code = planned
        throw error
      }
      if (state.files.has(key)) return { isFile: () => true, isDirectory: () => false }
      if (state.dirs.has(key)) return { isFile: () => false, isDirectory: () => true }
      const error = new Error('ENOENT') as NodeJS.ErrnoException
      error.code = 'ENOENT'
      throw error
    },
    realpath: async (p: string) => p,
    statfs: async () => ({ bavail: 10, bsize: 1024, blocks: 100 }),
    mkdir: async (p: string) => {
      if (state.mkdirThrows) throw new Error('mkdir boom')
      state.existsSet.add(fsKey(p))
    },
    copyFile: async () => undefined,
    open: async () => ({ stat: async () => ({ size: 0 }), read: async () => ({ bytesRead: 0 }), close: async () => undefined })
  }
}))

const windowController = {
  getMainWindow: () => ({ isDestroyed: () => false, webContents: { send: () => undefined } }),
  isRendererContentReady: () => true,
  setWindowTheme: vi.fn(),
  setTaskbarProgress: vi.fn(),
  show: vi.fn()
}

const trayController = { createTray: vi.fn(), destroy: vi.fn(), getTray: () => ({ id: 1 }) }

const aria2Controller = {
  saveSession: vi.fn(async () => ({ success: true })),
  requestShutdownAndWait: vi.fn(async () => ({ success: true })),
  restartEngine: vi.fn(async () => ({ success: true })),
  applyImportedSettings: vi.fn(async () => {
    if (state.engineApplyThrows) throw new Error('engine boom')
    return state.engineApply
  }),
  registerIpcHandlers: vi.fn()
}

async function registered(): Promise<Map<string, (event: any, ...args: any[]) => any>> {
  vi.resetModules()
  const mod = await import('./IpcController')
  const controller = new mod.IpcController(
    windowController as never,
    trayController as never,
    aria2Controller as never,
    state.store
  )
  controller.registerHandlers()
  state.saved = []
  return state.handlers
}

const originalPlatform = process.platform
function setPlatform(value: string) {
  Object.defineProperty(process, 'platform', { value, configurable: true })
}

beforeEach(() => {
  vi.clearAllMocks()
  state.handlers = new Map()
  state.listeners = new Map()
  state.settings = { aria2: { port: 6800, secret: 's' }, download: { defaultDir: 'E:/downloads' } }
  state.downloadsPath = 'E:/downloads'
  state.saved = []
  state.store = { get: vi.fn(() => 'stored'), set: vi.fn() }
  state.commands = []
  state.commandShouldFail = false
  state.clipboardReadThrows = false
  state.clipboardWriteThrows = false
  state.clipboardWrites = []
  state.notificationSupported = true
  state.notificationThrows = false
  state.notifications = []
  state.notificationClicks = []
  state.shellCalls = []
  state.openPathThrows = false
  state.openExternalThrows = false
  state.dialogResult = { canceled: true }
  state.openDialogCalls = []
  state.trashCalls = []
  state.trashPlan = {}
  state.repairedPath = null
  state.existsSet = new Set()
  state.files = new Set()
  state.dirs = new Set()
  state.statPlan = {}
  state.mkdirThrows = false
  state.policyThrows = false
  state.proxyPlan = []
  state.proxySessionThrows = false
  state.autoLaunchThrows = false
  state.setAutoLaunchThrows = false
  state.autoLaunchSet = true
  state.sanitizeSettingsThrows = false
  state.importResult = { ok: true, report: { applied: 1 }, next: {} }
  state.normalizedImport = { next: {}, normalized: [] }
  state.engineApply = { requiresRestart: false, changed: [] }
  state.engineApplyThrows = false
  state.upnpReconcile = vi.fn()
  state.performRestartAndInstall = vi.fn(async () => ({ success: true }))
  state.extracted = []
  state.logs = { info: [], warn: [], error: [], debug: [] }
})

afterEach(() => {
  setPlatform(originalPlatform)
  vi.restoreAllMocks()
})

function logsContain(level: 'info' | 'warn' | 'error', text: string): boolean {
  return state.logs[level].some((args: any[]) => String(args[0]).includes(text))
}

describe('应用类通道的成功与失败回报', () => {
  it('版本、扩展状态与控制台状态直接回报', async () => {
    const handlers = await registered()
    expect(handlers.get('get-app-version')!({})).toBe('1.5.0')
    expect(handlers.get('web-console-status')!({})).toEqual(state.webConsoleStatus)
  })

  it('导入时记录规范化与引擎改动，引擎同步抛错则返回失败', async () => {
    const handlers = await registered()
    state.normalizedImport = { next: { aria2: {} }, normalized: ['aria2.port', 'download.defaultDir'] }
    state.engineApply = { requiresRestart: true, changed: ['rpc-listen-port'] }
    expect((await handlers.get('settings-import')!({}, {})).success).toBe(true)
    expect(logsContain('warn', '[Settings] 导入数据中的引擎配置已规范化:')).toBe(true)
    expect(logsContain('info', '[Settings] 导入的引擎配置已写入 aria2.conf:')).toBe(true)
    expect(state.upnpReconcile).toHaveBeenCalled()
    state.engineApplyThrows = true
    expect(await handlers.get('settings-import')!({}, {})).toEqual({ success: false, error: 'Error: engine boom' })
    expect(logsContain('error', 'settings-import failed:')).toBe(true)
  })

  it('开机自启读写失败都如实返回错误', async () => {
    const handlers = await registered()
    state.autoLaunchThrows = true
    expect(handlers.get('get-auto-launch')!({})).toEqual({ success: false, error: 'Error: launch probe failed' })
    state.autoLaunchThrows = false
    state.setAutoLaunchThrows = true
    expect(handlers.get('set-auto-launch')!({}, true)).toEqual({ success: false, error: 'Error: launch write failed' })
    expect(logsContain('warn', '[IpcController] 设置开机自启失败:')).toBe(true)
  })

  it('更新类通道透传给更新控制器并注入安装编排回调', async () => {
    const handlers = await registered()
    expect(await handlers.get('check-for-updates')!({})).toEqual({ success: true, hasUpdate: true })
    expect(await handlers.get('check-updates-on-startup')!({})).toEqual({ success: true, hasUpdate: false })
    expect(await handlers.get('download-update')!({})).toEqual({ success: true, downloaded: true })
    expect(await handlers.get('restart-and-install')!({})).toEqual({ success: true })
    const options = state.performRestartAndInstall.mock.calls[0][0]
    await options.saveSession(1000)
    await options.requestShutdownAndWait(2000)
    await options.restartAndInstall()
    await options.restartEngine()
    expect(aria2Controller.saveSession).toHaveBeenCalledWith(1000)
    expect(aria2Controller.requestShutdownAndWait).toHaveBeenCalledWith(2000)
    expect(state.updateController.restartAndInstall).toHaveBeenCalled()
    expect(aria2Controller.restartEngine).toHaveBeenCalled()
    expect(options.logger).toBeTruthy()
  })

  it('剪贴板读写抛错时降级', async () => {
    const handlers = await registered()
    state.clipboardReadThrows = true
    expect(handlers.get('read-clipboard')!({})).toBe('')
    state.clipboardWriteThrows = true
    expect(handlers.get('write-clipboard')!({}, 'x')).toBe(false)
  })

  it('通知支持时展示并可在点击时唤出窗口；构造抛错只记日志', async () => {
    const handlers = await registered()
    handlers.get('send-notification')!({}, '标题', '正文')
    expect(state.notifications).toMatchObject([{ title: '标题', body: '正文' }])
    state.notificationClicks[0]()
    expect(windowController.show).toHaveBeenCalled()
    state.notificationThrows = true
    expect(() => handlers.get('send-notification')!({}, 't', 'b')).not.toThrow()
    expect(logsContain('warn', '[IpcController] Failed to send notification:')).toBe(true)
  })
})

describe('系统命令的平台分支', () => {
  it('Linux 关机走 shutdown -h +1', async () => {
    setPlatform('linux')
    const handlers = await registered()
    expect(await handlers.get('system-shutdown')!({})).toEqual({ success: true })
    expect(state.commands[0]).toEqual({ file: 'shutdown', args: ['-h', '+1'] })
  })

  it('Windows 与 macOS 休眠走各自命令', async () => {
    setPlatform('win32')
    let handlers = await registered()
    expect(await handlers.get('system-hibernate')!({})).toEqual({ success: true })
    expect(state.commands[0]).toEqual({ file: 'shutdown', args: ['/h'] })
    setPlatform('darwin')
    handlers = await registered()
    expect(await handlers.get('system-hibernate')!({})).toEqual({ success: true })
    expect(state.commands[1].file).toBe('osascript')
    expect(state.commands[1].args[0]).toBe('-e')
  })

  it('休眠命令失败时如实返回错误', async () => {
    state.commandShouldFail = true
    const handlers = await registered()
    expect(await handlers.get('system-hibernate')!({})).toEqual({ success: false, error: 'Error: command failed' })
  })

  it('Windows 与 Linux 取消关机走 /a 与 -c，失败时记日志', async () => {
    setPlatform('win32')
    let handlers = await registered()
    expect(await handlers.get('system-cancel-shutdown')!({})).toEqual({ success: true })
    expect(state.commands[0]).toEqual({ file: 'shutdown', args: ['/a'] })
    setPlatform('linux')
    handlers = await registered()
    expect(await handlers.get('system-cancel-shutdown')!({})).toEqual({ success: true })
    expect(state.commands[1]).toEqual({ file: 'shutdown', args: ['-c'] })
    state.commandShouldFail = true
    expect(await handlers.get('system-cancel-shutdown')!({})).toEqual({ success: false, error: 'Error: command failed' })
    expect(logsContain('warn', '[IpcController] 取消关机失败')).toBe(true)
  })
})

describe('代理探测的容错', () => {
  it('单个探测目标抛错时继续下一个，全部直连返回空串', async () => {
    const handlers = await registered()
    state.proxyPlan = ['THROW', 'DIRECT', 'DIRECT', 'DIRECT']
    expect(await handlers.get('detect-system-proxy')!({})).toEqual({ success: true, proxy: '' })
  })

  it('会话本身不可用时按全部直连处理', async () => {
    const handlers = await registered()
    state.proxySessionThrows = true
    expect(await handlers.get('detect-system-proxy')!({})).toEqual({ success: true, proxy: '' })
  })

  it('探测结果不是字符串时按失败回报', async () => {
    const handlers = await registered()
    state.proxyPlan = ['BAD']
    const result = await handlers.get('detect-system-proxy')!({})
    expect(result.success).toBe(false)
    expect(String(result.error)).toContain('bad proxy payload')
  })
})

describe('store 写入与对话框', () => {
  it('windowState 与 taskSources 校验通过后写入 store', async () => {
    const handlers = await registered()
    expect(handlers.get('set-store-value')!({}, 'windowState', { width: 1 })).toEqual({ success: true })
    expect(state.store.set).toHaveBeenCalledWith('windowState', { width: 1 })
    expect(handlers.get('set-store-value')!({}, 'taskSources', { list: [] })).toEqual({ success: true })
    expect(state.store.set).toHaveBeenCalledWith('taskSources', { list: [] })
  })

  it('settings 结构校验抛错时被兜住', async () => {
    const handlers = await registered()
    state.sanitizeSettingsThrows = true
    expect(handlers.get('set-store-value')!({}, 'settings', {})).toEqual({ success: false, error: 'sanitize boom' })
    expect(logsContain('warn', 'Rejected invalid store write for settings:')).toBe(true)
  })

  it('有主窗口时把打开对话框结果原样带回', async () => {
    const handlers = await registered()
    const result = { canceled: false, filePaths: ['E:/downloads/a.zip'] }
    state.dialogResult = result
    expect(await handlers.get('show-open-dialog')!({}, {})).toBe(result)
    expect(state.openDialogCalls).toHaveLength(1)
  })
})

describe('文件通道的兜底', () => {
  it('外链打开失败时返回错误', async () => {
    const handlers = await registered()
    state.openExternalThrows = true
    expect(await handlers.get('open-external-url')!({}, 'https://github.com/x')).toEqual({ success: false, error: 'Error: open failed' })
  })

  it('文件通道拒绝空路径', async () => {
    const handlers = await registered()
    expect(await handlers.get('open-in-explorer')!({}, '  ')).toEqual({ success: false, error: 'Invalid path' })
    expect(await handlers.get('open-file')!({}, '')).toEqual({ success: false, error: 'Invalid path' })
  })

  it('open-file 找不到文件、open-path 只接受目录', async () => {
    const handlers = await registered()
    expect(await handlers.get('open-file')!({}, 'E:/downloads/missing.zip')).toEqual({ success: false, error: 'Path not found' })
    state.files.add('E:/downloads/a.zip')
    expect(await handlers.get('open-path')!({}, 'E:/downloads/a.zip')).toEqual({ success: false, error: 'Only directories can be opened' })
    state.dirs.add('E:/downloads/sub')
    expect(await handlers.get('open-path')!({}, 'E:/downloads/sub')).toEqual({ success: true })
  })

  it('路径策略判定抛错时文件通道不崩', async () => {
    const handlers = await registered()
    state.files.add('E:/downloads/a.zip')
    state.policyThrows = true
    expect((await handlers.get('show-item-in-folder')!({}, 'E:/downloads/a.zip')).success).toBe(false)
    expect((await handlers.get('open-in-explorer')!({}, 'E:/downloads/a.zip')).success).toBe(false)
    expect((await handlers.get('open-file')!({}, 'E:/downloads/a.zip')).success).toBe(false)
  })

  it('没有可用下载目录时拒绝删除', async () => {
    const handlers = await registered()
    state.settings = { aria2: {}, download: { defaultDir: '' } }
    state.downloadsPath = ''
    expect(await handlers.get('delete-files')!({}, ['E:/x.txt'])).toEqual({ success: false, error: 'Download dir not configured' })
    expect(logsContain('warn', 'Blocked deletion: no download dir configured')).toBe(true)
  })

  it('任务目录校验通过后放宽白名单', async () => {
    const handlers = await registered()
    state.files.add('E:/downloads/sub/a.txt')
    const result = await handlers.get('delete-files')!({}, ['E:/downloads/sub/a.txt'], 'E:/downloads/sub')
    expect(result.success).toBe(true)
    expect(state.trashCalls).toHaveLength(1)
    expect(result.results[0].success).toBe(true)
  })

  it('修正路径仍失败且非 ENOENT 时该项标记失败', async () => {
    const handlers = await registered()
    state.repairedPath = 'E:/downloads/Downloads/a.txt'
    state.statPlan = { 'E:/downloads/Downloads/a.txt': 'EACCES' }
    const result = await handlers.get('delete-files')!({}, ['E:/downloads/Downloads/Downloads/a.txt'])
    expect(result.success).toBe(true)
    expect(result.results[0].success).toBe(false)
  })

  it('任务目录位于下载根内时放宽文件通道白名单', async () => {
    const handlers = await registered()
    state.files.add('E:/downloads/sub/a.txt')
    expect(await handlers.get('open-file')!({}, 'E:/downloads/sub/a.txt', 'E:/downloads/sub')).toEqual({ success: true })
    expect(state.shellCalls.some(call => call.kind === 'open' && call.arg.endsWith('a.txt'))).toBe(true)
  })

  it('open-path 打开失败时返回错误', async () => {
    const handlers = await registered()
    state.dirs.add('E:/downloads/sub')
    state.openPathThrows = true
    expect(await handlers.get('open-path')!({}, 'E:/downloads/sub')).toEqual({ success: false, error: 'Error: openPath boom' })
  })

  it('压缩包在下载根内时交给解压服务', async () => {
    const handlers = await registered()
    expect(await handlers.get('archive-extract')!({}, 'E:/downloads/a.zip')).toEqual({ success: true, extracted: true })
    expect(state.extracted).toHaveLength(1)
    expect(state.extracted[0]).toContain('a.zip')
  })
})

describe('历史与目录通道', () => {
  it('历史读取与保存委托给历史库', async () => {
    const handlers = await registered()
    expect(await handlers.get('persisted-tasks-load')!({})).toEqual({ tasks: {} })
    expect(await handlers.get('persisted-tasks-save')!({}, { tasks: {} })).toEqual({ success: true })
    expect(state.history.loadAll).toHaveBeenCalled()
    expect(state.history.saveAll).toHaveBeenCalled()
  })

  it('插件目录与日志目录创建失败时如实返回错误', async () => {
    const handlers = await registered()
    state.mkdirThrows = true
    expect(await handlers.get('plugins-open-dir')!({})).toEqual({ success: false, error: 'Error: mkdir boom' })
    expect(await handlers.get('open-logs-dir')!({})).toEqual({ success: false, error: 'Error: mkdir boom' })
  })
})
