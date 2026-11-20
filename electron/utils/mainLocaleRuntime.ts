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

export function runtimeMainLocale(): MainLocale {
  return mainLocaleFrom(() => app?.getLocale?.() ?? '')
}
