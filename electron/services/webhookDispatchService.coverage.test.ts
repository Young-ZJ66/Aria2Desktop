import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * webhookDispatchService 覆盖率补充单测。
 *
 * 既有 webhookDispatchService.test.ts 覆盖正常投递链路；这里专攻「异常时队列会不会
 * 卡住或静默丢条目」：调度层异常、条目在轮次中消失、超时中止、容量裁剪无候选、
 * 密钥反查的两条路径、以及单例访问器。
 */
const h = vi.hoisted(() => ({ state: { windows: [] as unknown[], settingsThrows: false, settings: { completionRules: [] as unknown[] } } }))
const { state } = h

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => state.windows } }))
vi.mock('../utils/ipcSecurity', () => ({ registerSecureHandler: vi.fn() }))
vi.mock('../utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
}))
vi.mock('../utils/settingsAccessor', () => ({
  getSettingsFresh: () => {
    if (state.settingsThrows) throw new Error('settings unavailable')
    return state.settings
  }
}))
vi.mock('../utils/mainLocaleRuntime', () => ({ runtimeMainLocale: () => 'zh' }))
vi.mock('../utils/mainErrorCopy', () => ({ mainError: (_locale: string, key: string) => key }))

import {
  WebhookDispatchService,
  getWebhookDispatchService,
  initWebhookDispatchService
} from './webhookDispatchService'
import type { WebhookPayload } from './webhookDispatchService'
import { registerSecureHandler } from '../utils/ipcSecurity'
import type { WebhookQueueEntry } from '../../src/shared/webhookQueue'

const mockedRegister = vi.mocked(registerSecureHandler)

type StoreLike = {
  get: (key: string) => unknown
  set: (key: string, value: unknown) => void
}

type StoreState = { failGet: boolean }

function makeStore(initial: Record<string, unknown> = {}): StoreLike & { state: StoreState } {
  const data: Record<string, unknown> = { ...initial }
  const storeState: StoreState = { failGet: false }
  return {
    state: storeState,
    get(key: string) {
      if (storeState.failGet) throw new Error('store read failed')
      return data[key]
    },
    set(key: string, value: unknown) {
      data[key] = value
    }
  }
}

type FetchLike = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number }>

function asFetch(fn: FetchLike): typeof fetch {
  return fn as unknown as typeof fetch
}

function okFetch(): { fetcher: typeof fetch; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return { ok: true, status: 200 }
  })
  return { fetcher: asFetch(fn), calls }
}

/** 永不返回、只在 AbortSignal 触发时 reject 的 fetcher：用来验证 10 秒超时中止 */
function abortableFetch(): { fetcher: typeof fetch; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fn = vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return new Promise<{ ok: boolean; status: number }>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('The operation was aborted')))
    })
  })
  return { fetcher: asFetch(fn as FetchLike), calls }
}

function makePayload(overrides: Partial<WebhookPayload> = {}): WebhookPayload {
  return {
    event: 'download.complete',
    gid: 'g1',
    status: 'complete',
    name: 'a.iso',
    files: ['D:/Downloads/a.iso'],
    dir: 'D:/Downloads',
    timestamp: '2026-11-14T00:00:00.000Z',
    ...overrides
  }
}

function makeEntry(overrides: Partial<WebhookQueueEntry> = {}): WebhookQueueEntry {
  return {
    id: 'entry-1',
    url: 'https://example.com/hook',
    method: 'POST',
    event: 'download.complete',
    gid: 'g1',
    attempts: 0,
    maxRetries: 4,
    baseDelaySeconds: 60,
    nextAttemptAt: 0,
    lastError: '',
    status: 'pending',
    createdAt: Date.now(),
    ...overrides
  }
}

function makeService(fetcher: typeof fetch, initial: Record<string, unknown> = {}) {
  const store = makeStore(initial)
  const service = new WebhookDispatchService(store as never, fetcher)
  return { service, store }
}

function readQueue(store: StoreLike): WebhookQueueEntry[] {
  return (store.get('webhookQueue') as WebhookQueueEntry[] | undefined) ?? []
}

type Internals = {
  deliver: (id: string) => Promise<void>
  recordFailure: (id: string, message: string) => void
  removeEntry: (id: string) => void
  trimToCapacity: (list: WebhookQueueEntry[]) => WebhookQueueEntry[]
  patchEntry: (id: string, patch: Partial<WebhookQueueEntry>) => void
  resolveSecret: (entry: WebhookQueueEntry) => string
  secrets: Map<string, string>
  timer: unknown
  kick: () => void
}

function internalsOf(service: WebhookDispatchService): Internals {
  return service as unknown as Internals
}

beforeEach(() => {
  vi.clearAllMocks()
  state.windows = []
  state.settingsThrows = false
  state.settings = { completionRules: [] }
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('入队参数的钳制边界', () => {
  it('非有限数值一律回落到下界，不写成 NaN', async () => {
    const { fetcher } = okFetch()
    const { service, store } = makeService(fetcher)
    service.enqueue(
      { type: 'webhook', url: 'https://a.test/nan', maxRetries: Number.NaN, retryDelaySeconds: Number.NaN },
      makePayload()
    )
    const [entry] = readQueue(store)
    expect(entry).toMatchObject({ maxRetries: 0, baseDelaySeconds: 5 })
    await service.waitForIdle()
  })

  it('Infinity 同样回落到下界', async () => {
    const { fetcher } = okFetch()
    const { service, store } = makeService(fetcher)
    service.enqueue(
      { type: 'webhook', url: 'https://a.test/inf', maxRetries: Number.POSITIVE_INFINITY, retryDelaySeconds: Number.NEGATIVE_INFINITY },
      makePayload()
    )
    const [entry] = readQueue(store)
    expect(entry).toMatchObject({ maxRetries: 0, baseDelaySeconds: 5 })
    await service.waitForIdle()
  })
})

describe('ticker 与调度层的容错', () => {
  it('15 秒一跳会真正触发一轮投递', async () => {
    const { fetcher, calls } = okFetch()
    const { service, store } = makeService(fetcher, { webhookQueue: [makeEntry({ id: 'due-1', nextAttemptAt: 0 })] })
    const intervalSpy = vi.spyOn(globalThis, 'setInterval')
    service.initialize()
    expect(internalsOf(service).timer).not.toBeNull()
    const tick = intervalSpy.mock.calls[0]![0] as () => void
    tick()
    await service.waitForIdle()
    expect(calls).toHaveLength(1)
    expect(readQueue(store)).toHaveLength(0)
    service.shutdown()
  })

  it('读队列抛错时只记调度层告警，ticker 不被打死', async () => {
    const { fetcher } = okFetch()
    const { service, store } = makeService(fetcher)
    store.state.failGet = true
    expect(() => internalsOf(service).kick()).not.toThrow()
    await service.waitForIdle()
    store.state.failGet = false
    // 下一轮仍能正常跑（ticker 没被异常终止）
    service.enqueue({ type: 'webhook', url: 'https://a.test/after' }, makePayload())
    await service.waitForIdle()
    expect(readQueue(store).length).toBeLessThanOrEqual(1)
  })

  it('shutdown 后再 shutdown 不抛错', () => {
    const { fetcher } = okFetch()
    const { service } = makeService(fetcher)
    service.initialize()
    service.shutdown()
    expect(() => service.shutdown()).not.toThrow()
  })
})

describe('投递阶段的条目消失与超时', () => {
  it('条目已不在队列里时直接返回', async () => {
    const { fetcher, calls } = okFetch()
    const { service } = makeService(fetcher)
    await internalsOf(service).deliver('missing-entry')
    expect(calls).toHaveLength(0)
  })

  it('条目已被改成 delivering 时不重复投递', async () => {
    const { fetcher, calls } = okFetch()
    const { service } = makeService(fetcher, {
      webhookQueue: [makeEntry({ id: 'inflight', status: 'delivering' })]
    })
    await internalsOf(service).deliver('inflight')
    expect(calls).toHaveLength(0)
  })

  it('请求超过 10 秒会被中止并记为失败', async () => {
    const { fetcher, calls } = abortableFetch()
    const { service, store } = makeService(fetcher)
    service.enqueue({ type: 'webhook', url: 'https://a.test/hang' }, makePayload())
    await vi.advanceTimersByTimeAsync(10_000)
    await service.waitForIdle()
    expect(calls).toHaveLength(1)
    expect(readQueue(store)[0]).toMatchObject({ status: 'pending', attempts: 1, lastError: 'The operation was aborted' })
  })

  it('记录失败时条目已被清空则静默返回', () => {
    const { fetcher } = okFetch()
    const { service, store } = makeService(fetcher, { webhookQueue: [] })
    expect(() => internalsOf(service).recordFailure('gone', 'boom')).not.toThrow()
    expect(readQueue(store)).toEqual([])
  })

  it('移除不存在的条目不会改动队列', () => {
    const { fetcher } = okFetch()
    const { service, store } = makeService(fetcher, { webhookQueue: [makeEntry({ id: 'keep' })] })
    internalsOf(service).removeEntry('missing')
    expect(readQueue(store).map(entry => entry.id)).toEqual(['keep'])
  })

  it('patchEntry 找不到条目时不动队列', () => {
    const { fetcher } = okFetch()
    const { service, store } = makeService(fetcher, { webhookQueue: [makeEntry({ id: 'keep' })] })
    internalsOf(service).patchEntry('missing', { status: 'failed' })
    expect(readQueue(store)[0]!.status).toBe('pending')
  })
})

describe('容量裁剪的极端情况', () => {
  it('全部在投递中时宁可超限也不丢条目', () => {
    const { fetcher } = okFetch()
    const { service } = makeService(fetcher)
    const list = Array.from({ length: 201 }, (_unused, index) =>
      makeEntry({ id: 'inflight-' + index, status: 'delivering', createdAt: index })
    )
    const trimmed = internalsOf(service).trimToCapacity(list)
    expect(trimmed).toHaveLength(201)
  })
})

describe('签名密钥的反查', () => {
  it('进程重启后按 url + method 从设置里找回密钥', async () => {
    state.settings = {
      completionRules: [
        {
          id: 'r1',
          actions: [
            { type: 'webhook', url: 'https://a.test/signed', method: 'POST', secret: 'persisted-secret' },
            { type: 'webhook', url: 'https://a.test/signed', method: 'GET', secret: 'wrong-method' },
            { type: 'notify', title: 'x' }
          ]
        }
      ]
    }
    const { fetcher, calls } = okFetch()
    const { service } = makeService(fetcher, {
      webhookQueue: [makeEntry({ id: 'resume-1', url: 'https://a.test/signed', nextAttemptAt: 0 })]
    })
    service.initialize()
    await service.waitForIdle()
    const headers = calls[0]!.init!.headers as Record<string, string>
    expect(headers['X-Aria2-Timestamp']).toMatch(/^\d+$/)
    expect(headers['X-Aria2-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/)
    service.shutdown()
  })

  it('读设置抛错时按无签名投递并记告警', async () => {
    state.settingsThrows = true
    const { fetcher, calls } = okFetch()
    const { service } = makeService(fetcher, {
      webhookQueue: [makeEntry({ id: 'resume-2', url: 'https://a.test/plain', nextAttemptAt: 0 })]
    })
    service.initialize()
    await service.waitForIdle()
    const headers = calls[0]!.init!.headers as Record<string, string>
    expect(headers['X-Aria2-Signature']).toBeUndefined()
    expect(headers['Content-Type']).toBe('application/json')
    service.shutdown()
  })

  it('投递成功后内存里的密钥被丢弃', async () => {
    const { fetcher } = okFetch()
    const { service } = makeService(fetcher)
    const entry = service.enqueue({ type: 'webhook', url: 'https://a.test/secret', secret: 'k' }, makePayload())
    expect(internalsOf(service).secrets.get(entry.id)).toBe('k')
    await service.waitForIdle()
    expect(internalsOf(service).secrets.size).toBe(0)
  })
})

describe('IPC 通道的窗口取值器', () => {
  it('没有窗口时给 null，有窗口时给该窗口', () => {
    const { fetcher } = okFetch()
    const { service } = makeService(fetcher)
    service.registerIpcHandlers()
    const listCall = mockedRegister.mock.calls.find(call => call[0] === 'webhook-queue-list')!
    const getMainWindow = (listCall[2] as { getMainWindow: () => unknown }).getMainWindow
    expect(getMainWindow()).toBeNull()
    const fakeWindow = { id: 7 }
    state.windows = [fakeWindow]
    expect(getMainWindow()).toBe(fakeWindow)
  })
})

describe('密钥反查的条目筛选', () => {
  it('按类型、地址、方法逐条筛掉不匹配的动作', () => {
    state.settings = {
      completionRules: [
        {
          id: 'r1',
          actions: [
            { type: 'webhook', url: 'https://other.test/hook', method: 'POST', secret: 'wrong-url' },
            { type: 'notify', title: 'x' },
            { type: 'webhook', url: 'https://a.test/signed', method: 'GET', secret: 'wrong-method' },
            { type: 'webhook', url: 'https://a.test/signed', method: 'POST', secret: 'persisted-secret' }
          ]
        }
      ]
    }
    const { fetcher } = okFetch()
    const { service } = makeService(fetcher)
    const internals = internalsOf(service)
    expect(internals.resolveSecret(makeEntry({ url: 'https://a.test/signed', method: 'POST' }))).toBe('persisted-secret')
    expect(internals.resolveSecret(makeEntry({ url: 'https://a.test/signed', method: 'GET' }))).toBe('wrong-method')
    expect(internals.resolveSecret(makeEntry({ url: 'https://missing.test/hook', method: 'POST' }))).toBe('')
  })
})

describe('模块级单例访问器', () => {
  it('initWebhookDispatchService 复用同一个实例，getter 可取得', () => {
    const { fetcher } = okFetch()
    const store = makeStore()
    const first = initWebhookDispatchService(store as never, fetcher)
    const second = initWebhookDispatchService(store as never, fetcher)
    expect(second).toBe(first)
    expect(getWebhookDispatchService()).toBe(first)
  })
})
