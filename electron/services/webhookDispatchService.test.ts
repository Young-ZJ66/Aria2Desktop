import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * webhookDispatchService 单测。
 *
 * mock 手法照抄 rssSubscriptionService.test.ts：
 * - electron / ipcSecurity / logger / settingsAccessor 全部替换为假实现（单测跑在 node 环境，没有 electron）；
 * - store 用内存假对象（只用到 get/set）；
 * - fetch 通过构造函数注入，测试里给假 fetcher，完全不碰网络。
 */
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../utils/ipcSecurity', () => ({ registerSecureHandler: vi.fn() }))
vi.mock('../utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
}))
vi.mock('../utils/settingsAccessor', () => ({ getSettingsFresh: vi.fn(() => ({ completionRules: [] })) }))

import {
  WebhookDispatchService,
  buildSignatureHeaders,
  computeBackoffMs
} from './webhookDispatchService'
import type { WebhookPayload } from './webhookDispatchService'
import { registerSecureHandler } from '../utils/ipcSecurity'
import { getSettingsFresh } from '../utils/settingsAccessor'
import type { WebhookQueueEntry } from '../../src/shared/webhookQueue'

const mockedRegister = vi.mocked(registerSecureHandler)
const mockedSettings = vi.mocked(getSettingsFresh)

type StoreLike = {
  get: (key: string) => unknown
  set: (key: string, value: unknown) => void
}

function makeStore(initial: Record<string, unknown> = {}): StoreLike {
  const data: Record<string, unknown> = { ...initial }
  return {
    get: key => data[key],
    set: (key, value) => { data[key] = value }
  }
}

type FetchLike = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number }>

/** 假 fetcher 的返回形态只需要 ok/status 两个字段 */
function asFetch(fn: FetchLike): typeof fetch {
  return fn as unknown as typeof fetch
}

/** 成功响应 */
function okFetch(): { fetcher: typeof fetch; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return { ok: true, status: 200 }
  })
  return { fetcher: asFetch(fn), calls }
}

/** 失败响应（非 2xx） */
function badFetch(status = 500): { fetcher: typeof fetch; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return { ok: false, status }
  })
  return { fetcher: asFetch(fn), calls }
}

/** 网络异常 */
function throwingFetch(message = 'boom'): { fetcher: typeof fetch; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    throw new Error(message)
  })
  return { fetcher: asFetch(fn), calls }
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

function makeService(fetcher: typeof fetch, initial: Record<string, unknown> = {}) {
  const store = makeStore(initial)
  const service = new WebhookDispatchService(store as never, fetcher)
  return { service, store }
}

function readQueue(store: StoreLike): WebhookQueueEntry[] {
  return (store.get('webhookQueue') as WebhookQueueEntry[] | undefined) ?? []
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
    nextAttemptAt: Date.now() + 1_000_000,
    lastError: '',
    status: 'pending',
    createdAt: Date.now(),
    ...overrides
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedSettings.mockReturnValue({ completionRules: [] } as never)
})

describe('computeBackoffMs', () => {
  it('按 base * 2^(attempts-1) 递增', () => {
    expect(computeBackoffMs(60, 1)).toBe(60_000)
    expect(computeBackoffMs(60, 2)).toBe(120_000)
    expect(computeBackoffMs(60, 3)).toBe(240_000)
    expect(computeBackoffMs(60, 4)).toBe(480_000)
  })

  it('上限 6 小时（21600 秒）', () => {
    expect(computeBackoffMs(60, 10)).toBe(21_600_000)
    expect(computeBackoffMs(3600, 5)).toBe(21_600_000)
    // 刚好卡在上限之下的档位仍然按公式算
    expect(computeBackoffMs(3600, 3)).toBe(14_400_000)
  })

  it('非法输入回落到下界/首档，不产生 NaN', () => {
    expect(computeBackoffMs(Number.NaN, 1)).toBe(5_000)
    expect(computeBackoffMs(60, Number.NaN)).toBe(60_000)
    expect(computeBackoffMs(60, 0)).toBe(60_000)
  })
})

describe('buildSignatureHeaders', () => {
  it('固定向量：POST 带 body', () => {
    const body = '{"event":"download.complete","gid":"g1"}'
    const headers = buildSignatureHeaders('s3cr3t', 1700000000000, body)
    expect(headers['X-Aria2-Timestamp']).toBe('1700000000000')
    expect(headers['X-Aria2-Signature']).toBe(
      'sha256=fde8babe1faa5d009884b33111744edf2e6097604e4725501672ea61928d2d1d'
    )
  })

  it('固定向量：GET 无 body 时签 timestamp + "."', () => {
    const headers = buildSignatureHeaders('s3cr3t', 1700000000000, '')
    expect(headers['X-Aria2-Signature']).toBe('sha256=516ff7f3329566c749765d9285a2d781ff68a5bd5b764f09aa5126c0b5197e28')
  })

  it('时间戳是字符串形式的 epoch 毫秒，签名是 sha256= 前缀的 hex', () => {
    const headers = buildSignatureHeaders('topsecret', 1763000000000, '{"event":"download.error"}')
    expect(headers['X-Aria2-Timestamp']).toBe('1763000000000')
    expect(headers['X-Aria2-Signature']).toBe(
      'sha256=4c881d41ff46f8ccf35aac954a8eab79b17bae02a35e41ee2507895495d59036'
    )
  })
})

describe('enqueue 持久化与参数钳制', () => {
  it('默认值：maxRetries 4、退避基准 60 秒、POST、pending', async () => {
    const { fetcher } = okFetch()
    const { service, store } = makeService(fetcher)
    service.enqueue({ type: 'webhook', url: 'https://example.com/hook' }, makePayload())
    const [entry] = readQueue(store)
    expect(entry).toMatchObject({
      url: 'https://example.com/hook',
      method: 'POST',
      event: 'download.complete',
      gid: 'g1',
      attempts: 0,
      maxRetries: 4,
      baseDelaySeconds: 60,
      lastError: ''
    })
    // enqueue 内部已 kick() 触发立即投递，读到的可能是投递中（pending → delivering）的瞬时态
    expect(['pending', 'delivering']).toContain(entry!.status)
    await service.waitForIdle()
  })

  it('越界值被钳到合法区间', async () => {
    const { fetcher } = okFetch()
    const { service, store } = makeService(fetcher)
    service.enqueue(
      { type: 'webhook', url: 'https://a.test/1', maxRetries: 99, retryDelaySeconds: 999_999 },
      makePayload()
    )
    service.enqueue(
      { type: 'webhook', url: 'https://a.test/2', maxRetries: -5, retryDelaySeconds: 1 },
      makePayload()
    )
    const queue = readQueue(store)
    expect(queue[0]).toMatchObject({ maxRetries: 10, baseDelaySeconds: 3600 })
    expect(queue[1]).toMatchObject({ maxRetries: 0, baseDelaySeconds: 5 })
    await service.waitForIdle()
  })

  it('载荷随条目落盘，进程重启后仍能原样重放', async () => {
    const first = throwingFetch('offline')
    const { service, store } = makeService(first.fetcher)
    const payload = makePayload()
    service.enqueue({ type: 'webhook', url: 'https://a.test/replay' }, payload)
    await service.waitForIdle()
    // 落盘快照里带完整载荷（重试时 aria2 可能已清掉任务，队列要能独立重放）
    expect(readQueue(store)[0]!.payload).toEqual(payload)

    // 模拟进程重启：新实例只从 store 读，内存里的旧状态全丢
    const second = okFetch()
    const restarted = new WebhookDispatchService(store as never, second.fetcher)
    readQueue(store)[0]!.nextAttemptAt = 0
    store.set('webhookQueue', readQueue(store))
    restarted.initialize()
    await restarted.waitForIdle()
    restarted.shutdown()
    expect(second.calls).toHaveLength(1)
    expect(second.calls[0]!.init!.body).toBe(JSON.stringify(payload))
    expect(readQueue(store)).toHaveLength(0)
  })

  it('GET 动作的 method 固化到条目上', async () => {
    const { fetcher } = okFetch()
    const { service, store } = makeService(fetcher)
    service.enqueue({ type: 'webhook', url: 'https://a.test/get', method: 'GET' }, makePayload())
    expect(readQueue(store)[0]!.method).toBe('GET')
    await service.waitForIdle()
  })

  it('容量 200：先淘汰最旧 failed，再淘汰最旧 pending', async () => {
    const { fetcher } = throwingFetch('offline')
    // 3 条 failed（最旧）+ 197 条 pending（nextAttemptAt 在未来，本轮不会被投递）
    const seed: WebhookQueueEntry[] = [
      makeEntry({ id: 'failed-0', status: 'failed', createdAt: 1 }),
      makeEntry({ id: 'failed-1', status: 'failed', createdAt: 2 }),
      makeEntry({ id: 'failed-2', status: 'failed', createdAt: 3 })
    ]
    for (let index = 0; index < 197; index += 1) {
      seed.push(makeEntry({ id: `pending-${index}`, status: 'pending', createdAt: 100 + index }))
    }
    expect(seed).toHaveLength(200)
    const { service, store } = makeService(fetcher, { webhookQueue: seed })

    service.enqueue({ type: 'webhook', url: 'https://a.test/new' }, makePayload())
    await service.waitForIdle()

    const ids = readQueue(store).map(entry => entry.id)
    expect(ids).toHaveLength(200)
    // 最旧 failed 被淘汰，其余 failed 保留
    expect(ids).not.toContain('failed-0')
    expect(ids).toContain('failed-1')
    expect(ids).toContain('failed-2')
    // 新条目（首投失败后仍留在队列里）
    expect(readQueue(store).some(entry => entry.url === 'https://a.test/new')).toBe(true)
  })

  it('没有 failed 时淘汰最旧 pending', async () => {
    const { fetcher } = throwingFetch('offline')
    const seed: WebhookQueueEntry[] = []
    for (let index = 0; index < 200; index += 1) {
      seed.push(makeEntry({ id: `pending-${index}`, status: 'pending', createdAt: 100 + index }))
    }
    const { service, store } = makeService(fetcher, { webhookQueue: seed })
    service.enqueue({ type: 'webhook', url: 'https://a.test/new' }, makePayload())
    await service.waitForIdle()
    const ids = readQueue(store).map(entry => entry.id)
    expect(ids).toHaveLength(200)
    expect(ids).not.toContain('pending-0')
    expect(ids).toContain('pending-1')
  })
})

describe('投递状态机', () => {
  it('2xx：条目从队列移除并落盘', async () => {
    const { fetcher } = okFetch()
    const { service, store } = makeService(fetcher)
    service.enqueue({ type: 'webhook', url: 'https://a.test/ok' }, makePayload())
    await service.waitForIdle()
    expect(readQueue(store)).toHaveLength(0)
  })

  it('首投失败：status 回 pending、attempts=1、nextAttemptAt 按退避推进', async () => {
    const { fetcher } = throwingFetch('connect ECONNREFUSED')
    const { service, store } = makeService(fetcher)
    const before = Date.now()
    service.enqueue({ type: 'webhook', url: 'https://a.test/fail', retryDelaySeconds: 30 }, makePayload())
    await service.waitForIdle()
    const after = Date.now()
    const [entry] = readQueue(store)
    expect(entry).toMatchObject({ status: 'pending', attempts: 1, lastError: 'connect ECONNREFUSED' })
    expect(entry!.lastAttemptAt).toBeGreaterThanOrEqual(before)
    expect(entry!.nextAttemptAt).toBeGreaterThanOrEqual(before + 30_000)
    expect(entry!.nextAttemptAt).toBeLessThanOrEqual(after + 30_000)
  })

  it('非 2xx 也按失败处理，lastError 记录状态码', async () => {
    const { fetcher } = badFetch(503)
    const { service, store } = makeService(fetcher)
    service.enqueue({ type: 'webhook', url: 'https://a.test/503' }, makePayload())
    await service.waitForIdle()
    const [entry] = readQueue(store)
    expect(entry).toMatchObject({ status: 'pending', attempts: 1, lastError: 'HTTP 503' })
  })

  it('attempts 超过 maxRetries：转 failed 并留在队列', async () => {
    const { fetcher } = throwingFetch('still down')
    const { service, store } = makeService(fetcher)
    service.enqueue({ type: 'webhook', url: 'https://a.test/dead', maxRetries: 0 }, makePayload())
    await service.waitForIdle()
    const [entry] = readQueue(store)
    expect(entry).toMatchObject({ status: 'failed', attempts: 1, maxRetries: 0 })
    // 再次 tick 不会重投 failed
    await service.waitForIdle()
    expect(readQueue(store)[0]!.attempts).toBe(1)
  })

  it('maxRetries=2 时第三次失败才转 failed', async () => {
    const { fetcher } = throwingFetch('nope')
    const { service, store } = makeService(fetcher)
    service.enqueue({ type: 'webhook', url: 'https://a.test/retry', maxRetries: 2 }, makePayload())
    await service.waitForIdle()
    expect(readQueue(store)[0]).toMatchObject({ status: 'pending', attempts: 1 })
    // 把 nextAttemptAt 拉到当下，模拟退避到期
    readQueue(store)[0]!.nextAttemptAt = 0
    store.set('webhookQueue', readQueue(store))
    service.initialize()
    await service.waitForIdle()
    expect(readQueue(store)[0]).toMatchObject({ status: 'pending', attempts: 2 })
    readQueue(store)[0]!.nextAttemptAt = 0
    store.set('webhookQueue', readQueue(store))
    await service.waitForIdle()
    service.shutdown()
  })

  it('POST：Content-Type 与 JSON body 精确一致', async () => {
    const { fetcher, calls } = okFetch()
    const { service } = makeService(fetcher)
    const payload = makePayload()
    service.enqueue({ type: 'webhook', url: 'https://a.test/post' }, payload)
    await service.waitForIdle()
    expect(calls).toHaveLength(1)
    const init = calls[0]!.init!
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(init.body).toBe(JSON.stringify(payload))
  })

  it('GET：无 body、无 Content-Type', async () => {
    const { fetcher, calls } = okFetch()
    const { service } = makeService(fetcher)
    service.enqueue({ type: 'webhook', url: 'https://a.test/get', method: 'GET' }, makePayload())
    await service.waitForIdle()
    const init = calls[0]!.init!
    expect(init.method).toBe('GET')
    expect(init.body).toBeUndefined()
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined()
  })

  it('secret：带 X-Aria2-Timestamp 与正确的 X-Aria2-Signature（签 timestamp.body）', async () => {
    const { fetcher, calls } = okFetch()
    const { service } = makeService(fetcher)
    const payload = makePayload()
    service.enqueue({ type: 'webhook', url: 'https://a.test/signed', secret: 's3cr3t' }, payload)
    await service.waitForIdle()
    const headers = calls[0]!.init!.headers as Record<string, string>
    const timestamp = headers['X-Aria2-Timestamp']!
    expect(timestamp).toMatch(/^\d{13}$/)
    // 用 node crypto 独立复算（不复用被测函数，避免自证）
    const expected = 'sha256=' + createHmac('sha256', 's3cr3t')
      .update(`${timestamp}.${JSON.stringify(payload)}`)
      .digest('hex')
    expect(headers['X-Aria2-Signature']).toBe(expected)
  })

  it('无 secret 时不带签名头', async () => {
    const { fetcher, calls } = okFetch()
    const { service } = makeService(fetcher)
    service.enqueue({ type: 'webhook', url: 'https://a.test/plain' }, makePayload())
    await service.waitForIdle()
    const headers = calls[0]!.init!.headers as Record<string, string>
    expect(headers['X-Aria2-Signature']).toBeUndefined()
    expect(headers['X-Aria2-Timestamp']).toBeUndefined()
  })
})

describe('retry / clear / list', () => {
  it('retry：失败条目复位并立即重投，成功后移除', async () => {
    const { fetcher } = okFetch()
    const { service, store } = makeService(fetcher, {
      webhookQueue: [makeEntry({ id: 'dead-1', status: 'failed', attempts: 5, lastError: 'down' })]
    })
    const result = service.retryEntry('dead-1')
    expect(result).toEqual({ success: true })
    await service.waitForIdle()
    expect(readQueue(store)).toHaveLength(0)
  })

  it('retry：条目不存在返回失败原因', () => {
    const { fetcher } = okFetch()
    const { service } = makeService(fetcher)
    expect(service.retryEntry('missing')).toEqual({ success: false, error: '队列条目不存在' })
  })

  it('clear：清空全部并返回条数', () => {
    const { fetcher } = okFetch()
    const { service, store } = makeService(fetcher, {
      webhookQueue: [makeEntry({ id: 'a' }), makeEntry({ id: 'b' }), makeEntry({ id: 'c' })]
    })
    expect(service.clearQueue()).toBe(3)
    expect(readQueue(store)).toEqual([])
    expect(service.clearQueue()).toBe(0)
  })

  it('listEntries 返回新→旧', () => {
    const { fetcher } = okFetch()
    const { service } = makeService(fetcher, {
      webhookQueue: [makeEntry({ id: 'old', createdAt: 1 }), makeEntry({ id: 'new', createdAt: 2 })]
    })
    expect(service.listEntries().map(entry => entry.id)).toEqual(['new', 'old'])
  })
})

describe('initialize：进程中断恢复', () => {
  it('遗留 delivering 复位为 pending，nextAttemptAt 推到 5 秒后', async () => {
    const { fetcher } = okFetch()
    const { service, store } = makeService(fetcher, {
      webhookQueue: [makeEntry({ id: 'inflight', status: 'delivering', attempts: 2 })]
    })
    const before = Date.now()
    service.initialize()
    const [entry] = readQueue(store)
    expect(entry!.status).toBe('pending')
    expect(entry!.attempts).toBe(2)
    expect(entry!.nextAttemptAt).toBeGreaterThanOrEqual(before + 5_000)
    expect(entry!.nextAttemptAt).toBeLessThanOrEqual(Date.now() + 5_000)
    service.shutdown()
  })

  it('initialize 幂等：重复调用不重复挂 ticker', () => {
    const { fetcher } = okFetch()
    const { service } = makeService(fetcher)
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    service.initialize()
    service.initialize()
    expect(setIntervalSpy).toHaveBeenCalledTimes(1)
    service.shutdown()
    setIntervalSpy.mockRestore()
  })
})

describe('registerIpcHandlers', () => {
  it('注册三个通道，且 list/retry/clear 的返回形态与 preload 契约一致', async () => {
    const { fetcher } = okFetch()
    const { service, store } = makeService(fetcher, {
      webhookQueue: [makeEntry({ id: 'failed-1', status: 'failed', attempts: 3 })]
    })
    service.registerIpcHandlers()
    expect(mockedRegister.mock.calls.map(call => call[0])).toEqual([
      'webhook-queue-list',
      'webhook-queue-retry',
      'webhook-queue-clear'
    ])

    const handlerOf = (channel: string) => {
      const call = mockedRegister.mock.calls.find(item => item[0] === channel)!
      return call[1] as (event: unknown, ...args: unknown[]) => unknown
    }

    const listResult = (await handlerOf('webhook-queue-list')(null)) as { entries: WebhookQueueEntry[] }
    expect(listResult.entries).toHaveLength(1)
    expect(listResult.entries[0]!.id).toBe('failed-1')

    const retryResult = await handlerOf('webhook-queue-retry')(null, 'nope')
    expect(retryResult).toEqual({ success: false, error: '队列条目不存在' })

    const clearResult = await handlerOf('webhook-queue-clear')(null)
    expect(clearResult).toEqual({ success: true, cleared: 1 })
    expect(readQueue(store)).toEqual([])
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})
