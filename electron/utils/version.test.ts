import { describe, expect, it } from 'vitest'
import { compareVersions } from './version'

/**
 * 版本比较决定"是否有新版本"的判定，一旦方向搞反会导致永远提示有新版本或永远不提示。
 * 语义按 SemVer：核心版本数值比较，预发布按标识排序，调用方需先剥离 v 前缀。
 */
describe('compareVersions', () => {
  it('逐段数值比较（不是字符串比较）', () => {
    expect(compareVersions('1.0.10', '1.0.9')).toBe(1)
    expect(compareVersions('1.0.9', '1.0.10')).toBe(-1)
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1)
  })

  it('段数不同时缺位补 0', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.0.0', '1.0')).toBe(0)
    expect(compareVersions('1.0.1', '1.0')).toBe(1)
  })

  it('主版本优先于次版本', () => {
    expect(compareVersions('2.0.0', '1.99.99')).toBe(1)
    expect(compareVersions('1.99.99', '2.0.0')).toBe(-1)
  })

  it('相等版本返回 0', () => {
    expect(compareVersions('1.0.7', '1.0.7')).toBe(0)
    expect(compareVersions('0.0.0', '0.0.0')).toBe(0)
  })

  it('预发布按 SemVer 排序：同核心时正式版高于预发布版', () => {
    expect(compareVersions('1.0.0-beta', '1.0.0')).toBe(-1)
    expect(compareVersions('1.0.0', '1.0.0-beta')).toBe(1)
    expect(compareVersions('1.0.0-rc.1', '1.0.0-beta.9')).toBe(1)
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.10')).toBe(-1)
    expect(compareVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1)
    expect(compareVersions('1.0.0+build5', '1.0.0')).toBe(0)
  })

  it('当前版本与最新版本（真实场景）', () => {
    // 应用内更新：latestVersion 来自 release tag（已剥离 v 前缀），与 app.getVersion() 比较
    const latest = 'v1.0.7'.replace(/^v/i, '')
    expect(compareVersions(latest, '1.0.6')).toBe(1) // 有更新
    expect(compareVersions(latest, '1.0.7')).toBe(0) // 已是最新
    expect(compareVersions(latest, '1.0.8')).toBe(-1) // 本地版本更新（开发中）
  })
})

describe('compareVersions 的预发布段排序', () => {
  it('数字段按数值比较（不是字典序）', () => {
    expect(compareVersions('1.0.0-beta.10', '1.0.0-beta.9')).toBe(1)
    expect(compareVersions('1.0.0-beta.9', '1.0.0-beta.10')).toBe(-1)
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.2')).toBe(0)
  })

  it('数字段比字母段小（SemVer：1.0.0-1 < 1.0.0-alpha）', () => {
    expect(compareVersions('1.0.0-1', '1.0.0-alpha')).toBe(-1)
    expect(compareVersions('1.0.0-alpha', '1.0.0-1')).toBe(1)
  })

  it('字母段按字典序', () => {
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBe(-1)
    expect(compareVersions('1.0.0-beta', '1.0.0-alpha')).toBe(1)
    expect(compareVersions('1.0.0-rc.1', '1.0.0-beta.9')).toBe(1)
  })

  it('段数不同时短者更小', () => {
    expect(compareVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1)
    expect(compareVersions('1.0.0-alpha.1', '1.0.0-alpha')).toBe(1)
  })
})
