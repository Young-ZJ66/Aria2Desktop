import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

/**
 * 连接切换竞态的单测。
 *
 * 要覆盖的真实故障（用户反馈）：先点一个连不上的实例、在它还没超时前再点另一个
 * 能连上的实例，界面会同时弹出「连接成功」和「连接失败」，「当前连接」还显示成
 * 后点的那个实例，但实际两个都没连上。
 *
 * 这里把 Aria2Service 换成可手动 resolve/reject 的假实现，就能精确控制
 * 「谁先返回、谁后返回」，从而验证 token 机制：只有最新一次尝试可以改状态，
 * 旧尝试必须安静返回 false。
 */

const mocks = vi.hoisted(() => {
  interface Deferred<T> {
    promise: Promise<T>
    resolve: (value: T) => void
    reject: (reason: unknown) => void
  }

  function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void
    let reject!: (reason: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }

  class FakeAria2Service {
    static instances: FakeAria2Service[] = []

    readonly config: unknown
    readonly connectGate = deferred<void>()
    readonly versionGate = deferred<{ version: string }>()
    disconnectCalls = 0
    private readonly handlers = new Map<string, Array<(payload?: unknown) => void>>()

    constructor(config: unknown) {
      this.config = config
      FakeAria2Service.instances.push(this)
    }

    on(event: string, handler: (payload?: unknown) => void): void {
      const list = this.handlers.get(event) ?? []
      list.push(handler)
      this.handlers.set(event, list)
    }

    disconnect(): void {
      this.disconnectCalls++
    }

    connect(): Promise<void> {
      return this.connectGate.promise
    }

    getVersion(): Promise<{ version: string }> {
      return this.versionGate.promise
    }

    emit(event: string, payload?: unknown): void {
      for (const handler of this.handlers.get(event) ?? []) handler(payload)
    }
  }

  return {
    FakeAria2Service,
    settings: {
      aria2: { host: 'localhost', port: 6800, protocol: 'http', secret: '', path: '/jsonrpc' },
      connectionProfiles: [
        {
          id: 'default',
          name: '本地引擎',
          config: { host: 'localhost', port: 6800, protocol: 'http', secret: '', path: '/jsonrpc' }
        },
        {
          id: 'backup',
          name: '备用实例',
          config: { host: 'localhost', port: 6812, protocol: 'http', secret: '', path: '/jsonrpc' }
        }
      ],
      activeProfileId: 'default'
    },
    updateSettings: vi.fn(async () => {}),
    clearTasks: vi.fn(),
    clearCache: vi.fn(),
    loadGlobalOptions: vi.fn(async () => {})
  }
})

vi.mock('@/services/aria2Service', () => ({
  Aria2Service: mocks.FakeAria2Service
}))

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: mocks.settings,
    updateSettings: mocks.updateSettings
  })
}))

vi.mock('@/stores/taskStore', () => ({
  useTaskStore: () => ({ clearTasks: mocks.clearTasks })
}))

vi.mock('@/stores/statsStore', () => ({
  useStatsStore: () => ({
    clearCache: mocks.clearCache,
    loadGlobalOptions: mocks.loadGlobalOptions
  })
}))

/** 让挂起的 Promise 链推进到下一个 await 之后 */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function createStore() {
  const { useConnectionStore } = await import('./connectionStore')
  setActivePinia(createPinia())
  const store = useConnectionStore()
  store.loadProfiles()
  return store
}

describe('connectionStore 连接切换竞态', () => {
  beforeEach(() => {
    mocks.FakeAria2Service.instances.length = 0
    mocks.updateSettings.mockClear()
    mocks.clearTasks.mockClear()
  })

  it('后发起的连接成功时，先前的尝试作废且不改动当前预设', async () => {
    const store = await createStore()

    const first = store.connect(undefined, 'default')
    const second = store.connect(undefined, 'backup')
    const firstService = mocks.FakeAria2Service.instances[0]!
    const secondService = mocks.FakeAria2Service.instances[1]!

    // 第二次（备用实例）先连上
    secondService.connectGate.resolve()
    await flush()
    secondService.versionGate.resolve({ version: '1.37.0' })
    await expect(second).resolves.toBe(true)

    expect(store.isConnected).toBe(true)
    expect(store.activeProfileId).toBe('backup')

    // 第一次（本地引擎）随后才返回：必须安静作废，不能把状态改回去
    firstService.connectGate.resolve()
    await flush()
    firstService.versionGate.resolve({ version: '1.37.0' })
    await expect(first).resolves.toBe(false)

    expect(store.activeProfileId).toBe('backup')
    expect(store.isConnected).toBe(true)
    expect(store.connectionError).toBeNull()
  })

  it('连接失败时不把当前预设切到连不上的实例', async () => {
    const store = await createStore()

    const pending = store.connect(undefined, 'backup')
    const service = mocks.FakeAria2Service.instances[0]!

    service.connectGate.resolve()
    await flush()
    service.versionGate.reject(new Error('Connection refused'))

    await expect(pending).rejects.toThrow('Connection refused')

    // 失败只影响连接状态，不改变「当前连接」指向哪个预设
    expect(store.activeProfileId).toBe('default')
    expect(store.isConnected).toBe(false)
    expect(store.connectionError).toBe('Connection refused')
    // 失败后必须销毁本次连接的服务实例，避免残留 WebSocket 在后台无限重连
    expect(service.disconnectCalls).toBe(1)
    expect(store.service).toBeNull()
  })

  it('连接过程中手动断开，未完成的尝试作废且不再置为已连接', async () => {
    const store = await createStore()

    const pending = store.connect(undefined, 'backup')
    const service = mocks.FakeAria2Service.instances[0]!

    store.disconnect()

    service.connectGate.resolve()
    await flush()
    service.versionGate.resolve({ version: '1.37.0' })
    await expect(pending).resolves.toBe(false)

    expect(store.isConnected).toBe(false)
    expect(store.activeProfileId).toBe('default')
  })

  it('切换实例失败时保留原连接，不清空任务也不改当前预设', async () => {
    const store = await createStore()

    // 先建立一个可用的旧连接（本地引擎）
    const established = store.connect(undefined, 'default')
    const previousService = mocks.FakeAria2Service.instances[0]!
    previousService.connectGate.resolve()
    await flush()
    previousService.versionGate.resolve({ version: '1.37.0' })
    await expect(established).resolves.toBe(true)
    expect(store.service).toBe(previousService)
    expect(store.activeProfileId).toBe('default')
    mocks.clearTasks.mockClear()

    // 再切到连不上的备用实例：探测失败必须回滚，旧连接继续可用
    const switched = store.connect(undefined, 'backup')
    const probeService = mocks.FakeAria2Service.instances[1]!
    probeService.connectGate.resolve()
    await flush()
    probeService.versionGate.reject(new Error('Connection refused'))
    await expect(switched).rejects.toThrow('Connection refused')

    // 旧连接没有被拆掉：service 仍是它，且从未被 disconnect
    expect(store.service).toBe(previousService)
    expect(previousService.disconnectCalls).toBe(0)
    // 界面状态保持「已连接旧实例」，失败原因单独上报给调用方
    expect(store.isConnected).toBe(true)
    expect(store.activeProfileId).toBe('default')
    expect(store.connectionError).toBe('Connection refused')
    // 只有探测实例被销毁，任务列表不该被清空
    expect(probeService.disconnectCalls).toBe(1)
    expect(mocks.clearTasks).not.toHaveBeenCalled()
    expect(store.isConnecting).toBe(false)
  })

  it('连接成功但预设写盘失败时保持连接可用', async () => {
    mocks.updateSettings.mockRejectedValueOnce(new Error('disk full'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = await createStore()

    const pending = store.connect(undefined, 'backup')
    const service = mocks.FakeAria2Service.instances[0]!
    service.connectGate.resolve()
    await flush()
    service.versionGate.resolve({ version: '1.37.0' })

    await expect(pending).resolves.toBe(true)
    expect(store.isConnected).toBe(true)
    expect(store.service).toBe(service)
    expect(service.disconnectCalls).toBe(0)
    warn.mockRestore()
  })
})

describe('connectionStore 预设管理', () => {
  function setSettings(next: Record<string, unknown>) {
    Object.assign(mocks.settings, next)
  }

  function baseSettings() {
    return {
      aria2: { host: 'localhost', port: 6800, protocol: 'http', secret: '', path: '/jsonrpc' },
      connectionProfiles: [
        { id: 'default', name: '本地引擎', config: { host: 'localhost', port: 6800, protocol: 'http', secret: '', path: '/jsonrpc' } }
      ],
      activeProfileId: 'default'
    }
  }

  beforeEach(() => {
    setSettings(baseSettings())
    mocks.updateSettings.mockClear()
  })

  it('加载预设时把本机引擎密钥补进预设（否则前端拿旧 token 连不上）', async () => {
    setSettings({
      aria2: { host: 'localhost', port: 6800, protocol: 'http', secret: 'engine-secret', path: '/jsonrpc' },
      connectionProfiles: [
        { id: 'default', name: '本地引擎', config: { host: 'localhost', port: 6800, protocol: 'http', secret: '', path: '/jsonrpc' } },
        { id: 'remote', name: '远程', config: { host: '10.0.0.5', port: 6800, protocol: 'http', secret: '', path: '/jsonrpc' } }
      ],
      activeProfileId: 'default'
    })
    const store = await createStore()

    expect(store.profiles[0].config.secret).toBe('engine-secret')
    // 远程预设不是本机引擎，密钥保持原样（不能把本机密钥发给远程）
    expect(store.profiles[1].config.secret).toBe('')
  })

  it('引擎侧没有密钥时不改动预设密钥', async () => {
    setSettings({
      aria2: { host: 'localhost', port: 6800, protocol: 'http', secret: '', path: '/jsonrpc' },
      connectionProfiles: [
        { id: 'default', name: '本地引擎', config: { host: 'localhost', port: 6800, protocol: 'http', secret: 'user-set', path: '/jsonrpc' } }
      ],
      activeProfileId: 'default'
    })
    const store = await createStore()

    expect(store.profiles[0].config.secret).toBe('user-set')
  })

  it('没有保存预设时用旧版 aria2 连接设置迁移出默认预设', async () => {
    setSettings({
      aria2: { host: 'localhost', port: 6812, protocol: 'https', secret: 'legacy', path: '/jsonrpc' },
      connectionProfiles: [],
      activeProfileId: ''
    })
    const store = await createStore()

    expect(store.profiles).toHaveLength(1)
    expect(store.profiles[0].id).toBe('default')
    expect(store.profiles[0].config.port).toBe(6812)
    expect(store.profiles[0].config.protocol).toBe('https')
    // 端口与引擎一致 → 迁移出来的预设也要拿到引擎密钥
    expect(store.profiles[0].config.secret).toBe('legacy')
    expect(store.activeProfileId).toBe('default')
  })

  it('activeProfileId 指向不存在的预设时回落到第一个', async () => {
    setSettings({
      ...baseSettings(),
      connectionProfiles: [
        { id: 'a', name: 'A', config: { host: 'localhost', port: 6800, protocol: 'http', secret: '', path: '/jsonrpc' } }
      ],
      activeProfileId: 'gone'
    })
    const store = await createStore()

    expect(store.activeProfileId).toBe('a')
  })

  it('新建预设不会抢占当前连接，名字为空时给默认名', async () => {
    const store = await createStore()
    const created = await store.createProfile('   ')

    expect(created.name).toBe('未命名')
    expect(store.profiles).toHaveLength(2)
    // 未实际连接前不应把新配置标成当前
    expect(store.activeProfileId).toBe('default')
    expect(mocks.updateSettings).toHaveBeenCalledTimes(1)
  })

  it('重命名只改指定预设并持久化，空名字时保留原名', async () => {
    const store = await createStore()
    const created = await store.createProfile('备用')

    await store.renameProfile(created.id, '   ')
    expect(store.profiles.find(p => p.id === created.id)?.name).toBe('备用')

    await store.renameProfile(created.id, '生产')
    expect(store.profiles.find(p => p.id === created.id)?.name).toBe('生产')
    expect(mocks.updateSettings).toHaveBeenCalledTimes(3)
  })

  it('删除预设：至少保留一个，删掉当前项后回落到第一个', async () => {
    const store = await createStore()
    const created = await store.createProfile('备用')
    store.setActiveProfile(created.id)

    await store.deleteProfile(created.id)
    expect(store.profiles).toHaveLength(1)
    expect(store.activeProfileId).toBe('default')

    // 只剩一个时删除是空操作，也不写盘
    mocks.updateSettings.mockClear()
    await store.deleteProfile('default')
    expect(store.profiles).toHaveLength(1)
    expect(mocks.updateSettings).not.toHaveBeenCalled()
  })

  it('删除不存在的预设是空操作', async () => {
    const store = await createStore()
    mocks.updateSettings.mockClear()

    await store.deleteProfile('missing')

    expect(store.profiles).toHaveLength(1)
    expect(mocks.updateSettings).not.toHaveBeenCalled()
  })

  it('setActiveProfile 忽略不存在的 id', async () => {
    const store = await createStore()
    store.setActiveProfile('nope')
    expect(store.activeProfileId).toBe('default')
  })

  it('updateActiveConfig 只改内存不写盘，updateProfileConfig 写盘', async () => {
    const store = await createStore()
    mocks.updateSettings.mockClear()

    store.updateActiveConfig({ port: 7000 })
    expect(store.config.port).toBe(7000)
    expect(mocks.updateSettings).not.toHaveBeenCalled()

    await store.updateProfileConfig('default', { host: '127.0.0.1' })
    expect(store.config.host).toBe('127.0.0.1')
    expect(mocks.updateSettings).toHaveBeenCalledTimes(1)
  })
})

describe('connectionStore 连通性探测与断开', () => {
  beforeEach(() => {
    mocks.FakeAria2Service.instances.length = 0
    mocks.updateSettings.mockClear()
    mocks.clearTasks.mockClear()
    mocks.clearCache.mockClear()
  })

  it('testConnection 成功时返回版本与耗时，并销毁探测实例', async () => {
    const store = await createStore()
    const pending = store.testConnection({ host: 'localhost', port: 6800, protocol: 'http', secret: '', path: '/jsonrpc' })
    const probe = mocks.FakeAria2Service.instances[0]!
    probe.versionGate.resolve({ version: '1.37.0' })

    const result = await pending
    expect(result.success).toBe(true)
    expect(result.version).toBe('1.37.0')
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    expect(probe.disconnectCalls).toBe(1)
  })

  it('testConnection 失败时回传错误且不影响当前连接', async () => {
    const store = await createStore()
    const pending = store.testConnection({ host: '10.0.0.9', port: 6800, protocol: 'http', secret: '', path: '/jsonrpc' })
    const probe = mocks.FakeAria2Service.instances[0]!
    probe.versionGate.reject(new Error('ECONNREFUSED'))

    const result = await pending
    expect(result.success).toBe(false)
    expect(result.error).toBe('ECONNREFUSED')
    expect(probe.disconnectCalls).toBe(1)
    expect(store.service).toBeNull()
    expect(store.isConnected).toBe(false)
  })

  it('disconnect 推进代次、清空服务与缓存', async () => {
    const store = await createStore()
    const pending = store.connect(undefined, 'default')
    const service = mocks.FakeAria2Service.instances[0]!
    service.connectGate.resolve()
    await flush()
    service.versionGate.resolve({ version: '1.37.0' })
    await expect(pending).resolves.toBe(true)
    mocks.clearTasks.mockClear()
    mocks.clearCache.mockClear()

    store.disconnect()

    expect(store.service).toBeNull()
    expect(store.isConnected).toBe(false)
    expect(store.isConnecting).toBe(false)
    expect(store.connectionError).toBeNull()
    expect(service.disconnectCalls).toBe(1)
    // 重新连接时要展示新实例的数据，旧缓存必须清掉
    expect(mocks.clearTasks).toHaveBeenCalledTimes(1)
    expect(mocks.clearCache).toHaveBeenCalledTimes(1)
  })

  it('连接成功后会清空旧任务列表（切换实例不能沿用上一个实例的任务）', async () => {
    const store = await createStore()

    const first = store.connect(undefined, 'default')
    const firstService = mocks.FakeAria2Service.instances[0]!
    firstService.connectGate.resolve()
    await flush()
    firstService.versionGate.resolve({ version: '1.37.0' })
    await expect(first).resolves.toBe(true)
    mocks.clearTasks.mockClear()

    const second = store.connect(undefined, 'backup')
    const secondService = mocks.FakeAria2Service.instances[1]!
    secondService.connectGate.resolve()
    await flush()
    secondService.versionGate.resolve({ version: '1.37.0' })
    await expect(second).resolves.toBe(true)

    expect(store.service).toBe(secondService)
    expect(firstService.disconnectCalls).toBe(1)
    expect(mocks.clearTasks).toHaveBeenCalledTimes(1)
  })
})

describe('connectionStore 连接收尾与预设落盘的边界', () => {
  beforeEach(() => {
    mocks.FakeAria2Service.instances.length = 0
    mocks.updateSettings.mockClear()
    mocks.clearTasks.mockClear()
    mocks.clearCache.mockClear()
    mocks.settings.connectionProfiles = [
      { id: 'default', name: '本地引擎', config: { host: 'localhost', port: 6800, protocol: 'http', secret: '', path: '/jsonrpc' } },
      { id: 'backup', name: '备用实例', config: { host: 'localhost', port: 6812, protocol: 'http', secret: '', path: '/jsonrpc' } }
    ]
    mocks.settings.activeProfileId = 'default'
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  async function connectWith(store: Awaited<ReturnType<typeof createStore>>, profileId: string) {
    const pending = store.connect(undefined, profileId)
    const service = mocks.FakeAria2Service.instances[mocks.FakeAria2Service.instances.length - 1]!
    service.connectGate.resolve()
    await flush()
    service.versionGate.resolve({ version: '1.37.0' })
    await pending
    return service
  }

  it('删除不存在的预设时即使有多个预设也不写盘', async () => {
    const store = await createStore()
    mocks.updateSettings.mockClear()

    await store.deleteProfile('missing')

    expect(store.profiles).toHaveLength(2)
    expect(mocks.updateSettings).not.toHaveBeenCalled()
  })

  it('指定预设并带新参数时先合并进该预设再连接', async () => {
    const store = await createStore()
    const pending = store.connect({ port: 7001 }, 'backup')
    const service = mocks.FakeAria2Service.instances[0]!

    // 连接使用的是合并后的参数，而不是预设里的旧端口
    expect(service.config).toMatchObject({ port: 7001 })
    expect(store.profiles.find(p => p.id === 'backup')?.config.port).toBe(7001)

    service.connectGate.resolve()
    await flush()
    service.versionGate.resolve({ version: '1.37.0' })
    await expect(pending).resolves.toBe(true)
    expect(store.activeProfileId).toBe('backup')
  })

  it('不指定预设但带新参数时只改当前预设的连接参数', async () => {
    const store = await createStore()
    const pending = store.connect({ port: 7002 })
    const service = mocks.FakeAria2Service.instances[0]!

    expect(service.config).toMatchObject({ port: 7002 })
    expect(store.config.port).toBe(7002)

    service.connectGate.resolve()
    await flush()
    service.versionGate.resolve({ version: '1.37.0' })
    await expect(pending).resolves.toBe(true)
  })

  it('WebSocket 建连失败时降级走 HTTP 并在控制台留痕', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = await createStore()
    const pending = store.connect(undefined, 'default')
    const service = mocks.FakeAria2Service.instances[0]!

    service.connectGate.reject(new Error('ws refused'))
    await flush()
    expect(warn).toHaveBeenCalledWith('WebSocket connection failed, will use HTTP:', expect.any(Error))

    service.versionGate.resolve({ version: '1.37.0' })
    await expect(pending).resolves.toBe(true)
    expect(store.isConnected).toBe(true)
  })

  it('已接管实例的 connected/disconnected/error 事件会同步界面状态', async () => {
    const store = await createStore()
    const service = await connectWith(store, 'default')
    expect(store.isConnected).toBe(true)

    service.emit('disconnected')
    expect(store.isConnected).toBe(false)

    service.emit('connected')
    expect(store.isConnected).toBe(true)
    expect(store.connectionError).toBeNull()

    service.emit('error', new Error('socket closed'))
    expect(store.connectionError).toBe('socket closed')

    // 没有 message 的错误也要给出可读文案，而不是空白提示
    service.emit('error', {})
    expect(store.connectionError).toBe('Connection error')
  })

  it('被更新连接取代的失败尝试会自行销毁且不报错', async () => {
    const store = await createStore()

    const first = store.connect(undefined, 'default')
    const firstService = mocks.FakeAria2Service.instances[0]!
    firstService.connectGate.resolve()
    await flush()

    // 第一次还卡在 getVersion 时又发起了第二次连接并成功
    const second = store.connect(undefined, 'backup')
    const secondService = mocks.FakeAria2Service.instances[1]!
    secondService.connectGate.resolve()
    await flush()
    secondService.versionGate.resolve({ version: '1.37.0' })
    await expect(second).resolves.toBe(true)

    // 第一次随后失败：既不能抛给调用方，也不能改动当前状态
    firstService.versionGate.reject(new Error('Connection refused'))
    await expect(first).resolves.toBe(false)
    expect(firstService.disconnectCalls).toBe(1)
    expect(store.service).toBe(secondService)
    expect(store.isConnected).toBe(true)
    expect(store.activeProfileId).toBe('backup')
  })

  it('被新连接取代后，旧实例的事件不再改动界面状态', async () => {
    const store = await createStore()
    const firstService = await connectWith(store, 'default')
    expect(store.isConnected).toBe(true)

    // 第二次连接成功接管：connectToken 递增，旧实例的三个监听器全部作废
    const secondService = await connectWith(store, 'backup')
    expect(store.service).toBe(secondService)

    firstService.emit('connected')
    firstService.emit('disconnected')
    firstService.emit('error', new Error('stale socket'))
    expect(store.isConnected).toBe(true)
    expect(store.connectionError).toBeNull()

    // 新实例的事件照常生效，证明不是把监听器整体摘掉了
    secondService.emit('error', new Error('fresh socket'))
    expect(store.connectionError).toBe('fresh socket')
  })

  it('连通性探测超时后返回失败并销毁探测实例', async () => {
    vi.useFakeTimers()
    const store = await createStore()

    const pending = store.testConnection({ host: '10.0.0.9', port: 6800, protocol: 'http', secret: '', path: '/jsonrpc' })
    const probe = mocks.FakeAria2Service.instances[0]!

    // 探测实例一直不回版本号，由 6 秒超时兜底
    await vi.advanceTimersByTimeAsync(6000)
    const result = await pending

    expect(result.success).toBe(false)
    expect(result.error).toBe('Connection timed out')
    expect(probe.disconnectCalls).toBe(1)
  })
})

