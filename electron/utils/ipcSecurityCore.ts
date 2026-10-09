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
  /**
   * 生产环境允许的渲染层入口（`pathToFileURL(渲染层 index.html)` 的字符串形式）。
   *
   * 为什么需要：只校验 `file://` 前缀意味着主窗口一旦被导航到**任意本地 HTML 文件**，
   * 那个页面就继承了完整的特权桥（读解密后的 RPC 密钥、删除下载目录文件、执行 yt-dlp）。
   * 传入本值后改为与真正的入口比对。省略时回退为旧的"任意 file://"语义（保守兜底：
   * 拿不到入口路径时不应把应用锁死）。
   */
  allowedFileUrl?: string
  /**
   * 入口所在目录（`pathToFileURL(dirname(渲染层 index.html))`）。
   *
   * 用途是**兜底**：见 isSenderAuthorized 中"同目录放行"的说明——只比对入口文件本身过于脆弱，
   * URL 形态的任何细微差异都会让整个应用的 IPC 失效（界面直接不可用）。
   */
  allowedFileDirUrl?: string
}

/**
 * 归一化 file:// URL 以便比较：去掉 hash/query、解码百分号编码、统一分隔符，
 * Windows 上再统一小写（盘符与路径大小写不敏感）。
 *
 * 为什么必须归一化：`loadFile()` 产出的 URL 与 `pathToFileURL()` 可能只在
 * `%20` / 大小写 / 尾随 `#/route` 上不同，直接字符串比较会把**自己的页面**判成非法，
 * 那样的"安全加固"会直接让整个应用失去 IPC。
 */
export function normalizeFileUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return raw
  }
  url.hash = ''
  url.search = ''
  let decoded = url.pathname
  try {
    decoded = decodeURIComponent(url.pathname)
  } catch {
    // 非法百分号编码：保持原样参与比较
  }
  decoded = decoded.replace(/\\/g, '/')

  // file:// 有两种合法写法：file:///C:/x 与 file://C:/x（后者盘符落在 host 段）。
  // 不归一化的话两者会被判成不同路径，而"判错"的代价是整个应用的 IPC 失效，
  // 因此这里把 host（盘符）并回路径，只按路径段比较。
  const prefix = url.protocol === 'file:' && url.host ? `/${url.host}` : ''
  const normalized = `${url.protocol}//${prefix}${decoded}`
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

/**
 * 判断 IPC 调用来源是否可信。
 *
 * 判定语义（**安全代码，不要顺手"优化"**）：
 * 1. 调用窗口必须存在且等于主窗口 —— 排除其它窗口与外部进程；
 * 2. 页面来源按"这个应用会加载什么页面"分两种：
 *    - **开发态**（`npm run dev`）：渲染层由 Vite dev server 提供，用 URL 的
 *      **origin 精确匹配**。不能用 startsWith 之类的前缀判断，否则
 *      `http://localhost:5173.evil.com` 会被误判为可信（真实存在的绕过手法）。
 *    - **file:// 页面**：打包后加载 `dist/vue/index.html`，以及未打包但 `NODE_ENV`
 *      不是 development 时的 `electron .`（同一个 file:// 页面）。两者共用
 *      `isAllowedFileSender`：只认本应用的渲染层入口及其同目录文件。
 *      此前 `electron .` 会走到开发态分支而被拒 → 界面能开、IPC 全废。
 */
export function isSenderAuthorized(input: SenderAuthInput): boolean {
  if (!input.isMainWindow) return false

  if (!input.isPackaged) {
    try {
      if (DEV_ALLOWED_ORIGINS.includes(new URL(input.senderUrl).origin)) return true
    } catch {
      // URL 解析失败（空串、畸形 URL）：交给下面的 file:// 判定拒绝
    }
  }

  return isAllowedFileSender(input)
}

/**
 * file:// 来源判定：本应用渲染层入口本身，或与入口同目录的文件（应用自身前端产物）。
 *
 * 兜底放宽到"同目录"的理由：一旦 URL 形态出现任何未预料的差异（不同 Electron 版本的
 * 编码方式、安装路径规范化等），IPC 会**全部失效**——用户看到的是界面彻底不可用。
 * 这个兜底不构成实际削弱：能往应用目录写文件的攻击者本就能替换 index.html 本身；
 * 它挡住的仍然是真正的风险场景——被导航到应用目录之外的本地页面（如下载目录里的 HTML）。
 */
function isAllowedFileSender(input: SenderAuthInput): boolean {
  if (!input.senderUrl.startsWith('file://')) return false

  // 拿不到入口路径时的保守策略：打包态放行（宁可保持可用，也不能把应用锁死），
  // 开发态维持严格——那个模式本来就应该由 dev server 提供页面。
  if (!input.allowedFileUrl) return input.isPackaged

  const sender = normalizeFileUrl(input.senderUrl)
  if (sender === normalizeFileUrl(input.allowedFileUrl)) return true

  if (input.allowedFileDirUrl) {
    const dir = normalizeFileUrl(input.allowedFileDirUrl)
    const prefix = dir.endsWith('/') ? dir : `${dir}/`
    if (sender.startsWith(prefix)) return true
  }
  return false
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
