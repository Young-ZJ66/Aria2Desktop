/**
 * 主进程运行时语言（唯一 import electron 的一处）。
 *
 * mainLocale.ts 刻意不 import electron 以便纯函数单测；但服务层需要"当前语言"，
 * 每次都写 app.getLocale() 闭包既啰嗦又容易漏 try/catch。这里收口成一个函数：
 * 单测里没 mock electron 时 app 为 undefined，mainLocaleFrom 会捕获并退回中文，
 * 因此既有中文断言不受影响。
 */
import { app } from 'electron'
import { mainLocaleFrom } from './mainLocale'
import type { MainLocale } from './mainLocale'

type RuntimeLocaleProvider = () => string | undefined | null

/**
 * 应用设置里的 language（21 种语言的 BCP-47 标签）优先于系统语言。
 * 只区分中/英：中文（zh-CN/zh-TW）走中文文案，其余 19 种语言统一走英文文案——
 * 主进程文案只有通知与对话框，渲染层的 21 语言已完整覆盖。
 *
 * 为什么必须先读设置：用户可以在设置里把应用切成 English，而 Windows 系统仍是中文；
 * 旧实现只看 app.getLocale()，会出现「界面全英文、下载完成通知却是中文」的割裂（实测 D-30）。
 *
 * 这里用注入的 provider 而不是直接 import settingsAccessor：settingsAccessor → secretCipher →
 * logger → appEnv 的静态依赖链需要完整的 electron app，而主进程文案工具本身应是轻量的；
 * 由 main.ts 在 bindSettingsStore 之后注入「读 settings.language」的闭包，未注入时跟随系统语言。
 */
let localeProvider: RuntimeLocaleProvider | null = null

/** 在 main.ts 绑定 settings 之后注入；传 null 可还原为跟随系统（单测用）。 */
export function setRuntimeLocaleProvider(provider: RuntimeLocaleProvider | null): void {
  localeProvider = provider
}

export function runtimeMainLocale(): MainLocale {
  try {
    const language = localeProvider?.()
    if (language) return mainLocaleFrom(() => language)
  } catch {
    // provider 未注入或读取 settings 失败：退回系统语言
  }
  return mainLocaleFrom(() => app?.getLocale?.() ?? '')
}
