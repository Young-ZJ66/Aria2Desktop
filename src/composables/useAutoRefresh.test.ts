import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 轮询调度的回归测试。
 *
 * 这里的每条断言都对应一个真实会翻车的场景：
 * 1) 间隔参数来自主进程配置，NaN/0/负数会让 setInterval 退化成 0ms 死循环，把引擎打爆；
 * 2) 窗口隐藏时必须停止轮询（托盘驻留耗电），回到前台要立刻补刷一次，否则界面停在旧数据；
 * 3) 重复 start 不能留下第二个定时器，否则刷新频率翻倍。
 */
const state = vi.hoisted(() => ({ connected: true }))
const loadGlobalStat = vi.hoisted(() => vi.fn())
const loadLightTasks = vi.hoisted(() => vi.fn())
const loadAllTasks = vi.hoisted(() => vi.fn())

vi.mock('@/stores/connectionStore', () => ({
  useConnectionStore: () => ({ get isConnected() { return state.connected } })
}))
vi.mock('@/stores/statsStore', () => ({ useStatsStore: () => ({ loadGlobalStat }) }))
vi.mock('@/stores/taskStore', () => ({ useTaskStore: () => ({ loadLightTasks, loadAllTasks }) }))

import { useAutoRefresh } from './useAutoRefresh'

interface FakeDoc {
  visibilityState: string
  handlers: Map<string, () => void>
  addEventListener: (type: string, handler: () => void) => void
  removeEventListener: (type: string, handler: () => void) => void
}

let doc: FakeDoc

beforeEach(() => {
  vi.useFakeTimers()
  state.connected = true
  loadGlobalStat.mockClear()
  loadLightTasks.mockClear()
  loadAllTasks.mockClear()
  doc = {
    visibilityState: 'visible',
    handlers: new Map(),
    addEventListener(type, handler) { doc.handlers.set(type, handler) },
    removeEventListener(type) { doc.handlers.delete(type) }
  }
  ;(globalThis as unknown as { document: unknown }).document = doc
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  delete (globalThis as unknown as { document?: unknown }).document
})

describe('高频刷新', () => {
  it('到点后同时刷新统计与轻量任务列表', async () => {
    const refresh = useAutoRefresh()
    refresh.startAutoUpdate()
    await vi.advanceTimersByTimeAsync(1000)
    expect(loadGlobalStat).toHaveBeenCalledTimes(1)
    expect(loadLightTasks).toHaveBeenCalledTimes(1)
    expect(loadAllTasks).not.toHaveBeenCalled()
    refresh.stopAll()
  })

  it.each([Number.NaN, 0, -5, 50])('非法间隔 %s 兜底到 1 秒（0ms 死循环会打爆引擎）', async (bad) => {
    const refresh = useAutoRefresh()
    refresh.startAutoUpdate(bad)
    await vi.advanceTimersByTimeAsync(999)
    expect(loadGlobalStat).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(loadGlobalStat).toHaveBeenCalledTimes(1)
    refresh.stopAll()
  })

  it('未连接时到点不发请求', async () => {
    state.connected = false
    const refresh = useAutoRefresh()
    refresh.startAutoUpdate()
    await vi.advanceTimersByTimeAsync(3000)
    expect(loadGlobalStat).not.toHaveBeenCalled()
    expect(loadLightTasks).not.toHaveBeenCalled()
    refresh.stopAll()
  })

  it('重复 start 不会叠加定时器', async () => {
    const refresh = useAutoRefresh()
    refresh.startAutoUpdate()
    refresh.startAutoUpdate()
    await vi.advanceTimersByTimeAsync(1000)
    expect(loadGlobalStat).toHaveBeenCalledTimes(1)
    refresh.stopAll()
  })

  it('stopAutoUpdate 之后不再刷新，并摘掉可见性监听', async () => {
    const refresh = useAutoRefresh()
    refresh.startAutoUpdate()
    expect(doc.handlers.has('visibilitychange')).toBe(true)
    refresh.stopAutoUpdate()
    expect(doc.handlers.has('visibilitychange')).toBe(false)
    await vi.advanceTimersByTimeAsync(5000)
    expect(loadGlobalStat).not.toHaveBeenCalled()
  })
})

describe('窗口可见性', () => {
  it('隐藏时不轮询（托盘驻留不该空转耗电）', async () => {
    doc.visibilityState = 'hidden'
    const refresh = useAutoRefresh()
    refresh.startAutoUpdate()
    await vi.advanceTimersByTimeAsync(5000)
    expect(loadGlobalStat).not.toHaveBeenCalled()
    refresh.stopAll()
  })

  it('回到前台立即补刷一次', async () => {
    doc.visibilityState = 'hidden'
    const refresh = useAutoRefresh()
    refresh.startAutoUpdate()
    await vi.advanceTimersByTimeAsync(1000)
    expect(loadGlobalStat).not.toHaveBeenCalled()
    doc.visibilityState = 'visible'
    doc.handlers.get('visibilitychange')?.()
    expect(loadGlobalStat).toHaveBeenCalledTimes(1)
    expect(loadLightTasks).toHaveBeenCalledTimes(1)
    refresh.stopAll()
  })

  it('回到前台但未连接时不补刷', async () => {
    const refresh = useAutoRefresh()
    refresh.startAutoUpdate()
    state.connected = false
    doc.handlers.get('visibilitychange')?.()
    expect(loadGlobalStat).not.toHaveBeenCalled()
    refresh.stopAll()
  })
})

describe('低频全量刷新', () => {
  it('30 秒后刷新完整任务列表', async () => {
    const refresh = useAutoRefresh()
    refresh.startSlowUpdate()
    await vi.advanceTimersByTimeAsync(29000)
    expect(loadAllTasks).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(loadAllTasks).toHaveBeenCalledTimes(1)
    refresh.stopAll()
  })

  it('窗口隐藏时跳过', async () => {
    doc.visibilityState = 'hidden'
    const refresh = useAutoRefresh()
    refresh.startSlowUpdate()
    await vi.advanceTimersByTimeAsync(30000)
    expect(loadAllTasks).not.toHaveBeenCalled()
    refresh.stopAll()
  })

  it('stopAll 同时停掉高频与低频', async () => {
    const refresh = useAutoRefresh()
    refresh.startAutoUpdate()
    refresh.startSlowUpdate()
    refresh.stopAll()
    await vi.advanceTimersByTimeAsync(60000)
    expect(loadGlobalStat).not.toHaveBeenCalled()
    expect(loadAllTasks).not.toHaveBeenCalled()
  })
})
