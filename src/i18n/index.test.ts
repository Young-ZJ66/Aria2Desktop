import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

interface FakeStorage {
  map: Map<string, string>
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

const h = vi.hoisted(() => ({
  storage: null as unknown as FakeStorage,
  storageThrowsOnRead: false,
  storageThrowsOnWrite: false,
  systemLanguage: 'zh-CN'
}))

/**
 * i18n 模块在 import 时就会读 localStorage / navigator / document，
 * 而 vue 的 runtime-dom 在模块加载阶段就要 document.createElement('template')，
 * 所以桩 document 必须同时满足这两边。
 */
function installDom() {
  h.storage = {
    map: new Map<string, string>(),
    getItem(key: string) {
      if (h.storageThrowsOnRead) throw new Error('storage blocked')
      return h.storage.map.has(key) ? (h.storage.map.get(key) as string) : null
    },
    setItem(key: string, value: string) {
      if (h.storageThrowsOnWrite) throw new Error('quota exceeded')
      h.storage.map.set(key, value)
    }
  }
  const documentElement = { lang: '', dir: '' }
  const fakeDocument = {
    documentElement,
    createElement: () => ({ style: {}, setAttribute: () => {}, appendChild: () => {} }),
    createElementNS: () => ({ style: {}, setAttribute: () => {}, appendChild: () => {} }),
    createTextNode: () => ({}),
    querySelector: () => null,
    addEventListener: () => {},
    removeEventListener: () => {}
  }
  vi.stubGlobal('localStorage', h.storage)
  vi.stubGlobal('document', fakeDocument)
  // 用 getter 而不是快照：用例里会改 h.systemLanguage 再重新 import
  vi.stubGlobal('navigator', { get language() { return h.systemLanguage } })
}

async function loadI18n() {
  vi.resetModules()
  return import('./index')
}

function documentElement() {
  return (globalThis as unknown as { document: { documentElement: { lang: string, dir: string } } }).document.documentElement
}

beforeEach(() => {
  h.storageThrowsOnRead = false
  h.storageThrowsOnWrite = false
  h.systemLanguage = 'zh-CN'
  installDom()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('启动时决定语言', () => {
  it('没有任何存储与系统提示时回落到简体中文', async () => {
    h.systemLanguage = ''
    const { getLocale } = await loadI18n()
    expect(getLocale()).toBe('zh-CN')
  })

  it('首次启动按系统语言猜（英文系统不会一屏中文）', async () => {
    h.systemLanguage = 'en-US'
    const { getLocale } = await loadI18n()
    expect(getLocale()).toBe('en-US')
  })

  it('用户上次选过的语言优先于系统语言', async () => {
    h.systemLanguage = 'en-US'
    h.storage.map.set('app-locale', 'ja-JP')
    const { getLocale } = await loadI18n()
    expect(getLocale()).toBe('ja-JP')
  })

  it('存储里的非法值被忽略，退回系统语言', async () => {
    h.systemLanguage = 'de-DE'
    h.storage.map.set('app-locale', 'klingon')
    const { getLocale } = await loadI18n()
    expect(getLocale()).toBe('de-DE')
  })

  it('localStorage 读取抛错（隐私模式）时仍能按系统语言启动', async () => {
    h.storageThrowsOnRead = true
    h.systemLanguage = 'fr-FR'
    const { getLocale } = await loadI18n()
    expect(getLocale()).toBe('fr-FR')
  })

  it('启动时同步 <html lang> 与方向', async () => {
    h.storage.map.set('app-locale', 'ar-SA')
    await loadI18n()
    expect(documentElement().lang).toBe('ar-SA')
    expect(documentElement().dir).toBe('rtl')
  })

  it('非阿拉伯语启动时方向是 ltr', async () => {
    h.storage.map.set('app-locale', 'en-US')
    await loadI18n()
    expect(documentElement().lang).toBe('en-US')
    expect(documentElement().dir).toBe('ltr')
  })
})

describe('setLocale', () => {
  it('切换语言并同步文档 lang/dir', async () => {
    const { setLocale, getLocale } = await loadI18n()
    setLocale('ar-SA')
    expect(getLocale()).toBe('ar-SA')
    expect(documentElement().lang).toBe('ar-SA')
    expect(documentElement().dir).toBe('rtl')
    setLocale('en-US')
    expect(documentElement().lang).toBe('en-US')
    expect(documentElement().dir).toBe('ltr')
  })

  it('切换后写入 localStorage，下次启动生效', async () => {
    const { setLocale } = await loadI18n()
    setLocale('ko-KR')
    expect(h.storage.map.get('app-locale')).toBe('ko-KR')
    const { getLocale } = await loadI18n()
    expect(getLocale()).toBe('ko-KR')
  })

  it('写入失败只告警，不影响本次切换', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    h.storageThrowsOnWrite = true
    const { setLocale, getLocale } = await loadI18n()
    expect(() => setLocale('it-IT')).not.toThrow()
    expect(getLocale()).toBe('it-IT')
    expect(documentElement().lang).toBe('it-IT')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('Failed to persist locale')
  })
})

describe('语言包装配', () => {
  it('21 种语言全部装配，fallback 是简体中文', async () => {
    const module = await loadI18n()
    const composer = module.default.global as unknown as {
      availableLocales: string[]
      fallbackLocale: { value: unknown }
    }
    expect([...composer.availableLocales].sort()).toEqual([
      'ar-SA', 'cs-CZ', 'de-DE', 'en-US', 'es-ES', 'fr-FR', 'hi-IN', 'id-ID', 'it-IT', 'ja-JP',
      'ko-KR', 'nl-NL', 'pl-PL', 'pt-BR', 'ru-RU', 'th-TH', 'tr-TR', 'uk-UA', 'vi-VN', 'zh-CN', 'zh-TW'
    ])
    expect(String(composer.fallbackLocale.value)).toBe('zh-CN')
  })

  it('英文环境取到英文文案，不是中文兜底', async () => {
    h.systemLanguage = 'en-US'
    const en = await loadI18n()
    const enText = (en.default.global.t as (key: string) => string)('nav.downloading')
    h.systemLanguage = 'zh-CN'
    const zh = await loadI18n()
    const zhText = (zh.default.global.t as (key: string) => string)('nav.downloading')
    expect(enText).toBeTruthy()
    expect(zhText).toBeTruthy()
    expect(enText).not.toBe(zhText)
  })

  it('阿拉伯语环境取到阿拉伯语文案', async () => {
    h.systemLanguage = 'ar-SA'
    const module = await loadI18n()
    const text = (module.default.global.t as (key: string) => string)('nav.downloading')
    expect(text).toMatch(/[\u0600-\u06FF]/)
  })
})
