/**
 * electron/main.ts 的单元测试。
 *
 * main.ts 是入口脚本：没有导出，全部行为都是 import 时的副作用，因此这里用
 * vi.resetModules() + 动态 import 反复加载，断言它对 electron 与各子系统的调用。
 *
 * 覆盖的是只有集成才能发现、且出错代价最高的几条主线：
 * - 单实例锁：拿不到锁必须立刻退出，不能启动第二套引擎/托盘；
 * - 全局兜底：逃逸的 Promise 拒绝不能让常驻下载器整体退出；
 * - 待处理链接队列：冷启动时渲染层还没就绪，磁力链接必须排队而不是静默丢弃；
 * - 优雅关闭：before-quit 只跑一次，且先让渲染层刷盘再关服务。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  type Handler = (...args: never[]) => unknown
  const state = {
    packaged: false,
    userData: 'E:/user-data',
    minimizeToTray: false,
    lockGranted: true,
    argv: [] as string[],
    order: [] as string[],
    appHandlers: new Map<string, Handler[]>(),
    processHandlers: new Map<string, Handler[]>(),
    quitCalls: 0,
    aumids: [] as string[],
    protocols: [] as string[],
    logs: { info: [] as string[], warn: [] as string[], error: [] as string[] },
    exists: new Set<string>(),
    copied: [] as Array<[string, string]>,
    copyFailures: new Set<string>(),
    written: [] as Array<[string, string]>,
    mkdirs: [] as string[],
    readFiles: new Map<string, string>(),
    stats: new Map<string, { isFile: boolean; size: number }>(),
    sends: [] as Array<[string, unknown]>,
    rendererReadyCb: null as null | (() => void),
    engineStartedCb: null as null | (() => void),
    engineCrashCb: null as null | ((count: number) => void),
    engineGaveUpCb: null as null | ((attempts: number) => void),
    restartNotice: false,
    lifecycleInit: null as null | (() => Promise<void>),
    calls: [] as string[],
    windowDestroyed: false,
    shutdownStarted: false,
    dialogResponse: 1,
    storeChanges: [] as string[],
    statusProvider: null as null | (() => unknown),
    extensionDeps: null as Record<string, (...args: never[]) => unknown> | null,
    trayGaveUp: null as number | null,
    trayCleared: 0,
    appliedConsole: 0
  }
  const windowStub = {
    webContents: {
      send: (channel: string, payload: unknown) => {
        state.sends.push([channel, payload])
      }
    },
    isDestroyed: () => state.windowDestroyed
  }
  return { state, windowStub }
})

vi.mock('electron', () => ({
  app: {
    setPath: (name: string, value: string) => {
      h.state.order.push('setPath:' + name)
      h.state.userData = value
    },
    getPath: (name: string) => {
      h.state.order.push('getPath:' + name)
      return h.state.userData
    },
    getVersion: () => '1.5.0-beta.4',
    requestSingleInstanceLock: () => h.state.lockGranted,
    quit: () => {
      h.state.quitCalls++
    },
    on: (event: string, handler: (...args: never[]) => unknown) => {
      const list = h.state.appHandlers.get(event) ?? []
      list.push(handler)
      h.state.appHandlers.set(event, list)
    },
    whenReady: () => Promise.resolve(),
    setAppUserModelId: (id: string) => {
      h.state.aumids.push(id)
    },
    setAsDefaultProtocolClient: (protocol: string) => {
      h.state.protocols.push(protocol)
    }
  },
  dialog: { showMessageBox: async () => ({ response: h.state.dialogResponse }) }
}))

vi.mock('electron-store', () => ({
  default: class {
    constructor(public options: unknown) {}
    onDidChange(key: string) {
      h.state.storeChanges.push(key)
    }
  }
}))

/** Windows 下 path.join 产出反斜杠，桩里统一成正斜杠再比对 */
function fsKey(target: string): string {
  return target.replace(/\\/g, '/')
}

vi.mock('fs', () => ({
  existsSync: (target: string) => h.state.exists.has(fsKey(target)),
  mkdirSync: (target: string) => {
    h.state.mkdirs.push(fsKey(target))
  },
  copyFileSync: (from: string, to: string) => {
    if (h.state.copyFailures.has(fsKey(from))) throw new Error('copy failed')
    h.state.copied.push([fsKey(from), fsKey(to)])
  },
  writeFileSync: (target: string, data: string) => {
    h.state.written.push([fsKey(target), data])
  },
  promises: {
    stat: async (target: string) => {
      const entry = h.state.stats.get(fsKey(target))
      if (!entry) throw new Error('ENOENT')
      // 实现里调的是 stat.isFile()（fs.Stats 的方法），桩不能只给布尔字段
      return { isFile: () => entry.isFile, size: entry.size }
    },
    readFile: async (target: string) => {
      const content = h.state.readFiles.get(fsKey(target))
      if (content === undefined) throw new Error('ENOENT')
      return Buffer.from(content, 'utf-8')
    }
  }
}))

vi.mock('./utils/logger', () => ({
  setupLogging: () => {
    h.state.order.push('setupLogging')
  },
  createLogger: () => ({
    info: (message: string) => {
      h.state.logs.info.push(message)
    },
    warn: (message: string) => {
      h.state.logs.warn.push(message)
    },
    error: (message: string) => {
      h.state.logs.error.push(message)
    },
    debug: () => {}
  })
}))

vi.mock('./utils/appEnv', () => ({
  get isPackagedApp() {
    return h.state.packaged
  }
}))

vi.mock('./utils/settingsAccessor', () => ({
  bindSettingsStore: () => {
    h.state.calls.push('bindSettingsStore')
  },
  getSettings: () => ({ minimizeToTray: h.state.minimizeToTray, aria2: { port: 6800 } })
}))

vi.mock('./utils/appState', () => ({
  appState: {
    markQuitting: () => {
      h.state.calls.push('markQuitting')
    },
    hasShutdownStarted: () => h.state.shutdownStarted,
    markShutdownStarted: () => {
      h.state.shutdownStarted = true
    }
  }
}))

vi.mock('./controllers/WindowController', () => ({
  WindowController: class {
    constructor() {
      h.state.calls.push('new:WindowController')
    }
    getMainWindow() {
      return h.windowStub
    }
    createWindow() {
      h.state.calls.push('createWindow')
      return h.windowStub
    }
    show() {
      h.state.calls.push('showWindow')
    }
    isRendererContentReady() {
      return true
    }
    setOnRendererReady(callback: () => void) {
      h.state.rendererReadyCb = callback
    }
    async flushRendererData() {
      h.state.calls.push('flushRendererData')
    }
  }
}))

vi.mock('./controllers/TrayController', () => ({
  TrayController: class {
    setEngineGaveUp(attempts: number) {
      h.state.trayGaveUp = attempts
    }
    clearEngineGaveUp() {
      h.state.trayCleared++
    }
  }
}))

vi.mock('./controllers/Aria2Controller', () => ({
  Aria2Controller: class {
    setEngineStartedListener(callback: () => void) {
      h.state.engineStartedCb = callback
    }
    setEngineCrashListener(callback: (count: number) => void) {
      h.state.engineCrashCb = callback
    }
    setEngineGaveUpListener(callback: (attempts: number) => void) {
      h.state.engineGaveUpCb = callback
    }
    getProcessInfo() {
      return { running: false }
    }
    consumeEngineRestartNotice() {
      const value = h.state.restartNotice
      h.state.restartNotice = false
      return value
    }
  }
}))

vi.mock('./controllers/IpcController', () => ({
  IpcController: class {
    attachExtensionStatusProvider(provider: () => unknown) {
      h.state.statusProvider = provider
    }
  }
}))

vi.mock('./controllers/AppLifecycle', () => ({
  AppLifecycle: class {
    constructor(...args: unknown[]) {
      h.state.calls.push('new:AppLifecycle')
      void args
    }
    async initialize() {
      h.state.calls.push('lifecycle:initialize')
      if (h.state.lifecycleInit) await h.state.lifecycleInit()
    }
    async shutdown() {
      h.state.calls.push('lifecycle:shutdown')
    }
    notifyEngineGaveUp(attempts: number) {
      h.state.calls.push('lifecycle:gaveUp:' + attempts)
    }
  }
}))

vi.mock('./services/trackerSubscriptionService', () => ({
  TrackerSubscriptionService: class {
    registerIpcHandlers() {
      h.state.calls.push('tracker:ipc')
    }
    initialize() {
      h.state.calls.push('tracker:initialize')
    }
    shutdown() {
      h.state.calls.push('tracker:shutdown')
    }
  }
}))

vi.mock('./services/rssSubscriptionService', () => ({
  RssSubscriptionService: class {
    registerIpcHandlers() {
      h.state.calls.push('rss:ipc')
    }
    initialize() {
      h.state.calls.push('rss:initialize')
    }
    shutdown() {
      h.state.calls.push('rss:shutdown')
    }
  }
}))

vi.mock('./services/watchFolderService', () => ({
  WatchFolderService: class {
    registerIpcHandlers() {
      h.state.calls.push('watch:ipc')
    }
    initialize() {
      h.state.calls.push('watch:initialize')
    }
    shutdown() {
      h.state.calls.push('watch:shutdown')
    }
  }
}))

vi.mock('./services/webhookDispatchService', () => ({
  initWebhookDispatchService: () => ({
    registerIpcHandlers: () => {
      h.state.calls.push('webhook:ipc')
    },
    initialize: () => {
      h.state.calls.push('webhook:initialize')
    },
    shutdown: () => {
      h.state.calls.push('webhook:shutdown')
    }
  })
}))

vi.mock('./services/speedScheduler', () => ({
  SpeedScheduler: class {
    start() {
      h.state.calls.push('speed:start')
    }
    stop() {
      h.state.calls.push('speed:stop')
    }
    reapply() {
      h.state.calls.push('speed:reapply')
    }
  }
}))

vi.mock('./services/downloadScheduler', () => ({
  DownloadScheduler: class {
    start() {
      h.state.calls.push('download:start')
    }
    stop() {
      h.state.calls.push('download:stop')
    }
    reapply() {
      h.state.calls.push('download:reapply')
    }
  }
}))

vi.mock('./services/upnpService', () => ({
  upnpService: {
    reconcile: async () => {
      h.state.calls.push('upnp:reconcile')
    },
    stop: () => {
      h.state.calls.push('upnp:stop')
    }
  }
}))

vi.mock('./services/extensionApiServer', () => ({
  ExtensionApiServer: class {
    constructor(deps: Record<string, (...args: never[]) => unknown>) {
      h.state.extensionDeps = deps
    }
    start() {
      h.state.calls.push('extension:start')
    }
    stop() {
      h.state.calls.push('extension:stop')
    }
    getExtensionConnection() {
      return { version: null, lastSeenAt: null }
    }
  }
}))

vi.mock('./services/webConsoleServer', () => ({
  webConsoleServer: {
    apply: async () => {
      h.state.appliedConsole++
    },
    stop: async () => {
      h.state.calls.push('console:stop')
    }
  }
}))

/** 让 main.ts 里的 whenReady().then(...) 微任务链跑完 */
async function flush(times = 6): Promise<void> {
  for (let index = 0; index < times; index++) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

/** 重新加载入口脚本；main.ts 无导出，全部行为都发生在 import 期间 */
async function loadMain(options: { userDataEnv?: string; lockGranted?: boolean; argv?: string[] } = {}) {
  if (options.userDataEnv === undefined) delete process.env.ARIA2_E2E_USER_DATA
  else process.env.ARIA2_E2E_USER_DATA = options.userDataEnv
  if (options.lockGranted !== undefined) h.state.lockGranted = options.lockGranted
  if (options.argv) h.state.argv = options.argv
  // main.ts 直接读 process.argv（命令行磁力链接/--headless），必须真的替换掉
  process.argv = [...h.state.argv]
  vi.resetModules()
  await import('./main')
  await flush()
}

/** 取某个 app 事件的处理器（main.ts 对同一事件可能注册多个） */
function appHandlers(event: string): Array<(...args: never[]) => unknown> {
  return h.state.appHandlers.get(event) ?? []
}

function firstAppHandler(event: string): (...args: never[]) => unknown {
  const handler = appHandlers(event)[0]
  if (!handler) throw new Error('no handler for ' + event)
  return handler
}

beforeEach(() => {
  const state = h.state
  state.packaged = false
  state.userData = 'E:/user-data'
  state.minimizeToTray = false
  state.lockGranted = true
  state.argv = ['electron', 'main.js']
  state.order = []
  state.appHandlers.clear()
  state.processHandlers.clear()
  state.quitCalls = 0
  state.aumids = []
  state.protocols = []
  state.logs = { info: [], warn: [], error: [] }
  state.exists.clear()
  state.copied = []
  state.copyFailures.clear()
  state.written = []
  state.mkdirs = []
  state.readFiles.clear()
  state.stats.clear()
  state.sends = []
  state.rendererReadyCb = null
  state.engineStartedCb = null
  state.engineCrashCb = null
  state.engineGaveUpCb = null
  state.restartNotice = false
  state.lifecycleInit = null
  state.calls = []
  state.windowDestroyed = false
  state.shutdownStarted = false
  state.dialogResponse = 1
  state.storeChanges = []
  state.statusProvider = null
  state.extensionDeps = null
  state.trayGaveUp = null
  state.trayCleared = 0
  state.appliedConsole = 0
  delete process.env.ARIA2_E2E_USER_DATA
  vi.spyOn(process, 'on').mockImplementation(((event: string, handler: never) => {
    const list = state.processHandlers.get(event) ?? []
    list.push(handler)
    state.processHandlers.set(event, list)
    return process
  }) as never)
})

describe('单实例与启动', () => {
  it('拿不到单实例锁时直接退出，不注册任何窗口/退出钩子', async () => {
    await loadMain({ lockGranted: false })
    expect(h.state.quitCalls).toBe(1)
    expect(appHandlers('before-quit')).toHaveLength(0)
    expect(appHandlers('window-all-closed')).toHaveLength(0)
  })

  it('拿到锁后注册窗口关闭、激活与退出钩子', async () => {
    await loadMain()
    expect(h.state.quitCalls).toBe(0)
    expect(appHandlers('window-all-closed')).toHaveLength(1)
    expect(appHandlers('activate')).toHaveLength(1)
    expect(appHandlers('before-quit')).toHaveLength(1)
    expect(appHandlers('second-instance')).toHaveLength(1)
  })

  it('E2E 隔离的 userData 必须在日志与配置初始化之前生效', async () => {
    await loadMain({ userDataEnv: 'E:/isolated-user-data' })
    expect(h.state.userData).toBe('E:/isolated-user-data')
    const setPathIndex = h.state.order.indexOf('setPath:userData')
    expect(setPathIndex).toBe(0)
    expect(h.state.order.indexOf('setupLogging')).toBeGreaterThan(setPathIndex)
    expect(h.state.order.indexOf('getPath:userData')).toBeGreaterThan(setPathIndex)
  })

  it('没有该环境变量时不改写 userData', async () => {
    await loadMain()
    expect(h.state.order).not.toContain('setPath:userData')
    expect(h.state.userData).toBe('E:/user-data')
  })

  it('开发态用 execPath 作为 AppUserModelID，打包态用固定的应用 ID', async () => {
    await loadMain()
    expect(h.state.aumids).toEqual([process.execPath])
    h.state.aumids = []
    h.state.packaged = true
    await loadMain()
    expect(h.state.aumids).toEqual(['com.aria2desktop.app'])
  })

  it('只有打包态才把本应用注册为 magnet 协议处理器', async () => {
    await loadMain()
    expect(h.state.protocols).toEqual([])
    h.state.packaged = true
    await loadMain()
    expect(h.state.protocols).toEqual(['magnet'])
  })
})

describe('旧版数据迁移', () => {
  // 开发态的旧版目录是 path.join(process.cwd(), 'data')，不能写死本机的 E:/Project/...，
  // 否则在 CI（D:/a/...）上三个用例会全部落空。
  const legacyRoot = fsKey(process.cwd()) + '/data'
  const legacyConfig = legacyRoot + '/config/aria2-desktop-settings.json'
  const legacyConf = legacyRoot + '/aria2/aria2.conf'
  const legacySession = legacyRoot + '/aria2/aria2.session'

  it('把旧版设置、aria2 配置与会话复制到 userData 并写标记', async () => {
    h.state.exists.add(legacyRoot)
    h.state.exists.add(legacyConfig)
    h.state.exists.add(legacyConf)
    h.state.exists.add(legacySession)
    await loadMain()
    expect(h.state.copied.map(([from]) => from)).toEqual([legacyConfig, legacyConf, legacySession])
    expect(h.state.copied[0][1]).toBe('E:/user-data/config/aria2-desktop-settings.json')
    expect(h.state.written).toHaveLength(1)
    expect(h.state.written[0][0]).toBe('E:/user-data/.legacy-data-migrated')
  })

  it('已经迁移过（标记存在）时不再复制', async () => {
    h.state.exists.add(legacyRoot)
    h.state.exists.add(legacyConfig)
    h.state.exists.add('E:/user-data/.legacy-data-migrated')
    await loadMain()
    expect(h.state.copied).toEqual([])
  })

  it('目标文件已存在时不覆盖用户现有数据', async () => {
    h.state.exists.add(legacyRoot)
    h.state.exists.add(legacyConf)
    h.state.exists.add('E:/user-data/aria2/aria2.conf')
    await loadMain()
    expect(h.state.copied).toEqual([])
    expect(h.state.written).toHaveLength(1)
  })

  it('有单项复制失败时不写标记，留待下次启动重试', async () => {
    h.state.exists.add(legacyRoot)
    h.state.exists.add(legacyConf)
    h.state.exists.add(legacySession)
    h.state.copyFailures.add(legacyConf)
    await loadMain()
    expect(h.state.written).toEqual([])
    expect(h.state.logs.warn.some((line) => line.includes('旧版数据迁移存在 1 项失败'))).toBe(true)
  })
})

describe('全局兜底', () => {
  it('逃逸的 Promise 拒绝与未捕获异常只记日志，不让主进程退出', async () => {
    await loadMain()
    const rejections = h.state.processHandlers.get('unhandledRejection') ?? []
    const exceptions = h.state.processHandlers.get('uncaughtException') ?? []
    expect(rejections).toHaveLength(1)
    expect(exceptions).toHaveLength(1)
    rejections[0](new Error('boom') as never)
    exceptions[0](new Error('bang') as never)
    expect(h.state.quitCalls).toBe(0)
    expect(h.state.logs.error.some((line) => line.includes('未捕获的 Promise 拒绝'))).toBe(true)
    expect(h.state.logs.error.some((line) => line.includes('未捕获的异常'))).toBe(true)
  })

  it('SIGINT/SIGTERM 都走 app.quit 以复用优雅关闭链路', async () => {
    await loadMain()
    const sigint = h.state.processHandlers.get('SIGINT') ?? []
    expect(sigint).toHaveLength(1)
    sigint[0]()
    expect(h.state.quitCalls).toBe(1)
  })
})

describe('初始化编排', () => {
  it('whenReady 后按序注册 IPC、初始化子系统并启动调度器', async () => {
    await loadMain()
    const calls = h.state.calls
    const ipcStart = calls.indexOf('tracker:ipc')
    expect(ipcStart).toBeGreaterThanOrEqual(0)
    expect(calls.slice(ipcStart, ipcStart + 4)).toEqual(['tracker:ipc', 'rss:ipc', 'watch:ipc', 'webhook:ipc'])
    expect(calls.indexOf('lifecycle:initialize')).toBeGreaterThan(ipcStart)
    expect(calls).toContain('lifecycle:initialize')
    expect(calls).toContain('tracker:initialize')
    expect(calls).toContain('rss:initialize')
    expect(calls).toContain('watch:initialize')
    expect(calls).toContain('webhook:initialize')
    expect(calls).toContain('speed:start')
    expect(calls).toContain('download:start')
    expect(calls).toContain('upnp:reconcile')
    expect(calls).toContain('extension:start')
    expect(h.state.appliedConsole).toBe(1)
    expect(h.state.storeChanges).toContain('settings.webConsole')
    expect(h.state.logs.info).toContain('应用初始化完成')
  })

  it('初始化失败时记录错误并退出应用', async () => {
    h.state.lifecycleInit = async () => {
      throw new Error('db locked')
    }
    await loadMain()
    expect(h.state.logs.error.some((line) => line.includes('应用初始化失败'))).toBe(true)
    expect(h.state.quitCalls).toBe(1)
    expect(h.state.appliedConsole).toBe(0)
  })
})

describe('待处理链接队列', () => {
  it('渲染层未就绪时磁力链接先入队，就绪后按到达顺序补投', async () => {
    await loadMain({ argv: ['electron', 'main.js', 'magnet:?xt=urn:btih:aaa'] })
    expect(h.state.sends).toEqual([])
    h.state.rendererReadyCb?.()
    expect(h.state.sends).toEqual([['pending-download-url', 'magnet:?xt=urn:btih:aaa']])
  })

  it('就绪后补投时把待重启引擎的提示一并送出', async () => {
    h.state.restartNotice = true
    await loadMain()
    h.state.rendererReadyCb?.()
    expect(h.state.sends).toEqual([['config:changed', { key: 'engine-restart-required', value: true }]])
  })

  it('渲染层已就绪时 second-instance 直接投递磁力链接并显示窗口', async () => {
    await loadMain()
    h.state.rendererReadyCb?.()
    h.state.calls = []
    firstAppHandler('second-instance')({} as never, ['electron', 'magnet:?xt=urn:btih:bbb'] as never)
    expect(h.state.calls).toContain('showWindow')
    expect(h.state.sends).toEqual([['pending-download-url', 'magnet:?xt=urn:btih:bbb']])
  })

  it('open-url 只处理 magnet 前缀，其它协议忽略', async () => {
    await loadMain()
    h.state.rendererReadyCb?.()
    const openUrl = firstAppHandler('open-url')
    const event = { preventDefault: () => {} }
    openUrl(event as never, 'https://example.com/a.zip' as never)
    expect(h.state.sends).toEqual([])
    openUrl(event as never, 'magnet:?xt=urn:btih:ccc' as never)
    expect(h.state.sends).toEqual([['pending-download-url', 'magnet:?xt=urn:btih:ccc']])
  })

  it('open-file 把种子文件读成 base64 投递给渲染层', async () => {
    h.state.stats.set('E:/tmp/a.torrent', { isFile: true, size: 12 })
    h.state.readFiles.set('E:/tmp/a.torrent', 'd4:infod')
    await loadMain()
    h.state.rendererReadyCb?.()
    firstAppHandler('open-file')({ preventDefault: () => {} } as never, 'E:/tmp/a.torrent' as never)
    await flush(2)
    expect(h.state.sends).toEqual([
      ['pending-task-file', { name: 'a.torrent', data: Buffer.from('d4:infod', 'utf-8').toString('base64'), kind: 'torrent' }]
    ])
  })

  it('空文件与超过 20MB 的关联文件被忽略', async () => {
    h.state.stats.set('E:/tmp/empty.torrent', { isFile: true, size: 0 })
    h.state.stats.set('E:/tmp/huge.torrent', { isFile: true, size: 21 * 1024 * 1024 })
    await loadMain()
    h.state.rendererReadyCb?.()
    const openFile = firstAppHandler('open-file')
    openFile({ preventDefault: () => {} } as never, 'E:/tmp/empty.torrent' as never)
    openFile({ preventDefault: () => {} } as never, 'E:/tmp/huge.torrent' as never)
    await flush(2)
    expect(h.state.sends).toEqual([])
    expect(h.state.logs.warn.some((line) => line.includes('忽略无法处理的关联文件'))).toBe(true)
  })

  it('非 magnet 的启动参数不会投递', async () => {
    await loadMain({ argv: ['electron', 'main.js', '--headless'] })
    h.state.rendererReadyCb?.()
    expect(h.state.sends).toEqual([])
  })
})

describe('窗口生命周期', () => {
  it('minimizeToTray 开启时关闭窗口不退出应用', async () => {
    h.state.minimizeToTray = true
    await loadMain()
    firstAppHandler('window-all-closed')()
    expect(h.state.quitCalls).toBe(0)
  })

  it('minimizeToTray 关闭时关闭窗口即退出', async () => {
    h.state.minimizeToTray = false
    await loadMain()
    firstAppHandler('window-all-closed')()
    expect(h.state.quitCalls).toBe(1)
  })

  it('--headless 下点 Dock 图标不会建窗', async () => {
    await loadMain({ argv: ['electron', 'main.js', '--headless'] })
    h.state.calls = []
    firstAppHandler('activate')()
    expect(h.state.calls).not.toContain('createWindow')
  })

  it('窗口已销毁时激活会重建窗口', async () => {
    await loadMain()
    h.state.windowDestroyed = true
    h.state.calls = []
    firstAppHandler('activate')()
    expect(h.state.calls).toContain('createWindow')
  })
})

describe('优雅关闭', () => {
  it('before-quit 只执行一次优雅关闭，第二次直接放行', async () => {
    await loadMain()
    const beforeQuit = firstAppHandler('before-quit')
    const event = { preventDefault: () => { h.state.calls.push('preventDefault') } }
    await (beforeQuit(event as never) as Promise<void>)
    await flush(2)
    expect(h.state.calls).toContain('preventDefault')
    expect(h.state.calls).toContain('markQuitting')
    expect(h.state.calls).toContain('flushRendererData')
    expect(h.state.calls).toContain('lifecycle:shutdown')
    expect(h.state.calls).toContain('extension:stop')
    expect(h.state.calls).toContain('console:stop')
    expect(h.state.quitCalls).toBe(1)

    h.state.calls = []
    await (beforeQuit(event as never) as Promise<void>)
    expect(h.state.calls).toEqual([])
    expect(h.state.quitCalls).toBe(1)
  })

  it('关闭顺序是先让渲染层刷盘，再关各子系统', async () => {
    await loadMain()
    h.state.calls = []
    await (firstAppHandler('before-quit')({ preventDefault: () => {} } as never) as Promise<void>)
    const calls = h.state.calls
    const flushIndex = calls.indexOf('flushRendererData')
    const lifecycleIndex = calls.indexOf('lifecycle:shutdown')
    const extensionIndex = calls.indexOf('extension:stop')
    expect(flushIndex).toBeGreaterThanOrEqual(0)
    expect(flushIndex).toBeLessThan(lifecycleIndex)
    expect(lifecycleIndex).toBeLessThan(extensionIndex)
  })
})

describe('引擎事件转发', () => {
  it('引擎启动后重新下发限速、清掉托盘异常态并通知界面', async () => {
    await loadMain()
    h.state.calls = []
    h.state.engineStartedCb?.()
    expect(h.state.calls).toEqual(['speed:reapply', 'download:reapply'])
    expect(h.state.trayCleared).toBe(1)
    expect(h.state.sends).toEqual([['aria2-engine-started', undefined]])
  })

  it('崩溃自动重启与放弃重启分别推给渲染层，放弃时同时写托盘并通知生命周期', async () => {
    await loadMain()
    h.state.engineCrashCb?.(2)
    expect(h.state.sends).toEqual([['aria2-engine-crashed', { retryCount: 2 }]])
    h.state.sends = []
    h.state.engineGaveUpCb?.(3)
    expect(h.state.sends).toEqual([['aria2-engine-gave-up', { attempts: 3 }]])
    expect(h.state.trayGaveUp).toBe(3)
    expect(h.state.calls).toContain('lifecycle:gaveUp:3')
  })

  it('窗口已销毁时不再向渲染层推送', async () => {
    await loadMain()
    h.state.windowDestroyed = true
    h.state.engineCrashCb?.(1)
    h.state.engineGaveUpCb?.(3)
    expect(h.state.sends).toEqual([])
    expect(h.state.trayGaveUp).toBe(3)
  })
})

describe('扩展本地接口装配', () => {
  it('配对确认走原生对话框，默认按钮是拒绝（Esc/回车都不放行）', async () => {
    await loadMain()
    const confirmPairing = h.state.extensionDeps?.confirmPairing
    expect(typeof confirmPairing).toBe('function')
    h.state.dialogResponse = 1
    await expect((confirmPairing as () => Promise<boolean>)()).resolves.toBe(false)
    h.state.dialogResponse = 0
    await expect((confirmPairing as () => Promise<boolean>)()).resolves.toBe(true)
  })

  it('扩展发起的流媒体事件转发到主窗口', async () => {
    await loadMain()
    const sendStreamEvent = h.state.extensionDeps?.sendStreamEvent as (event: unknown) => void
    sendStreamEvent({ type: 'progress', percent: 42 })
    expect(h.state.sends).toEqual([['stream-download-event', { type: 'progress', percent: 42 }]])
  })

  it('设置页读到的扩展连接信息来自接口服务的实时状态', async () => {
    await loadMain()
    expect(typeof h.state.statusProvider).toBe('function')
    expect(h.state.statusProvider?.()).toEqual({ version: null, lastSeenAt: null })
  })
})
