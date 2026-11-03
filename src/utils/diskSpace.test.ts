import { describe, expect, it } from 'vitest'
import { DISK_SPACE_UNKNOWN, isDiskSpaceSufficient } from './diskSpace'

describe('isDiskSpaceSufficient', () => {
  it('剩余空间大于需求 → 足够', () => {
    expect(isDiskSpaceSufficient(1000, 500)).toBe(true)
  })

  it('恰好相等 → 足够（余量问题由 aria2 报错兜底）', () => {
    expect(isDiskSpaceSufficient(500, 500)).toBe(true)
  })

  it('剩余空间小于需求 → 不足', () => {
    expect(isDiskSpaceSufficient(499, 500)).toBe(false)
  })

  it('空间未知（哨兵值 -1）→ 不拦截', () => {
    expect(isDiskSpaceSufficient(DISK_SPACE_UNKNOWN, 1000)).toBe(true)
  })

  it('NaN / Infinity 视作未知 → 不拦截', () => {
    expect(isDiskSpaceSufficient(Number.NaN, 1000)).toBe(true)
    expect(isDiskSpaceSufficient(Number.POSITIVE_INFINITY, 1000)).toBe(true)
  })

  it('需求为 0 / 负数 / NaN → 不拦截（无意义需求）', () => {
    expect(isDiskSpaceSufficient(1, 0)).toBe(true)
    expect(isDiskSpaceSufficient(1, -5)).toBe(true)
    expect(isDiskSpaceSufficient(1, Number.NaN)).toBe(true)
  })
})
