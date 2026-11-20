/**
 * 主进程的界面语言口径（单一事实来源）。
 *
 * 主进程没有 i18n 实例——语言包在渲染层，主进程拿不到。历史上各处各写一份
 * `app.getLocale().startsWith('zh')`，很容易出现"托盘是英文、对话框是中文"的割裂。
 * 这里统一成一个函数，新增主进程文案时一律走它。
 *
 * 只区分中/英：主进程的文案量很小（对话框与系统通知），
 * 其余 19 种语言在渲染层已完整覆盖；主进程退回英文比退回中文更通用。
 */

export type MainLocale = 'zh' | 'en'

/** 把 Electron 的 locale（如 'zh-CN'、'en-US'）归一成主进程文案语言 */
export function resolveMainLocale(locale: string | undefined | null): MainLocale {
  return String(locale ?? '').toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

/**
 * 从取语言函数得到主进程文案语言（本模块刻意不 import electron，
 * 这样纯函数与单测都不需要 mock 主进程运行时）。
 *
 * 取不到时退回中文：主进程历史文案以中文为基准，
 * 测试里 mock 的 electron 大多没有 getLocale，退回英文会让既有断言莫名变红。
 */
export function mainLocaleFrom(getLocale?: () => string): MainLocale {
  try {
    const locale = getLocale?.()
    // 取不到具体语言时按中文基准兜底（与 resolveMainLocale 的 "非中文即英文" 不同：
    // 那是已知语言之间的归一，这里是"根本不知道语言"）
    return locale ? resolveMainLocale(locale) : 'zh'
  } catch {
    return 'zh'
  }
}
