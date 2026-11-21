import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 速度曲线采集的补充边界（与 useTrafficMonitor.test.ts 分开成文件的原因：
 * 模块级 statsStore 是惰性缓存的单例，只有在本文件里「第一次」调用 recordRetryMarker
 * 才能覆盖惰性初始化那一行；同一文件里先跑过 collectPoint 就再也走不到。
 * 同样必须静态 import，理由见 useTrafficMonitor.test.ts 顶部注释。
 */
import { useTrafficMonitor } from './useTrafficMonitor'

const statsState = { downloadSpeed: 0 }

vi.mock('@/stores/statsStore', () => ({
  useStatsStore: () => ({ globalStat: statsState })
}))

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T10:31:00.000Z'))
  statsState.downloadSpeed = 0
})

afterEach(() => {
  useTrafficMonitor().stopMonitor()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('速度曲线采集的补充边界', () => {
  it('未采集过任何点就记录重试标记时惰性拿到 store（速度为 0）', () => {
    const monitor = useTrafficMonitor()
    monitor.resetHistory()
    monitor.recordRetryMarker('首次重试')
    expect(monitor.retryMarkers.value).toHaveLength(1)
    expect(monitor.retryMarkers.value[0]).toMatchObject({ label: '首次重试', speed: 0 })
    expect(monitor.speedHistory.value).toHaveLength(0)
  })

  it('对齐定时器还没触发就 stopMonitor 时清掉等待中的定时器', async () => {
    const monitor = useTrafficMonitor()
    monitor.startMonitor()
    await vi.advanceTimersByTimeAsync(500)
    // 此时只有 timeoutId 在等下一个整秒，intervalId 还是 null
    monitor.stopMonitor()
    await vi.advanceTimersByTimeAsync(5000)
    expect(monitor.speedHistory.value).toHaveLength(0)
  })

  it('对齐定时器触发后 stopMonitor 清掉 interval', async () => {
    const monitor = useTrafficMonitor()
    monitor.startMonitor()
    await vi.advanceTimersByTimeAsync(1000)
    expect(monitor.speedHistory.value).toHaveLength(1)
    monitor.stopMonitor()
    await vi.advanceTimersByTimeAsync(5000)
    expect(monitor.speedHistory.value).toHaveLength(1)
  })
})
