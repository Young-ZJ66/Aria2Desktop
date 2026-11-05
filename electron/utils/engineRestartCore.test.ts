import { describe, expect, it } from 'vitest'
import {
  MAX_RESTART_DELAY_MS,
  STABLE_UPTIME_MS,
  nextRestartDelayMs,
  shouldResetRetryCount
} from './engineRestartCore'

describe('nextRestartDelayMs', () => {
  it('指数退避：3s → 6s → 12s → 24s', () => {
    expect(nextRestartDelayMs(1)).toBe(3000)
    expect(nextRestartDelayMs(2)).toBe(6000)
    expect(nextRestartDelayMs(3)).toBe(12000)
    expect(nextRestartDelayMs(4)).toBe(24000)
  })

  it('超过上限后封顶 30 秒（崩溃循环别把 CPU 耗在反复拉起上）', () => {
    expect(nextRestartDelayMs(5)).toBe(MAX_RESTART_DELAY_MS)
    expect(nextRestartDelayMs(50)).toBe(MAX_RESTART_DELAY_MS)
  })

  it('异常入参按第一次重试处理', () => {
    expect(nextRestartDelayMs(0)).toBe(3000)
    expect(nextRestartDelayMs(-5)).toBe(3000)
    expect(nextRestartDelayMs(Number.NaN)).toBe(3000)
    expect(nextRestartDelayMs(1.9)).toBe(3000)
  })
})

describe('shouldResetRetryCount', () => {
  it('只在上一次启动稳定存活后才清零计数', () => {
    expect(shouldResetRetryCount(STABLE_UPTIME_MS)).toBe(true)
    expect(shouldResetRetryCount(STABLE_UPTIME_MS + 1)).toBe(true)
    expect(shouldResetRetryCount(STABLE_UPTIME_MS - 1)).toBe(false)
    expect(shouldResetRetryCount(2000)).toBe(false)
  })

  it('拿不到存活时长时不清零（避免崩溃循环漏过止损）', () => {
    expect(shouldResetRetryCount(0)).toBe(false)
    expect(shouldResetRetryCount(-1)).toBe(false)
    expect(shouldResetRetryCount(Number.NaN)).toBe(false)
  })
})
