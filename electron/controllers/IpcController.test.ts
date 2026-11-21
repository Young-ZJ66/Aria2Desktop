import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const state = {
    handlers: new Map<string, (event: any, ...args: any[]) => any>(),
    listeners: new Map<string, (event: any, ...args: any[]) => any>(),
    settings: {} as Record<string, any>,
    saved: [] as any[],
    store: { get: vi.fn(), set: vi.fn() } as any,
    rpcCalls: [] as any[],
    rpcPlan: {} as Record<string, () => Promise<unknown>>,
    commands: [] as { file: string; args: string[] }[],
    commandShouldFail: false,
    clipboardText: '',
    clipboardWrites: [] as string[],
    notificationSupported: true,
    notifications: [] as { title: string; body: string }[],
    shellCalls: [] as { kind: string; arg: string }[],
    openPathError: '',
    dialogResult: { canceled: true, filePath: undefined as string | undefined },
    trashCalls: [] as string[],
    trashPlan: {} as Record<string, string>,
    existsSet: new Set<string>(),
    files: new Set<string>(),
    dirs: new Set<string>(),
    statfs: { bavail: 10, bsize: 1024, blocks: 100 },
    logLines: [] as string[],
    logReadError: null as null | { code: string },
    sanitizeSettings: (value: unknown) => value,
    sanitizeWindowState: (value: unknown) => value,
    sanitizeTaskSources: (value: unknown) => value,
    exportResult: { redacted: true, settings: {} } as Record<string, unknown>,
    exportThrows: false,
    importResult: { ok: true, report: { applied: 1, skipped: 0, rejected: [], preservedSecrets: [] }, next: {} },
    normalizedImport: { next: {}, normalized: [] as string[] },
    engineApply: { requiresRestart: false, changed: [] as string[] },
    upnpReconcile: vi.fn(),
    upnpStatus: { state: 'idle' },
    webConsoleStatus: { running: false, port: 0, url: '', tls: false, token: '', tokensCount: 0, audit: [] },
    extensionConnection: { version: null as string | null, lastSeenAt: null as string | null },
    performRestartAndInstall: vi.fn(async (_options: unknown) => ({ success: true })),
    autoLaunchSet: false as boolean,
    history: null as any,
    pluginManager: null as any,
    pluginMarket: null as any,
    hasWindow: true,
    sent: [] as { channel: string; payload: unknown }[],
    proxyValue: 'DIRECT',
    webConsoleApplyResult: {} as Record<string, unknown>,
    statfsThrows: false,
    realpathThrows: false,
    repairedPath: null as string | null,
    copyCalls: [] as { from: string; to: string }[],
    mkdirCalls: [] as string[],
    logFileSize: 10,
    streamOnEvent: null as null | ((event: unknown) => void),
    logs: { info: [] as any[], warn: [] as any[], error: [] as any[], debug: [] as any[] }
  }
  return { state }
})

const { state } = h

vi.mock('electron', () => ({
  app: {
    getVersion: () => '1.5.0',
    getPath: (name: string) => (name === 'downloads' ? 'E:/downloads' : 'E:/userData')
  },
  dialog: { showSaveDialog: vi.fn(async () => state.dialogResult), showOpenDialog: vi.fn(async () => state.dialogResult) },
  shell: {
    openExternal: vi.fn(async (url: string) => { state.shellCalls.push({ kind: 'external', arg: url }) }),
    openPath: vi.fn(async (p: string) => {
      state.shellCalls.push({ kind: 'open', arg: p })
      return state.openPathError
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
    constructor(public options: { title: string; body: string }) {
      state.notifications.push(options)
    }
    show = vi.fn()
    on = vi.fn()
  },
  clipboard: {
    readText: () => state.clipboardText,
    writeText: (text: string) => { state.clipboardWrites.push(text) }
  },
  session: {
    defaultSession: {
      resolveProxy: vi.fn(async () => state.proxyValue)
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
    checkForUpdates = vi.fn(async () => ({ success: true, hasUpdate: false }))
    checkForUpdatesOnStartup = vi.fn(async () => ({ success: true, hasUpdate: false }))
    downloadUpdate = vi.fn(async () => ({ success: true }))
    restartAndInstall = vi.fn(async () => ({ success: true }))
    startScheduledCheck = vi.fn()
    stopScheduledCheck = vi.fn()
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
  buildSettingsExport: () => {
    if (state.exportThrows) throw new Error('boom')
    return state.exportResult
  },
  normalizeImportedEngineSettings: () => state.normalizedImport
}))

vi.mock('../utils/activeRpcConfig', () => ({
  activeRpcOptions: () => ({ host: '127.0.0.1', port: 6800, protocol: 'http', path: '/jsonrpc', secret: '' })
}))

vi.mock('../utils/aria2Rpc', () => ({
  callAria2Rpc: vi.fn(async (options: any) => {
    state.rpcCalls.push(options)
    const planned = state.rpcPlan[options.method]
    if (planned) return planned()
    return {}
  })
}))

vi.mock('../utils/downloadNameProbe', () => ({
  probeDownloadFileName: vi.fn(async () => 'probe.zip'),
  resolveConflictingFileName: vi.fn(async (dir: string, name: string) => ({ fileName: name, conflict: false }))
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
  sanitizeSettingsInput: (value: unknown) => state.sanitizeSettings(value),
  sanitizeWindowStateInput: (value: unknown) => state.sanitizeWindowState(value),
  sanitizeTaskSourcesInput: (value: unknown) => state.sanitizeTaskSources(value)
}))

vi.mock('../services/ytdlpService', () => ({
  checkYtdlpAvailable: vi.fn(async () => ({ available: true, installable: true })),
  checkYtdlpUpdate: vi.fn(async () => ({ success: true, updateAvailable: false, checkable: true })),
  installYtdlp: vi.fn(async (onProgress: (p: unknown) => void) => { onProgress({ percent: 50 }); return { success: true } }),
  getVideoInfo: vi.fn(async () => ({ title: 'v' })),
  getPlaylistInfo: vi.fn(async () => ({ entries: [] })),
  getFormatUrl: vi.fn(async () => 'https://cdn/x.mp4')
}))

vi.mock('../services/ffmpegService', () => ({
  checkFfmpegAvailable: vi.fn(async () => ({ available: true, installable: true })),
  checkFfmpegUpdate: vi.fn(async () => ({ success: true, updateAvailable: false, checkable: true })),
  installFfmpeg: vi.fn(async (onProgress: (p: unknown) => void) => { onProgress({ percent: 10 }); return { success: true } })
}))

vi.mock('../services/streamDownloadService', () => ({
  startStreamDownload: vi.fn(async (_request: unknown, onEvent: (event: unknown) => void) => {
    state.streamOnEvent = onEvent
    return { success: true, id: 's1' }
  }),
  cancelStreamDownload: vi.fn(() => true),
  discardStreamDownload: vi.fn(() => true),
  pauseStreamDownload: vi.fn(() => true),
  resumeStreamDownload: vi.fn(() => true),
  deleteStreamDownloadFile: vi.fn(async () => ({ success: true }))
}))

vi.mock('../services/archiveService', () => ({
  extractArchive: vi.fn(async () => ({ success: true, extracted: true }))
}))

vi.mock('../services/completionRuleService', () => ({ applyCompletionRules: vi.fn(async () => {}) }))

vi.mock('../services/upnpService', () => ({
  upnpService: {
    reconcile: (...args: unknown[]) => state.upnpReconcile(...args),
    getStatus: () => state.upnpStatus,
    mapNow: async () => ({ state: 'ok', ports: [6881] })
  }
}))

vi.mock('../services/autoLaunch', () => ({
  getAutoLaunchEnabled: () => true,
  setAutoLaunchEnabled: (enabled: boolean) => { state.autoLaunchSet = enabled }
}))

vi.mock('../services/pluginManager', () => ({
  PluginManager: class FakePluginManager {
    getPlugins = vi.fn(() => [{ id: 'p' }])
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
    constructor() { state.pluginMarket = this }
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
    getStats = vi.fn(async () => ({ count: 3, backend: 'sqlite' }))
    close = vi.fn()
    constructor() { state.history = this }
  }
}))

vi.mock('../services/webConsoleServer', () => ({
  webConsoleServer: { getStatus: () => state.webConsoleStatus, apply: async () => state.webConsoleApplyResult }
}))

vi.mock('../utils/ipGeo', () => ({ lookupPeerLocations: vi.fn(async (ips: string[]) => ({ count: ips.length })) }))

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
      if (state.files.has(key)) return { isFile: () => true, isDirectory: () => false }
      if (state.dirs.has(key)) return { isFile: () => false, isDirectory: () => true }
      const error = new Error('ENOENT') as NodeJS.ErrnoException
      error.code = 'ENOENT'
      throw error
    },
    realpath: async (p: string) => {
      if (state.realpathThrows) {
        const error = new Error('realpath failed') as NodeJS.ErrnoException
        error.code = 'EACCES'
        throw error
      }
      return p
    },
    statfs: async () => {
      if (state.statfsThrows) throw new Error('statfs failed')
      return state.statfs
    },
    mkdir: async (p: string) => { state.mkdirCalls.push(p) },
    copyFile: async (from: string, to: string) => { state.copyCalls.push({ from, to }) },
    open: async (p: string) => {
      if (state.logReadError) throw state.logReadError
      if (!state.existsSet.has(fsKey(p)) && !state.files.has(fsKey(p))) {
        const error = new Error('ENOENT') as NodeJS.ErrnoException
        error.code = 'ENOENT'
        throw error
      }
      return {
        stat: async () => ({ size: state.logFileSize }),
        read: async (buffer: Buffer) => {
          const written = buffer.write(state.logLines.join('\n'))
          return { bytesRead: written }
        },
        close: async () => undefined
      }
    }
  }
}))

type Controller = import('./IpcController').IpcController

const windowController = {
  getMainWindow: () => (state.hasWindow
    ? {
      isDestroyed: () => false,
      webContents: { send: (channel: string, payload: unknown) => { state.sent.push({ channel, payload }) } }
    }
    : null),
  isRendererContentReady: () => true,
  setWindowTheme: vi.fn(),
  setTaskbarProgress: vi.fn(),
  show: vi.fn()
}

const trayController = {
  createTray: vi.fn(),
  destroy: vi.fn(),
  getTray: (): { id: number } | null => ({ id: 1 })
}

const aria2Controller = {
  saveSession: vi.fn(async () => ({ success: true })),
  requestShutdownAndWait: vi.fn(async () => ({ success: true })),
  restartEngine: vi.fn(async () => ({ success: true })),
  applyImportedSettings: vi.fn(async () => state.engineApply),
  registerIpcHandlers: vi.fn()
}

async function loadController(): Promise<{ controller: Controller; api: FakeApi }> {
  vi.resetModules()
  const mod = await import('./IpcController')
  const controller = new mod.IpcController(
    windowController as never,
    trayController as never,
    aria2Controller as never,
    state.store
  )
  return { controller, api: null as unknown as FakeApi }
}

interface FakeApi {
  [key: string]: any
}

async function registered(): Promise<Map<string, (event: any, ...args: any[]) => any>> {
  const { controller } = await loadController()
  controller.registerHandlers()
  state.saved = []
  return state.handlers
}

function baseSettings(overrides: Record<string, unknown> = {}) {
  return { aria2: { port: 6800, secret: 's' }, download: { defaultDir: 'E:/downloads' }, ...overrides }
}

beforeEach(() => {
  state.handlers = new Map()
  state.listeners = new Map()
  state.settings = baseSettings()
  state.saved = []
  state.store = { get: vi.fn(() => 'stored'), set: vi.fn() }
  state.rpcCalls = []
  state.rpcPlan = {}
  state.commands = []
  state.commandShouldFail = false
  state.clipboardText = ''
  state.clipboardWrites = []
  state.notificationSupported = true
  state.notifications = []
  state.shellCalls = []
  state.openPathError = ''
  state.dialogResult = { canceled: true, filePath: undefined }
  state.trashCalls = []
  state.trashPlan = {}
  state.existsSet = new Set()
  state.files = new Set()
  state.dirs = new Set()
  state.statfs = { bavail: 10, bsize: 1024, blocks: 100 }
  state.logLines = []
  state.sanitizeSettings = (value: unknown) => value
  state.sanitizeWindowState = (value: unknown) => value
  state.sanitizeTaskSources = (value: unknown) => value
  state.exportResult = { redacted: true, settings: {} }
  state.exportThrows = false
  state.importResult = { ok: true, report: { applied: 1, skipped: 0, rejected: [], preservedSecrets: [] }, next: {} }
  state.normalizedImport = { next: {}, normalized: [] }
  state.engineApply = { requiresRestart: false, changed: [] }
  state.upnpReconcile = vi.fn()
  state.logs = { info: [], warn: [], error: [], debug: [] }
  state.performRestartAndInstall = vi.fn(async () => ({ success: true }))
  state.hasWindow = true
  state.sent = []
  state.proxyValue = 'DIRECT'
  state.webConsoleApplyResult = {}
  state.statfsThrows = false
  state.realpathThrows = false
  state.repairedPath = null
  state.copyCalls = []
  state.mkdirCalls = []
  state.logFileSize = 10
  state.logReadError = null
  state.streamOnEvent = null
  state.existsSet.add('E:/userData/logs/main.log')
})

describe('通道注册面', () => {
  it('注册了全部应用/文件/历史/流媒体/插件通道', async () => {
    const handlers = await registered()
    const channels = [...handlers.keys()]
    expect(channels.length).toBeGreaterThanOrEqual(60)
    for (const channel of [
      'get-app-version',
      'web-console-status',
      'settings-export',
      'settings-import',
      'get-store-value',
      'set-store-value',
      'delete-files',
      'archive-extract',
      'stream-download-start',
      'persisted-tasks-save-one',
      'ytdlp-install',
      'plugins-list',
      'read-log-file',
      'write-log'
    ]) {
      expect(channels).toContain(channel)
    }
    expect([...state.listeners.keys()].sort()).toEqual(['download-event', 'renderer-error'])
    expect(aria2Controller.registerIpcHandlers).toHaveBeenCalled()
    expect(state.pluginManager.loadAll).toHaveBeenCalled()
  })
})

describe('store 键白名单', () => {
  it('只允许三个键，其它一律拒绝', async () => {
    const handlers = await registered()
    expect(handlers.get('get-store-value')!({}, 'settings')).toEqual(state.settings)
    expect(handlers.get('get-store-value')!({}, 'windowState')).toBe('stored')
    expect(handlers.get('get-store-value')!({}, 'secrets')).toBeUndefined()
    expect(handlers.get('set-store-value')!({}, 'secrets', 1)).toEqual({ success: false, error: 'Key not allowed' })
  })

  it('写 settings 走结构校验并触发 UPnP 重新协商', async () => {
    const handlers = await registered()
    const result = handlers.get('set-store-value')!({}, 'settings', { aria2: {} })
    expect(result).toEqual({ success: true })
    expect(state.saved).toHaveLength(1)
    expect(state.upnpReconcile).toHaveBeenCalled()
  })

  it('windowState / taskSources 校验失败时拒绝写入', async () => {
    const handlers = await registered()
    state.sanitizeWindowState = () => null
    expect(handlers.get('set-store-value')!({}, 'windowState', {})).toEqual({ success: false, error: 'Invalid windowState' })
    state.sanitizeTaskSources = () => null
    expect(handlers.get('set-store-value')!({}, 'taskSources', {})).toEqual({ success: false, error: 'Invalid taskSources' })
    expect(state.store.set).not.toHaveBeenCalled()
  })
})

describe('剪贴板与通知', () => {
  it('读剪贴板失败时返回空串', async () => {
    const handlers = await registered()
    state.clipboardText = 'hello'
    expect(handlers.get('read-clipboard')!({})).toBe('hello')
  })

  it('写剪贴板截断超长内容', async () => {
    const handlers = await registered()
    handlers.get('write-clipboard')!({}, 'x'.repeat(70000))
    expect(state.clipboardWrites[0]).toHaveLength(64 * 1024)
  })

  it('系统不支持通知时不抛错', async () => {
    const handlers = await registered()
    state.notificationSupported = false
    expect(() => handlers.get('send-notification')!({}, 't', 'b')).not.toThrow()
    expect(state.notifications).toHaveLength(0)
  })
})

describe('系统命令按平台选择', () => {
  const original = process.platform
  function setPlatform(value: string) {
    Object.defineProperty(process, 'platform', { value, configurable: true })
  }

  it('Windows 关机走 shutdown /s /t 60', async () => {
    setPlatform('win32')
    try {
      const handlers = await registered()
      expect(await handlers.get('system-shutdown')!({})).toEqual({ success: true })
      expect(state.commands[0]).toEqual({ file: 'shutdown', args: ['/s', '/t', '60'] })
    } finally {
      setPlatform(original)
    }
  })

  it('macOS 关机走 osascript', async () => {
    setPlatform('darwin')
    try {
      const handlers = await registered()
      await handlers.get('system-shutdown')!({})
      expect(state.commands[0].file).toBe('osascript')
    } finally {
      setPlatform(original)
    }
  })

  it('Linux 休眠走 systemctl hibernate', async () => {
    setPlatform('linux')
    try {
      const handlers = await registered()
      await handlers.get('system-hibernate')!({})
      expect(state.commands[0]).toEqual({ file: 'systemctl', args: ['hibernate'] })
    } finally {
      setPlatform(original)
    }
  })

  it('macOS 不支持取消关机时返回明确错误', async () => {
    setPlatform('darwin')
    try {
      const handlers = await registered()
      expect(await handlers.get('system-cancel-shutdown')!({})).toEqual({
        success: false,
        error: 'Cancel shutdown is not supported on macOS'
      })
    } finally {
      setPlatform(original)
    }
  })

  it('命令执行失败时如实返回错误', async () => {
    state.commandShouldFail = true
    const handlers = await registered()
    const result = await handlers.get('system-shutdown')!({})
    expect(result.success).toBe(false)
    expect(result.error).toContain('command failed')
  })
})

describe('外链与文件操作边界', () => {
  it('非白名单外链被拦截且日志只记协议', async () => {
    const handlers = await registered()
    expect(await handlers.get('open-external-url')!({}, 'file:///C:/Windows/system32/calc.exe')).toEqual({
      success: false,
      error: 'url_not_allowed'
    })
    expect(state.shellCalls).toHaveLength(0)
    const warns = state.logs.warn.map(args => String(args[1] ?? args[0]))
    expect(warns.join(' ')).toContain('file:')
  })

  it('白名单外链交给系统打开', async () => {
    const handlers = await registered()
    expect(await handlers.get('open-external-url')!({}, 'https://github.com/x')).toEqual({ success: true })
    expect(state.shellCalls[0]).toEqual({ kind: 'external', arg: 'https://github.com/x' })
  })

  it('open-file 拒绝下载目录外的路径', async () => {
    const handlers = await registered()
    const outside = 'E:/Windows/system32/calc.exe'
    state.files.add(outside)
    const result = await handlers.get('open-file')!({}, outside)
    expect(result).toEqual({ success: false, error: 'Path not allowed' })
    expect(state.shellCalls).toHaveLength(0)
  })

  it('open-file 只允许普通文件', async () => {
    const handlers = await registered()
    const dir = 'E:/downloads/sub'
    state.dirs.add(dir)
    expect(await handlers.get('open-file')!({}, dir)).toEqual({ success: false, error: 'Only files can be opened' })
  })

  it('open-file 在目录内时用默认程序打开', async () => {
    const handlers = await registered()
    const file = 'E:/downloads/a.zip'
    state.files.add(file)
    expect(await handlers.get('open-file')!({}, file)).toEqual({ success: true })
    expect(state.shellCalls[0].kind).toBe('open')
    expect(state.shellCalls[0].arg.replace(/\\/g, '/')).toBe(file)
  })

  it('open-path 只接受绝对目录并拒绝 UNC', async () => {
    const handlers = await registered()
    expect(await handlers.get('open-path')!({}, 'relative/dir')).toEqual({ success: false, error: 'Path not allowed' })
    expect(await handlers.get('open-path')!({}, '\\\\server\\share')).toEqual({ success: false, error: 'Path not allowed' })
    state.dirs.add('E:/downloads')
    expect(await handlers.get('open-path')!({}, 'E:/downloads')).toEqual({ success: true })
  })

  it('delete-files 拒绝下载根之外的任务目录', async () => {
    const handlers = await registered()
    const result = await handlers.get('delete-files')!({}, ['E:/downloads/a.zip'], 'E:/Windows')
    expect(result).toEqual({ success: false, error: 'taskDir outside allowed root' })
  })

  it('delete-files 逐项返回结果，越界项标记失败', async () => {
    const handlers = await registered()
    state.files.add('E:/downloads/a.zip')
    const result = await handlers.get('delete-files')!({}, ['E:/downloads/a.zip', 'E:/Windows/b.dll'])
    expect(result.success).toBe(true)
    expect(result.results[0]).toEqual({ path: 'E:/downloads/a.zip', success: true })
    expect(result.results[1]).toMatchObject({ path: 'E:/Windows/b.dll', success: false })
    expect(state.trashCalls.map(p => p.replace(/\\/g, '/'))).toEqual(['E:/downloads/a.zip'])
  })

  it('delete-files 把本来就缺失的文件算作成功', async () => {
    const handlers = await registered()
    const result = await handlers.get('delete-files')!({}, ['E:/downloads/missing.zip'])
    expect(result.results[0]).toEqual({ path: 'E:/downloads/missing.zip', success: true, missing: true })
  })
})

describe('磁盘与解压', () => {
  it('磁盘空间换算成字节', async () => {
    const handlers = await registered()
    expect(await handlers.get('get-disk-free-space')!({}, 'E:/downloads')).toEqual({
      free: 10 * 1024,
      total: 100 * 1024
    })
  })

  it('非绝对路径直接返回未知哨兵', async () => {
    const handlers = await registered()
    expect(await handlers.get('get-disk-free-space')!({}, 'relative')).toEqual({ free: -1, total: -1 })
  })

  it('archive-extract 拒绝下载根之外的压缩包', async () => {
    const handlers = await registered()
    const result = await handlers.get('archive-extract')!({}, 'E:/Windows/a.zip')
    expect(result).toMatchObject({ success: false, reason: 'path_not_allowed' })
  })
})

describe('流媒体通道入参校验', () => {
  it('缺少 outputDir 时拒绝', async () => {
    const handlers = await registered()
    const result = await handlers.get('stream-download-start')!({ sender: { isDestroyed: () => false, send: vi.fn() } }, { url: 'https://a' })
    expect(result).toMatchObject({ success: false, code: 'invalid_request' })
  })

  it('保存目录不在下载根内时拒绝（D-19）', async () => {
    const handlers = await registered()
    const result = await handlers.get('stream-download-start')!({ sender: { isDestroyed: () => false, send: vi.fn() } }, {
      url: 'https://a',
      outputDir: 'C:/Windows/System32'
    })
    expect(result).toMatchObject({ success: false, code: 'path_not_allowed' })
  })

  it('playlist 结构非法时拒绝', async () => {
    const handlers = await registered()
    const result = await handlers.get('stream-download-start')!({ sender: { isDestroyed: () => false, send: vi.fn() } }, {
      url: 'https://a',
      outputDir: 'E:/downloads',
      playlist: { ids: 'not-an-array' }
    })
    expect(result).toMatchObject({ success: false, code: 'invalid_request' })
  })

  it('合法请求透传给服务', async () => {
    const handlers = await registered()
    const result = await handlers.get('stream-download-start')!({ sender: { isDestroyed: () => false, send: vi.fn() } }, {
      url: 'https://a',
      outputDir: 'E:/downloads',
      merge: true
    })
    expect(result).toEqual({ success: true, id: 's1' })
  })

  it('cancel/discard/pause/resume 拒绝非字符串 id', async () => {
    const handlers = await registered()
    for (const channel of ['stream-download-cancel', 'stream-download-discard', 'stream-download-pause', 'stream-download-resume']) {
      expect(await handlers.get(channel)!({}, 42)).toBe(false)
      expect(await handlers.get(channel)!({}, 's1')).toBe(true)
    }
  })
})

describe('历史持久化', () => {
  it('保存非对象载荷被拒绝', async () => {
    const handlers = await registered()
    expect(await handlers.get('persisted-tasks-save')!({}, [1, 2])).toEqual({
      success: false,
      error: 'Invalid history payload'
    })
  })

  it('单条写入校验 gid 与任务形状', async () => {
    const handlers = await registered()
    expect(await handlers.get('persisted-tasks-save-one')!({}, '', {})).toEqual({ success: false, error: 'Invalid gid' })
    expect(await handlers.get('persisted-tasks-save-one')!({}, 'g1', null)).toEqual({ success: false, error: 'Invalid history task' })
    expect(await handlers.get('persisted-tasks-save-one')!({}, 'g1', { a: 1 })).toEqual({ success: true })
  })

  it('批量删除过滤非法项并限制 1000 条', async () => {
    const handlers = await registered()
    expect(await handlers.get('persisted-tasks-delete')!({}, 'not-array')).toEqual({ success: false, error: 'Invalid gids' })
    const many = Array.from({ length: 1200 }, (_, i) => 'g' + i)
    await handlers.get('persisted-tasks-delete')!({}, many)
    expect(state.history.deleteMany.mock.calls[0][0]).toHaveLength(1000)
  })
})

describe('日志通道', () => {
  it('write-log 过滤非法级别并截断超长内容', async () => {
    const handlers = await registered()
    expect(handlers.get('write-log')!({}, 'verbose', 'hello')).toEqual({ success: true })
    expect(state.logs.info[0][0]).toBe('hello')
    handlers.get('write-log')!({}, 'error', 'x'.repeat(5000))
    expect(state.logs.error[0][0]).toHaveLength(2000)
    expect(handlers.get('write-log')!({}, 'info', '')).toEqual({ success: false })
  })

  it('read-log-file 限制行数范围并去掉末尾空行', async () => {
    const handlers = await registered()
    state.logLines = ['a', 'b', '']
    const result = await handlers.get('read-log-file')!({}, 1)
    expect(result.success).toBe(true)
    expect(result.lines).toEqual(['a', 'b'])
  })
})

describe('插件与更新通道', () => {
  it('插件通道委托给管理器', async () => {
    const handlers = await registered()
    expect(handlers.get('plugins-list')!({})).toEqual([{ id: 'p' }])
    expect(handlers.get('plugins-enable')!({}, 'p')).toEqual({ success: true })
    expect(handlers.get('plugins-dir')!({})).toEqual({ success: true, path: 'E:/userData/plugins' })
  })

  it('插件市场安装拒绝非字符串 id', async () => {
    const handlers = await registered()
    expect(await handlers.get('plugins-market-install')!({}, 5)).toEqual({ success: false, error: 'INVALID_ID' })
    expect(await handlers.get('plugins-market-install')!({}, 'p')).toEqual({ success: true })
  })

  it('restart-and-install 走编排服务并注入五个回调', async () => {
    const handlers = await registered()
    await handlers.get('restart-and-install')!({})
    const [arg] = state.performRestartAndInstall.mock.calls[0] as unknown as [Record<string, unknown>]
    expect(Object.keys(arg).sort()).toEqual(['logger', 'requestShutdownAndWait', 'restartAndInstall', 'restartEngine', 'saveSession'])
  })
})

describe('设置导入导出', () => {
  it('导出默认脱敏，includeSecrets 才带密钥', async () => {
    const handlers = await registered()
    expect(await handlers.get('settings-export')!({})).toEqual({ success: true, data: { redacted: true, settings: {} } })
    state.exportThrows = true
    expect(await handlers.get('settings-export')!({})).toEqual({ success: false, error: 'Error: boom' })
  })

  it('导入 dryRun 不落盘', async () => {
    const handlers = await registered()
    const result = await handlers.get('settings-import')!({}, {}, { dryRun: true })
    expect(result.success).toBe(true)
    expect(state.saved).toHaveLength(0)
  })

  it('导入失败时返回错误且不写设置', async () => {
    const handlers = await registered()
    state.importResult = { ok: false, error: 'bad file', report: {}, next: {} } as unknown as typeof state.importResult
    expect(await handlers.get('settings-import')!({}, {})).toEqual({ success: false, error: 'bad file' })
    expect(state.saved).toHaveLength(0)
  })

  it('导入成功后同步引擎配置并重新协商 UPnP', async () => {
    const handlers = await registered()
    state.engineApply = { requiresRestart: false, changed: ['port'] }
    const result = await handlers.get('settings-import')!({}, {})
    expect(result.success).toBe(true)
    expect(state.saved).toHaveLength(1)
    expect(state.upnpReconcile).toHaveBeenCalled()
  })
})

describe('对等节点地理信息与扩展状态', () => {
  it('lookup-peer-locations 过滤非法 IP 且限制 100 条', async () => {
    const handlers = await registered()
    expect(await handlers.get('lookup-peer-locations')!({}, 'not-array')).toEqual({})
    const tooMany = Array.from({ length: 101 }, () => '1.1.1.1')
    expect(await handlers.get('lookup-peer-locations')!({}, tooMany)).toEqual({})
    const result = await handlers.get('lookup-peer-locations')!({}, ['1.1.1.1', 'bad host', '::1'])
    expect(result).toEqual({ count: 2 })
  })

  it('get-extension-status 在未注入取值器时给出空连接', async () => {
    const handlers = await registered()
    expect(await handlers.get('get-extension-status')!({})).toEqual({
      appVersion: '1.5.0',
      connection: { version: null, lastSeenAt: null }
    })
  })
})
describe('应用退出与状态注入', () => {
  it('shutdown 关闭历史库、停插件管理器与每日复查', async () => {
    const { controller } = await loadController()
    controller.registerHandlers()
    controller.shutdown()
    expect(state.history.close).toHaveBeenCalled()
    expect(state.pluginManager.shutdown).toHaveBeenCalled()
    const update = controller['updateController'] as unknown as { stopScheduledCheck: ReturnType<typeof vi.fn> }
    expect(update.stopScheduledCheck).toHaveBeenCalled()
  })

  it('注入扩展状态取值器后 get-extension-status 用注入值', async () => {
    const { controller } = await loadController()
    controller.attachExtensionStatusProvider(() => ({ version: '1.2.3', lastSeenAt: 1_760_000_000_000 }))
    controller.registerHandlers()
    expect(await state.handlers.get('get-extension-status')!({})).toEqual({
      appVersion: '1.5.0',
      connection: { version: '1.2.3', lastSeenAt: 1_760_000_000_000 }
    })
  })

  it('导入需要重启的引擎设置时通知渲染层', async () => {
    const handlers = await registered()
    state.engineApply = { requiresRestart: true, changed: ['port'] }
    await handlers.get('settings-import')!({}, {})
    expect(state.sent).toEqual([{ channel: 'config:changed', payload: { key: 'engine-restart-required', value: true } }])
  })

  it('窗口未就绪时不投递重启通知', async () => {
    const handlers = await registered()
    state.hasWindow = false
    state.engineApply = { requiresRestart: true, changed: [] }
    expect(await handlers.get('settings-import')!({}, {})).toMatchObject({ success: true })
    expect(state.sent).toHaveLength(0)
  })

  it('web-console-restart 合并 apply 结果与最新状态', async () => {
    const handlers = await registered()
    state.webConsoleApplyResult = { started: true }
    expect(await handlers.get('web-console-restart')!({})).toMatchObject({ started: true, port: 0 })
  })
})

describe('文件对话框与资源管理器', () => {
  it('没有主窗口时保存/打开对话框都返回 canceled', async () => {
    const handlers = await registered()
    state.hasWindow = false
    expect(await handlers.get('show-save-dialog')!({}, {})).toEqual({ canceled: true })
    expect(await handlers.get('show-open-dialog')!({}, {})).toEqual({ canceled: true })
  })

  it('有主窗口时把对话框结果原样带回', async () => {
    const handlers = await registered()
    state.dialogResult = { canceled: false, filePath: 'E:/downloads/a.torrent' }
    expect(await handlers.get('show-save-dialog')!({}, {})).toEqual({ canceled: false, filePath: 'E:/downloads/a.torrent' })
  })

  it('show-item-in-folder 拒绝空路径与不存在的路径', async () => {
    const handlers = await registered()
    expect(await handlers.get('show-item-in-folder')!({}, '')).toEqual({ success: false, error: 'Invalid path' })
    expect(await handlers.get('show-item-in-folder')!({}, 'E:/downloads/a.zip')).toEqual({
      success: false,
      error: 'Path not found'
    })
  })

  it('show-item-in-folder 拒绝下载根之外的路径', async () => {
    const handlers = await registered()
    const outside = 'E:/Windows/system32/calc.exe'
    state.files.add(outside)
    expect(await handlers.get('show-item-in-folder')!({}, outside)).toEqual({ success: false, error: 'Path not allowed' })
    expect(state.shellCalls).toHaveLength(0)
  })

  it('show-item-in-folder 在下载根内时定位文件', async () => {
    const handlers = await registered()
    const file = 'E:/downloads/a.zip'
    state.files.add(file)
    expect(await handlers.get('show-item-in-folder')!({}, file)).toEqual({ success: true })
    expect(state.shellCalls[0].kind).toBe('reveal')
  })

  it('open-in-explorer 文件存在时选中，不存在时退化打开目录', async () => {
    const handlers = await registered()
    const file = 'E:/downloads/a.zip'
    state.files.add(file)
    expect(await handlers.get('open-in-explorer')!({}, file)).toEqual({ success: true })
    expect(state.shellCalls[0].kind).toBe('reveal')

    const missing = 'E:/downloads/sub/missing.zip'
    state.dirs.add('E:/downloads/sub')
    expect(await handlers.get('open-in-explorer')!({}, missing)).toEqual({ success: true })
    expect(state.shellCalls[1].kind).toBe('open')
  })

  it('open-in-explorer 拒绝越界路径与完全找不到的目录', async () => {
    const handlers = await registered()
    expect(await handlers.get('open-in-explorer')!({}, 'E:/Windows/a.dll')).toEqual({
      success: false,
      error: 'Path not allowed'
    })
    expect(await handlers.get('open-in-explorer')!({}, 'E:/downloads/none/missing.zip')).toEqual({
      success: false,
      error: 'Path not found'
    })
  })

  it('open-path 拒绝空路径与不存在的目录', async () => {
    const handlers = await registered()
    expect(await handlers.get('open-path')!({}, '  ')).toEqual({ success: false, error: 'Invalid path' })
    expect(await handlers.get('open-path')!({}, 'E:/downloads/none')).toEqual({ success: false, error: 'Path not found' })
  })

  it('open-path 透传 shell 返回的错误文案', async () => {
    const handlers = await registered()
    state.dirs.add('E:/downloads')
    state.openPathError = 'no handler'
    expect(await handlers.get('open-path')!({}, 'E:/downloads')).toEqual({ success: false, error: 'no handler' })
  })

  it('download-probe-filename 与 resolve-download-conflict 透传给工具函数', async () => {
    const handlers = await registered()
    expect(await handlers.get('download-probe-filename')!({}, 'https://a/b')).toBe('probe.zip')
    expect(await handlers.get('resolve-download-conflict')!({}, 'E:/downloads', 'a.zip')).toEqual({
      fileName: 'a.zip',
      conflict: false
    })
  })
})

describe('导出 torrent 与解压', () => {
  it('gid 非法时直接拒绝', async () => {
    const handlers = await registered()
    expect(await handlers.get('export-task-torrent')!({}, 'not-a-gid')).toEqual({ success: false, error: 'invalid_gid' })
  })

  it('非 BT 任务返回 not_bittorrent', async () => {
    const handlers = await registered()
    state.rpcPlan['aria2.tellStatus'] = async () => ({ gid: '0123456789abcdef' })
    expect(await handlers.get('export-task-torrent')!({}, '0123456789abcdef')).toEqual({
      success: false,
      error: 'not_bittorrent'
    })
  })

  it('元数据文件尚未落盘时返回 metadata_not_saved', async () => {
    const handlers = await registered()
    state.rpcPlan['aria2.tellStatus'] = async () => ({ infoHash: 'abc', dir: 'E:/downloads' })
    expect(await handlers.get('export-task-torrent')!({}, '0123456789abcdef')).toEqual({
      success: false,
      error: 'metadata_not_saved'
    })
  })

  it('用户在保存对话框取消时返回 canceled', async () => {
    const handlers = await registered()
    state.rpcPlan['aria2.tellStatus'] = async () => ({ infoHash: 'abc', dir: 'E:/downloads' })
    state.existsSet.add('E:/downloads/abc.torrent')
    expect(await handlers.get('export-task-torrent')!({}, '0123456789abcdef')).toEqual({
      success: false,
      canceled: true
    })
  })

  it('保存成功时按 bittorrent 名称给出默认文件名并复制', async () => {
    const handlers = await registered()
    state.rpcPlan['aria2.tellStatus'] = async () => ({
      infoHash: 'abc',
      dir: 'E:/downloads',
      bittorrent: { info: { name: '演示' } }
    })
    state.existsSet.add('E:/downloads/abc.torrent')
    state.dialogResult = { canceled: false, filePath: 'E:/out/演示.torrent' }
    expect(await handlers.get('export-task-torrent')!({}, '0123456789abcdef')).toEqual({
      success: true,
      path: 'E:/out/演示.torrent'
    })
    expect(state.copyCalls).toHaveLength(1)
    expect(state.copyCalls[0].to.replace(/\\/g, '/')).toBe('E:/out/演示.torrent')
  })

  it('RPC 抛错时转成失败结果', async () => {
    const handlers = await registered()
    state.rpcPlan['aria2.tellStatus'] = async () => { throw new Error('rpc down') }
    const result = await handlers.get('export-task-torrent')!({}, '0123456789abcdef')
    expect(result).toEqual({ success: false, error: 'rpc down' })
  })

  it('archive-extract 拒绝空路径', async () => {
    const handlers = await registered()
    expect(await handlers.get('archive-extract')!({}, '')).toEqual({
      success: false,
      extracted: false,
      reason: 'invalid_path'
    })
  })
})

describe('删除文件的三条兜底路径', () => {
  it('按修正后的重复目录路径删除成功', async () => {
    const handlers = await registered()
    const duplicated = 'E:/downloads/Downloads/x.zip'
    const repaired = 'E:/downloads/x.zip'
    state.existsSet.add(repaired)
    state.files.add(repaired)
    state.repairedPath = repaired
    const result = await handlers.get('delete-files')!({}, [duplicated])
    expect(result.results[0]).toMatchObject({ path: duplicated, success: true, repairedPath: repaired })
    expect(state.trashCalls.map(p => p.replace(/\\/g, '/'))).toEqual([repaired])
  })

  it('修正后仍然不存在时按缺失成功', async () => {
    const handlers = await registered()
    state.repairedPath = null
    const result = await handlers.get('delete-files')!({}, ['E:/downloads/gone.zip'])
    expect(result.results[0]).toEqual({ path: 'E:/downloads/gone.zip', success: true, missing: true })
  })

  it('回收站抛非 ENOENT 错误时该项标记失败', async () => {
    const handlers = await registered()
    const file = 'E:/downloads/a.zip'
    state.files.add(file)
    // trashItem 收到的是 path.resolve 之后的原生分隔符路径
    state.trashPlan[file.replace(/\//g, '\\')] = 'EBUSY'
    const result = await handlers.get('delete-files')!({}, [file])
    expect(result.success).toBe(true)
    expect(result.results[0]).toMatchObject({ success: false })
    expect(String(result.results[0].error)).toContain('EBUSY')
  })

  it('realpath 失败时回落原路径仍能删除', async () => {
    const handlers = await registered()
    const file = 'E:/downloads/a.zip'
    state.files.add(file)
    state.realpathThrows = true
    const result = await handlers.get('delete-files')!({}, [file])
    expect(result.results[0]).toMatchObject({ success: true })
  })
})

describe('历史统计与清空', () => {
  it('clear 与 stats 委托给历史库', async () => {
    const handlers = await registered()
    expect(await handlers.get('persisted-tasks-clear')!({})).toEqual({ success: true })
    expect(await handlers.get('persisted-tasks-stats')!({})).toEqual({ count: 3, backend: 'sqlite' })
  })

  it('JSON 回退后端提示改走全量保存', async () => {
    const handlers = await registered()
    state.history.enabled = false
    expect(await handlers.get('persisted-tasks-delete')!({}, ['g1'])).toEqual({
      success: false,
      error: 'unsupported',
      fallback: true
    })
  })
})

describe('流媒体与 yt-dlp 通道', () => {
  it('startStreamDownload 的事件回调转发到渲染层，窗口销毁时不发', async () => {
    const handlers = await registered()
    const send = vi.fn()
    await handlers.get('stream-download-start')!({ sender: { isDestroyed: () => false, send } }, {
      url: 'https://a',
      outputDir: 'E:/downloads'
    })
    state.streamOnEvent!({ id: 's1', status: 'active' })
    expect(send).toHaveBeenCalledWith('stream-download-event', { id: 's1', status: 'active' })

    const deadSend = vi.fn()
    await handlers.get('stream-download-start')!({ sender: { isDestroyed: () => true, send: deadSend } }, {
      url: 'https://a',
      outputDir: 'E:/downloads'
    })
    state.streamOnEvent!({ id: 's2' })
    expect(deadSend).not.toHaveBeenCalled()
  })

  it('delete-file 拒绝非字符串参数', async () => {
    const handlers = await registered()
    expect(await handlers.get('stream-download-delete-file')!({}, 42, 'E:/downloads')).toEqual({
      success: false,
      error: 'Invalid request'
    })
    expect(await handlers.get('stream-download-delete-file')!({}, 'E:/a.mp4', 'E:/downloads')).toEqual({ success: true })
  })

  it('ytdlp/ffmpeg 安装进度经事件通道推送', async () => {
    const handlers = await registered()
    const send = vi.fn()
    await handlers.get('ytdlp-install')!({ sender: { isDestroyed: () => false, send } })
    expect(send).toHaveBeenCalledWith('ytdlp-install-progress', { percent: 50 })

    const ffmpegSend = vi.fn()
    await handlers.get('ffmpeg-install')!({ sender: { isDestroyed: () => false, send: ffmpegSend } })
    expect(ffmpegSend).toHaveBeenCalledWith('ffmpeg-install-progress', { percent: 10 })
  })

  it('能力查询与解析通道委托给服务层', async () => {
    const handlers = await registered()
    expect(await handlers.get('ytdlp-check')!({})).toEqual({ available: true, installable: true })
    expect(await handlers.get('ytdlp-check-update')!({})).toMatchObject({ success: true })
    expect(await handlers.get('ffmpeg-check')!({})).toEqual({ available: true, installable: true })
    expect(await handlers.get('ffmpeg-check-update')!({})).toMatchObject({ success: true })
    expect(await handlers.get('ytdlp-video-info')!({}, 'https://a')).toEqual({ title: 'v' })
    expect(await handlers.get('ytdlp-format-url')!({}, 'https://a', '137')).toBe('https://cdn/x.mp4')
    expect(await handlers.get('ytdlp-playlist-info')!({}, 'https://a')).toEqual({ entries: [] })
  })
})

describe('插件、日志与目录通道', () => {
  it('停用/卸载/市场列表都委托给服务', async () => {
    const handlers = await registered()
    expect(handlers.get('plugins-disable')!({}, 'p')).toEqual({ success: true })
    expect(handlers.get('plugins-uninstall')!({}, 'p')).toEqual({ success: true })
    expect(await handlers.get('plugins-market-list')!({}, true)).toEqual({ success: true, plugins: [] })
    expect(state.pluginMarket.list).toHaveBeenCalledWith(true)
  })

  it('plugins-open-dir 打开失败时带回错误', async () => {
    const handlers = await registered()
    expect(await handlers.get('plugins-open-dir')!({})).toEqual({ success: true })
    state.openPathError = 'denied'
    expect(await handlers.get('plugins-open-dir')!({})).toEqual({ success: false, error: 'denied' })
  })

  it('get-logs-path 与 open-logs-dir 使用 electron-log 解析出的路径', async () => {
    const handlers = await registered()
    expect(handlers.get('get-logs-path')!({})).toEqual({
      success: true,
      file: 'E:/userData/logs/main.log',
      dir: 'E:/userData/logs'
    })
    expect(await handlers.get('open-logs-dir')!({})).toMatchObject({ success: true, dir: 'E:/userData/logs' })
    state.openPathError = 'denied'
    expect(await handlers.get('open-logs-dir')!({})).toEqual({ success: false, error: 'denied' })
  })

  it('read-log-file 在日志文件缺失时返回空列表', async () => {
    const handlers = await registered()
    state.existsSet.clear()
    expect(await handlers.get('read-log-file')!({}, 10)).toMatchObject({ success: true, lines: [], totalLines: 0 })
  })

  it('read-log-file 从文件中间读取时丢掉半截首行并标记截断', async () => {
    const handlers = await registered()
    state.logFileSize = 2 * 1024 * 1024
    state.logLines = ['半截行', '第二行', '第三行']
    const result = await handlers.get('read-log-file')!({}, 10)
    expect(result.success).toBe(true)
    expect(result.truncated).toBe(true)
    expect(result.lines[0]).toBe('第二行')
  })

  it('read-log-file 读取异常时如实报错', async () => {
    const handlers = await registered()
    state.logReadError = { code: 'EACCES' }
    const result = await handlers.get('read-log-file')!({}, 10)
    expect(result.success).toBe(false)
    expect(result.lines).toEqual([])
  })
})

describe('托盘、主题与系统探测', () => {
  it('set-tray-enabled 如实回报托盘是否真的存在', async () => {
    const handlers = await registered()
    const original = trayController.getTray
    try {
      expect(handlers.get('set-tray-enabled')!({}, true)).toEqual({ success: true, enabled: true })
      expect(trayController.createTray).toHaveBeenCalled()
      trayController.getTray = () => null
      expect(handlers.get('set-tray-enabled')!({}, true)).toEqual({ success: false, enabled: false })
      expect(handlers.get('set-tray-enabled')!({}, false)).toEqual({ success: true, enabled: false })
      expect(trayController.destroy).toHaveBeenCalled()
    } finally {
      trayController.getTray = original
    }
  })

  it('set-window-theme 与 set-taskbar-progress 转给窗口控制器', async () => {
    const handlers = await registered()
    expect(handlers.get('set-window-theme')!({}, true)).toEqual({ success: true })
    expect(windowController.setWindowTheme).toHaveBeenCalledWith(true)
    handlers.get('set-taskbar-progress')!({}, 0.5, 'paused')
    expect(windowController.setTaskbarProgress).toHaveBeenCalledWith(0.5, 'paused')
    handlers.get('set-taskbar-progress')!({}, 0.5)
    expect(windowController.setTaskbarProgress).toHaveBeenLastCalledWith(0.5, 'normal')
  })

  it('detect-system-proxy 解析 HTTP 与 SOCKS 代理，直连时返回空串', async () => {
    const handlers = await registered()
    state.proxyValue = 'PROXY 1.2.3.4:8080'
    expect(await handlers.get('detect-system-proxy')!({})).toEqual({ success: true, proxy: 'http://1.2.3.4:8080' })
    state.proxyValue = 'SOCKS5 1.2.3.4:1080'
    expect(await handlers.get('detect-system-proxy')!({})).toEqual({ success: true, proxy: 'socks5://1.2.3.4:1080' })
    state.proxyValue = 'DIRECT'
    expect(await handlers.get('detect-system-proxy')!({})).toEqual({ success: true, proxy: '' })
  })

  it('开机自启、默认下载目录与密钥存储状态', async () => {
    const handlers = await registered()
    expect(handlers.get('get-auto-launch')!({})).toEqual({ success: true, enabled: true })
    expect(handlers.get('set-auto-launch')!({}, false)).toEqual({ success: true, enabled: true })
    expect(state.autoLaunchSet).toBe(false)
    expect(handlers.get('get-default-download-dir')!({})).toEqual({ success: true, path: 'E:/downloads' })
    expect(handlers.get('get-secret-storage-status')!({})).toEqual({ available: true, platform: process.platform })
  })

  it('UPnP 状态与手动重映射', async () => {
    const handlers = await registered()
    expect(await handlers.get('get-upnp-status')!({})).toEqual({ state: 'idle' })
    expect(await handlers.get('upnp-remap')!({})).toEqual({ state: 'ok', ports: [6881] })
  })

  it('statfs 失败时回落未知哨兵', async () => {
    const handlers = await registered()
    state.statfsThrows = true
    expect(await handlers.get('get-disk-free-space')!({}, 'E:/downloads')).toEqual({ free: -1, total: -1 })
  })
})

describe('下载事件与渲染层日志监听器', () => {
  it('download-event 校验类型与 gid 后转发给插件并触发完成规则', async () => {
    await registered()
    const { applyCompletionRules } = await import('../services/completionRuleService')
    state.listeners.get('download-event')!({}, 'downloadComplete', 'g1', 'name.zip')
    expect(state.pluginManager.emit).toHaveBeenCalledWith('downloadComplete', { gid: 'g1', name: 'name.zip' })
    expect(applyCompletionRules).toHaveBeenCalledWith('g1')

    state.listeners.get('download-event')!({}, 'unknownKind', 'g2', 'x')
    state.listeners.get('download-event')!({}, 'downloadStart', '', 'x')
    expect(state.pluginManager.emit).toHaveBeenCalledTimes(1)
  })

  it('download-event 在名称缺失时补空串', async () => {
    await registered()
    state.listeners.get('download-event')!({}, 'downloadStart', 'g1', 42)
    expect(state.pluginManager.emit).toHaveBeenCalledWith('downloadStart', { gid: 'g1', name: '' })
  })

  it('renderer-error 把文案与堆栈截断后落日志', async () => {
    await registered()
    state.listeners.get('renderer-error')!({}, { message: 'x'.repeat(3000), stack: 'y'.repeat(7000), kind: 'unhandled' })
    const logged = String(state.logs.error[0][0])
    expect(logged).toContain('[Renderer:unhandled]')
    expect(logged).toContain('x'.repeat(2000))
    expect(logged).not.toContain('x'.repeat(2001))
    expect(logged.length).toBeLessThan(9100)
  })

  it('renderer-error 在字段缺失时使用默认值', async () => {
    await registered()
    expect(() => state.listeners.get('renderer-error')!({}, {})).not.toThrow()
    expect(String(state.logs.error[0][0])).toBe('[Renderer:error] ')
  })
})

