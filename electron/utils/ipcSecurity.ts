import { BrowserWindow } from 'electron'

/**
 * 创建 IPC 调用来源校验器
 * 校验调用方是否为主窗口，防止恶意页面或外部进程调用敏感 IPC 通道
 */
export function createSenderValidator(getMainWindow: () => BrowserWindow | null) {
  return (event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): boolean => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    const mainWindow = getMainWindow()
    return senderWindow !== null && senderWindow === mainWindow
  }
}
