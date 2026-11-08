import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_LOCALE, normalizeLocale, pickLocale } from './locale'

describe('normalizeLocale', () => {
  it('认这六个精确值', () => {
    expect(normalizeLocale('zh-CN')).toBe('zh-CN')
    expect(normalizeLocale('en-US')).toBe('en-US')
    expect(normalizeLocale('ja-JP')).toBe('ja-JP')
    expect(normalizeLocale('ko-KR')).toBe('ko-KR')
    expect(normalizeLocale('de-DE')).toBe('de-DE')
    expect(normalizeLocale('fr-FR')).toBe('fr-FR')
  })

  it('大小写与下划线都归一', () => {
    expect(normalizeLocale('EN-us')).toBe('en-US')
    expect(normalizeLocale('zh_cn')).toBe('zh-CN')
    expect(normalizeLocale('JA_jp')).toBe('ja-JP')
  })

  it('按主语言标签归类：zh-HK / zh-TW 都算中文，en-GB 算英文', () => {
    expect(normalizeLocale('zh-HK')).toBe('zh-CN')
    expect(normalizeLocale('zh-TW')).toBe('zh-CN')
    expect(normalizeLocale('en-GB')).toBe('en-US')
    expect(normalizeLocale('en')).toBe('en-US')
    expect(normalizeLocale('ja')).toBe('ja-JP')
    expect(normalizeLocale('de-AT')).toBe('de-DE')
    expect(normalizeLocale('fr-CA')).toBe('fr-FR')
    expect(normalizeLocale('ko')).toBe('ko-KR')
  })

  it('其它语言、空值与非法类型返回 null', () => {
    expect(normalizeLocale('es-ES')).toBeNull()
    expect(normalizeLocale('ru')).toBeNull()
    expect(normalizeLocale('')).toBeNull()
    expect(normalizeLocale('   ')).toBeNull()
    expect(normalizeLocale(null)).toBeNull()
    expect(normalizeLocale(undefined)).toBeNull()
    expect(normalizeLocale(42)).toBeNull()
  })
})

describe('pickLocale', () => {
  it('用户选过的语言优先于系统语言', () => {
    expect(pickLocale('zh-CN', 'en-US')).toBe('zh-CN')
    expect(pickLocale('en-US', 'zh-CN')).toBe('en-US')
    expect(pickLocale('ja-JP', 'fr-FR')).toBe('ja-JP')
  })

  it('没有用户选择时看系统语言', () => {
    expect(pickLocale(null, 'en-US')).toBe('en-US')
    expect(pickLocale(undefined, 'zh-TW')).toBe('zh-CN')
    expect(pickLocale(null, 'ko-KR')).toBe('ko-KR')
  })

  it('用户选择损坏时也回落到系统语言，而不是直接兜底', () => {
    expect(pickLocale('garbage', 'en-GB')).toBe('en-US')
  })

  it('两者都不可用时用默认语言', () => {
    expect(pickLocale(null, 'es-ES')).toBe(DEFAULT_APP_LOCALE)
    expect(pickLocale('', '')).toBe('zh-CN')
  })
})
