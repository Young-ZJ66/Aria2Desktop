import { autoUpdater, type UpdateInfo, type ProgressInfo } from 'electron-updater'
import { app, BrowserWindow } from 'electron'

/**
 * UpdateController - 封装 electron-updater，负责检查更新、下载进度推送与安装
 * 事件通过 webContents.send('update:status', ...) 推送给渲染进程
 */
export class UpdateController {
  private getWindow: () => BrowserWindow | null

  constructor(getWindow: () => BrowserWindow | null) {
    this.getWindow = getWindow

    // 检测到更新后自动下载；应用退出前自动静默安装（若已下载完成）
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    this.registerListeners()
  }

  /** 向主窗口推送更新状态 */
  private sendToRenderer(payload: unknown): void {
    const win = this.getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('update:status', payload)
    }
  }

  private registerListeners(): void {
    autoUpdater.on('checking-for-update', () => {
      this.sendToRenderer({ state: 'checking' })
    })

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      this.sendToRenderer({ state: 'available', version: info.version })
    })

    autoUpdater.on('update-not-available', () => {
      this.sendToRenderer({ state: 'not-available' })
    })

    autoUpdater.on('error', (error: Error) => {
      this.sendToRenderer({ state: 'error', error: error.message })
    })

    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      this.sendToRenderer({
        state: 'downloading',
        percent: progress.percent,
        transferred: progress.transferred,
        total: progress.total,
        bytesPerSecond: progress.bytesPerSecond
      })
    })

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      this.sendToRenderer({ state: 'downloaded', version: info.version })
    })
  }

  /** 检查更新（自动下载），仅打包后可用 */
  async checkForUpdates(): Promise<{ success: boolean; error?: string }> {
    if (!app.isPackaged) {
      return { success: false, error: 'Development mode does not support auto update' }
    }
    try {
      autoUpdater.checkForUpdates()
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** 立即退出并安装已下载的更新 */
  quitAndInstall(): void {
    autoUpdater.quitAndInstall()
  }
}
