/**
 * 界面语言的判定规则
 *
 * 首次启动时应用无法从设置里读到语言（那时设置还没有默认值），只能靠
 * 浏览器/系统语言猜一个。猜错的后果是英文用户打开就是一屏中文，而语言
 * 开关还藏在设置里——这是最容易被卸载劝退的一步。
 *
 * 规则：用户显式选过的语言 > 系统语言 > 中文。
 * 支持 21 种常用语言；系统语言按主语言标签归类，地区变体回落到最接近的
 * 受支持语言（例如 zh-HK/zh-MO 归繁体中文，en-GB 归英文）。
 */

export type AppLocale =
  | 'zh-CN' | 'zh-TW'
  | 'en-US'
  | 'ja-JP' | 'ko-KR'
  | 'de-DE' | 'fr-FR' | 'es-ES' | 'pt-BR' | 'it-IT' | 'ru-RU'
  | 'ar-SA' | 'hi-IN' | 'th-TH' | 'vi-VN' | 'id-ID'
  | 'tr-TR' | 'nl-NL' | 'pl-PL' | 'uk-UA' | 'cs-CZ'

/** 语言下拉框的唯一来源：value 必须与 AppLocale 一致，label 用该语言的原生写法 */
export const APP_LOCALES: ReadonlyArray<{ value: AppLocale; label: string }> = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'en-US', label: 'English' },
  { value: 'ja-JP', label: '日本語' },
  { value: 'ko-KR', label: '한국어' },
  { value: 'de-DE', label: 'Deutsch' },
  { value: 'fr-FR', label: 'Français' },
  { value: 'es-ES', label: 'Español' },
  { value: 'pt-BR', label: 'Português (Brasil)' },
  { value: 'it-IT', label: 'Italiano' },
  { value: 'ru-RU', label: 'Русский' },
  { value: 'ar-SA', label: 'العربية' },
  { value: 'hi-IN', label: 'हिन्दी' },
  { value: 'th-TH', label: 'ไทย' },
  { value: 'vi-VN', label: 'Tiếng Việt' },
  { value: 'id-ID', label: 'Bahasa Indonesia' },
  { value: 'tr-TR', label: 'Türkçe' },
  { value: 'nl-NL', label: 'Nederlands' },
  { value: 'pl-PL', label: 'Polski' },
  { value: 'uk-UA', label: 'Українська' },
  { value: 'cs-CZ', label: 'Čeština' }
]

/** 系统语言无法归类时的兜底（项目以中文为主） */
export const DEFAULT_APP_LOCALE: AppLocale = 'zh-CN'

const EXACT_LOCALES: Record<string, AppLocale> = Object.fromEntries(
  APP_LOCALES.map(item => [item.value.toLowerCase(), item.value])
) as Record<string, AppLocale>

/** 主语言标签的回落目标（没有地区信息或地区不在支持列表时） */
const PRIMARY_LOCALES: Record<string, AppLocale> = {
  zh: 'zh-CN',
  en: 'en-US',
  ja: 'ja-JP',
  ko: 'ko-KR',
  de: 'de-DE',
  fr: 'fr-FR',
  es: 'es-ES',
  pt: 'pt-BR',
  it: 'it-IT',
  ru: 'ru-RU',
  ar: 'ar-SA',
  hi: 'hi-IN',
  th: 'th-TH',
  vi: 'vi-VN',
  id: 'id-ID',
  in: 'id-ID',
  tr: 'tr-TR',
  nl: 'nl-NL',
  pl: 'pl-PL',
  uk: 'uk-UA',
  cs: 'cs-CZ'
}

/** 严格判定：只认 21 种支持的语言值/可归类变体，其它一律返回 null，由调用方回退 */
export function normalizeLocale(value: unknown): AppLocale | null {
  if (typeof value !== 'string') return null
  const tag = value.trim().replace(/_/g, '-').toLowerCase()
  if (!tag) return null
  const exact = EXACT_LOCALES[tag]
  if (exact) return exact
  const [primary = '', region] = tag.split('-')
  if (primary === 'zh') {
    return region === 'tw' || region === 'hk' || region === 'mo' || tag.includes('hant')
      ? 'zh-TW'
      : 'zh-CN'
  }
  return PRIMARY_LOCALES[primary] ?? null
}

/**
 * 决定启动时用哪种语言
 *
 * @param stored 用户上次手动选择的语言（localStorage）
 * @param preferred 系统语言，通常是 navigator.language
 */
export function pickLocale(stored: unknown, preferred: unknown): AppLocale {
  return normalizeLocale(stored) ?? normalizeLocale(preferred) ?? DEFAULT_APP_LOCALE
}

/** 读取系统语言；在测试等没有 DOM 的环境下返回 undefined */
export function systemLocale(): string | undefined {
  if (typeof navigator === 'undefined') return undefined
  return navigator.language
}
