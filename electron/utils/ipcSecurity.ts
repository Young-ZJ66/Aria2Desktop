import { app, BrowserWindow } from 'electron'

/**
 * 创建 IPC 调用来源校验器
 * 校验调用方是否为主窗口，防止恶意页面或外部进程调用敏感 IPC 通道。
 * 同时校验页面来源（origin），防止主窗口被导航到恶意页面（如 XSS 后 location 改写）后仍可调用 IPC。
 */
export function createSenderValidator(getMainWindow: () => BrowserWindow | null) {
  // 允许的渲染进程页面来源：开发环境为 Vite dev server（精确匹配 origin），生产环境为 file:// 本地页面
  const allowedDevOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173']

  return (event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): boolean => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    const mainWindow = getMainWindow()
    if (senderWindow === null || senderWindow !== mainWindow) return false

    const url = event.sender.getURL()
    if (!app.isPackaged) {
      // 开发环境：用 URL origin 做精确匹配，避免前缀碰撞（如 http://localhost:5173.evil.com）
      try {
        return allowedDevOrigins.includes(new URL(url).origin)
      } catch {
        return false
      }
    }
    // 生产环境：仅接受本应用打包内的 file:// 页面
    return url.startsWith('file://')
  }
}
