import { describe, it, expect } from 'vitest'
import {
  EMPTY_EXTENSION_CONNECTION,
  MIN_SUPPORTED_EXTENSION_VERSION,
  compareExtensionVersions,
  isExtensionOutdated,
  normalizeExtensionVersion
} from './extensionVersion'

describe('normalizeExtensionVersion', () => {
  it('接受两端实际的版本号形状', () => {
    expect(normalizeExtensionVersion('1.2.0')).toBe('1.2.0')
    expect(normalizeExtensionVersion('1.2')).toBe('1.2')
    expect(normalizeExtensionVersion('3')).toBe('3')
    expect(normalizeExtensionVersion('1.2.3.4')).toBe('1.2.3.4')
  })

  it('去掉首尾空白', () => {
    expect(normalizeExtensionVersion('  1.2.0 ')).toBe('1.2.0')
  })

  it('拒绝不合规的输入（外部输入不可直接透传）', () => {
    expect(normalizeExtensionVersion('')).toBeNull()
    expect(normalizeExtensionVersion('   ')).toBeNull()
    expect(normalizeExtensionVersion('v1.2.0')).toBeNull()
    expect(normalizeExtensionVersion('1.2.0-beta')).toBeNull()
    expect(normalizeExtensionVersion('1.2.0.0.0')).toBeNull()
    expect(normalizeExtensionVersion('123456')).toBeNull()
    expect(normalizeExtensionVersion('1..2')).toBeNull()
    expect(normalizeExtensionVersion(undefined)).toBeNull()
    expect(normalizeExtensionVersion(null)).toBeNull()
    expect(normalizeExtensionVersion(120)).toBeNull()
    expect(normalizeExtensionVersion(['1.2.0'])).toBeNull()
  })
})

describe('compareExtensionVersions', () => {
  it('逐段按数值比较，而不是按字符串', () => {
    expect(compareExtensionVersions('1.10.0', '1.9.0')).toBe(1)
    expect(compareExtensionVersions('1.9.0', '1.10.0')).toBe(-1)
    expect(compareExtensionVersions('2.0.0', '10.0.0')).toBe(-1)
  })

  it('缺的段按 0 计', () => {
    expect(compareExtensionVersions('1.2', '1.2.0')).toBe(0)
    expect(compareExtensionVersions('1.2', '1.2.1')).toBe(-1)
  })

  it('完全相同返回 0', () => {
    expect(compareExtensionVersions('1.2.0', '1.2.0')).toBe(0)
  })
})

describe('isExtensionOutdated', () => {
  it('低于给定的最低版本才算过旧', () => {
    expect(isExtensionOutdated('1.1.9', '1.2.0')).toBe(true)
    expect(isExtensionOutdated('1.2.0', '1.2.0')).toBe(false)
    expect(isExtensionOutdated('1.10.0', '1.9.0')).toBe(false)
  })

  it('默认下限是 MIN_SUPPORTED_EXTENSION_VERSION，与应用版本解耦', () => {
    expect(MIN_SUPPORTED_EXTENSION_VERSION).toBe('1.2.0')
    // 回归：应用发补丁版时商店里没有对应扩展可升，不能对用户报"过旧"（恒亮的提示等于没有提示）
    expect(isExtensionOutdated('1.2.0')).toBe(false)
  })

  it('版本未知时不判定为过旧（旧版扩展不带头部，界面另有文案）', () => {
    expect(isExtensionOutdated(null)).toBe(false)
  })

  it('下限本身不是合法版本号时不做判断，避免误报', () => {
    expect(isExtensionOutdated('1.0.9', 'v1.2.0')).toBe(false)
    expect(isExtensionOutdated('1.0.9', '')).toBe(false)
  })
})

describe('EMPTY_EXTENSION_CONNECTION', () => {
  it('表示"从未连接过"', () => {
    expect(EMPTY_EXTENSION_CONNECTION).toEqual({ version: null, lastSeenAt: null })
  })
})
