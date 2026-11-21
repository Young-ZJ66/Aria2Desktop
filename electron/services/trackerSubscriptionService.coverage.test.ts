import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Entry =
  | { kind: 'body'; text: string }
  | { kind: 'status'; statusCode: number }
  | { kind: 'redirect'; statusCode: number; location: string }
  | { kind: 'error'; error: Error }
  | { kind: 'res-error'; error: Error }

const { h } = vi.hoisted(() => ({
  h: {
    plan: [] as Entry[],
    calls: [] as { hostname?: string; path?: string }[],
    send: vi.fn(),
    handlers: new Map<string, (...args: unknown[]) => unknown>(),
    options: [] as unknown[],
    windowAlive: true,
    warn: vi.fn()
  }
}))

vi.mock('../utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: h.warn, error: vi.fn(), debug: vi.fn() })
}))
vi.mock('../utils/mainLocaleRuntime', () => ({ runtimeMainLocale: () => 'zh' }))
vi.mock('../utils/mainErrorCopy', () => ({
  mainError: (locale: string, key: string, params?: Record<string, unknown>) =>
    'E:' + key + (params ? '|' + JSON.stringify(params) : '')
}))
vi.mock('../utils/ipcSecurity', () => ({
  registerSecureHandler: (channel: string, handler: (...args: unknown[]) => unknown, options: unknown) => {
    h.handlers.set(channel, handler)
    h.options.push(options)
  }
}))

vi.mock('https', async () => {
  const { EventEmitter } = await import('node:events')
  type Emitter = InstanceType<typeof EventEmitter>

  const makeResponse = (statusCode: number, headers: Record<string, string>, body: string, resError?: Error): Emitter => {
    const res = new EventEmitter() as Emitter & { statusCode: number; headers: Record<string, string>; resume: () => void }
    res.statusCode = statusCode
    res.headers = headers
    res.resume = () => {}
    queueMicrotask(() => {
      if (resError) {
        res.emit('error', resError)
        return
      }
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
        setTimeout: (ms: number, cb: () => void) => unknown
        destroy: (error?: Error) => unknown
        end: () => void
      }
      req.setTimeout = () => req
      req.destroy = (error?: Error) => {
        if (error) queueMicrotask(() => req.emit('error', error))
        return req
      }
      req.end = () => {
        if (!entry) {
          queueMicrotask(() => req.emit('error', new Error('no plan entry')))
          return
        }
        if (entry.kind === 'body') queueMicrotask(() => callback(makeResponse(200, {}, entry.text)))
        else if (entry.kind === 'status') queueMicrotask(() => callback(makeResponse(entry.statusCode, {}, '')))
        else if (entry.kind === 'redirect') queueMicrotask(() => callback(makeResponse(entry.statusCode, { location: entry.location }, '')))
        else if (entry.kind === 'res-error') queueMicrotask(() => callback(makeResponse(200, {}, '', entry.error)))
        else queueMicrotask(() => req.emit('error', entry.error))
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

function makeService(
  state: State = {},
  applyImpl: () => { success: boolean; error?: string } = () => ({ success: true })
) {
  const store = makeStore(state)
  const applyTrackerList = vi.fn(applyImpl)
  const service = new TrackerSubscriptionService(
    store as never,
    { applyTrackerList } as never,
    {
      getMainWindow: () =>
        h.windowAlive ? { isDestroyed: () => false, webContents: { send: h.send } } : null
    } as never
  )
  return { service, store, applyTrackerList }
}

const flush = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve()
}

const SOURCE = 'https://example.com/best.txt'
const SOURCE_B = 'https://mirror.example.com/best.txt'

beforeEach(() => {
  vi.useFakeTimers()
  h.plan = []
  h.calls = []
  h.handlers.clear()
  h.options = []
  h.send.mockClear()
  h.warn.mockClear()
  h.windowAlive = true
})

afterEach(() => {
  vi.useRealTimers()
})

describe('TrackerSubscriptionService 拉取的失败细节', () => {
  it('重定向到明文 http 地址时拒绝跟随（防止 TLS 降级）', async () => {
    h.plan = [{ kind: 'redirect', statusCode: 302, location: 'http://insecure.example/best.txt' }]
    const { service, applyTrackerList } = makeService({ trackerSubscription: { autoUpdate: false } })

    const result = await service.update(true, [SOURCE])

    expect(result.success).toBe(false)
    expect(result.error).toContain('tracker.unsupportedUrl')
    expect(h.calls).toHaveLength(1)
    expect(applyTrackerList).not.toHaveBeenCalled()
  })

  it('响应流中途出错按该源失败处理，其它源照常写入', async () => {
    h.plan = [
      { kind: 'res-error', error: new Error('ECONNRESET while reading') },
      { kind: 'body', text: 'udp://b.example:1337/announce' }
    ]
    const { service, applyTrackerList } = makeService({ trackerSubscription: { autoUpdate: false } })

    const result = await service.update(true, [SOURCE, SOURCE_B])

    expect(result.success).toBe(true)
    expect(result.count).toBe(1)
    expect(applyTrackerList).toHaveBeenCalledWith('udp://b.example:1337/announce')
  })

  it('写入 aria2 时抛异常被兜成失败结果，而不是让 IPC 调用方收到 rejection', async () => {
    h.plan = [{ kind: 'body', text: 'udp://a.example:1337/announce' }]
    const { service } = makeService({ trackerSubscription: { autoUpdate: false } }, () => {
      throw new Error('apply boom')
    })

    const result = await service.update(true, [SOURCE])

    expect(result).toEqual({ success: false, error: 'apply boom' })
    expect(h.warn).toHaveBeenCalledWith('[TrackerSubscription] 更新失败:', expect.any(Error))
    expect(h.send).toHaveBeenCalledWith('tracker:updated', { success: false, error: 'apply boom' })
  })

  it('窗口已销毁时不推送更新结果（避免往死窗口发消息）', async () => {
    h.windowAlive = false
    const { service } = makeService({ trackerSubscription: { autoUpdate: false } })

    const result = await service.update(true, ['http://plain.example/best.txt'])

    expect(result.success).toBe(false)
    expect(h.send).not.toHaveBeenCalled()
  })
})

describe('TrackerSubscriptionService 定时器的收尾', () => {
  it('定时器到点时若自动更新已被关闭，只摘掉定时器不再拉取', async () => {
    const { service, store } = makeService({
      trackerSubscription: { autoUpdate: true, lastUpdate: new Date().toISOString(), customSources: [SOURCE] }
    })
    service.initialize()
    await flush()
    expect(h.calls).toHaveLength(0)

    // 绕过 setAutoUpdate 直接改状态：模拟定时器挂上之后用户在别处关掉了开关
    store.set('trackerSubscription', { autoUpdate: false, lastUpdate: new Date().toISOString(), customSources: [SOURCE] })
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
    await flush()
    expect(h.calls).toHaveLength(0)
  })
})

describe('TrackerSubscriptionService 的 IPC 通道', () => {
  it('三个通道都登记了，并统一把主窗口取值器交给校验工厂', async () => {
    const { service } = makeService({ trackerSubscription: { autoUpdate: false } })
    service.registerIpcHandlers()

    expect([...h.handlers.keys()]).toEqual([
      'tracker-subscription-status',
      'tracker-set-auto-update',
      'tracker-update-now'
    ])
    expect(h.options).toHaveLength(3)
    for (const options of h.options) {
      expect(typeof (options as { getMainWindow: () => unknown }).getMainWindow).toBe('function')
    }
  })

  it('状态通道返回默认值与已保存值合并后的结果', () => {
    const { service } = makeService({ trackerSubscription: { autoUpdate: false, lastCount: 42 } })
    service.registerIpcHandlers()

    const status = h.handlers.get('tracker-subscription-status')?.({}) as Record<string, unknown>
    expect(status).toMatchObject({ success: true, autoUpdate: false, lastCount: 42, syncIntervalHours: 24 })
  })
  it('窗口取值器按主窗口存活状态返回窗口或 null', () => {
    const { service } = makeService({ trackerSubscription: { autoUpdate: false } })
    service.registerIpcHandlers()
    const options = h.options[0] as { getMainWindow: () => unknown }
    const windowRef = options.getMainWindow() as { isDestroyed: () => boolean }
    expect(windowRef.isDestroyed()).toBe(false)
    h.windowAlive = false
    expect(options.getMainWindow()).toBeNull()
  })

  it('开关通道把间隔钳进 12–168 小时并立即拉取一次', async () => {
    h.plan = [{ kind: 'body', text: 'udp://a.example:1337/announce' }]
    const { service, store } = makeService({ trackerSubscription: { autoUpdate: false } })
    service.registerIpcHandlers()

    const result = h.handlers.get('tracker-set-auto-update')?.({}, true, [SOURCE], 1) as Record<string, unknown>
    await flush()

    expect(result).toMatchObject({ success: true, autoUpdate: true, syncIntervalHours: 12 })
    expect((store.dump().trackerSubscription as Record<string, unknown>).syncIntervalHours).toBe(12)
    expect(h.calls).toHaveLength(1)
    service.shutdown()
  })

  it('立即更新通道按手动模式执行并返回结果', async () => {
    h.plan = [{ kind: 'body', text: 'udp://a.example:1337/announce' }]
    const { service } = makeService({ trackerSubscription: { autoUpdate: false } })
    service.registerIpcHandlers()

    const result = (await h.handlers.get('tracker-update-now')?.({}, [SOURCE])) as Record<string, unknown>

    expect(result).toMatchObject({ success: true, count: 1, csv: 'udp://a.example:1337/announce' })
  })
})
