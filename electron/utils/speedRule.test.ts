import { describe, expect, it } from 'vitest'
import { formatClockTime, matchesSpeedRule } from './speedRule'

/**
 * 限速规则的时间匹配是"按星期/时段自动切换限速"的核心判定，
 * 跨午夜与边界语义容易改错，这里逐条锁死（语义与重构前完全一致）。
 */
describe('matchesSpeedRule', () => {
  const everyday = { days: [] as number[], startTime: '09:00', endTime: '18:00' }

  it('days 为空表示每天生效', () => {
    for (let day = 0; day <= 6; day++) {
      expect(matchesSpeedRule(everyday, day, '10:00')).toBe(true)
    }
  })

  it('不在指定的星期时不匹配', () => {
    const weekdayOnly = { days: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '18:00' }
    expect(matchesSpeedRule(weekdayOnly, 0, '10:00')).toBe(false) // 周日
    expect(matchesSpeedRule(weekdayOnly, 6, '10:00')).toBe(false) // 周六
    expect(matchesSpeedRule(weekdayOnly, 3, '10:00')).toBe(true)
  })

  it('非跨午夜区间为左闭右开 [start, end)', () => {
    expect(matchesSpeedRule(everyday, 1, '08:59')).toBe(false)
    expect(matchesSpeedRule(everyday, 1, '09:00')).toBe(true) // 起点含
    expect(matchesSpeedRule(everyday, 1, '17:59')).toBe(true)
    expect(matchesSpeedRule(everyday, 1, '18:00')).toBe(false) // 终点不含
  })

  it('跨午夜区间覆盖 [start, 23:59] 与 [00:00, end)', () => {
    const overnight = { days: [] as number[], startTime: '22:00', endTime: '06:00' }
    expect(matchesSpeedRule(overnight, 1, '22:00')).toBe(true)
    expect(matchesSpeedRule(overnight, 1, '23:59')).toBe(true)
    expect(matchesSpeedRule(overnight, 1, '00:00')).toBe(true)
    expect(matchesSpeedRule(overnight, 1, '05:59')).toBe(true)
    expect(matchesSpeedRule(overnight, 1, '06:00')).toBe(false)
    expect(matchesSpeedRule(overnight, 1, '12:00')).toBe(false)
  })

  it('startTime 等于 endTime 视为空区间（有意保留，可用于临时停用规则）', () => {
    const empty = { days: [] as number[], startTime: '09:00', endTime: '09:00' }
    expect(matchesSpeedRule(empty, 1, '09:00')).toBe(false)
    expect(matchesSpeedRule(empty, 1, '09:01')).toBe(false)
  })
})

describe('formatClockTime', () => {
  it('补零为 HH:mm', () => {
    expect(formatClockTime(new Date(2026, 0, 1, 9, 5))).toBe('09:05')
    expect(formatClockTime(new Date(2026, 0, 1, 0, 0))).toBe('00:00')
    expect(formatClockTime(new Date(2026, 0, 1, 23, 59))).toBe('23:59')
  })
})
