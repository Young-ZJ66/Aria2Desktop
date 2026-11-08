import { describe, expect, it } from 'vitest'
import { APP_LOCALES, DEFAULT_APP_LOCALE, normalizeLocale, pickLocale } from './locale'

describe('normalizeLocale', () => {
  it('认出全部 21 种支持的语言', () => {
    for (const { value } of APP_LOCALES) {
      expect(normalizeLocale(value)).toBe(value)
    }
    expect(APP_LOCALES).toHaveLength(21)
  })

  it('语言列表不含重复 value / label', () => {
    expect(new Set(APP_LOCALES.map(item => item.value)).size).toBe(APP_LOCALES.length)
    expect(new Set(APP_LOCALES.map(item => item.label)).size).toBe(APP_LOCALES.length)
  })

  it('大小写与下划线都归一', () => {
    expect(normalizeLocale('EN-us')).toBe('en-US')
    expect(normalizeLocale('zh_cn')).toBe('zh-CN')
    expect(normalizeLocale('JA_jp')).toBe('ja-JP')
    expect(normalizeLocale('PT_br')).toBe('pt-BR')
  })

  it('按地区归类：简繁中文分开，其余地区变体回落到主语言', () => {
    expect(normalizeLocale('zh-HK')).toBe('zh-TW')
    expect(normalizeLocale('zh-TW')).toBe('zh-TW')
    expect(normalizeLocale('zh-Hant')).toBe('zh-TW')
    expect(normalizeLocale('zh-CN')).toBe('zh-CN')
    expect(normalizeLocale('zh-SG')).toBe('zh-CN')
    expect(normalizeLocale('en-GB')).toBe('en-US')
    expect(normalizeLocale('en')).toBe('en-US')
    expect(normalizeLocale('ja')).toBe('ja-JP')
    expect(normalizeLocale('de-AT')).toBe('de-DE')
    expect(normalizeLocale('fr-CA')).toBe('fr-FR')
    expect(normalizeLocale('es-419')).toBe('es-ES')
    expect(normalizeLocale('pt-PT')).toBe('pt-BR')
    expect(normalizeLocale('ru')).toBe('ru-RU')
    expect(normalizeLocale('in')).toBe('id-ID')
  })

  it('其它语言、空值与非法类型返回 null', () => {
    expect(normalizeLocale('sv-SE')).toBeNull()
    expect(normalizeLocale('fi')).toBeNull()
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
    expect(pickLocale('ru-RU', 'de-DE')).toBe('ru-RU')
  })

  it('没有用户选择时看系统语言', () => {
    expect(pickLocale(null, 'en-US')).toBe('en-US')
    expect(pickLocale(undefined, 'zh-HK')).toBe('zh-TW')
    expect(pickLocale(null, 'ko-KR')).toBe('ko-KR')
    expect(pickLocale(null, 'tr-TR')).toBe('tr-TR')
  })

  it('用户选择损坏时也回落到系统语言，而不是直接兜底', () => {
    expect(pickLocale('garbage', 'en-GB')).toBe('en-US')
  })

  it('两者都不可用时用默认语言', () => {
    expect(pickLocale(null, 'sv-SE')).toBe(DEFAULT_APP_LOCALE)
    expect(pickLocale('', '')).toBe('zh-CN')
  })
})
