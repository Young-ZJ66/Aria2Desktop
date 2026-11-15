import { beforeEach, describe, expect, it, vi } from 'vitest'
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
      // 假实现不需要真正关闭连接
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
})
