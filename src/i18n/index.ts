/**
 * vue-i18n 初始化配置
 * 支持 21 种常用语言：首次启动按系统语言猜，之后跟随用户选择
 */

import { createI18n } from 'vue-i18n'
import zhCN from '@/locales/zh-CN.json'
import zhTW from '@/locales/zh-TW.json'
import enUS from '@/locales/en-US.json'
import jaJP from '@/locales/ja-JP.json'
import koKR from '@/locales/ko-KR.json'
import deDE from '@/locales/de-DE.json'
import frFR from '@/locales/fr-FR.json'
import esES from '@/locales/es-ES.json'
import ptBR from '@/locales/pt-BR.json'
import itIT from '@/locales/it-IT.json'
import ruRU from '@/locales/ru-RU.json'
import arSA from '@/locales/ar-SA.json'
import hiIN from '@/locales/hi-IN.json'
import thTH from '@/locales/th-TH.json'
import viVN from '@/locales/vi-VN.json'
import idID from '@/locales/id-ID.json'
import trTR from '@/locales/tr-TR.json'
import nlNL from '@/locales/nl-NL.json'
import plPL from '@/locales/pl-PL.json'
import ukUA from '@/locales/uk-UA.json'
import csCZ from '@/locales/cs-CZ.json'
import { pickLocale, systemLocale, type AppLocale } from '@/shared/locale'

export type { AppLocale }

const STORAGE_KEY = 'app-locale'

/**
 * 用户选过就用用户的，否则看系统语言
 *
 * 这里不能直接写死中文：英文用户第一次打开就是一屏中文，
 * 而语言开关藏在设置里，很多人根本走不到那里。
 */
function getDefaultLocale(): AppLocale {
  let stored: string | null = null
  try {
    stored = localStorage.getItem(STORAGE_KEY)
  } catch {
    // 隐私模式下 localStorage 可能直接抛错，此时按系统语言处理
  }
  return pickLocale(stored, systemLocale())
}

/** 同步 <html lang>，保证辅助技术、拼写检查与字体回退拿到正确语言 */
function syncDocumentLang(locale: AppLocale): void {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale
    // 阿拉伯语从右到左排版；其它语言保持 LTR
    document.documentElement.dir = locale === 'ar-SA' ? 'rtl' : 'ltr'
  }
}

const i18n = createI18n({
  legacy: false,
  locale: getDefaultLocale(),
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': zhCN,
    'zh-TW': zhTW,
    'en-US': enUS,
    'ja-JP': jaJP,
    'ko-KR': koKR,
    'de-DE': deDE,
    'fr-FR': frFR,
    'es-ES': esES,
    'pt-BR': ptBR,
    'it-IT': itIT,
    'ru-RU': ruRU,
    'ar-SA': arSA,
    'hi-IN': hiIN,
    'th-TH': thTH,
    'vi-VN': viVN,
    'id-ID': idID,
    'tr-TR': trTR,
    'nl-NL': nlNL,
    'pl-PL': plPL,
    'uk-UA': ukUA,
    'cs-CZ': csCZ
  }
})

syncDocumentLang(i18n.global.locale.value as AppLocale)

/**
 * 切换语言并持久化
 */
export function setLocale(locale: AppLocale): void {
  i18n.global.locale.value = locale
  syncDocumentLang(locale)
  try {
    localStorage.setItem(STORAGE_KEY, locale)
  } catch (error) {
    // 存储不可用（隐私模式/配额满）时仅影响下次默认语言，不影响本次切换
    console.warn('Failed to persist locale:', error)
  }
}

/**
 * 获取当前语言
 */
export function getLocale(): AppLocale {
  return i18n.global.locale.value as AppLocale
}

export default i18n
