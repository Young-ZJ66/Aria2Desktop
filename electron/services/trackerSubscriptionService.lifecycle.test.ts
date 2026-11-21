import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
}))
vi.mock('../utils/ipcSecurity', () => ({ registerSecureHandler: vi.fn() }))

type Entry =
  | { kind: 'body'; text: string }
  | { kind: 'status'; statusCode: number }
  | { kind: 'redirect'; statusCode: number; location: string }
  | { kind: 'error'; error: Error }
  | { kind: 'timeout' }
  | { kind: 'gate' }

const { h } = vi.hoisted(() => ({
  h: {
    plan: [] as Entry[],
    calls: [] as { hostname?: string; path?: string }[],
    gates: [] as (() => void)[],
    send: vi.fn(),
    windowAlive: true
  }
}))

vi.mock('https', async () => {
  const { EventEmitter } = await import('node:events')
  type Emitter = InstanceType<typeof EventEmitter>

  const makeResponse = (statusCode: number, headers: Record<string, string>, body: string): Emitter => {
    const res = new EventEmitter() as Emitter & { statusCode: number; headers: Record<string, string>; resume: () => void }
    res.statusCode = statusCode
    res.headers = headers
    res.resume = () => {}
    queueMicrotask(() => {
      if (body) res.emit('data', Buffer.from(body, 'utf-8'))
      res.emit('end')
    })
    return res
  }

  return {
    request: (options: { hostname?: string; path?: string }, callback: (res: unknown) => void) => {
      h.calls.push(options)
      const entry = h.plan.shift()
      const req = new EventEmitter() as Emitter & {
        destroyed: boolean
        timeoutCb: (() => void) | null
        setTimeout: (ms: number, cb: () => void) => unknown
        destroy: (error?: Error) => unknown
        end: () => void
      }
      req.destroyed = false
      req.timeoutCb = null
      req.setTimeout = (_ms: number, cb: () => void) => {
        req.timeoutCb = cb
        return req
      }
      req.destroy = (error?: Error) => {
        req.destroyed = true
        if (error) queueMicrotask(() => req.emit('error', error))
        return req
      }
      req.end = () => {
        if (!entry) {
          queueMicrotask(() => req.emit('error', new Error('no plan entry')))
          return
        }
        if (entry.kind === 'body') {
          queueMicrotask(() => callback(makeResponse(200, {}, entry.text)))
          return
        }
        if (entry.kind === 'status') {
          queueMicrotask(() => callback(makeResponse(entry.statusCode, {}, '')))
          return
        }
        if (entry.kind === 'redirect') {
          queueMicrotask(() => callback(makeResponse(entry.statusCode, { location: entry.location }, '')))
          return
        }
        if (entry.kind === 'error') {
          queueMicrotask(() => req.emit('error', entry.error))
          return
        }
        if (entry.kind === 'timeout') {
          queueMicrotask(() => req.timeoutCb?.())
          return
        }
        h.gates.push(() => callback(makeResponse(200, {}, 'udp://gated.example:1337/announce')))
      }
      return req
    }
  }
})

import { TrackerSubscriptionService } from './trackerSubscriptionService'

type State = Record<string, unknown>

function makeStore(initial: State = {}) {
  const data: State = { ...initial }
  return {
    get: (key: string) => data[key],
    set: (key: string, value: unknown) => {
      data[key] = value
    },
    dump: () => data
  }
}

function makeService(state: State = {}, applyResult: { success: boolean; error?: string } = { success: true }) {
  const store = makeStore(state)
  const applyTrackerList = vi.fn(() => applyResult)
  const service = new TrackerSubscriptionService(
    store as never,
    { applyTrackerList } as never,
    {
      getMainWindow: () =>
        h.windowAlive
          ? { isDestroyed: () => false, webContents: { send: h.send } }
          : null
    } as never
  )
  return { service, store, applyTrackerList }
}

/** 让 microtask 队列跑完（update() 是 async，内部 await fetch） */
const flush = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve()
}

const SOURCE = 'https://example.com/best.txt'
const SOURCE_B = 'https://mirror.example.com/best.txt'

beforeEach(() => {
  vi.useFakeTimers()
  h.plan = []
  h.calls = []
  h.gates = []
  h.send.mockClear()
  h.windowAlive = true
})

afterEach(() => {
  vi.useRealTimers()
})

describe('TrackerSubscriptionService 拉取与重定向', () => {
  it('跟随 302 重定向到新主机，并把相对地址解析成绝对地址', async () => {
    h.plan = [
      { kind: 'redirect', statusCode: 302, location: '/moved/best.txt' },
      { kind: 'body', text: 'udp://a.example:1337/announce\n' }
    ]
    const { service } = makeService({ trackerSubscription: { autoUpdate: false } })

    const result = await service.update(true, [SOURCE])

    expect(result.success).toBe(true)
    expect(h.calls).toHaveLength(2)
    expect(h.calls[1]).toMatchObject({ hostname: 'example.com', path: '/moved/best.txt' })
    expect(result.csv).toBe('udp://a.example:1337/announce')
  })

  it('重定向超过 3 次即放弃，不再继续请求', async () => {
    h.plan = [
      { kind: 'redirect', statusCode: 301, location: '/1' },
      { kind: 'redirect', statusCode: 301, location: '/2' },
      { kind: 'redirect', statusCode: 301, location: '/3' },
      { kind: 'redirect', statusCode: 301, location: '/4' }
    ]
    const { service } = makeService({ trackerSubscription: { autoUpdate: false } })

    const result = await service.update(true, [SOURCE])

    expect(result.success).toBe(false)
    expect(result.error).toContain('Too many redirects')
    // 第 4 次重定向不再发起新请求（共 4 次请求：原始 + 3 次跟随）
    expect(h.calls).toHaveLength(4)
  })

  it('HTTP 500 按失败处理，不会把错误页当 tracker 列表写入配置', async () => {
    h.plan = [{ kind: 'status', statusCode: 500 }]
    const { service, applyTrackerList } = makeService({ trackerSubscription: { autoUpdate: false } })

    const result = await service.update(true, [SOURCE])

    expect(result.success).toBe(false)
    expect(result.error).toContain('Fetch failed: 500')
    expect(applyTrackerList).not.toHaveBeenCalled()
  })

  it('请求超时被转成失败结果，而不是挂住整个更新', async () => {
    h.plan = [{ kind: 'timeout' }]
    const { service } = makeService({ trackerSubscription: { autoUpdate: false } })

    const result = await service.update(true, [SOURCE])

    expect(result.success).toBe(false)
    expect(result.error).toContain('Fetch timed out')
  })
})

describe('TrackerSubscriptionService 聚合与应用', () => {
  it('多个订阅源合并去重后一次性写入 aria2', async () => {
    h.plan = [
      { kind: 'body', text: 'udp://a.example:1337/announce\nudp://shared.example:1337/announce' },
      { kind: 'body', text: 'udp://shared.example:1337/announce\nudp://b.example:1337/announce' }
    ]
    const { service, applyTrackerList } = makeService({ trackerSubscription: { autoUpdate: false } })

    const result = await service.update(true, [SOURCE, SOURCE_B])

    expect(result.success).toBe(true)
    expect(result.count).toBe(3)
    expect(result.csv).toBe('udp://a.example:1337/announce,udp://shared.example:1337/announce,udp://b.example:1337/announce')
    expect(applyTrackerList).toHaveBeenCalledWith(result.csv)
  })

  it('单个源失败不影响其余源，成功结果照常写入', async () => {
    h.plan = [
      { kind: 'error', error: new Error('ECONNRESET') },
      { kind: 'body', text: 'udp://b.example:1337/announce' }
    ]
    const { service, applyTrackerList } = makeService({ trackerSubscription: { autoUpdate: false } })

    const result = await service.update(true, [SOURCE, SOURCE_B])

    expect(result.success).toBe(true)
    expect(result.count).toBe(1)
    expect(applyTrackerList).toHaveBeenCalledTimes(1)
  })

  it('所有源都失败时返回最后一个错误，且不写配置', async () => {
    h.plan = [
      { kind: 'error', error: new Error('first down') },
      { kind: 'error', error: new Error('second down') }
    ]
    const { service, applyTrackerList } = makeService({ trackerSubscription: { autoUpdate: false } })

    const result = await service.update(true, [SOURCE, SOURCE_B])

    expect(result.success).toBe(false)
    expect(result.error).toBe('second down')
    expect(applyTrackerList).not.toHaveBeenCalled()
  })

  it('源里没有合法 tracker 时回落到「所有订阅源均不可用」', async () => {
    h.plan = [{ kind: 'body', text: 'not-a-tracker\n\n' }]
    const { service, applyTrackerList } = makeService({ trackerSubscription: { autoUpdate: false } })

    const result = await service.update(true, [SOURCE])

    expect(result.success).toBe(false)
    expect(result.error).toContain('所有订阅源均不可用')
    expect(applyTrackerList).not.toHaveBeenCalled()
  })

  it('写入 aria2 失败时把失败原因带回渲染层', async () => {
    h.plan = [{ kind: 'body', text: 'udp://a.example:1337/announce' }]
    const { service, store } = makeService(
      { trackerSubscription: { autoUpdate: false, lastCount: 0 } },
      { success: false, error: 'RPC timeout' }
    )

    const result = await service.update(true, [SOURCE])

    expect(result.success).toBe(false)
    expect(result.error).toBe('RPC timeout')
    // 失败时不能把 lastUpdate 往前推，否则下次启动会以为刚更新过
    expect((store.dump().trackerSubscription as { lastCount: number }).lastCount).toBe(0)
    expect(h.send).toHaveBeenCalledWith('tracker:updated', expect.objectContaining({ success: false }))
  })

  it('成功时把更新时间、来源与条数写回状态', async () => {
    h.plan = [{ kind: 'body', text: 'udp://a.example:1337/announce' }]
    const { service, store } = makeService({ trackerSubscription: { autoUpdate: false } })

    const result = await service.update(true, [SOURCE])

    const saved = store.dump().trackerSubscription as {
      lastUpdate: string
      lastSource: string
      lastCount: number
    }
    expect(saved.lastSource).toBe(SOURCE)
    expect(saved.lastCount).toBe(1)
    expect(typeof saved.lastUpdate).toBe('string')
    expect(result.lastUpdate).toBe(saved.lastUpdate)
  })

  it('并发触发共享同一次拉取，不会重复请求', async () => {
    h.plan = [{ kind: 'gate' }]
    const { service } = makeService({ trackerSubscription: { autoUpdate: false } })

    const first = service.update(true, [SOURCE])
    const second = service.update(true, [SOURCE])
    await flush()
    // update() 是 async 函数，两次调用的返回值不是同一个 Promise 对象，
    // 真正要保证的是"只发起一次网络请求、两边拿到同一份结果"
    expect(h.calls).toHaveLength(1)

    h.gates[0]()
    const [a, b] = await Promise.all([first, second])

    expect(a).toEqual(b)
    expect(h.calls).toHaveLength(1)
  })

  it('窗口已销毁时不推送渲染层通知', async () => {
    h.windowAlive = false
    h.plan = [{ kind: 'body', text: 'udp://a.example:1337/announce' }]
    const { service } = makeService({ trackerSubscription: { autoUpdate: false } })

    await service.update(true, [SOURCE])

    expect(h.send).not.toHaveBeenCalled()
  })
})

describe('TrackerSubscriptionService 定时与状态', () => {
  it('上次更新超期时启动后立即补拉', async () => {
    h.plan = [{ kind: 'body', text: 'udp://a.example:1337/announce' }]
    const { service } = makeService({
      trackerSubscription: {
        autoUpdate: true,
        lastUpdate: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
        customSources: [SOURCE],
        syncIntervalHours: 24
      }
    })

    service.initialize()
    await flush()

    expect(h.calls).toHaveLength(1)
    service.shutdown()
  })

  it('上次更新还在间隔内时启动不补拉，但仍安排下一次', async () => {
    h.plan = [{ kind: 'body', text: 'udp://a.example:1337/announce' }]
    const { service } = makeService({
      trackerSubscription: {
        autoUpdate: true,
        lastUpdate: new Date().toISOString(),
        customSources: [SOURCE],
        syncIntervalHours: 24
      }
    })

    service.initialize()
    await flush()
    expect(h.calls).toHaveLength(0)

    // 24 小时后定时器应触发一次拉取，并重新安排下一轮
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
    await flush()
    expect(h.calls).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
    await flush()
    expect(h.calls).toHaveLength(2)

    service.shutdown()
  })

  it('shutdown() 之后定时器不再触发', async () => {
    const { service } = makeService({
      trackerSubscription: {
        autoUpdate: true,
        lastUpdate: new Date().toISOString(),
        customSources: [SOURCE],
        syncIntervalHours: 24
      }
    })

    service.initialize()
    service.shutdown()

    await vi.advanceTimersByTimeAsync(7 * 24 * 60 * 60 * 1000)
    await flush()

    expect(h.calls).toHaveLength(0)
  })

  it('同步间隔被钳在 12~168 小时之间', () => {
    const { service, store } = makeService({ trackerSubscription: { autoUpdate: false } })

    service.setAutoUpdate(false, undefined, 1)
    expect((store.dump().trackerSubscription as { syncIntervalHours: number }).syncIntervalHours).toBe(12)

    service.setAutoUpdate(false, undefined, 999)
    expect((store.dump().trackerSubscription as { syncIntervalHours: number }).syncIntervalHours).toBe(168)

    service.setAutoUpdate(false, undefined, 48)
    expect((store.dump().trackerSubscription as { syncIntervalHours: number }).syncIntervalHours).toBe(48)
  })

  it('开启自动更新会立即拉取一次并保留调用方给的订阅源', async () => {
    h.plan = [{ kind: 'body', text: 'udp://a.example:1337/announce' }]
    const { service, store } = makeService({ trackerSubscription: { autoUpdate: false } })

    service.setAutoUpdate(true, [SOURCE])
    await flush()

    expect(h.calls).toHaveLength(1)
    expect((store.dump().trackerSubscription as { customSources: string[] }).customSources).toEqual([SOURCE])
    service.shutdown()
  })
})
