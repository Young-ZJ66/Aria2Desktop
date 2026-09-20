/**
 * IPC 安全判定的纯逻辑（**禁止 import electron**）。
 *
 * 为什么单独拆出这一层：
 * 1. 这里是安全边界——决定哪些页面能调用主进程 IPC。`electron/utils/ipcSecurity.ts` 顶层
 *    `import { app, BrowserWindow } from 'electron'`，而单测跑在 vitest 的 node 环境（无 electron），
 *    判定逻辑必须与 electron 解耦才可测。
 * 2. 包裹逻辑（校验失败返回什么）同样需要可测：一个通道返回错值，就可能让渲染层走进错误的错误分支。
 *
 * 约束：本文件一旦引入 electron 依赖，上述可测性立即失效。
 */

/** 开发环境允许的渲染进程来源（用作**精确 origin** 匹配，不是前缀匹配） */
export const DEV_ALLOWED_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173']

/** 来源判定入参（由 electron 侧负责收集） */
export interface SenderAuthInput {
  /** 调用方是否就是主窗口（BrowserWindow.fromWebContents(event.sender) === getMainWindow()） */
  isMainWindow: boolean
  /** event.sender.getURL() */
  senderUrl: string
  /** app.isPackaged */
  isPackaged: boolean
}

/**
 * 判断 IPC 调用来源是否可信。
 *
 * 判定语义与重构前**逐字一致**（这是安全代码，不要顺手"优化"）：
 * 1. 调用窗口必须存在且等于主窗口 —— 排除其它窗口与外部进程；
 * 2. 页面来源：
 *    - 开发环境：用 URL 的 **origin 精确匹配**。不能用 startsWith 之类的前缀判断，
 *      否则 `http://localhost:5173.evil.com` 会被误判为可信（真实存在的绕过手法）；
 *      URL 解析失败（非法 URL）时一律拒绝。
 *    - 生产环境：只接受 `file://` 开头的本应用页面（渲染层用 loadFile 加载打包产物）。
 */
export function isSenderAuthorized(input: SenderAuthInput): boolean {
  if (!input.isMainWindow) return false

  if (!input.isPackaged) {
    try {
      return DEV_ALLOWED_ORIGINS.includes(new URL(input.senderUrl).origin)
    } catch {
      return false
    }
  }
  return input.senderUrl.startsWith('file://')
}

/**
 * 包裹 `ipcMain.handle` 的 handler：来源不可信时返回 `failureValue`，可信时原样透传参数与返回值。
 *
 * 参数用 rest 透传：本仓有 23 个 handler 带 1~3 个额外参数（最多 3 个），不能写死。
 * 失败返回值由调用方显式给出——历史上存在 10 种不同形态（对象 / `''` / `undefined` / `{}` / `[]` …），
 * 统一成一种会改变渲染层拿到的语义。
 */
export function wrapSecureHandler<E, A extends unknown[], R>(
  handler: (event: E, ...args: A) => R,
  isAuthorized: (event: E) => boolean,
  failureValue: unknown
): (event: E, ...args: A) => unknown {
  return (event, ...args) => {
    if (!isAuthorized(event)) return failureValue
    return handler(event, ...args)
  }
}

/**
 * 包裹 `ipcMain.on` 的 listener。
 *
 * 与 handle 的语义差异：事件回调的返回值被 Electron 直接丢弃，渲染层也不会收到结果，
 * 因此这里不需要 failureValue——校验失败时丢弃本次调用即可。
 */
export function wrapSecureListener<E, A extends unknown[]>(
  listener: (event: E, ...args: A) => void,
  isAuthorized: (event: E) => boolean
): (event: E, ...args: A) => void {
  return (event, ...args) => {
    if (!isAuthorized(event)) return
    listener(event, ...args)
  }
}
