import * as os from 'os'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const state = {
    settings: {} as Record<string, any>,
    saved: [] as any[],
    rpcCalls: [] as any[],
    rpcPlan: {} as Record<string, () => Promise<unknown>>,
    probeClass: 'free' as string,
    portReleased: true,
    manager: null as any,
    managerSeed: {} as Record<string, any>,
    managerCalls: [] as string[],
    handlers: new Map<string, (event: unknown, ...args: any[]) => unknown>(),
    shutdownResult: { success: true, forced: false, timedOut: false, processExited: true, portReleased: true, waitedMs: 5 },
    imported: {} as Record<string, unknown>,
    logs: { info: [] as any[], warn: [] as any[], error: [] as any[] }
  }
  return { state }
})

const { state } = h

function makeManager(overrides: Record<string, any> = {}) {
  const manager = {
    isRunning: vi.fn(() => false),
    start: vi.fn(async () => true),
    stop: vi.fn(async () => true),
    restart: vi.fn(async () => true),
    getConfig: vi.fn(() => ({ port: 6800, secret: '', downloadDir: 'E:/dl' })),
    updateConfig: vi.fn((config: unknown) => { state.managerCalls.push('updateConfig:' + JSON.stringify(config)) }),
    flushConfig: vi.fn(),
    saveGlobalOptionsToConfig: vi.fn((options: unknown) => { state.managerCalls.push('saveGlobalOptionsToConfig:' + JSON.stringify(options)) }),
    getLastStderr: vi.fn(() => ''),
    resetRestartCounter: vi.fn(),
    killIfRunning: vi.fn(),
    setGracefulShutdown: vi.fn((hook: unknown) => { manager.gracefulHook = hook }),
    setEngineStartedListener: vi.fn(),
    setEngineCrashListener: vi.fn(),
    setEngineGaveUpListener: vi.fn(),
    getProcessInfo: vi.fn(() => ({ isRunning: true, pid: 4242, retryCount: 0, config: {}, isAria2Available: true, resourceInfo: {} })),
    gracefulHook: null as unknown,
    ...overrides
  }
  return manager
}

vi.mock('electron', () => ({ app: { getPath: vi.fn(() => 'E:/system-downloads') } }))

vi.mock('../managers/Aria2ProcessManager', () => ({
  getAria2ProcessManager: (config: unknown) => {
    state.manager = makeManager(state.managerSeed)
    state.manager.config = config
    return state.manager
  }
}))

vi.mock('./WindowController', () => ({ WindowController: class FakeWindowController {} }))

vi.mock('../utils/ipcSecurity', () => ({
  registerSecureHandler: (channel: string, handler: (event: unknown, ...args: any[]) => unknown) => {
    state.handlers.set(channel, handler)
  }
}))

vi.mock('../utils/aria2Rpc', () => ({
  callAria2Rpc: vi.fn(async (options: any) => {
    state.rpcCalls.push(options)
    const planned = state.rpcPlan[options.method]
    if (planned) return planned()
    return {}
  }),
  classifyRpcPortProbe: () => state.probeClass
}))

vi.mock('../utils/settingsAccessor', () => ({
  getSettingsFresh: () => state.settings,
  saveSettings: (next: unknown) => { state.saved.push(next) }
}))

vi.mock('../utils/activeRpcConfig', () => ({
  activeRpcOptions: () => ({ host: '127.0.0.1', port: 6800, protocol: 'http', path: '/jsonrpc', secret: '' }),
  getActiveRpcConfig: () => ({ isLocal: true, host: '127.0.0.1', port: 6800 })
}))

vi.mock('../../src/shared/localEngine', () => ({
  isLocalEngineAddress: (host: string, port: number, localPort: number) =>
    (host === 'localhost' || host === '127.0.0.1') && Number(port) === Number(localPort)
}))

vi.mock('../utils/logger', () => ({
  createLogger: () => ({
    info: (...args: unknown[]) => { state.logs.info.push(args) },
    warn: (...args: unknown[]) => { state.logs.warn.push(args) },
    error: (...args: unknown[]) => { state.logs.error.push(args) },
    debug: vi.fn()
  })
}))

vi.mock('../utils/mainErrorCopy', () => ({
  mainError: (locale: string, key: string, params?: Record<string, unknown>) =>
    locale + ':' + key + (params ? '|' + JSON.stringify(params) : '')
}))

vi.mock('../utils/mainLocaleRuntime', () => ({ runtimeMainLocale: () => 'zh' }))

vi.mock('../services/engineShutdownService', () => ({
  DEFAULT_ENGINE_SHUTDOWN_MAX_WAIT_MS: 12000,
  waitForPortRelease: async () => state.portReleased,
  EngineShutdownService: class FakeEngineShutdownService {
    constructor(public options: unknown) {}
    async requestShutdownAndWait() { return state.shutdownResult }
  }
}))

vi.mock('../utils/settingsSync', () => ({
  extractImportedEngineSettings: () => state.imported
}))

type Controller = import('./Aria2Controller').Aria2Controller

async function loadController(): Promise<Controller> {
  vi.resetModules()
  const mod = await import('./Aria2Controller')
  return new mod.Aria2Controller({ getMainWindow: () => null } as never)
}

function baseSettings(overrides: Record<string, unknown> = {}) {
  return {
    aria2: { host: 'localhost', port: 6800, secret: '', protocol: 'http', path: '/jsonrpc' },
    connectionProfiles: [] as any[],
    ...overrides
  }
}

beforeEach(() => {
  state.settings = baseSettings()
  state.saved = []
  state.rpcCalls = []
  state.rpcPlan = {}
  state.probeClass = 'free'
  state.portReleased = true
  state.manager = null
  state.managerSeed = {}
  state.managerCalls = []
  state.handlers = new Map()
  state.imported = {}
  state.logs = { info: [], warn: [], error: [] }
})

describe('initialize', () => {
  it('没有密钥且用户从未管理过时自动生成并落盘', async () => {
    const controller = await loadController()
    await controller.initialize()
    const saved = state.saved[0] as any
    expect(saved.aria2.secret).toMatch(/^[0-9a-f]{32}$/)
    expect(saved.aria2.secretAutogenerated).toBe(true)
    expect(state.managerCalls.some(call => call.startsWith('updateConfig:'))).toBe(true)
    expect(state.manager.flushConfig).toHaveBeenCalled()
  })

  it('conf 已有密钥时以 conf 为准并回填 settings', async () => {
    state.settings = baseSettings()
    state.managerSeed = { getConfig: vi.fn(() => ({ port: 6800, secret: 'conf-secret', downloadDir: 'E:/dl' })) }
    const controller = await loadController()
    await controller.initialize()
    const saved = state.saved[0] as any
    expect(saved.aria2.secret).toBe('conf-secret')
    expect(saved.aria2.secretAutogenerated).toBeUndefined()
  })

  it('用户显式清空过密钥时不再自动生成', async () => {
    state.settings = baseSettings({
      aria2: { host: 'localhost', port: 6800, secret: '', protocol: 'http', path: '/jsonrpc', secretAutogenerated: false }
    })
    const controller = await loadController()
    await controller.initialize()
    expect(state.saved).toHaveLength(0)
  })

  it('密钥变化时同步本机连接预设，远程预设不动', async () => {
    state.settings = baseSettings({
      connectionProfiles: [
        { id: 'local', name: '本机', config: { host: '127.0.0.1', port: 6800, secret: 'old', protocol: 'http', path: '/jsonrpc' } },
        { id: 'remote', name: 'NAS', config: { host: '10.0.0.9', port: 6800, secret: 'nas', protocol: 'http', path: '/jsonrpc' } }
      ]
    })
    state.managerSeed = { getConfig: vi.fn(() => ({ port: 6800, secret: 'conf-secret', downloadDir: 'E:/dl' })) }
    const controller = await loadController()
    await controller.initialize()
    const saved = state.saved[0] as any
    expect(saved.connectionProfiles[0].config.secret).toBe('conf-secret')
    expect(saved.connectionProfiles[1].config.secret).toBe('nas')
  })

  it('autoStart 关闭时不启动引擎', async () => {
    state.settings = baseSettings({
      aria2: { host: 'localhost', port: 6800, secret: 's', protocol: 'http', path: '/jsonrpc', autoStart: false }
    })
    const controller = await loadController()
    await controller.initialize()
    expect(state.manager.start).not.toHaveBeenCalled()
  })

  it('引擎启动失败时带上 aria2 stderr', async () => {
    state.settings = baseSettings({
      aria2: { host: 'localhost', port: 6800, secret: 's', protocol: 'http', path: '/jsonrpc' }
    })
    state.managerSeed = {
      start: vi.fn(async () => false),
      getLastStderr: vi.fn(() => 'bind error')
    }
    const controller = await loadController()
    await expect(controller.initialize()).rejects.toThrow(/engine.startFailedWithOutput/)
  })
})

describe('优雅关闭钩子', () => {
  async function hookOf(controller: Controller) {
    await controller.initialize()
    return state.manager.gracefulHook as () => Promise<void>
  }

  it('先保存会话再请求关闭', async () => {
    state.settings = baseSettings({ aria2: { host: 'localhost', port: 6800, secret: 's', protocol: 'http', path: '/jsonrpc' } })
    const controller = await loadController()
    const hook = await hookOf(controller)
    state.rpcCalls = []
    await hook()
    expect(state.rpcCalls.map(call => call.method)).toEqual(['aria2.saveSession', 'aria2.shutdown'])
  })

  it('保存失败但无未完成任务时只记 info', async () => {
    state.settings = baseSettings({ aria2: { host: 'localhost', port: 6800, secret: 's', protocol: 'http', path: '/jsonrpc' } })
    const controller = await loadController()
    const hook = await hookOf(controller)
    state.rpcPlan['aria2.saveSession'] = async () => { throw new Error('Failed to serialize session') }
    state.rpcPlan['aria2.getGlobalStat'] = async () => ({ numActive: '0', numWaiting: '0' })
    await hook()
    const infos = state.logs.info.map(args => String(args[0]))
    expect(infos.some(text => text.includes('无需保存'))).toBe(true)
  })

  it('保存失败且有未完成任务时告警', async () => {
    state.settings = baseSettings({ aria2: { host: 'localhost', port: 6800, secret: 's', protocol: 'http', path: '/jsonrpc' } })
    const controller = await loadController()
    const hook = await hookOf(controller)
    state.rpcPlan['aria2.saveSession'] = async () => { throw new Error('boom') }
    state.rpcPlan['aria2.getGlobalStat'] = async () => ({ numActive: '2', numWaiting: '0' })
    await hook()
    const warns = state.logs.warn.map(args => String(args[0]))
    expect(warns.some(text => text.includes('可能丢失未完成任务'))).toBe(true)
  })

  it('Unauthorized 不重试，直接进入任务数判定', async () => {
    state.settings = baseSettings({ aria2: { host: 'localhost', port: 6800, secret: 's', protocol: 'http', path: '/jsonrpc' } })
    const controller = await loadController()
    const hook = await hookOf(controller)
    state.rpcPlan['aria2.saveSession'] = async () => { throw new Error('Unauthorized') }
    state.rpcPlan['aria2.getGlobalStat'] = async () => ({ numActive: '0', numWaiting: '0' })
    await hook()
    const saves = state.rpcCalls.filter(call => call.method === 'aria2.saveSession')
    expect(saves).toHaveLength(1)
  })

  it('shutdown 请求失败时把错误抛给管理器（由它回退信号关闭）', async () => {
    state.settings = baseSettings({ aria2: { host: 'localhost', port: 6800, secret: 's', protocol: 'http', path: '/jsonrpc' } })
    const controller = await loadController()
    const hook = await hookOf(controller)
    state.rpcPlan['aria2.shutdown'] = async () => { throw new Error('conn reset') }
    await expect(hook()).rejects.toThrow('conn reset')
  })
})

describe('saveSession', () => {
  it('成功返回 success', async () => {
    const controller = await loadController()
    expect(await controller.saveSession(500)).toEqual({ success: true })
  })

  it('瞬时失败重试一次后成功', async () => {
    const controller = await loadController()
    let attempts = 0
    state.rpcPlan['aria2.saveSession'] = async () => {
      attempts++
      if (attempts === 1) throw new Error('transient')
      return {}
    }
    expect(await controller.saveSession(500)).toEqual({ success: true })
    expect(attempts).toBe(2)
  })

  it('两次都失败时如实返回错误', async () => {
    const controller = await loadController()
    state.rpcPlan['aria2.saveSession'] = async () => { throw new Error('always') }
    const result = await controller.saveSession(500)
    expect(result.success).toBe(false)
    expect(result.error).toContain('always')
  })
})

describe('prepareForManagedStart 的端口探测分类', () => {
  it('本应用引擎已在跑时直接返回', async () => {
    const controller = await loadController()
    await controller.initialize()
    state.manager.isRunning = vi.fn(() => true)
    state.rpcCalls = []
    await controller.prepareForManagedStart()
    expect(state.rpcCalls).toHaveLength(0)
  })

  it('端口空闲时不发任何请求', async () => {
    const controller = await loadController()
    await controller.initialize()
    state.rpcCalls = []
    state.probeClass = 'free'
    await controller.prepareForManagedStart()
    expect(state.rpcCalls.map(call => call.method)).toEqual(['aria2.getVersion'])
  })

  it('遗留实例认本机密钥时请求其退出', async () => {
    state.settings = baseSettings({ aria2: { host: 'localhost', port: 6800, secret: 's', protocol: 'http', path: '/jsonrpc', autoStart: false } })
    const controller = await loadController()
    await controller.initialize()
    state.rpcCalls = []
    state.probeClass = 'aria2-with-our-secret'
    await controller.prepareForManagedStart()
    expect(state.rpcCalls.map(call => call.method)).toEqual(['aria2.getVersion', 'aria2.shutdown'])
  })

  it('遗留实例迟迟不退出时升级为 forceShutdown', async () => {
    state.settings = baseSettings({ aria2: { host: 'localhost', port: 6800, secret: 's', protocol: 'http', path: '/jsonrpc', autoStart: false } })
    const controller = await loadController()
    await controller.initialize()
    state.rpcCalls = []
    state.probeClass = 'aria2-with-our-secret'
    state.portReleased = false
    await expect(controller.prepareForManagedStart()).rejects.toThrow(/engine.leftoverNotExited/)
    expect(state.rpcCalls.map(call => call.method)).toEqual([
      'aria2.getVersion',
      'aria2.shutdown',
      'aria2.forceShutdown'
    ])
  })

  it('端口被别的 aria2 占用时给出明确错误', async () => {
    state.settings = baseSettings({ aria2: { host: 'localhost', port: 6800, secret: 's', protocol: 'http', path: '/jsonrpc', autoStart: false } })
    const controller = await loadController()
    await controller.initialize()
    state.probeClass = 'aria2-with-other-secret'
    await expect(controller.prepareForManagedStart()).rejects.toThrow(/engine.portOccupiedOtherAria2/)
  })

  it('端口被非 aria2 服务占用时给出明确错误', async () => {
    state.settings = baseSettings({ aria2: { host: 'localhost', port: 6800, secret: 's', protocol: 'http', path: '/jsonrpc', autoStart: false } })
    const controller = await loadController()
    await controller.initialize()
    state.probeClass = 'non-aria2-service'
    await expect(controller.prepareForManagedStart()).rejects.toThrow(/engine.portNonAria2/)
  })

  it('探测结果不确定时只告警不阻断', async () => {
    state.settings = baseSettings({ aria2: { host: 'localhost', port: 6800, secret: 's', protocol: 'http', path: '/jsonrpc', autoStart: false } })
    const controller = await loadController()
    await controller.initialize()
    state.probeClass = 'unknown'
    await expect(controller.prepareForManagedStart()).resolves.toBeUndefined()
  })
})

describe('关闭与重启', () => {
  it('requestShutdown 只发请求不等退出并关掉兜底强杀', async () => {
    const controller = await loadController()
    await controller.initialize()
    state.rpcCalls = []
    controller.requestShutdown()
    expect(state.rpcCalls.map(call => call.method)).toEqual(['aria2.shutdown'])
  })

  it('requestShutdownAndWait 在管理器缺失时直接成功', async () => {
    const controller = await loadController()
    const result = await controller.requestShutdownAndWait()
    expect(result).toEqual({ success: true, forced: false, timedOut: false, processExited: true, portReleased: true, waitedMs: 0 })
  })

  it('requestShutdownAndWait 委托给 EngineShutdownService', async () => {
    state.settings = baseSettings({ aria2: { host: 'localhost', port: 6800, secret: 's', protocol: 'http', path: '/jsonrpc', autoStart: false } })
    const controller = await loadController()
    await controller.initialize()
    expect(await controller.requestShutdownAndWait(500)).toEqual(state.shutdownResult)
  })

  it('stop 在管理器未运行时直接成功', async () => {
    const controller = await loadController()
    expect(await controller.stop()).toBe(true)
  })

  it('stop 如实返回未能确认退出', async () => {
    state.settings = baseSettings({ aria2: { host: 'localhost', port: 6800, secret: 's', protocol: 'http', path: '/jsonrpc', autoStart: false } })
    const controller = await loadController()
    await controller.initialize()
    state.manager.isRunning = vi.fn(() => true)
    state.manager.stop = vi.fn(async () => false)
    expect(await controller.stop()).toBe(false)
    const warns = state.logs.warn.map(args => String(args[0]))
    expect(warns.some(text => text.includes('退出兜底'))).toBe(true)
  })

  it('restartEngine 在未初始化时先初始化', async () => {
    state.settings = baseSettings({ aria2: { host: 'localhost', port: 6800, secret: 's', protocol: 'http', path: '/jsonrpc', autoStart: false } })
    const controller = await loadController()
    expect(await controller.restartEngine()).toEqual({ success: true })
    expect(state.manager.start).toHaveBeenCalled()
  })

  it('restartEngine 先等待旧进程停止再启动', async () => {
    state.settings = baseSettings({ aria2: { host: 'localhost', port: 6800, secret: 's', protocol: 'http', path: '/jsonrpc', autoStart: false } })
    const controller = await loadController()
    await controller.initialize()
    const order: string[] = []
    state.manager.stop = vi.fn(async () => { order.push('stop'); return true })
    state.manager.start = vi.fn(async () => { order.push('start'); return true })
    await controller.restartEngine()
    expect(order).toEqual(['stop', 'start'])
    expect(state.manager.resetRestartCounter).toHaveBeenCalled()
  })

  it('restartEngine 启动失败时返回 stderr', async () => {
    state.settings = baseSettings({ aria2: { host: 'localhost', port: 6800, secret: 's', protocol: 'http', path: '/jsonrpc', autoStart: false } })
    const controller = await loadController()
    await controller.initialize()
    state.manager.start = vi.fn(async () => false)
    state.manager.getLastStderr = vi.fn(() => 'bad config')
    expect(await controller.restartEngine()).toEqual({ success: false, error: 'bad config' })
  })
})

describe('applyTrackerList', () => {
  it('本机引擎时写配置并尽力下发', async () => {
    state.settings = baseSettings({ aria2: { host: 'localhost', port: 6800, secret: 's', protocol: 'http', path: '/jsonrpc', autoStart: false } })
    const controller = await loadController()
    await controller.initialize()
    const result = controller.applyTrackerList('udp://a:1')
    expect(result).toEqual({ success: true })
    expect(state.managerCalls.some(call => call.includes('bt-tracker'))).toBe(true)
    expect(state.rpcCalls.map(call => call.method)).toContain('aria2.changeGlobalOption')
  })

  it('引擎未初始化时返回错误', async () => {
    const controller = await loadController()
    expect(controller.applyTrackerList('udp://a:1')).toEqual({
      success: false,
      error: 'zh:engine.managerUninitialized'
    })
  })
})

describe('IPC 通道', () => {
  async function handlersOf() {
    const controller = await loadController()
    await controller.initialize()
    controller.registerIpcHandlers()
    state.saved = []
    return state.handlers
  }

  it('注册 8 个引擎通道', async () => {
    const handlers = await handlersOf()
    expect([...handlers.keys()].sort()).toEqual([
      'aria2-restart',
      'aria2-save-global-options',
      'aria2-save-session',
      'aria2-start',
      'aria2-status',
      'aria2-stop',
      'aria2-update-config'
    ])
  })

  it('aria2-save-global-options 拒绝非法端口', async () => {
    const handlers = await handlersOf()
    const result = await handlers.get('aria2-save-global-options')!({}, { 'rpc-listen-port': '80' })
    expect(result).toMatchObject({ success: false, code: 'invalid_port' })
    const tooBig = await handlers.get('aria2-save-global-options')!({}, { 'rpc-listen-port': 70000 })
    expect(tooBig).toMatchObject({ success: false, code: 'invalid_port' })
  })

  it('aria2-save-global-options 把启动项同步进管理器与 settings', async () => {
    const handlers = await handlersOf()
    const result = await handlers.get('aria2-save-global-options')!({}, {
      'rpc-listen-port': '7100',
      'enable-rpc': 'true',
      'max-overall-download-limit': '1048576'
    })
    expect(result).toEqual({ success: true })
    expect(state.manager.updateConfig).toHaveBeenCalledWith({ port: 7100, enableRpc: true })
    expect((state.saved[0] as any).aria2.port).toBe(7100)
  })

  it('aria2-update-config 拒绝相对路径的下载目录', async () => {
    const handlers = await handlersOf()
    const result = await handlers.get('aria2-update-config')!({}, { port: 6800, downloadDir: 'relative/dir' })
    expect(result).toMatchObject({ success: false, code: 'invalid_download_dir' })
  })

  it('aria2-update-config 未声明 clearSecret 时保留原密钥', async () => {
    state.settings = baseSettings({ aria2: { host: 'localhost', port: 6800, secret: 'keep-me', protocol: 'http', path: '/jsonrpc', autoStart: false } })
    const handlers = await handlersOf()
    // 必须用真实可写目录：处理器会真的 mkdir/access 一次（E:/dl 这类盘符在 CI 上不存在）
    await handlers.get('aria2-update-config')!({}, { port: 6800, secret: '', downloadDir: os.tmpdir() })
    expect((state.saved[0] as any).aria2.secret).toBe('keep-me')
    expect((state.saved[0] as any).aria2.secretAutogenerated).toBeUndefined()
  })

  it('aria2-update-config 显式 clearSecret 时清空并关闭自动生成', async () => {
    state.settings = baseSettings({ aria2: { host: 'localhost', port: 6800, secret: 'keep-me', protocol: 'http', path: '/jsonrpc', autoStart: false } })
    const handlers = await handlersOf()
    await handlers.get('aria2-update-config')!({}, { port: 6800, secret: '', clearSecret: true, downloadDir: os.tmpdir() })
    expect((state.saved[0] as any).aria2.secret).toBe('')
    expect((state.saved[0] as any).aria2.secretAutogenerated).toBe(false)
  })

  it('aria2-status 在未初始化时返回错误态', async () => {
    const controller = await loadController()
    controller.registerIpcHandlers()
    const result = await state.handlers.get('aria2-status')!({})
    expect(result).toEqual({ isRunning: false, error: 'Not initialized' })
  })
})

describe('导入设置落到引擎', () => {
  it('引擎未初始化时只返回不需要重启', async () => {
    state.imported = { port: 7100 }
    const controller = await loadController()
    expect(await controller.applyImportedSettings({} as never)).toEqual({ requiresRestart: false, changed: [] })
  })

  it('导入值未变化时什么都不做', async () => {
    const controller = await loadController()
    await controller.initialize()
    state.imported = { port: 6800, secret: '' }
    state.manager.getConfig = vi.fn(() => ({ port: 6800, secret: '', downloadDir: 'E:/dl' }))
    expect(await controller.applyImportedSettings({} as never)).toEqual({ requiresRestart: false, changed: [] })
  })

  it('引擎未运行时不要求重启', async () => {
    const controller = await loadController()
    await controller.initialize()
    state.imported = { port: 7100 }
    state.manager.isRunning = vi.fn(() => false)
    const result = await controller.applyImportedSettings({} as never)
    expect(result).toEqual({ requiresRestart: false, changed: ['port'] })
    expect(controller.consumeEngineRestartNotice()).toBe(false)
  })

  it('引擎运行中且端口变化时要求重启并标记待投递', async () => {
    const controller = await loadController()
    await controller.initialize()
    state.imported = { port: 7100 }
    state.manager.isRunning = vi.fn(() => true)
    const result = await controller.applyImportedSettings({} as never)
    expect(result).toEqual({ requiresRestart: true, changed: ['port'] })
    expect(controller.consumeEngineRestartNotice()).toBe(true)
    expect(controller.consumeEngineRestartNotice()).toBe(false)
  })

  it('写配置失败时要求重启以便用户手动处理', async () => {
    const controller = await loadController()
    await controller.initialize()
    state.imported = { port: 7100 }
    state.manager.updateConfig = vi.fn(() => { throw new Error('disk full') })
    expect(await controller.applyImportedSettings({} as never)).toEqual({ requiresRestart: true, changed: ['port'] })
  })
})
