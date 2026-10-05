import { app, BrowserWindow, ipcMain } from 'electron'
import * as path from 'path'
import { pathToFileURL } from 'url'
import { isSenderAuthorized, wrapSecureHandler, wrapSecureListener } from './ipcSecurityCore'
import { resolveRendererIndexPath } from './resolvePaths'

/**
 * 未授权时的默认失败返回值：覆盖本仓 32/45 个通道的主流形态。
 *
 * 其余 13 个通道的形态各不相同（`hasUpdate:false` / `isRunning:false` / `available:false` /
 * `''` / `undefined` / `{}` / `[]` / `{canceled:true}`），它们对应渲染层不同的错误分支，
 * 必须由调用方显式传 `failureValue`，不能统一。
 */
const UNAUTHORIZED = { success: false, error: 'Unauthorized' } as const

/**
 * 「未授权」失败形态。
 *
 * 类型层面允许**任何**通道用这个标准形态作为 failureValue：本仓历史上就是如此
 * （例如 `get-app-version` 成功返回 string、失败返回该对象），收敛时保持原样不改变渲染层语义。
 */
export interface UnauthorizedFailure {
  success: false
  error: string
}

/**
 * 创建 IPC 调用来源校验器
 * 校验调用方是否为主窗口，防止恶意页面或外部进程调用敏感 IPC 通道。
 * 同时校验页面来源（origin），防止主窗口被导航到恶意页面（如 XSS 后 location 改写）后仍可调用 IPC。
 *
 * 判定逻辑本体在 `ipcSecurityCore.ts`（纯函数、可单测），这里只做 electron 侧取值。
 */
export function createSenderValidator(getMainWindow: () => BrowserWindow | null) {
  return (event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): boolean => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    const isMainWindow = senderWindow !== null && senderWindow === getMainWindow()
    // 与重构前保持一致：非主窗口时提前返回，不在"非本窗口 / 可能已销毁"的 webContents 上取 URL
    if (!isMainWindow) return false

    return isSenderAuthorized({
      isMainWindow,
      senderUrl: event.sender.getURL(),
      isPackaged: app.isPackaged,
      allowedFileUrl: getRendererEntryFileUrl(),
      allowedFileDirUrl: getRendererEntryDirUrl()
    })
  }
}

/** 渲染层入口 URL 的进程内缓存（null = 尚未计算；入口路径在进程生命周期内不变） */
let cachedRendererEntryUrl: string | undefined | null = null
let cachedRendererEntryDirUrl: string | undefined | null = null

/**
 * 渲染层入口的 `file://` URL（生产环境 IPC 来源比对的基准）。
 *
 * 语义等价性说明：`loadFile(p)` 加载出的 URL 与 `pathToFileURL(p)` 相同（同为
 * file:// + 正斜杠 + 必要字符的百分号编码），因此可以安全地作为比对基准；
 * 万一解析异常则返回 undefined，让判定回退到"任意 file://"（宁可保持可用，
 * 也不能因为拿不到入口路径而把整个应用的 IPC 锁死）。
 */
function getRendererEntryFileUrl(): string | undefined {
  if (cachedRendererEntryUrl !== null) return cachedRendererEntryUrl
  try {
    cachedRendererEntryUrl = pathToFileURL(resolveRendererIndexPath()).toString()
  } catch {
    cachedRendererEntryUrl = undefined
  }
  return cachedRendererEntryUrl
}

/** 入口所在目录的 `file://` URL（同目录放行的兜底判定，见 ipcSecurityCore 的说明） */
function getRendererEntryDirUrl(): string | undefined {
  if (cachedRendererEntryDirUrl !== null) return cachedRendererEntryDirUrl
  try {
    cachedRendererEntryDirUrl = pathToFileURL(path.dirname(resolveRendererIndexPath())).toString()
  } catch {
    cachedRendererEntryDirUrl = undefined
  }
  return cachedRendererEntryDirUrl
}

/** `registerSecureHandler` 的选项 */
export interface SecureHandlerOptions<R> {
  /** 主窗口取值器（与 createSenderValidator 同一口径） */
  getMainWindow: () => BrowserWindow | null
  /**
   * 校验失败时返回给渲染层的值；省略则返回 `UNAUTHORIZED`。
   *
   * 类型约束为「handler 的返回值 ∪ 标准 Unauthorized 形态」，于是：
   * - 用错形态会被编译期拦住（例如把 `{canceled:true}` 用到 `set-tray-enabled` 上）；
   * - 同时允许任何通道沿用标准的 `{success:false,error:'Unauthorized'}`（历史一致行为）。
   * 个别通道的失败形态两者都不属于（如 `aria2-status` 返回 `{isRunning:false,error}`），
   * 此时需在该 handler 上显式标注返回类型。
   *
   * 注意实现里用「属性是否存在」判断是否显式提供，而不是默认参数：
   * 有 3 个 fire-and-forget 通道（`set-taskbar-progress` / `send-notification` / `app-ready`）
   * 需要**显式返回 undefined**，而 JS 默认参数会把"显式传 undefined"与"没传"视为同一情况，
   * 导致这些通道意外拿到 UNAUTHORIZED 对象。
   */
  failureValue?: R | UnauthorizedFailure
}

/**
 * 注册一个带来源校验的 `ipcMain.handle`。
 *
 * 取代此前 45 处重复的 `if (!this.validateSender(event)) return ...` 样板，
 * 把"忘了校验"这类疏漏从"靠人肉 review"变成"结构上不可能发生"。
 *
 * 泛型 `R` 用 `Awaited<>` 取异步 handler 的实际返回值类型，
 * 因此 `failureValue` 会与 handler 的返回类型一起被类型检查（例如 `read-clipboard`
 * 返回 `Promise<string>`，传数字会编译报错）。
 *
 * `A` 默认 `any[]`：与重构前 `ipcMain.handle` 的 `...args: any[]` 保持同样的宽松度，
 * 使个别未标注类型的入参（对话框选项、aria2 配置）不必为了迁移而额外收紧。
 */
export function registerSecureHandler<A extends unknown[] = any[], R = unknown>(
  channel: string,
  handler: (event: Electron.IpcMainInvokeEvent, ...args: A) => R,
  options: SecureHandlerOptions<Awaited<R>>
): void {
  const validate = createSenderValidator(options.getMainWindow)
  const failureValue = Object.prototype.hasOwnProperty.call(options, 'failureValue')
    ? options.failureValue
    : UNAUTHORIZED

  ipcMain.handle(channel, wrapSecureHandler<Electron.IpcMainInvokeEvent, A, R>(handler, validate, failureValue))
}

/**
 * 注册一个带来源校验的 `ipcMain.on`。
 * 事件通道无返回值（渲染层用 send 单向触发），校验失败即丢弃本次调用。
 */
export function registerSecureListener<A extends unknown[]>(
  channel: string,
  listener: (event: Electron.IpcMainEvent, ...args: A) => void,
  options: { getMainWindow: () => BrowserWindow | null }
): void {
  const validate = createSenderValidator(options.getMainWindow)

  ipcMain.on(channel, wrapSecureListener<Electron.IpcMainEvent, A>(listener, validate))
}
