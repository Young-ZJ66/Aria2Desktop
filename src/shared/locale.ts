/**
 * 界面语言的判定规则
 *
 * 首次启动时应用无法从设置里读到语言（那时设置还没有默认值），只能靠
 * 浏览器/系统语言猜一个。猜错的后果是英文用户打开就是一屏中文，而语言
 * 开关还藏在设置里——这是最容易被卸载劝退的一步。
 *
 * 规则：用户显式选过的语言 > 系统语言 > 中文。
 * 只支持两种语言，所以系统语言只按主语言标签归类，`zh-HK`/`zh-TW` 都算中文。
 */

export type AppLocale = 'zh-CN' | 'en-US'

/** 系统语言无法归类时的兜底（项目以中文为主） */
export const DEFAULT_APP_LOCALE: AppLocale = 'zh-CN'

/** 严格判定：只认这两个值，其它一律返回 null，由调用方回退 */
export function normalizeLocale(value: unknown): AppLocale | null {
  if (typeof value !== 'string') return null
  const tag = value.trim().replace(/_/g, '-').toLowerCase()
  if (!tag) return null
  if (tag === 'zh-cn') return 'zh-CN'
  if (tag === 'en-us') return 'en-US'
  const primary = tag.split('-')[0]
  if (primary === 'zh') return 'zh-CN'
  if (primary === 'en') return 'en-US'
  return null
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
