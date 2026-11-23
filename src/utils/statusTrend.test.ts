import { describe, expect, it } from 'vitest'
import { formatTrendAxisLabel } from './statusTrend'

describe('formatTrendAxisLabel', () => {
  it('7 天视图显示完整的月/日', () => {
    expect(formatTrendAxisLabel('2026-11-17', 0, 7)).toBe('11/17')
    expect(formatTrendAxisLabel('2026-11-23', 6, 7)).toBe('11/23')
  })

  it('30 天视图显示日号，首日和每月 1 日带月份', () => {
    expect(formatTrendAxisLabel('2026-10-25', 0, 30)).toBe('10/25')
    expect(formatTrendAxisLabel('2026-10-26', 1, 30)).toBe('26')
    expect(formatTrendAxisLabel('2026-11-01', 7, 30)).toBe('11/1')
    expect(formatTrendAxisLabel('2026-11-02', 8, 30)).toBe('2')
  })

  it('非法日期键原样返回', () => {
    expect(formatTrendAxisLabel('', 0, 7)).toBe('')
    expect(formatTrendAxisLabel('not-a-date', 0, 7)).toBe('not-a-date')
  })
})
