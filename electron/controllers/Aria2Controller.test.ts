import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
    options: new Map<string, Record<string, any>>(),
    shutdownOptions: null as any,
    shutdownResult: { success: true, forced: false, timedOut: false, processExited: true, portReleased: true, waitedMs: 5 },
    imported: {} as Record<string, unknown>,
    activeIsLocal: true,
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
  registerSecureHandler: (channel: string, handler: (event: unknown, ...args: any[]) => unknown, options?: Record<string, any>) => {
    state.handlers.set(channel, handler)
    if (options) state.options.set(channel, options)
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
  getActiveRpcConfig: () => ({ isLocal: state.activeIsLocal, host: '127.0.0.1', port: 6800 })
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
    constructor(public options: unknown) {
      state.shutdownOptions = options
    }
    async requestShutdownAndWait() { return state.shutdownResult }
  }
}))

vi.mock('../utils/settingsSync', () => ({
  extractImportedEngineSettings: () => state.imported
}))

type Controller = import('./Aria2Controller').Aria2Controller

/**
 * 控制器构造函数会在 process 上挂退出兜底监听。每个用例都新建一个实例，
 * 不回收就会攒到 10 个以上触发 MaxListenersExceededWarning（噪音，不是产品问题：
 * 生产环境只实例化一次）。这里把挂上去的监听器记下来，用例结束后摘掉。
 */
const exitListeners: Array<(...args: unknown[]) => void> = []

async function loadController(): Promise<Controller> {
  vi.resetModules()
  const mod = await import('./Aria2Controller')
  const spy = vi.spyOn(process, 'on')
  const controller = new mod.Aria2Controller({ getMainWindow: () => null } as never)
  for (const call of spy.mock.calls) {
    if (call[0] === 'exit') exitListeners.push(call[1] as (...args: unknown[]) => void)
  }
  spy.mockRestore()
  return controller
}

afterEach(() => {
  for (const listener of exitListeners.splice(0)) process.removeListener('exit', listener)
})

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
  state.options = new Map()
  state.shutdownOptions = null
  state.imported = {}
  state.activeIsLocal = true
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

/** 初始化完成的控制器：引擎不自动启动，日志与落盘记录清零，便于断言单次调用 */
async function readyController(overrides: Record<string, unknown> = {}, seed: Record<string, unknown> = {}) {
  state.settings = baseSettings({
    aria2: { host: 'localhost', port: 6800, secret: 's', protocol: 'http', path: '/jsonrpc', autoStart: false },
    ...overrides
  })
  state.managerSeed = {
    getConfig: vi.fn(() => ({ port: 6800, secret: 's', downloadDir: 'E:/dl' })),
    ...seed
  }
  const controller = await loadController()
  await controller.initialize()
  state.saved = []
  state.rpcCalls = []
  state.logs = { info: [], warn: [], error: [] }
  return controller
}

async function channelsOf(controller: Controller) {
  controller.registerIpcHandlers()
  return state.handlers
}

function logText(level: 'info' | 'warn' | 'error'): string {
  return state.logs[level].map(args => args.map(String).join(' ')).join('\n')
}

describe('退出兜底与进程信息', () => {
  it('未请求优雅关闭时退出兜底强杀引擎', async () => {
    await readyController()
    const listener = exitListeners[exitListeners.length - 1]
    expect(listener).toBeTypeOf('function')
    listener()
    expect(state.manager.killIfRunning).toHaveBeenCalled()
  })

  it('已请求 aria2 优雅关闭后退出兜底不再强杀', async () => {
    const controller = await readyController()
    controller.requestShutdown()
    await new Promise(resolve => setTimeout(resolve, 0))
    exitListeners[exitListeners.length - 1]()
    expect(state.manager.killIfRunning).not.toHaveBeenCalled()
  })

  it('未初始化时 getProcessInfo 报未运行', async () => {
    const controller = await loadController()
    expect(controller.getProcessInfo()).toEqual({ isRunning: false })
    expect(controller.getManager()).toBeNull()
  })

  it('初始化后 getProcessInfo 转发管理器的进程信息', async () => {
    const controller = await readyController()
    expect(controller.getManager()).toBe(state.manager)
    expect(controller.getProcessInfo()).toEqual({ isRunning: true, pid: 4242 })
  })

  it('引擎事件监听器在管理器创建前暂存，创建时挂上', async () => {
    const controller = await loadController()
    const started = vi.fn()
    const crash = vi.fn()
    const gaveUp = vi.fn()
    controller.setEngineStartedListener(started)
    controller.setEngineCrashListener(crash)
    controller.setEngineGaveUpListener(gaveUp)
    await controller.initialize()
    expect(state.manager.setEngineStartedListener).toHaveBeenCalledWith(started)
    expect(state.manager.setEngineCrashListener).toHaveBeenCalledWith(crash)
    expect(state.manager.setEngineGaveUpListener).toHaveBeenCalledWith(gaveUp)
  })

  it('管理器已存在时设置监听器立即转发', async () => {
    const controller = await readyController()
    const started = vi.fn()
    controller.setEngineStartedListener(started)
    controller.setEngineCrashListener(null)
    controller.setEngineGaveUpListener(null)
    expect(state.manager.setEngineStartedListener).toHaveBeenLastCalledWith(started)
    expect(state.manager.setEngineCrashListener).toHaveBeenLastCalledWith(null)
    expect(state.manager.setEngineGaveUpListener).toHaveBeenLastCalledWith(null)
  })
})

describe('applyTrackerList 的远程与异常分支', () => {
  it('远程引擎时只下发运行时选项，不改写本机配置', async () => {
    const controller = await readyController()
    state.activeIsLocal = false
    expect(controller.applyTrackerList('udp://a:1')).toEqual({ success: true })
    expect(state.manager.saveGlobalOptionsToConfig).not.toHaveBeenCalled()
    expect(state.rpcCalls.map(call => call.method)).toEqual(['aria2.changeGlobalOption'])
  })

  it('远程下发失败只告警不影响成功返回', async () => {
    const controller = await readyController()
    state.activeIsLocal = false
    state.rpcPlan['aria2.changeGlobalOption'] = async () => { throw new Error('conn refused') }
    expect(controller.applyTrackerList('udp://a:1')).toEqual({ success: true })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(logText('warn')).toContain('远程 Tracker 下发失败')
  })

  it('写配置抛错时把原因带回调用方', async () => {
    const controller = await readyController()
    state.manager.saveGlobalOptionsToConfig = vi.fn(() => { throw new Error('disk full') })
    expect(controller.applyTrackerList('udp://a:1')).toEqual({ success: false, error: 'disk full' })
  })
})

describe('restartEngine 的异常与提前返回', () => {
  it('引擎已在运行时直接成功且不再启停', async () => {
    const controller = await readyController()
    state.manager.isRunning = vi.fn(() => true)
    expect(await controller.restartEngine()).toEqual({ success: true })
    expect(state.manager.stop).not.toHaveBeenCalled()
    expect(state.manager.start).not.toHaveBeenCalled()
  })

  it('初始化后仍拿不到管理器时返回错误', async () => {
    const controller = await loadController()
    ;(controller as unknown as { aria2Manager: unknown }).aria2Manager = null
    controller.initialize = async () => {}
    expect(await controller.restartEngine()).toEqual({ success: false, error: 'zh:engine.managerUninitialized' })
    expect(logText('error')).toContain('重启引擎失败')
  })

  it('停止旧进程失败时继续尝试启动', async () => {
    const controller = await readyController()
    state.manager.stop = vi.fn(async () => { throw new Error('stop timeout') })
    expect(await controller.restartEngine()).toEqual({ success: true })
    expect(state.manager.start).toHaveBeenCalled()
    expect(logText('warn')).toContain('等待旧进程停止失败')
  })

  it('启动抛异常时返回异常信息', async () => {
    const controller = await readyController()
    state.manager.start = vi.fn(async () => { throw new Error('spawn EACCES') })
    expect(await controller.restartEngine()).toEqual({ success: false, error: 'spawn EACCES' })
    expect(logText('error')).toContain('重启引擎异常')
  })

  it('启动返回 false 且没有 stderr 时回落到通用文案', async () => {
    const controller = await readyController()
    state.manager.start = vi.fn(async () => false)
    state.manager.getLastStderr = vi.fn(() => '')
    expect(await controller.restartEngine()).toEqual({ success: false, error: 'zh:engine.startFailed' })
  })
})

describe('IPC 通道：引擎启停与会话', () => {
  it('aria2-start 未初始化时先初始化再启动', async () => {
    state.settings = baseSettings({
      aria2: { host: 'localhost', port: 6800, secret: 's', protocol: 'http', path: '/jsonrpc', autoStart: false }
    })
    state.managerSeed = { getConfig: vi.fn(() => ({ port: 6800, secret: 's', downloadDir: 'E:/dl' })) }
    const controller = await loadController()
    const handlers = await channelsOf(controller)
    const result = await handlers.get('aria2-start')!({})
    expect(result).toEqual({ success: true, error: undefined })
    expect(state.manager.resetRestartCounter).toHaveBeenCalled()
    expect(state.manager.start).toHaveBeenCalledTimes(1)
  })

  it('aria2-start 准备阶段失败时把原因带回渲染层', async () => {
    const controller = await readyController()
    state.probeClass = 'aria2-with-other-secret'
    const handlers = await channelsOf(controller)
    const result = (await handlers.get('aria2-start')!({})) as { success: boolean; error: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('engine.portOccupiedOtherAria2')
    expect(state.manager.start).not.toHaveBeenCalled()
  })

  it('aria2-start 启动失败时附带 aria2 stderr', async () => {
    const controller = await readyController()
    state.manager.start = vi.fn(async () => false)
    state.manager.getLastStderr = vi.fn(() => 'bind error')
    const handlers = await channelsOf(controller)
    expect(await handlers.get('aria2-start')!({})).toEqual({ success: false, error: 'bind error' })
  })

  it('aria2-stop 未初始化时直接成功', async () => {
    const controller = await loadController()
    const handlers = await channelsOf(controller)
    expect(await handlers.get('aria2-stop')!({})).toEqual({ success: true })
  })

  it('aria2-stop 未能确认退出时返回端口未释放错误', async () => {
    const controller = await readyController()
    state.manager.isRunning = vi.fn(() => true)
    state.manager.stop = vi.fn(async () => false)
    const handlers = await channelsOf(controller)
    expect(await handlers.get('aria2-stop')!({})).toEqual({ success: false, error: 'zh:engine.portNotReleased' })
  })

  it('aria2-restart 未初始化时先初始化再重启', async () => {
    state.settings = baseSettings({
      aria2: { host: 'localhost', port: 6800, secret: 's', protocol: 'http', path: '/jsonrpc', autoStart: false }
    })
    state.managerSeed = { getConfig: vi.fn(() => ({ port: 6800, secret: 's', downloadDir: 'E:/dl' })) }
    const controller = await loadController()
    const handlers = await channelsOf(controller)
    expect(await handlers.get('aria2-restart')!({})).toEqual({ success: true })
    expect(state.manager.restart).toHaveBeenCalled()
  })

  it('aria2-save-session 转发到 saveSession', async () => {
    const controller = await readyController()
    const handlers = await channelsOf(controller)
    expect(await handlers.get('aria2-save-session')!({})).toEqual({ success: true })
    expect(state.rpcCalls.map(call => call.method)).toContain('aria2.saveSession')
  })

  it('aria2-status 已初始化时直接回报管理器状态', async () => {
    const controller = await readyController()
    const handlers = await channelsOf(controller)
    expect(await handlers.get('aria2-status')!({})).toMatchObject({ isRunning: true, pid: 4242 })
  })

  it('aria2-save-global-options 未初始化时返回管理器未就绪', async () => {
    const controller = await loadController()
    const handlers = await channelsOf(controller)
    expect(await handlers.get('aria2-save-global-options')!({}, {})).toEqual({
      success: false,
      error: 'zh:engine.managerUninitialized'
    })
  })

  it('aria2-save-global-options 把端口密钥与开关同步到 settings 和本机预设', async () => {
    const controller = await readyController({
      connectionProfiles: [
        { id: 'local', name: '本机', config: { host: '127.0.0.1', port: 6800, secret: 's', protocol: 'http', path: '/jsonrpc' } },
        { id: 'remote', name: 'NAS', config: { host: '10.0.0.9', port: 6800, secret: 'nas', protocol: 'http', path: '/jsonrpc' } }
      ]
    })
    const handlers = await channelsOf(controller)
    const result = await handlers.get('aria2-save-global-options')!({}, {
      'rpc-listen-port': '7100',
      'rpc-secret': 'next-secret',
      'enable-rpc': 'true',
      'rpc-allow-origin-all': 'false',
      'rpc-listen-all': 'true',
      'rpc-secure': 1
    })
    expect(result).toEqual({ success: true })
    expect(state.manager.updateConfig).toHaveBeenCalledWith({
      port: 7100,
      secret: 'next-secret',
      enableRpc: true,
      rpcAllowOriginAll: false,
      rpcListenAll: true,
      rpcSecure: true
    })
    const saved = state.saved[0] as any
    expect(saved.aria2).toMatchObject({
      port: 7100,
      secret: 'next-secret',
      rpcAllowOriginAll: false,
      rpcListenAll: true,
      rpcSecure: true,
      secretAutogenerated: false
    })
    expect(saved.connectionProfiles[0].config).toMatchObject({ port: 7100, secret: 'next-secret' })
    expect(saved.connectionProfiles[1].config).toMatchObject({ port: 6800, secret: 'nas' })
  })

  it('aria2-save-global-options 写配置失败时如实返回错误', async () => {
    const controller = await readyController()
    state.manager.updateConfig = vi.fn(() => { throw new Error('disk full') })
    const handlers = await channelsOf(controller)
    const result = (await handlers.get('aria2-save-global-options')!({}, { 'rpc-listen-port': '7100' })) as {
      success: boolean
      error: string
    }
    expect(result.success).toBe(false)
    expect(result.error).toContain('disk full')
  })
})

describe('aria2-update-config 的校验与落盘', () => {
  it('未初始化时先初始化再写配置', async () => {
    state.settings = baseSettings({
      aria2: { host: 'localhost', port: 6800, secret: 's', protocol: 'http', path: '/jsonrpc', autoStart: false }
    })
    state.managerSeed = { getConfig: vi.fn(() => ({ port: 6800, secret: 's', downloadDir: 'E:/dl' })) }
    const controller = await loadController()
    const handlers = await channelsOf(controller)
    const result = await handlers.get('aria2-update-config')!({}, { port: 6900, downloadDir: os.tmpdir() })
    expect(result).toEqual({ success: true })
    expect(state.manager.updateConfig).toHaveBeenCalledWith(expect.objectContaining({ port: 6900 }))
  })

  it('端口非法时返回稳定错误码', async () => {
    const controller = await readyController()
    const handlers = await channelsOf(controller)
    expect(await handlers.get('aria2-update-config')!({}, { port: 80 })).toMatchObject({
      success: false,
      code: 'invalid_port'
    })
  })

  it('下载目录无法创建时返回目录错误码', async () => {
    const controller = await readyController()
    const blocked = path.join(os.tmpdir(), 'aria2-ctl-blocked-' + process.pid + '-' + Date.now())
    fs.writeFileSync(blocked, 'not a directory')
    try {
      const handlers = await channelsOf(controller)
      const result = await handlers.get('aria2-update-config')!({}, {
        port: 6800,
        downloadDir: path.join(blocked, 'sub')
      })
      expect(result).toMatchObject({ success: false, code: 'invalid_download_dir' })
      expect(state.manager.updateConfig).not.toHaveBeenCalled()
    } finally {
      fs.rmSync(blocked, { force: true })
    }
  })

  it('下载目录不存在时创建后继续保存', async () => {
    const controller = await readyController()
    const fresh = path.join(os.tmpdir(), 'aria2-ctl-mk-' + process.pid + '-' + Date.now())
    try {
      const handlers = await channelsOf(controller)
      const result = await handlers.get('aria2-update-config')!({}, { port: 6800, downloadDir: fresh })
      expect(result).toEqual({ success: true })
      expect(fs.existsSync(fresh)).toBe(true)
      expect(logText('info')).toContain('已创建下载目录')
    } finally {
      fs.rmSync(fresh, { recursive: true, force: true })
    }
  })

  it('写配置抛错时返回 config_write_failed', async () => {
    const controller = await readyController()
    state.manager.updateConfig = vi.fn(() => { throw new Error('disk full') })
    const handlers = await channelsOf(controller)
    const result = (await handlers.get('aria2-update-config')!({}, { port: 6800, downloadDir: os.tmpdir() })) as {
      success: boolean
      code: string
      error: string
    }
    expect(result).toMatchObject({ success: false, code: 'config_write_failed' })
    expect(result.error).toContain('disk full')
    expect(logText('error')).toContain('写入 aria2 配置失败')
  })

  it('密钥变化时关闭自动生成并落盘', async () => {
    const controller = await readyController({
      aria2: {
        host: 'localhost',
        port: 6800,
        secret: 'keep-me',
        protocol: 'http',
        path: '/jsonrpc',
        autoStart: false,
        secretAutogenerated: true
      }
    })
    const handlers = await channelsOf(controller)
    const result = await handlers.get('aria2-update-config')!({}, {
      port: 6800,
      secret: 'fresh-secret',
      downloadDir: os.tmpdir()
    })
    expect(result).toEqual({ success: true })
    const saved = state.saved[0] as any
    expect(saved.aria2.secret).toBe('fresh-secret')
    expect(saved.aria2.secretAutogenerated).toBe(false)
  })

  it('密钥未变时保留原有的自动生成标记', async () => {
    const controller = await readyController({
      aria2: {
        host: 'localhost',
        port: 6800,
        secret: 'keep-me',
        protocol: 'http',
        path: '/jsonrpc',
        autoStart: false,
        secretAutogenerated: true
      }
    })
    const handlers = await channelsOf(controller)
    await handlers.get('aria2-update-config')!({}, { port: 6800, secret: 'keep-me', downloadDir: os.tmpdir() })
    const saved = state.saved[0] as any
    expect(saved.aria2.secret).toBe('keep-me')
    expect(saved.aria2.secretAutogenerated).toBe(true)
  })

  it('主动清空密钥时给出跨源风险告警', async () => {
    const controller = await readyController({
      aria2: { host: 'localhost', port: 6800, secret: 'keep-me', protocol: 'http', path: '/jsonrpc', autoStart: false }
    })
    const handlers = await channelsOf(controller)
    await handlers.get('aria2-update-config')!({}, {
      port: 6800,
      secret: '',
      clearSecret: true,
      downloadDir: os.tmpdir()
    })
    expect((state.saved[0] as any).aria2.secret).toBe('')
    expect(logText('warn')).toContain('RPC secret 为空')
  })
})

describe('会话保存的任务数判定', () => {
  it('查询任务数失败时按有任务处理（保守告警）', async () => {
    await readyController()
    const hook = state.manager.gracefulHook as () => Promise<void>
    state.rpcPlan['aria2.saveSession'] = async () => { throw new Error('serialize failed') }
    state.rpcPlan['aria2.getGlobalStat'] = async () => { throw new Error('rpc down') }
    await hook()
    expect(logText('warn')).toContain('可能丢失未完成任务')
  })

  it('统计缺字段时按有任务处理', async () => {
    await readyController()
    const hook = state.manager.gracefulHook as () => Promise<void>
    state.rpcPlan['aria2.saveSession'] = async () => { throw new Error('serialize failed') }
    state.rpcPlan['aria2.getGlobalStat'] = async () => ({})
    await hook()
    expect(logText('warn')).toContain('可能丢失未完成任务')
  })

  it('保存成功时记录耗时', async () => {
    await readyController()
    const hook = state.manager.gracefulHook as () => Promise<void>
    await hook()
    expect(logText('info')).toContain('已保存 aria2 会话')
  })
})

describe('遗留引擎接管与关闭请求的异常分支', () => {
  it('探测请求抛错时交给分类器判断', async () => {
    const controller = await readyController()
    state.rpcPlan['aria2.getVersion'] = async () => { throw new Error('ECONNREFUSED') }
    state.probeClass = 'free'
    await expect(controller.prepareForManagedStart()).resolves.toBeUndefined()
    expect(state.rpcCalls.map(call => call.method)).toEqual(['aria2.getVersion'])
  })

  it('遗留引擎 shutdown 失败时仍等待端口释放', async () => {
    const controller = await readyController()
    state.probeClass = 'aria2-with-our-secret'
    state.rpcPlan['aria2.shutdown'] = async () => { throw new Error('conn reset') }
    state.portReleased = true
    await expect(controller.prepareForManagedStart()).resolves.toBeUndefined()
    expect(logText('warn')).toContain('遗留引擎 shutdown 请求失败')
    expect(logText('info')).toContain('已结束遗留 aria2 实例')
  })

  it('forceShutdown 也失败时抛出端口未释放错误', async () => {
    const controller = await readyController()
    state.probeClass = 'aria2-with-our-secret'
    state.rpcPlan['aria2.shutdown'] = async () => { throw new Error('conn reset') }
    state.rpcPlan['aria2.forceShutdown'] = async () => { throw new Error('still reset') }
    state.portReleased = false
    await expect(controller.prepareForManagedStart()).rejects.toThrow(/engine.leftoverNotExited/)
    expect(logText('warn')).toContain('遗留引擎 forceShutdown 请求失败')
  })

  it('requestShutdown 的关闭请求失败时告警', async () => {
    const controller = await readyController()
    state.rpcPlan['aria2.shutdown'] = async () => { throw new Error('conn reset') }
    controller.requestShutdown()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(logText('warn')).toContain('请求 aria2 关闭失败')
  })
})

describe('导入设置后的连接预设同步', () => {
  it('本机预设跟随新的端口与密钥', async () => {
    const controller = await readyController({
      connectionProfiles: [
        { id: 'local', name: '本机', config: { host: '127.0.0.1', port: 6800, secret: 'old', protocol: 'http', path: '/jsonrpc' } },
        { id: 'remote', name: 'NAS', config: { host: '10.0.0.9', port: 6800, secret: 'nas', protocol: 'http', path: '/jsonrpc' } }
      ]
    })
    state.manager.isRunning = vi.fn(() => true)
    state.imported = { port: 7100, secret: 'next' }
    const result = await controller.applyImportedSettings({ aria2: { port: 7100, secret: 'next' } } as never)
    expect(result).toEqual({ requiresRestart: true, changed: ['port', 'secret'] })
    const saved = state.saved[0] as any
    expect(saved.connectionProfiles[0].config).toMatchObject({ port: 7100, secret: 'next' })
    expect(saved.connectionProfiles[1].config).toMatchObject({ port: 6800, secret: 'nas' })
    expect(logText('info')).toContain('已同步本机连接预设')
  })

  it('没有连接预设时不写盘', async () => {
    const controller = await readyController()
    state.manager.isRunning = vi.fn(() => true)
    state.imported = { port: 7100 }
    expect(await controller.applyImportedSettings({} as never)).toEqual({
      requiresRestart: true,
      changed: ['port']
    })
    expect(state.saved).toHaveLength(0)
  })

  it('只有远程预设时不写盘', async () => {
    const controller = await readyController({
      connectionProfiles: [
        { id: 'remote', name: 'NAS', config: { host: '10.0.0.9', port: 6800, secret: 'nas', protocol: 'http', path: '/jsonrpc' } }
      ]
    })
    state.manager.isRunning = vi.fn(() => true)
    state.imported = { port: 7100 }
    await controller.applyImportedSettings({} as never)
    expect(state.saved).toHaveLength(0)
  })

  it('导入值没有任何变化时不落盘', async () => {
    const controller = await readyController()
    state.imported = {}
    expect(await controller.applyImportedSettings({} as never)).toEqual({ requiresRestart: false, changed: [] })
  })

  it('多个开关字段一起变化时逐个记录', async () => {
    const controller = await readyController()
    state.manager.getConfig = vi.fn(() => ({
      port: 6800,
      secret: '',
      downloadDir: 'E:/dl',
      enableRpc: true,
      rpcSecure: false
    }))
    state.imported = { downloadDir: 'E:/new', enableRpc: false, rpcSecure: true }
    const result = await controller.applyImportedSettings({} as never)
    expect(result).toEqual({ requiresRestart: false, changed: ['downloadDir', 'enableRpc', 'rpcSecure'] })
    expect(state.manager.updateConfig).toHaveBeenCalledWith({
      downloadDir: 'E:/new',
      enableRpc: false,
      rpcSecure: true
    })
  })
})

describe('initialize 的连接预设边界', () => {
  it('缺 config 的预设原样保留', async () => {
    state.settings = baseSettings({ connectionProfiles: [{ id: 'broken', name: '无配置' }] })
    state.managerSeed = { getConfig: vi.fn(() => ({ port: 6800, secret: 'conf-secret', downloadDir: 'E:/dl' })) }
    const controller = await loadController()
    await controller.initialize()
    expect((state.saved[0] as any).connectionProfiles[0]).toEqual({ id: 'broken', name: '无配置' })
  })

  it('窗口取值器延迟到事件触发时才取主窗口', async () => {
    const controller = await readyController()
    const handlers = await channelsOf(controller)
    expect(handlers.has('aria2-status')).toBe(true)
    const options = state.options.get('aria2-status')
    expect(typeof options?.getMainWindow).toBe('function')
    expect(options?.getMainWindow()).toBeNull()
    expect(state.options.get('aria2-start')?.getMainWindow()).toBeNull()
  })

  it('关闭请求把管理器与端口交给关闭服务', async () => {
    const controller = await readyController()
    await controller.requestShutdownAndWait(500)
    const options = state.shutdownOptions as { getProcessManager: () => unknown; getPort: () => number }
    expect(options.getProcessManager()).toBe(state.manager)
    expect(options.getPort()).toBe(6800)
  })

  it('密钥已一致的预设不重复替换', async () => {
    state.settings = baseSettings({
      connectionProfiles: [
        { id: 'local', name: '本机', config: { host: '127.0.0.1', port: 6800, secret: 'conf-secret', protocol: 'http', path: '/jsonrpc' } }
      ]
    })
    state.managerSeed = { getConfig: vi.fn(() => ({ port: 6800, secret: 'conf-secret', downloadDir: 'E:/dl' })) }
    const controller = await loadController()
    await controller.initialize()
    expect((state.saved[0] as any).connectionProfiles[0].config.secret).toBe('conf-secret')
  })
})

