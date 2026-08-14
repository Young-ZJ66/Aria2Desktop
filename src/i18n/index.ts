/**
 * vue-i18n 初始化配置
 * 支持中文和英文，默认中文
 */

import { createI18n } from 'vue-i18n'
import zhCN from '@/locales/zh-CN.json'
import enUS from '@/locales/en-US.json'

export type AppLocale = 'zh-CN' | 'en-US'

const STORAGE_KEY = 'app-locale'

/**
 * 从 localStorage 读取用户选择的语言，默认中文
 */
function getDefaultLocale(): AppLocale {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'en-US' || stored === 'zh-CN') {
    return stored
  }
  return 'zh-CN'
}

const i18n = createI18n({
  legacy: false,
  locale: getDefaultLocale(),
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': zhCN,
    'en-US': enUS
  }
})

/**
 * 切换语言并持久化
 */
export function setLocale(locale: AppLocale): void {
  i18n.global.locale.value = locale
  localStorage.setItem(STORAGE_KEY, locale)
}

/**
 * 获取当前语言
 */
export function getLocale(): AppLocale {
  return i18n.global.locale.value as AppLocale
}

export default i18n
