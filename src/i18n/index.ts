/**
 * vue-i18n 初始化配置
 * 支持中文、英文、日文、韩文、德文、法文：首次启动按系统语言猜，之后跟随用户选择
 */

import { createI18n } from 'vue-i18n'
import zhCN from '@/locales/zh-CN.json'
import enUS from '@/locales/en-US.json'
import jaJP from '@/locales/ja-JP.json'
import koKR from '@/locales/ko-KR.json'
import deDE from '@/locales/de-DE.json'
import frFR from '@/locales/fr-FR.json'
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

const i18n = createI18n({
  legacy: false,
  locale: getDefaultLocale(),
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': zhCN,
    'en-US': enUS,
    'ja-JP': jaJP,
    'ko-KR': koKR,
    'de-DE': deDE,
    'fr-FR': frFR
  }
})

/**
 * 切换语言并持久化
 */
export function setLocale(locale: AppLocale): void {
  i18n.global.locale.value = locale
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
