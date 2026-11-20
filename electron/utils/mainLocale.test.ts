import { describe, expect, it, vi } from 'vitest'
import { mainLocaleFrom, resolveMainLocale } from './mainLocale'

describe('resolveMainLocale 归一语言', () => {
  it.each(['zh', 'zh-CN', 'zh-TW', 'ZH-cn', 'zh-Hans-CN'])('%s 归一为中文', locale => {
    expect(resolveMainLocale(locale)).toBe('zh')
  })

  it.each(['en', 'en-US', 'ja', 'de-DE', 'ar-SA', 'fr'])('%s 归一为英文', locale => {
    expect(resolveMainLocale(locale)).toBe('en')
  })

  it('空值归一为英文（已知语言之间的归一，与「取不到语言」不同）', () => {
    expect(resolveMainLocale(undefined)).toBe('en')
    expect(resolveMainLocale(null)).toBe('en')
    expect(resolveMainLocale('')).toBe('en')
  })

  it('不做子串匹配：含 zh 但非前缀的语言按英文', () => {
    expect(resolveMainLocale('en-zh')).toBe('en')
  })
})

describe('mainLocaleFrom 从取语言函数得到文案语言', () => {
  it('取到中文语言时返回 zh', () => {
    expect(mainLocaleFrom(() => 'zh-CN')).toBe('zh')
  })

  it('取到非中文语言时返回 en', () => {
    expect(mainLocaleFrom(() => 'ja-JP')).toBe('en')
  })

  it('没有提供取语言函数时退回中文（主进程历史文案以中文为基准）', () => {
    expect(mainLocaleFrom()).toBe('zh')
  })

  it('取语言函数返回空串时退回中文', () => {
    expect(mainLocaleFrom(() => '')).toBe('zh')
  })

  it('取语言函数抛错时退回中文，不把异常抛给调用方', () => {
    const boom = vi.fn(() => { throw new Error('app is not ready') })
    expect(mainLocaleFrom(boom)).toBe('zh')
    expect(boom).toHaveBeenCalledTimes(1)
  })
})
