import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Naive UI 主题与语言映射。
 *
 * 这张 21 语言的映射表最容易「悄悄错」：漏一项就是某个语言下组件文案变成
 * 英文兜底，但界面其他部分是本地语言，只有细心用户才看得出。
 */
const settings = vi.hoisted(() => ({ settings: { theme: 'auto' as 'auto' | 'dark' | 'light' } }))
const localeRef = vi.hoisted(() => ({ value: 'zh-CN' }))

vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: () => settings }))
vi.mock('@/i18n', () => ({ getLocale: () => localeRef.value }))
vi.mock('@/styles/themeTokens', () => ({ buildThemeOverrides: (dark: boolean) => ({ dark }) }))

import { useThemeManager } from './useThemeManager'

interface FakeMql {
  matches: boolean
  handler: ((event: { matches: boolean }) => void) | null
  addEventListener: (type: string, handler: (event: { matches: boolean }) => void) => void
  removeEventListener: (type: string) => void
}

let mql: FakeMql

beforeEach(() => {
  settings.settings.theme = 'auto'
  localeRef.value = 'zh-CN'
  mql = {
    matches: false,
    handler: null,
    addEventListener(_type, handler) { mql.handler = handler },
    removeEventListener() { mql.handler = null }
  }
  ;(globalThis as unknown as { window: unknown }).window = { matchMedia: () => mql }
})

describe('深浅色判定', () => {
  it('theme=dark 强制深色', () => {
    settings.settings.theme = 'dark'
    expect(useThemeManager().isDark.value).toBe(true)
  })

  it('theme=light 强制浅色', () => {
    settings.settings.theme = 'light'
    expect(useThemeManager().isDark.value).toBe(false)
  })

  it('theme=auto 跟随系统，并在系统切换后重算', () => {
    const manager = useThemeManager()
    manager.initSystemThemeListener()
    mql.matches = false
    expect(manager.isDark.value).toBe(false)
    mql.handler?.({ matches: true })
    expect(manager.isDark.value).toBe(true)
    manager.disposeSystemThemeListener()
  })

  it('没有 matchMedia 时不抛错（纯 node 环境）', () => {
    const manager = useThemeManager()
    // systemDark 是模块级状态：先复位，再模拟「没有 matchMedia」
    mql.matches = false
    manager.initSystemThemeListener()
    manager.disposeSystemThemeListener()
    ;(globalThis as unknown as { window: unknown }).window = {}
    expect(() => manager.initSystemThemeListener()).not.toThrow()
    expect(manager.isDark.value).toBe(false)
  })

  it('currentTheme 深色时为 darkTheme、浅色时为 null', () => {
    settings.settings.theme = 'dark'
    expect(useThemeManager().currentTheme.value).toBeTruthy()
    settings.settings.theme = 'light'
    expect(useThemeManager().currentTheme.value).toBeNull()
  })
})

describe('语言映射', () => {
  it('21 种语言都有对应的 naive-ui 语言包（不漏项）', () => {
    const manager = useThemeManager()
    const locales = [
      'zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ko-KR', 'de-DE', 'fr-FR', 'es-ES', 'pt-BR',
      'it-IT', 'ru-RU', 'ar-SA', 'hi-IN', 'th-TH', 'vi-VN', 'id-ID', 'tr-TR', 'nl-NL',
      'pl-PL', 'uk-UA', 'cs-CZ'
    ]
    for (const locale of locales) {
      localeRef.value = locale
      expect(manager.naiveLocale.value, locale).toBeTruthy()
      expect(manager.naiveLocale.value.name, locale).toBeTruthy()
    }
  })

  it('阿拉伯语用 ar 语言包（RTL 文案）', () => {
    localeRef.value = 'ar-SA'
    const locale = useThemeManager().naiveLocale.value
    expect(String(locale.name)).toMatch(/ar/i)
  })

  describe('重复初始化与主题覆盖', () => {
    it('已初始化过监听器时再调用只同步当前系统值，不重复注册', () => {
      const manager = useThemeManager()
      mql.matches = true
      manager.initSystemThemeListener()
      expect(manager.isDark.value).toBe(true)
      let added = 0
      const original = mql.addEventListener
      mql.addEventListener = (type, handler) => { added += 1; original(type, handler) }
      mql.matches = false
      manager.initSystemThemeListener()
      expect(manager.isDark.value).toBe(false)
      expect(added).toBe(0)
      manager.disposeSystemThemeListener()
    })

    it('themeOverrides 跟随深浅色重新计算', () => {
      settings.settings.theme = 'dark'
      expect(useThemeManager().themeOverrides.value).toEqual({ dark: true })
      settings.settings.theme = 'light'
      expect(useThemeManager().themeOverrides.value).toEqual({ dark: false })
    })
  })

  it('印地语没有官方语言包，回落英文', () => {
    localeRef.value = 'hi-IN'
    const hindi = useThemeManager().naiveLocale.value
    localeRef.value = 'en-US'
    const english = useThemeManager().naiveLocale.value
    expect(hindi).toBe(english)
  })
})
