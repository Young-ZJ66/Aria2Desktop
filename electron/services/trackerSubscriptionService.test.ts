import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
}))
vi.mock('../utils/ipcSecurity', () => ({
  registerSecureHandler: vi.fn()
}))

/** 网络在单测里一律失败：本文件关心的只是"该不该发起请求"和"请求打到哪个主机" */
const { requestMock } = vi.hoisted(() => ({
  requestMock: vi.fn((_options?: unknown, _callback?: unknown) => {
    throw new Error('no network in test')
  })
}))
vi.mock('https', () => ({ request: requestMock }))

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

function makeService(state: State) {
  const store = makeStore(state)
  const applyTrackerList = vi.fn(() => ({ success: true }))
  const service = new TrackerSubscriptionService(
    store as never,
    { applyTrackerList } as never,
    { getMainWindow: () => null } as never
  )
  return { service, store, applyTrackerList }
}

/** 让 microtask 队列跑完（update() 是 async，内部 await fetch） */
const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
  requestMock.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('TrackerSubscriptionService', () => {
  it('关闭自动更新时，启动既不该拉取也不该挂定时器', async () => {
    const { service, applyTrackerList } = makeService({
      trackerSubscription: { autoUpdate: false, lastUpdate: null }
    })

    service.initialize()
    await flush()

    expect(requestMock).not.toHaveBeenCalled()

    // 挂上定时器的话，一天后即使设置是"关闭"也会去拉一遍并改写用户的 tracker 列表
    await vi.advanceTimersByTimeAsync(30 * 24 * 60 * 60 * 1000)
    expect(requestMock).not.toHaveBeenCalled()
    expect(applyTrackerList).not.toHaveBeenCalled()
  })

  it('运行中关掉自动更新后，已经挂上的定时器不再拉取', async () => {
    const { service } = makeService({
      trackerSubscription: { autoUpdate: true, lastUpdate: new Date().toISOString() }
    })

    service.initialize()
    await flush()
    service.setAutoUpdate(false)

    await vi.advanceTimersByTimeAsync(30 * 24 * 60 * 60 * 1000)
    expect(requestMock).not.toHaveBeenCalled()
  })

  it('开启自动更新且从未更新过时，启动后立即拉取一次', async () => {
    const { service } = makeService({
      trackerSubscription: { autoUpdate: true, lastUpdate: null, customSources: ['https://example.com/best.txt'] }
    })

    service.initialize()
    await flush()

    expect(requestMock).toHaveBeenCalled()
  })

  it('订阅源两侧的空白不会让请求打到错误的主机', async () => {
    const { service } = makeService({
      trackerSubscription: { autoUpdate: false, lastUpdate: null }
    })

    await service.update(true, ['  https://example.com/best.txt  '])

    expect(requestMock).toHaveBeenCalled()
    const options = requestMock.mock.calls[0]?.[0] as { hostname?: string; path?: string }
    expect(options?.hostname).toBe('example.com')
    expect(options?.path).toBe('/best.txt')
  })

  it('没有可用订阅源时给出可读错误，且不写配置', async () => {
    const { service, applyTrackerList } = makeService({
      trackerSubscription: { autoUpdate: false, lastUpdate: null }
    })

    const result = await service.update(true, ['http://insecure.example.com/a.txt', '   '])

    expect(result.success).toBe(false)
    expect(result.error).toContain('https://')
    expect(applyTrackerList).not.toHaveBeenCalled()
  })
})
