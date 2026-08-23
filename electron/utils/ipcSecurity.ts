import { app, BrowserWindow } from 'electron'

/**
 * 创建 IPC 调用来源校验器
 * 校验调用方是否为主窗口，防止恶意页面或外部进程调用敏感 IPC 通道。
 * 同时校验页面来源（origin），防止主窗口被导航到恶意页面（如 XSS 后 location 改写）后仍可调用 IPC。
 */
export function createSenderValidator(getMainWindow: () => BrowserWindow | null) {
  // 允许的渲染进程页面来源前缀：开发环境为 Vite dev server，生产环境为 file:// 本地页面
  const allowedOrigins = app.isPackaged
    ? ['file://']
    : ['http://localhost:5173', 'http://127.0.0.1:5173']

  return (event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): boolean => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    const mainWindow = getMainWindow()
    if (senderWindow === null || senderWindow !== mainWindow) return false

    // 校验页面来源，拦截被导航到白名单之外的窗口发起的 IPC 调用
    const url = event.sender.getURL()
    if (!allowedOrigins.some((origin) => url.startsWith(origin))) return false

    return true
  }
}
