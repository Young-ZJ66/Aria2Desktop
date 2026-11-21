/**
 * RSS 订阅的边界与兜底（补充 rssSubscriptionService.test.ts 的正常管线）。
 *
 * 关注点：ticker 单订阅失败不能拖垮整轮、订阅在拉取途中被删掉时状态写回要放弃、
 * 直接注入 store 的脏订阅（非法正则 / 非 http 源 / 无链接条目）要能降级而不是崩。
 */
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const holder = vi.hoisted(() => ({
  requestMock: vi.fn((_options: unknown, _callback: (res: unknown) => void): EventEmitter => {
    throw new Error('no network in test')
  }),
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn()
}))

vi.mock('https', () => ({ request: holder.requestMock }))
vi.mock('http', () => ({ request: holder.requestMock }))
vi.mock('../utils/logger', () => ({
  createLogger: () => ({ info: holder.info, warn: holder.warn, error: holder.error, debug: vi.fn() })
}))
vi.mock('../utils/ipcSecurity', () => ({ registerSecureHandler: vi.fn() }))
vi.mock('../utils/aria2Rpc', () => ({ callAria2Rpc: vi.fn() }))
vi.mock('../utils/settingsAccessor', () => ({ getSettingsFresh: vi.fn() }))

import { RssSubscriptionService } from './rssSubscriptionService'
import { callAria2Rpc } from '../utils/aria2Rpc'
import { registerSecureHandler } from '../utils/ipcSecurity'
import { getSettingsFresh } from '../utils/settingsAccessor'
import type { AutoImportLogEntry, RssSubscription } from '../../src/shared/autoImport'

const mockedRpc = vi.mocked(callAria2Rpc)
const mockedRegister = vi.mocked(registerSecureHandler)
const mockedSettings = vi.mocked(getSettingsFresh)

interface StoreLike {
  get: (key: string) => unknown
  set: (key: string, value: unknown) => void
  dump: () => Record<string, unknown>
}

function makeStore(initial: Record<string, unknown> = {}): StoreLike {
  const data: Record<string, unknown> = { ...initial }
  return {
    get: key => data[key],
    set: (key, value) => { data[key] = value },
    dump: () => data
  }
}

function makeService(initial: Record<string, unknown> = {}) {
  const store = makeStore(initial)
  const service = new RssSubscriptionService(store as never, { getMainWindow: () => null } as never)
  return { service, store }
}

function baseSub(overrides: Record<string, unknown> = {}): RssSubscription {
  return { id: 'sub-1', name: '测试订阅', url: 'https://example.com/feed', enabled: true, ...overrides } as RssSubscription
}

function rssXml(items: Array<{ title: string; link?: string; guid?: string; enclosureUrl?: string }>): string {
  const parts = ['<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title>']
  for (const item of items) {
    parts.push('<item><title>' + item.title + '</title>')
    if (item.link !== undefined) parts.push('<link>' + item.link + '</link>')
    if (item.guid !== undefined) parts.push('<guid>' + item.guid + '</guid>')
    if (item.enclosureUrl !== undefined) parts.push('<enclosure url="' + item.enclosureUrl + '" type="application/octet-stream"/>')
    parts.push('</item>')
  }
  parts.push('</channel></rss>')
  return parts.join('')
}

function respondWith(body: string | Buffer, options: { status?: number; headers?: Record<string, string> } = {}): void {
  holder.requestMock.mockImplementationOnce((_options: unknown, callback: (res: unknown) => void) => {
    const res = new EventEmitter() as EventEmitter & { statusCode?: number; headers: Record<string, string>; resume: () => void; destroy: () => void }
    res.statusCode = options.status ?? 200
    res.headers = options.headers ?? {}
    res.resume = () => {}
    res.destroy = () => {}
    callback(res)
    queueMicrotask(() => {
      res.emit('data', Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf-8'))
      res.emit('end')
    })
    const req = new EventEmitter() as EventEmitter & { setTimeout: () => void; end: () => void; destroy: (err?: Error) => void }
    req.setTimeout = () => {}
    req.end = () => {}
    req.destroy = (err?: Error) => { queueMicrotask(() => req.emit('error', err ?? new Error('destroyed'))) }
    return req
  })
}

/** 只发出请求、永不回包的响应：用来验证超时回调确实被挂上并生效 */
function respondWithTimeout(): () => void {
  let timeoutHandler: (() => void) | null = null
  holder.requestMock.mockImplementationOnce((_options: unknown, callback: (res: unknown) => void) => {
    const res = new EventEmitter() as EventEmitter & { statusCode?: number; headers: Record<string, string>; resume: () => void; destroy: () => void }
    res.statusCode = 200
    res.headers = {}
    res.resume = () => {}
    res.destroy = () => {}
    callback(res)
    const req = new EventEmitter() as EventEmitter & { setTimeout: (ms: number, cb: () => void) => void; end: () => void; destroy: (err?: Error) => void }
    req.setTimeout = (_ms: number, cb: () => void) => { timeoutHandler = cb }
    req.end = () => {}
    req.destroy = (err?: Error) => { queueMicrotask(() => req.emit('error', err ?? new Error('destroyed'))) }
    return req
  })
  return () => { timeoutHandler?.() }
}

async function flush(times = 12): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
  holder.requestMock.mockReset()
  holder.requestMock.mockImplementation(() => { throw new Error('no network in test') })
  holder.warn.mockReset()
  mockedRpc.mockReset()
  mockedRpc.mockResolvedValue('gid-123')
  mockedRegister.mockReset()
  mockedSettings.mockReset()
  mockedSettings.mockReturnValue({ aria2: { host: '127.0.0.1', port: 6801, secret: 's' } } as never)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('RSS 订阅的脏数据与降级', () => {
  it('非法正则的过滤条件按「无此过滤」处理，条目照常添加', async () => {
    const { service } = makeService({ rssSubscriptions: [baseSub({ includePattern: '[' })] })
    respondWith(rssXml([{ title: 'A', link: 'https://example.com/a', guid: 'g-a' }]))

    const result = await service.fetchNow('sub-1')

    expect(result.added).toBe(1)
    expect(mockedRpc).toHaveBeenCalledTimes(1)
  })

  it('订阅源不是 http(s) 时按不支持的协议失败，不发出请求', async () => {
    const { service, store } = makeService({ rssSubscriptions: [baseSub({ url: 'ftp://example.com/feed' })] })

    const result = await service.fetchNow('sub-1')

    expect(result.success).toBe(false)
    expect(result.error).toContain('ftp://example.com/feed')
    expect(holder.requestMock).not.toHaveBeenCalled()
    const sub = (store.get('rssSubscriptions') as RssSubscription[])[0]
    expect(sub.lastStatus).toBe('error')
  })

  it('条目没有任何链接时记 error 日志，其它条目继续', async () => {
    const { service, store } = makeService({ rssSubscriptions: [baseSub()] })
    respondWith(rssXml([
      { title: '无链接', guid: 'g-none' },
      { title: '正常', link: 'https://example.com/a', guid: 'g-a' }
    ]))

    const result = await service.fetchNow('sub-1')

    expect(result.success).toBe(true)
    expect(result.added).toBe(1)
    const log = store.get('autoImportLog') as AutoImportLogEntry[]
    expect(log.find(entry => entry.title === '无链接')).toMatchObject({ status: 'error' })
    expect(holder.warn).toHaveBeenCalledWith('[RssSubscription] 添加失败:', '测试订阅', '无链接', expect.any(String))
  })

  it('全部条目都被过滤掉时不写日志', async () => {
    const { service, store } = makeService({ rssSubscriptions: [baseSub({ includePattern: '不存在的标题' })] })
    respondWith(rssXml([{ title: 'A', link: 'https://example.com/a', guid: 'g-a' }]))

    const result = await service.fetchNow('sub-1')

    expect(result.added).toBe(0)
    expect(result.items).toEqual([])
    expect(store.get('autoImportLog')).toBeUndefined()
  })

  it('拉取途中订阅被删掉时不再写回状态', async () => {
    const { service, store } = makeService({ rssSubscriptions: [baseSub()] })
    service.registerIpcHandlers()
    respondWith(rssXml([{ title: 'A', link: 'https://example.com/a', guid: 'g-a' }]))

    const pending = service.fetchNow('sub-1')
    const deleteCall = mockedRegister.mock.calls.find(entry => entry[0] === 'rss-subs-delete')!
    const deleteHandler = deleteCall[1] as (event: unknown, id: string) => unknown
    deleteHandler(undefined, 'sub-1')
    const result = await pending

    expect(result.success).toBe(true)
    expect(store.get('rssSubscriptions')).toEqual([])
  })
})

describe('RSS ticker 的容错', () => {
  it('lastFetchAt 损坏时视为到期，立即补拉', async () => {
    const { service } = makeService({ rssSubscriptions: [baseSub({ lastFetchAt: 'not-a-date' })] })
    respondWith(rssXml([{ title: 'A', link: 'https://example.com/a', guid: 'g-a' }]))

    service.initialize()
    await flush()

    expect(holder.requestMock).toHaveBeenCalledTimes(1)
    service.shutdown()
  })

  it('重复 initialize 只保留一个 ticker', async () => {
    const { service } = makeService({ rssSubscriptions: [baseSub({ enabled: false })] })
    service.initialize()
    service.initialize()
    vi.advanceTimersByTime(180_000)
    await flush()
    expect(holder.requestMock).not.toHaveBeenCalled()
    service.shutdown()
  })

  it('单订阅拉取自身抛错时只记日志，不让 ticker 崩掉', async () => {
    const store = makeStore({ rssSubscriptions: [baseSub()] })
    const originalGet = store.get
    store.get = key => {
      if (key === 'rssSeenItems') throw new Error('store unavailable')
      return originalGet(key)
    }
    const service = new RssSubscriptionService(store as never, { getMainWindow: () => null } as never)
    respondWith(rssXml([{ title: 'A', link: 'https://example.com/a', guid: 'g-a' }]))

    service.initialize()
    await flush()

    expect(holder.warn).toHaveBeenCalledWith('[RssSubscription] 自动拉取异常:', '测试订阅', expect.any(Error))
    service.shutdown()
  })
})

describe('RSS IPC 的窗口取值器与参数校验', () => {
  it('每个通道的 options 都带 getMainWindow，且取的是 controller 的当前窗口', () => {
    const getMainWindow = vi.fn(() => null)
    const store = makeStore({ rssSubscriptions: [baseSub()] })
    const service = new RssSubscriptionService(store as never, { getMainWindow } as never)
    service.registerIpcHandlers()

    const channels = mockedRegister.mock.calls.map(entry => entry[0])
    expect(channels).toEqual(['rss-subs-list', 'rss-subs-save', 'rss-subs-delete', 'rss-subs-fetch-now', 'auto-import-log-list'])
    for (const call of mockedRegister.mock.calls) {
      const options = call[2] as { getMainWindow: () => unknown }
      expect(typeof options.getMainWindow).toBe('function')
      expect(options.getMainWindow()).toBeNull()
    }
    expect(getMainWindow).toHaveBeenCalledTimes(mockedRegister.mock.calls.length)
  })

  it('rss-subs-save 拒绝非对象与非法过滤类型', () => {
    const { service } = makeService()
    service.registerIpcHandlers()
    const save = mockedRegister.mock.calls.find(entry => entry[0] === 'rss-subs-save')![1] as (event: unknown, sub: unknown) => { success: boolean; error?: string }

    expect(save(undefined, null).success).toBe(false)
    expect(save(undefined, 42).success).toBe(false)
    expect(save(undefined, baseSub({ includePattern: 42 })).error).toContain('过滤')
    expect(save(undefined, baseSub({ excludePattern: 42 })).success).toBe(false)
  })

  it('rss-subs-fetch-now 通道直接返回拉取结果', async () => {
    const { service } = makeService({ rssSubscriptions: [baseSub()] })
    service.registerIpcHandlers()
    respondWith(rssXml([{ title: 'A', link: 'https://example.com/a', guid: 'g-a' }]))
    const handler = mockedRegister.mock.calls.find(entry => entry[0] === 'rss-subs-fetch-now')![1] as (event: unknown, id: string) => Promise<{ success: boolean; added: number }>

    const result = await handler(undefined, 'sub-1')

    expect(result.success).toBe(true)
    expect(result.added).toBe(1)
  })

  it('订阅源拉取超时后按失败处理并写回错误状态', async () => {
    const { service, store } = makeService({ rssSubscriptions: [baseSub()] })
    const fireTimeout = respondWithTimeout()

    const pending = service.fetchNow('sub-1')
    await flush()
    fireTimeout()
    await flush()

    const result = await pending
    expect(result.success).toBe(false)
    expect(result.error).toContain('Fetch timed out')
    expect(holder.requestMock).toHaveBeenCalledTimes(1)
    const sub = (store.get('rssSubscriptions') as RssSubscription[])[0]
    expect(sub.lastStatus).toBe('error')
  })
})
