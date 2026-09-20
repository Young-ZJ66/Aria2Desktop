import { describe, expect, it } from 'vitest'
import { compareVersions } from './version'

/**
 * 版本比较决定"是否有新版本"的判定，一旦方向搞反会导致永远提示有新版本或永远不提示。
 * 语义与重构前完全一致（不处理预发布后缀，调用方需先剥离 v 前缀）。
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

  it('预发布/非数字后缀按 0 处理（已知限制，勿依赖它做预发布排序）', () => {
    expect(compareVersions('1.0.0-beta', '1.0.0')).toBe(0)
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
