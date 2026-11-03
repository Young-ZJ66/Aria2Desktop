import { describe, expect, it } from 'vitest'
import {
  SHUTDOWN_CANCEL_WINDOW_MS,
  evaluateDownloadCompletion,
  shouldCancelPendingShutdown
} from './downloadCompletion'

describe('evaluateDownloadCompletion', () => {
  it('还有活动任务时只做标记，不触发动作', () => {
    expect(evaluateDownloadCompletion({ hadActiveTasks: false, activeCount: 2, waitingCount: 0, isConnected: true }))
      .toBe('mark-active')
  })

  it('暂停的任务在等待队列里（waitingCount > 0）也不能算"全部完成"', () => {
    // 回归用例：旧实现只看 activeTasks 长度，用户暂停最后一个任务就触发关机
    expect(evaluateDownloadCompletion({ hadActiveTasks: true, activeCount: 0, waitingCount: 1, isConnected: true }))
      .toBe('mark-active')
  })

  it('活动与等待都为空且连着引擎时触发完成动作', () => {
    expect(evaluateDownloadCompletion({ hadActiveTasks: true, activeCount: 0, waitingCount: 0, isConnected: true }))
      .toBe('fire')
  })

  it('连接断开时的空列表是 clearTasks 的结果，不算完成', () => {
    expect(evaluateDownloadCompletion({ hadActiveTasks: true, activeCount: 0, waitingCount: 0, isConnected: false }))
      .toBe('ignore')
  })

  it('从未有过活动任务时空列表不触发（应用刚启动）', () => {
    expect(evaluateDownloadCompletion({ hadActiveTasks: false, activeCount: 0, waitingCount: 0, isConnected: true }))
      .toBe('ignore')
  })
})

describe('shouldCancelPendingShutdown', () => {
  const NOW = 1_000_000

  it('关机倒计时内新增了任务 → 撤销', () => {
    expect(shouldCancelPendingShutdown(NOW - 10_000, NOW, 1)).toBe(true)
  })

  it('超过 60 秒宽限窗口后不再撤销', () => {
    expect(shouldCancelPendingShutdown(NOW - SHUTDOWN_CANCEL_WINDOW_MS - 1, NOW, 1)).toBe(false)
  })

  it('没有挂起的关机（armedAt = 0）时不撤销', () => {
    expect(shouldCancelPendingShutdown(0, NOW, 1)).toBe(false)
  })

  it('没有新增任务时不撤销', () => {
    expect(shouldCancelPendingShutdown(NOW - 10_000, NOW, 0)).toBe(false)
  })
})
