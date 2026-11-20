import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 速度曲线采集的回归测试。
 *
 * 三个容易写错、且错了不报错的地方：
 * 1) 窗口隐藏时必须停止采样——否则把同一个旧速度重复写进历史，回到前台曲线是一条假水平线；
 * 2) 历史长度有上限（600 点 = 10 分钟），无上限会一直涨内存；
 * 3) 重试标记与历史一样有上限，且切连接要一起清空，否则旧引擎的速率会画到新连接上。
 *
 * 注意：这里刻意用静态 import、不用 vi.resetModules()。vue 的 runtime-dom 在模块加载时
 * 就会调用 document.createElement，若在 import 之前把 globalThis.document 换成假对象，
 * vue 自身会直接抛 TypeError: doc.createElement is not a function。
 * 模块级状态靠 resetHistory() / stopMonitor() 在 beforeEach 里复位。
 */
import { useTrafficMonitor } from './useTrafficMonitor'

const statsState = { downloadSpeed: 0 }

vi.mock('@/stores/statsStore', () => ({
  useStatsStore: () => ({ globalStat: statsState })
}))

const visibility = { state: 'visible' }

function installVisibility(): void {
  ;(globalThis as unknown as { document: unknown }).document = {
    get visibilityState() { return visibility.state }
  }
}

function removeVisibility(): void {
  delete (globalThis as unknown as { document?: unknown }).document
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T10:31:00.000Z'))
  statsState.downloadSpeed = 0
  visibility.state = 'visible'
  removeVisibility()
  const monitor = useTrafficMonitor()
  monitor.stopMonitor()
  monitor.resetHistory()
})

afterEach(() => {
  useTrafficMonitor().stopMonitor()
  vi.useRealTimers()
  vi.restoreAllMocks()
  removeVisibility()
})

describe('startMonitor：对齐整秒后每秒采集', () => {
  it('对齐到下一个整秒才开始采集', async () => {
    const monitor = useTrafficMonitor()
    monitor.startMonitor()
    await vi.advanceTimersByTimeAsync(999)
    expect(monitor.speedHistory.value).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(monitor.speedHistory.value).toHaveLength(1)
  })

  it('之后每秒新增一个点，时间戳为 HH:MM:SS', async () => {
    statsState.downloadSpeed = 2048
    const monitor = useTrafficMonitor()
    monitor.startMonitor()
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)
    expect(monitor.speedHistory.value).toHaveLength(3)
    expect(monitor.speedHistory.value[0]?.speed).toBe(2048)
    expect(monitor.speedHistory.value[0]?.time).toMatch(/^\d{2}:\d{2}:\d{2}$/)
  })

  it('重复 start 不会起第二个定时器', async () => {
    const monitor = useTrafficMonitor()
    monitor.startMonitor()
    monitor.startMonitor()
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)
    expect(monitor.speedHistory.value).toHaveLength(2)
  })

  it('stopMonitor 之后不再采集', async () => {
    const monitor = useTrafficMonitor()
    monitor.startMonitor()
    await vi.advanceTimersByTimeAsync(1000)
    monitor.stopMonitor()
    await vi.advanceTimersByTimeAsync(5000)
    expect(monitor.speedHistory.value).toHaveLength(1)
  })
})

describe('窗口隐藏时不采样', () => {
  it('visibilityState 非 visible 时不写入历史点', async () => {
    installVisibility()
    const monitor = useTrafficMonitor()
    visibility.state = 'hidden'
    monitor.startMonitor()
    await vi.advanceTimersByTimeAsync(5000)
    expect(monitor.speedHistory.value).toHaveLength(0)
  })

  it('回到前台后恢复采样', async () => {
    installVisibility()
    const monitor = useTrafficMonitor()
    visibility.state = 'hidden'
    monitor.startMonitor()
    await vi.advanceTimersByTimeAsync(2000)
    expect(monitor.speedHistory.value).toHaveLength(0)
    visibility.state = 'visible'
    await vi.advanceTimersByTimeAsync(2000)
    expect(monitor.speedHistory.value.length).toBeGreaterThan(0)
  })

  it('无 document 时（测试/非浏览器环境）不因可见性跳过采样', async () => {
    const monitor = useTrafficMonitor()
    monitor.startMonitor()
    await vi.advanceTimersByTimeAsync(1000)
    expect(monitor.speedHistory.value).toHaveLength(1)
  })
})

describe('历史上限', () => {
  it('超过 600 点后只保留最近 600 点', async () => {
    const monitor = useTrafficMonitor()
    monitor.startMonitor()
    await vi.advanceTimersByTimeAsync(1000 + 650 * 1000)
    expect(monitor.speedHistory.value).toHaveLength(600)
  })
})

describe('resetHistory / recordRetryMarker', () => {
  it('resetHistory 同时清空历史与重试标记', async () => {
    const monitor = useTrafficMonitor()
    monitor.startMonitor()
    await vi.advanceTimersByTimeAsync(1000)
    monitor.recordRetryMarker('自动重试')
    monitor.resetHistory()
    expect(monitor.speedHistory.value).toHaveLength(0)
    expect(monitor.retryMarkers.value).toHaveLength(0)
  })

  it('重试标记记录标签与当时速度', async () => {
    statsState.downloadSpeed = 512
    const monitor = useTrafficMonitor()
    monitor.recordRetryMarker('自动重试')
    expect(monitor.retryMarkers.value).toHaveLength(1)
    expect(monitor.retryMarkers.value[0]?.label).toBe('自动重试')
    expect(monitor.retryMarkers.value[0]?.speed).toBe(512)
  })

  it('重试标记最多保留 50 个', async () => {
    const monitor = useTrafficMonitor()
    for (let index = 0; index < 60; index += 1) {
      monitor.recordRetryMarker('重试' + index)
    }
    expect(monitor.retryMarkers.value).toHaveLength(50)
    expect(monitor.retryMarkers.value[49]?.label).toBe('重试59')
  })
})
