import { ipcMain, dialog, shell, BrowserWindow } from 'electron'
import { WindowController } from './WindowController'
import { TrayController } from './TrayController'
import { Aria2Controller } from './Aria2Controller'
import Store from 'electron-store'
import * as path from 'path'
import * as fs from 'fs'
import type { StoreData, AppSettings } from '../types/store'

/** 允许通过 get/set-store-value 访问的 store 键白名单 */
const ALLOWED_STORE_KEYS = new Set([
  'settings',
  'windowState'
])

export class IpcController {
  private windowController: WindowController
  private trayController: TrayController
  private aria2Controller: Aria2Controller
  private store: Store<StoreData>

  constructor(
    windowController: WindowController,
    trayController: TrayController,
    aria2Controller: Aria2Controller,
    store: Store<StoreData>
  ) {
    this.windowController = windowController
    this.trayController = trayController
    this.aria2Controller = aria2Controller
    this.store = store
  }

  public registerHandlers() {
    this.registerAppHandlers()
    this.registerFileHandlers()
    this.aria2Controller.registerIpcHandlers()
  }

  /**
     * 校验 IPC 调用来源是否为主窗口
     * 防止恶意页面或外部进程调用敏感 IPC 通道
     */
  private validateSender(event: Electron.IpcMainInvokeEvent): boolean {
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    const mainWindow = this.windowController.getMainWindow()
    return senderWindow !== null && senderWindow === mainWindow
  }

  private registerAppHandlers() {
    ipcMain.handle('get-app-version', () => process.env.npm_package_version || '1.0.0')

    ipcMain.handle('set-tray-enabled', (event, enabled: boolean) => {
      if (!this.validateSender(event)) return { success: false, error: 'Unauthorized' }
      if (enabled) {
        this.trayController.createTray()
      } else {
        this.trayController.destroy()
      }
      return { success: true }
    })

    ipcMain.handle('set-window-theme', (event, isDark: boolean) => {
      if (!this.validateSender(event)) return { success: false, error: 'Unauthorized' }
      this.windowController.setWindowTheme(isDark)
      return { success: true }
    })

    ipcMain.handle('get-store-value', (event, key: string) => {
      if (!this.validateSender(event)) return undefined
      if (!ALLOWED_STORE_KEYS.has(key)) {
        console.warn(`[IpcController] Blocked access to store key: ${key}`)
        return undefined
      }
      return this.store.get(key)
    })

    ipcMain.handle('set-store-value', (event, key: string, value: unknown) => {
      if (!this.validateSender(event)) return { success: false, error: 'Unauthorized' }
      if (!ALLOWED_STORE_KEYS.has(key)) {
        console.warn(`[IpcController] Blocked write to store key: ${key}`)
        return { success: false, error: 'Key not allowed' }
      }
      this.store.set(key, value)
      return { success: true }
    })

    ipcMain.handle('show-save-dialog', async (event, options) => {
      if (!this.validateSender(event)) return { canceled: true }
      const window = this.windowController.getMainWindow()
      if (window) {
        return await dialog.showSaveDialog(window, options)
      }
      return { canceled: true }
    })

    ipcMain.handle('show-open-dialog', async (event, options) => {
      if (!this.validateSender(event)) return { canceled: true }
      const window = this.windowController.getMainWindow()
      if (window) {
        return await dialog.showOpenDialog(window, options)
      }
      return { canceled: true }
    })
  }

  private registerFileHandlers() {
    ipcMain.handle('show-item-in-folder', async (event, filePath: string) => {
      if (!this.validateSender(event)) return { success: false, error: 'Unauthorized' }
      try {
        const normalizedPath = path.normalize(filePath)
        if (!fs.existsSync(normalizedPath)) return { success: false, error: 'Path not found' }
        shell.showItemInFolder(normalizedPath)
        return { success: true }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    })

    ipcMain.handle('open-path', async (event, filePath: string) => {
      if (!this.validateSender(event)) return { success: false, error: 'Unauthorized' }
      try {
        const normalizedPath = path.normalize(filePath)
        if (!fs.existsSync(normalizedPath)) return { success: false, error: 'Path not found' }
        await shell.openPath(normalizedPath)
        return { success: true }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    })

    ipcMain.handle('delete-files', async (event, filePaths: string[]) => {
      if (!this.validateSender(event)) return { success: false, error: 'Unauthorized' }

      // 获取允许删除文件的根目录（下载目录）
      const settings = this.store.get('settings', {}) as AppSettings
      const allowedDir = settings?.aria2?.downloadDir || settings?.download?.defaultDir || ''
      const normalizedAllowedDir = allowedDir ? path.resolve(allowedDir) : ''

      const results: unknown[] = []
      for (const p of filePaths) {
        try {
          const normalized = path.resolve(path.normalize(p))

          // 校验文件路径是否在允许的下载目录范围内
          if (normalizedAllowedDir && !normalized.startsWith(normalizedAllowedDir + path.sep) && normalized !== normalizedAllowedDir) {
            console.warn(`[IpcController] Blocked deletion of path outside download dir: ${normalized}`)
            results.push({ path: p, success: false, error: 'Path outside allowed directory' })
            continue
          }

          if (fs.existsSync(normalized)) {
            const stats = fs.statSync(normalized)
            if (stats.isDirectory()) {
              fs.rmSync(normalized, { recursive: true, force: true })
            } else {
              fs.unlinkSync(normalized)
            }
            results.push({ path: p, success: true })
          } else {
            results.push({ path: p, success: false, error: 'Not found' })
          }
        } catch (e) {
          results.push({ path: p, success: false, error: String(e) })
        }
      }
      return { success: true, results }
    })
  }
}
