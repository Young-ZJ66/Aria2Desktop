import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { requestMock } = vi.hoisted(() => ({
  // 假 request 的签名与测试里两处 mockImplementationOnce 完全一致，避免严格函数方差检查报错
  requestMock: vi.fn((_requestOptions: unknown, _callback: (res: unknown) => void): EventEmitter & { setTimeout: () => void; end: () => void; destroy: (err?: Error) => void } => {
    throw new Error('no network in test')
  })
}))

// 服务同时支持 http/https 两个传输（RSS 允许明文源），两个模块都要换成同一个假 request
vi.mock('https', () => ({ request: requestMock }))
vi.mock('http', () => ({ request: requestMock }))
vi.mock('../utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
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

type StoreLike = {
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

function baseSub(overrides: Partial<RssSubscription> = {}): RssSubscription {
  return { id: 'sub-1', name: '测试订阅', url: 'https://example.com/feed', enabled: true, ...overrides }
}

type RssItem = {
  title: string
  link?: string
  guid?: string
  enclosureUrl?: string
  enclosureType?: string
}

function rssXml(items: RssItem[]): string {
  const parts = ['<?xml version="1.0"?><rss version="2.0"><channel><title>Test Feed</title>']
  for (const item of items) {
    parts.push('<item><title>' + item.title + '</title>')
    if (item.link !== undefined) parts.push('<link>' + item.link + '</link>')
    if (item.guid !== undefined) parts.push('<guid>' + item.guid + '</guid>')
    if (item.enclosureUrl !== undefined) {
      parts.push('<enclosure url="' + item.enclosureUrl + '" type="' + (item.enclosureType ?? 'application/octet-stream') + '"/>')
    }
    parts.push('</item>')
  }
  parts.push('</channel></rss>')
  return parts.join('')
}

/** 伪造一次 http(s) 响应（同步回调 + 微任务里吐数据），并返回伪造的 req */
function respondWith(body: string | Buffer, options: { status?: number; headers?: Record<string, string> } = {}): void {
  requestMock.mockImplementationOnce((requestOptions: unknown, callback: (res: unknown) => void) => {
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

/** 永不返回响应的 request（用于并发复用测试） */
function stallRequest(): void {
  requestMock.mockImplementationOnce(() => {
    const req = new EventEmitter() as EventEmitter & { setTimeout: () => void; end: () => void; destroy: (err?: Error) => void }
    req.setTimeout = () => {}
    req.end = () => {}
    req.destroy = () => {}
    return req
  })
}

async function flush(times = 12): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve()
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  requestMock.mockReset()
  requestMock.mockImplementation(() => {
    throw new Error('no network in test')
  })
  mockedRpc.mockReset()
  mockedRpc.mockResolvedValue('gid-123')
  mockedSettings.mockReset()
  mockedSettings.mockReturnValue({
    aria2: { host: '127.0.0.1', port: 6801, secret: 'test-secret' }
  } as unknown as ReturnType<typeof getSettingsFresh>)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('RssSubscriptionService fetch 管线', () => {
  it('普通 http(s) 链接 → aria2.addUri，写 added 日志并更新订阅状态', async () => {
    const { service, store } = makeService({ rssSubscriptions: [baseSub()] })
    respondWith(rssXml([{ title: 'A', link: 'https://example.com/a', guid: 'g-a' }]))

    const result = await service.fetchNow('sub-1')

    expect(result.success).toBe(true)
    expect(result.added).toBe(1)
    expect(mockedRpc).toHaveBeenCalledWith(expect.objectContaining({
      host: '127.0.0.1',
      port: 6801,
      secret: 'test-secret',
      method: 'aria2.addUri',
      params: [['https://example.com/a'], {}]
    }))
    const log = store.get('autoImportLog') as AutoImportLogEntry[]
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({
      kind: 'rss', sourceId: 'sub-1', sourceName: '测试订阅', title: 'A', status: 'added', gid: 'gid-123'
    })
    const sub = (store.get('rssSubscriptions') as RssSubscription[])[0]
    expect(sub.lastStatus).toBe('ok')
    expect(sub.lastError).toBeNull()
    expect(sub.lastAddedCount).toBe(1)
    expect(sub.lastFetchAt).toBeTruthy()
    // 命中条目记入已见
    expect(store.get('rssSeenItems')).toEqual({ 'sub-1': ['g-a'] })
  })

  it('magnet: 链接 → aria2.addUri [[magnet]]', async () => {
    const { service } = makeService({ rssSubscriptions: [baseSub()] })
    respondWith(rssXml([{ title: 'M', link: 'magnet:?xt=urn:btih:abc', guid: 'g-m' }]))

    await service.fetchNow('sub-1')

    expect(mockedRpc).toHaveBeenCalledWith(expect.objectContaining({
      method: 'aria2.addUri',
      params: [['magnet:?xt=urn:btih:abc'], {}]
    }))
  })

  it('.torrent 结尾的链接 → 拉二进制 → aria2.addTorrent [base64, [], opts]', async () => {
    const { service } = makeService({ rssSubscriptions: [baseSub()] })
    const bytes = Buffer.from('torrent-bytes')
    respondWith(rssXml([{ title: 'T', link: 'https://example.com/x.torrent', guid: 'g-t' }]))
    respondWith(bytes)

    const result = await service.fetchNow('sub-1')

    expect(result.added).toBe(1)
    expect(mockedRpc).toHaveBeenCalledWith(expect.objectContaining({
      method: 'aria2.addTorrent',
      params: [bytes.toString('base64'), [], {}]
    }))
  })

  it('enclosure 声明 application/x-bittorrent 的任意扩展链接 → addTorrent', async () => {
    const { service } = makeService({ rssSubscriptions: [baseSub()] })
    const bytes = Buffer.from('bin')
    respondWith(rssXml([{ title: 'B', link: '', guid: 'g-b', enclosureUrl: 'https://example.com/x.bin', enclosureType: 'application/x-bittorrent' }]))
    respondWith(bytes)

    await service.fetchNow('sub-1')

    expect(mockedRpc).toHaveBeenCalledWith(expect.objectContaining({
      method: 'aria2.addTorrent',
      params: [bytes.toString('base64'), [], {}]
    }))
  })

  it('订阅配置 dir 时 opts 携带 dir', async () => {
    const { service } = makeService({ rssSubscriptions: [baseSub({ dir: 'D:\\Downloads' })] })
    respondWith(rssXml([{ title: 'A', link: 'https://example.com/a', guid: 'g-a' }]))

    await service.fetchNow('sub-1')

    expect(mockedRpc).toHaveBeenCalledWith(expect.objectContaining({
      method: 'aria2.addUri',
      params: [['https://example.com/a'], { dir: 'D:\\Downloads' }]
    }))
  })

  it('include/exclude 过滤：只处理匹配的标题', async () => {
    const { service } = makeService({
      rssSubscriptions: [baseSub({ includePattern: '1080', excludePattern: '预告' })]
    })
    respondWith(rssXml([
      { title: 'Show 1080p', link: 'https://example.com/1', guid: 'g-1' },
      { title: 'Show 720p', link: 'https://example.com/2', guid: 'g-2' },
      { title: 'Show 1080p 预告', link: 'https://example.com/3', guid: 'g-3' }
    ]))

    const result = await service.fetchNow('sub-1')

    expect(result.added).toBe(1)
    expect(mockedRpc).toHaveBeenCalledTimes(1)
    expect(result.items).toEqual([{ title: 'Show 1080p', link: 'https://example.com/1' }])
  })

  it('maxPerFetch 截断：被截断的条目下轮补上', async () => {
    const { service, store } = makeService({ rssSubscriptions: [baseSub({ maxPerFetch: 2 })] })
    const xml = rssXml([
      { title: 'a', link: 'https://e.com/1', guid: 'g-1' },
      { title: 'b', link: 'https://e.com/2', guid: 'g-2' },
      { title: 'c', link: 'https://e.com/3', guid: 'g-3' }
    ])

    respondWith(xml)
    const first = await service.fetchNow('sub-1')
    expect(first.added).toBe(2)
    expect(store.get('rssSeenItems')).toEqual({ 'sub-1': ['g-1', 'g-2'] })

    respondWith(xml)
    const second = await service.fetchNow('sub-1')
    expect(second.added).toBe(1)
    expect(store.get('rssSeenItems')).toEqual({ 'sub-1': ['g-1', 'g-2', 'g-3'] })
  })

  it('去重：已见条目不重复添加，日志记 skipped', async () => {
    const { service, store } = makeService({ rssSubscriptions: [baseSub()] })
    const xml = rssXml([{ title: 'A', link: 'https://example.com/a', guid: 'g-a' }])

    respondWith(xml)
    await service.fetchNow('sub-1')
    respondWith(xml)
    const second = await service.fetchNow('sub-1')

    expect(second.added).toBe(0)
    expect(mockedRpc).toHaveBeenCalledTimes(1)
    const log = store.get('autoImportLog') as AutoImportLogEntry[]
    expect(log).toHaveLength(2)
    expect(log[0]).toMatchObject({ status: 'skipped', title: 'A' })
    expect(log[1]).toMatchObject({ status: 'added', title: 'A' })
  })

  it('去重键 FIFO 上限 500：最旧的被挤出后可重新添加；日志上限 200', async () => {
    const { service, store } = makeService({ rssSubscriptions: [baseSub({ maxPerFetch: 50 })] })

    // feedParser 单次最多解析 200 条，所以每轮换一批新 guid（11 轮 × 50 = 550 个键 > 500）
    const feedForRound = (round: number) => rssXml(
      Array.from({ length: 50 }, (_, i) => {
        const n = round * 50 + i
        return { title: 't' + n, link: 'https://e.com/' + n, guid: 'g' + n }
      })
    )

    for (let round = 0; round < 11; round++) {
      respondWith(feedForRound(round))
      await service.fetchNow('sub-1')
    }

    const seen = (store.get('rssSeenItems') as Record<string, string[]>)['sub-1']
    expect(seen).toHaveLength(500)
    // g0..g49（第 1 轮）已被挤出
    expect(seen[0]).toBe('g50')
    expect(seen[499]).toBe('g549')
    expect(mockedRpc).toHaveBeenCalledTimes(550)

    // 第 12 轮：重放第 1 轮的 feed —— 被挤出的键重新可见、重新添加
    respondWith(feedForRound(0))
    const again = await service.fetchNow('sub-1')
    expect(again.added).toBe(50)

    // 日志总量 600 条（550 added + 50 re-added）→ 持久层只留最新 200 条
    const log = store.get('autoImportLog') as AutoImportLogEntry[]
    expect(log).toHaveLength(200)
    expect(log[0]).toMatchObject({ status: 'added', title: 't49' })
  })

  it('fetch-now 返回的条目预览最多 20 条', async () => {
    const { service } = makeService({ rssSubscriptions: [baseSub()] })
    const items = Array.from({ length: 25 }, (_, i) => ({ title: 't' + i, link: 'https://e.com/' + i, guid: 'g' + i }))
    respondWith(rssXml(items))

    const result = await service.fetchNow('sub-1')

    expect(result.items).toHaveLength(20)
    expect(result.items![0]).toEqual({ title: 't0', link: 'https://e.com/0' })
    // 默认 maxPerFetch 5：预览与实际添加数是两回事
    expect(result.added).toBe(5)
  })

  it('RPC 失败：单条记 error 日志，其余条目继续，订阅整体仍算成功', async () => {
    mockedRpc.mockRejectedValueOnce(new Error('Aria2 RPC Error: boom'))
    const { service, store } = makeService({ rssSubscriptions: [baseSub()] })
    respondWith(rssXml([
      { title: 'bad', link: 'https://e.com/1', guid: 'g-1' },
      { title: 'good', link: 'https://e.com/2', guid: 'g-2' }
    ]))

    const result = await service.fetchNow('sub-1')

    expect(result.success).toBe(true)
    expect(result.added).toBe(1)
    const log = store.get('autoImportLog') as AutoImportLogEntry[]
    expect(log).toHaveLength(2)
    expect(log[0]).toMatchObject({ status: 'added', title: 'good' })
    expect(log[1]).toMatchObject({ status: 'error', title: 'bad' })
    expect(log[1].message).toContain('boom')
    const sub = (store.get('rssSubscriptions') as RssSubscription[])[0]
    expect(sub.lastStatus).toBe('ok')
    expect(sub.lastAddedCount).toBe(1)
  })

  it('feed 拉取失败：返回失败并写订阅状态，不写条目日志', async () => {
    const { service, store } = makeService({ rssSubscriptions: [baseSub()] })
    respondWith('x', { status: 500 })

    const result = await service.fetchNow('sub-1')

    expect(result.success).toBe(false)
    expect(result.added).toBe(0)
    expect(result.error).toBe('Fetch failed: 500')
    const sub = (store.get('rssSubscriptions') as RssSubscription[])[0]
    expect(sub.lastStatus).toBe('error')
    expect(sub.lastError).toBe('Fetch failed: 500')
    expect(sub.lastFetchAt).toBeTruthy()
    expect(store.get('autoImportLog')).toBeUndefined()
  })

  it('响应超过 5MB → 拒绝', async () => {
    const { service } = makeService({ rssSubscriptions: [baseSub()] })
    respondWith(Buffer.alloc(6 * 1024 * 1024, 1))

    const result = await service.fetchNow('sub-1')

    expect(result.success).toBe(false)
    expect(result.error).toBe('Response too large')
  })

  it('重定向跟随且最终成功', async () => {
    const { service } = makeService({ rssSubscriptions: [baseSub()] })
    respondWith('', { status: 302, headers: { location: 'https://example.com/real-feed' } })
    respondWith(rssXml([{ title: 'R', link: 'https://example.com/r', guid: 'g-r' }]))

    const result = await service.fetchNow('sub-1')

    expect(result.success).toBe(true)
    expect(result.added).toBe(1)
  })

  it('重定向超过 3 次 → Too many redirects', async () => {
    const { service } = makeService({ rssSubscriptions: [baseSub()] })
    for (let i = 0; i < 4; i++) {
      respondWith('', { status: 302, headers: { location: 'https://example.com/loop' } })
    }

    const result = await service.fetchNow('sub-1')

    expect(result.success).toBe(false)
    expect(result.error).toBe('Too many redirects')
  })

  it('重定向到非 http(s) 协议 → 拒绝', async () => {
    const { service } = makeService({ rssSubscriptions: [baseSub()] })
    respondWith('', { status: 302, headers: { location: 'file:///etc/passwd' } })

    const result = await service.fetchNow('sub-1')

    expect(result.success).toBe(false)
    expect(result.error).toContain('http(s)')
  })

  it('订阅不存在 → 失败返回', async () => {
    const { service } = makeService({ rssSubscriptions: [] })
    const result = await service.fetchNow('nope')
    expect(result).toEqual({ success: false, added: 0, error: '订阅不存在' })
  })

  it('并发 fetch-now 共享同一个 Promise', async () => {
    const { service } = makeService({ rssSubscriptions: [baseSub()] })
    stallRequest()
    const first = service.fetchNow('sub-1')
    const second = service.fetchNow('sub-1')
    expect(second).toBe(first)
    first.catch(() => {})
  })
})

describe('RssSubscriptionService 定时器', () => {
  it('disabled 订阅不会被 ticker 拉取（手动 fetch-now 仍可用）', async () => {
    const { service } = makeService({ rssSubscriptions: [baseSub({ enabled: false })] })
    service.initialize()
    await flush()
    vi.advanceTimersByTime(180_000)
    await flush()
    expect(requestMock).not.toHaveBeenCalled()

    respondWith(rssXml([{ title: 'A', link: 'https://example.com/a', guid: 'g-a' }]))
    const result = await service.fetchNow('sub-1')
    expect(result.added).toBe(1)
  })

  it('initialize 首跳补拉到期订阅', async () => {
    // 默认 intervalMinutes 是 30：必须超过 30 分钟未拉取才算到期
    const fortyMinAgo = new Date(Date.now() - 40 * 60_000).toISOString()
    const { service } = makeService({ rssSubscriptions: [baseSub({ lastFetchAt: fortyMinAgo })] })
    respondWith(rssXml([{ title: 'A', link: 'https://example.com/a', guid: 'g-a' }]))

    service.initialize()
    await flush()

    expect(mockedRpc).toHaveBeenCalledTimes(1)
    service.shutdown()
  })

  it('未到期的订阅不被拉取；intervalMinutes 到点后拉取', async () => {
    const nowIso = new Date().toISOString()
    const { service, store } = makeService({ rssSubscriptions: [baseSub({ intervalMinutes: 5, lastFetchAt: nowIso })] })

    service.initialize()
    await flush()
    vi.advanceTimersByTime(60_000)
    await flush()
    // 距上次拉取 1 分钟 < 5 分钟：不动
    expect(requestMock).not.toHaveBeenCalled()

    // 把时钟推到 5 分钟后（fake timers 同步推进 Date）
    vi.advanceTimersByTime(4 * 60_000)
    await flush()
    // ticker 还没到下一跳（60s 步长，4 分钟整必然跨过），但补一跳确认
    vi.advanceTimersByTime(60_000)
    await flush()
    expect(requestMock).toHaveBeenCalled()
    service.shutdown()
    expect(store.dump()).toBeTruthy()
  })

  it('shutdown 后 ticker 停止', async () => {
    const nowIso = new Date().toISOString()
    const { service } = makeService({ rssSubscriptions: [baseSub({ intervalMinutes: 5, lastFetchAt: nowIso })] })
    service.initialize()
    service.shutdown()
    vi.advanceTimersByTime(600_000)
    await flush()
    expect(requestMock).not.toHaveBeenCalled()
  })
})

describe('RssSubscriptionService IPC', () => {
  // IPC 处理器在测试里都当同步/可 await 的宽松函数用：返回对象必含 success，其余字段自行断言
  type Handler = (event: unknown, payload: unknown) => { success: boolean } & Record<string, unknown>

  function getHandler(channel: string): Handler {
    const call = mockedRegister.mock.calls.find(entry => entry[0] === channel)
    if (!call) throw new Error('handler not registered: ' + channel)
    return call[1] as Handler
  }

  beforeEach(() => {
    mockedRegister.mockClear()
  })

  it('rss-subs-list 返回订阅列表', () => {
    const { service, store } = makeService({ rssSubscriptions: [baseSub()] })
    service.registerIpcHandlers()
    const result = getHandler('rss-subs-list')(undefined, undefined)
    expect(result).toEqual({ subscriptions: [baseSub()] })
    expect(store.dump()).toBeTruthy()
  })

  it('rss-subs-save：无 id 生成 UUID，数值钳制，运行时字段保留', () => {
    const { service, store } = makeService({ rssSubscriptions: [baseSub({ lastFetchAt: '2026-01-01T00:00:00.000Z', lastStatus: 'ok' })] })
    service.registerIpcHandlers()
    const save = getHandler('rss-subs-save')

    const created = save(undefined, baseSub({ id: '', intervalMinutes: 1, maxPerFetch: 99 })) as { success: boolean; subscription: RssSubscription }
    expect(created.success).toBe(true)
    expect(created.subscription.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(created.subscription.intervalMinutes).toBe(5)
    expect(created.subscription.maxPerFetch).toBe(50)

    // 更新已有订阅（同 id upsert）：没带 last* 字段时保留历史状态
    const updated = save(undefined, baseSub({ name: '改名', intervalMinutes: 99999, maxPerFetch: 0 })) as { success: boolean; subscription: RssSubscription }
    expect(updated.success).toBe(true)
    expect(updated.subscription.name).toBe('改名')
    expect(updated.subscription.intervalMinutes).toBe(10080)
    expect(updated.subscription.maxPerFetch).toBe(1)
    expect(updated.subscription.lastFetchAt).toBe('2026-01-01T00:00:00.000Z')
    expect(updated.subscription.lastStatus).toBe('ok')
    // 第一次 save 是空 id → 新建一条；第二次 save 是 upsert 'sub-1'
    const stored = store.get('rssSubscriptions') as RssSubscription[]
    expect(stored).toHaveLength(2)
    expect(stored.find(sub => sub.id === 'sub-1')).toMatchObject({ name: '改名', lastStatus: 'ok' })
  })

  it('rss-subs-save：非法输入被拒绝', () => {
    const { service } = makeService()
    service.registerIpcHandlers()
    const save = getHandler('rss-subs-save')

    expect(save(undefined, baseSub({ name: '' })).error).toContain('名称')
    expect(save(undefined, baseSub({ name: 'x'.repeat(101) })).success).toBe(false)
    expect(save(undefined, baseSub({ url: 'ftp://example.com/feed' })).error).toContain('http')
    expect(save(undefined, baseSub({ includePattern: '[' })).success).toBe(false)
    expect(save(undefined, baseSub({ excludePattern: '(unclosed' })).success).toBe(false)
    expect(save(undefined, baseSub({ dir: 'relative/path' })).error).toContain('绝对路径')
  })

  it('rss-subs-delete：删除订阅并清理已见键', () => {
    const { service, store } = makeService({
      rssSubscriptions: [baseSub()],
      rssSeenItems: { 'sub-1': ['g-1'], 'other': ['g-2'] }
    })
    service.registerIpcHandlers()

    const result = getHandler('rss-subs-delete')(undefined, 'sub-1')
    expect(result).toEqual({ success: true })
    expect(store.get('rssSubscriptions')).toEqual([])
    expect(store.get('rssSeenItems')).toEqual({ other: ['g-2'] })
  })

  it('auto-import-log-list 返回日志（新→旧）', () => {
    const entries: AutoImportLogEntry[] = [
      { id: 'e1', kind: 'rss', sourceId: 'sub-1', sourceName: 'n', title: 'old', status: 'added', importedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'e2', kind: 'rss', sourceId: 'sub-1', sourceName: 'n', title: 'new', status: 'added', importedAt: '2026-01-02T00:00:00.000Z' }
    ]
    const { service } = makeService({ autoImportLog: entries })
    service.registerIpcHandlers()
    const result = getHandler('auto-import-log-list')(undefined, undefined)
    expect(result.entries).toBe(entries)
  })
})
