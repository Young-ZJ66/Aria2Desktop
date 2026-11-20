import { describe, expect, it } from 'vitest'
import { formatSizeWithUnit, parseSizeToUnit } from './size'

/**
 * aria2 SIZE 值的单位换算测试。
 *
 * 设置页把这些选项按 KB/MB/GB 显示并回写，而 aria2 一律以字节数返回：
 * 换算错一位就会把「4MB 分片」显示成「4096MB」，回写后直接把配置改坏。
 */
describe('parseSizeToUnit：把 aria2 SIZE 值换成目标单位', () => {
  it('纯字节数按 1024 进制换算', () => {
    expect(parseSizeToUnit('2097152', 'M')).toBe(2)
    expect(parseSizeToUnit('1048576', 'K')).toBe(1024)
    expect(parseSizeToUnit('1073741824', 'G')).toBe(1)
    expect(parseSizeToUnit(2097152, 'M')).toBe(2)
  })

  it('带单位的输入按单位换算，不再当作字节数', () => {
    expect(parseSizeToUnit('2M', 'M')).toBe(2)
    expect(parseSizeToUnit('2m', 'M')).toBe(2)
    expect(parseSizeToUnit('1.5M', 'K')).toBe(1536)
    expect(parseSizeToUnit('1.5G', 'M')).toBe(1536)
    expect(parseSizeToUnit('1T', 'G')).toBe(1024)
  })

  it('保留一位小数（1.5M 这类输入不能被四舍五入回写失真）', () => {
    expect(parseSizeToUnit('1572864', 'M')).toBe(1.5)
    expect(parseSizeToUnit('1024', 'M')).toBe(0)
    expect(parseSizeToUnit('0.5K', 'K')).toBe(0.5)
  })

  it('空值与 0 一律返回 0（0 表示不限速/不限量）', () => {
    expect(parseSizeToUnit('0', 'M')).toBe(0)
    expect(parseSizeToUnit(0, 'M')).toBe(0)
    expect(parseSizeToUnit('', 'M')).toBe(0)
    expect(parseSizeToUnit(null, 'M')).toBe(0)
    expect(parseSizeToUnit(undefined, 'M')).toBe(0)
  })

  it('非法输入返回 0 而不是 NaN', () => {
    expect(parseSizeToUnit('abc', 'M')).toBe(0)
    expect(parseSizeToUnit('-5', 'M')).toBe(0)
    expect(parseSizeToUnit('2MB', 'M')).toBe(0)
    expect(parseSizeToUnit('M', 'M')).toBe(0)
  })

  it('忽略首尾空白', () => {
    expect(parseSizeToUnit(' 2M ', 'M')).toBe(2)
    expect(parseSizeToUnit(' 2097152 ', 'M')).toBe(2)
  })
})

describe('formatSizeWithUnit：回写 aria2 的 SIZE 字符串', () => {
  it('0 直接写成 0（表示无限制），不带单位', () => {
    expect(formatSizeWithUnit(0, 'M')).toBe('0')
    expect(formatSizeWithUnit(0, 'K')).toBe('0')
  })

  it('非 0 值附上目标单位后缀', () => {
    expect(formatSizeWithUnit(2, 'M')).toBe('2M')
    expect(formatSizeWithUnit(1.5, 'G')).toBe('1.5G')
    expect(formatSizeWithUnit(512, 'K')).toBe('512K')
  })

  it('与 parseSizeToUnit 往返后数值不变', () => {
    const cases: Array<[number, 'K' | 'M' | 'G']> = [[2, 'M'], [1.5, 'G'], [512, 'K']]
    for (const [value, unit] of cases) {
      expect(parseSizeToUnit(formatSizeWithUnit(value, unit), unit)).toBe(value)
    }
  })
})
