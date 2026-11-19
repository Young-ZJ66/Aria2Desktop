import { describe, expect, it } from 'vitest'
import { fromSpeedLimitBytes, parseSpeedLimitInput, toSpeedLimitBytes } from './speedLimit'

describe('toSpeedLimitBytes', () => {
  it('按单位换算成字节/秒', () => {
    expect(toSpeedLimitBytes(512, 'KB')).toBe(512 * 1024)
    expect(toSpeedLimitBytes(2, 'MB')).toBe(2 * 1024 * 1024)
    expect(toSpeedLimitBytes(1.5, 'MB')).toBe(1572864)
  })

  it('空值、0、负数与非法值都当作不限制', () => {
    expect(toSpeedLimitBytes(null, 'MB')).toBe(0)
    expect(toSpeedLimitBytes(undefined, 'KB')).toBe(0)
    expect(toSpeedLimitBytes(0, 'MB')).toBe(0)
    expect(toSpeedLimitBytes(-1, 'KB')).toBe(0)
    expect(toSpeedLimitBytes(Number.NaN, 'MB')).toBe(0)
  })

  it('极小值不会算成 0 字节', () => {
    expect(toSpeedLimitBytes(0.001, 'KB')).toBe(1)
  })
})

describe('parseSpeedLimitInput', () => {
  it('把输入框文本换算成字节/秒', () => {
    expect(parseSpeedLimitInput('10', 'MB')).toBe(10 * 1024 * 1024)
    expect(parseSpeedLimitInput(' 512 ', 'KB')).toBe(512 * 1024)
    expect(parseSpeedLimitInput('1.5', 'MB')).toBe(1572864)
  })

  it('逗号当小数点用', () => {
    expect(parseSpeedLimitInput('1,5', 'MB')).toBe(1572864)
  })

  it('留空或 0 当作不限制', () => {
    expect(parseSpeedLimitInput('', 'MB')).toBe(0)
    expect(parseSpeedLimitInput('   ', 'KB')).toBe(0)
    expect(parseSpeedLimitInput('0', 'MB')).toBe(0)
  })

  it('非法输入返回 null，交给调用方提示', () => {
    expect(parseSpeedLimitInput('abc', 'MB')).toBeNull()
    expect(parseSpeedLimitInput('-5', 'MB')).toBeNull()
    expect(parseSpeedLimitInput('1.2.3', 'MB')).toBeNull()
  })
})

describe('fromSpeedLimitBytes', () => {
  it('≥1MB/s 用 MB 回填', () => {
    expect(fromSpeedLimitBytes(1024 * 1024)).toEqual({ value: 1, unit: 'MB' })
    expect(fromSpeedLimitBytes(2 * 1024 * 1024)).toEqual({ value: 2, unit: 'MB' })
    expect(fromSpeedLimitBytes(1572864)).toEqual({ value: 1.5, unit: 'MB' })
  })

  it('<1MB/s 用 KB 回填', () => {
    expect(fromSpeedLimitBytes(512 * 1024)).toEqual({ value: 512, unit: 'KB' })
    expect(fromSpeedLimitBytes(300000)).toEqual({ value: 293, unit: 'KB' })
  })

  it('不限制时留空', () => {
    expect(fromSpeedLimitBytes(0)).toEqual({ value: null, unit: 'MB' })
    expect(fromSpeedLimitBytes(Number.NaN)).toEqual({ value: null, unit: 'MB' })
  })

  it('换算往返后基本还原', () => {
    for (const bytes of [512 * 1024, 1024 * 1024, 3 * 1024 * 1024, 700 * 1024]) {
      const { value, unit } = fromSpeedLimitBytes(bytes)
      expect(toSpeedLimitBytes(value, unit)).toBe(bytes)
    }
  })
})
