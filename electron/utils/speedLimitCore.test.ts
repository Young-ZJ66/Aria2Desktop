import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REMEMBERED_LIMIT,
  formatLimitLabel,
  parseLimitToBytes,
  resolveLimitToggle
} from './speedLimitCore'

describe('parseLimitToBytes', () => {
  it('纯数字按字节解析', () => {
    expect(parseLimitToBytes('1048576')).toBe(1048576)
    expect(parseLimitToBytes('0')).toBe(0)
  })

  it('K/M/G 后缀解析（大小写不敏感，忽略空隙）', () => {
    expect(parseLimitToBytes('1024K')).toBe(1048576)
    expect(parseLimitToBytes('1m')).toBe(1048576)
    expect(parseLimitToBytes('2 M')).toBe(2097152)
    expect(parseLimitToBytes('1G')).toBe(1073741824)
  })

  it('小数与负数/非法输入安全回落', () => {
    expect(parseLimitToBytes('1.5M')).toBe(1572864)
    expect(parseLimitToBytes('-5')).toBe(0)
    expect(parseLimitToBytes('abc')).toBe(0)
    expect(parseLimitToBytes('')).toBe(0)
    expect(parseLimitToBytes('Infinity')).toBe(0)
  })
})

describe('formatLimitLabel', () => {
  it('MB/s 与 KB/s 自动切换', () => {
    expect(formatLimitLabel(1048576)).toBe('1 MB/s')
    expect(formatLimitLabel(5 * 1048576)).toBe('5 MB/s')
    expect(formatLimitLabel(512 * 1024)).toBe('512 KB/s')
  })
})

describe('resolveLimitToggle', () => {
  it('限速中 → 清零并记住当前原始值（保留单位写法）', () => {
    const r = resolveLimitToggle({ currentRaw: '1024K', remembered: '1048576' })
    expect(r.nextRaw).toBe('0')
    expect(r.remembered).toBe('1024K')
    expect(r.limited).toBe(false)
    expect(r.limitBytes).toBe(0)
  })

  it('不限速 → 恢复记忆值', () => {
    const r = resolveLimitToggle({ currentRaw: '0', remembered: '1048576' })
    expect(r.nextRaw).toBe('1048576')
    expect(r.limited).toBe(true)
    expect(r.limitBytes).toBe(1048576)
  })

  it('当前值为空/未定义视作不限速', () => {
    expect(resolveLimitToggle({ currentRaw: '', remembered: '2M' }).nextRaw).toBe('2M')
    expect(resolveLimitToggle({ currentRaw: undefined, remembered: '2M' }).limited).toBe(true)
  })

  it('记忆值为空时回落默认 1MB/s', () => {
    const r = resolveLimitToggle({ currentRaw: '0', remembered: '' })
    expect(r.nextRaw).toBe(DEFAULT_REMEMBERED_LIMIT)
    expect(r.limitBytes).toBe(1048576)
  })
})
