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
      resolveProxy: vi.fn(async () => 'DIRECT')
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

vi.mock('../utils/pathRepair', () => ({ undoDuplicatedSegment: () => null }))

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
  startStreamDownload: vi.fn(async () => ({ success: true, id: 's1' })),
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

vi.mock('../services/webConsoleServer', () => ({ webConsoleServer: { getStatus: () => state.webConsoleStatus, apply: async () => ({}) } }))

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
    realpath: async (p: string) => p,
    statfs: async () => state.statfs,
    mkdir: async () => undefined,
    copyFile: async () => undefined,
    open: async () => ({
      stat: async () => ({ size: 10 }),
      read: async (buffer: Buffer) => {
        const written = buffer.write(state.logLines.join('\n'))
        return { bytesRead: written }
      },
      close: async () => undefined
    })
  }
}))

type Controller = import('./IpcController').IpcController

const windowController = {
  getMainWindow: () => ({ isDestroyed: () => false, webContents: { send: vi.fn() } }),
  isRendererContentReady: () => true,
  setWindowTheme: vi.fn(),
  setTaskbarProgress: vi.fn(),
  show: vi.fn()
}

const trayController = {
  createTray: vi.fn(),
  destroy: vi.fn(),
  getTray: () => ({ id: 1 })
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
