import { ipcMain, dialog, shell, app, Notification } from 'electron'
import { WindowController } from './WindowController'
import { TrayController } from './TrayController'
import { Aria2Controller } from './Aria2Controller'
import { UpdateController } from './UpdateController'
import Store from 'electron-store'
import * as path from 'path'
import * as fs from 'fs'
import { createSenderValidator } from '../utils/ipcSecurity'
import { encryptSettingsSecrets, decryptSettingsSecrets } from '../utils/secretCipher'
import { checkYtdlpAvailable, getVideoInfo, getFormatUrl } from '../services/ytdlpService'
import { PluginManager } from '../services/pluginManager'
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
  private updateController: UpdateController
  private store: Store<StoreData>
  private pluginManager: PluginManager

  constructor(
    windowController: WindowController,
    trayController: TrayController,
    aria2Controller: Aria2Controller,
    store: Store<StoreData>
  ) {
    this.windowController = windowController
    this.trayController = trayController
    this.aria2Controller = aria2Controller
    this.updateController = new UpdateController(() => windowController.getMainWindow())
    this.store = store
    this.pluginManager = new PluginManager(store)
  }

  /** 关闭插件管理器（应用退出时调用） */
  public shutdown(): void {
    this.pluginManager.shutdown()
  }

  public registerHandlers() {
    this.registerAppHandlers()
    this.registerFileHandlers()
    this.registerPersistedTasksHandlers()
    this.registerYtdlpHandlers()
    this.registerPluginHandlers()
    this.aria2Controller.registerIpcHandlers()
    this.pluginManager.loadAll()
  }

  // 校验 IPC 调用来源是否为主窗口（复用 ipcSecurity 工厂，防止恶意页面或外部进程调用敏感 IPC 通道）
  private validateSender = createSenderValidator(() => this.windowController.getMainWindow())

  private registerAppHandlers() {
    ipcMain.handle('get-app-version', (event) => {
      if (!this.validateSender(event)) return { success: false, error: 'Unauthorized' }
      return app.getVersion()
    })

    // 应用默认下载目录（Windows 系统"下载"文件夹）
    ipcMain.handle('get-default-download-dir', (event) => {
      if (!this.validateSender(event)) return { success: false, error: 'Unauthorized' }
      return {
        success: true,
        path: app.getPath('downloads').replace(/\\/g, '/')
      }
    })

    // 开机自启：查询当前是否已启用（仅 Windows 支持）
    ipcMain.handle('get-auto-launch', (event) => {
      if (!this.validateSender(event)) return { success: false, error: 'Unauthorized' }
      try {
        const openAtLogin = app.getLoginItemSettings().openAtLogin
        return { success: true, enabled: openAtLogin }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    })

    // 开机自启：设置启用/禁用（仅 Windows 支持）
    ipcMain.handle('set-auto-launch', (event, enabled: boolean) => {
      if (!this.validateSender(event)) return { success: false, error: 'Unauthorized' }
      try {
        app.setLoginItemSettings({
          openAtLogin: !!enabled,
          path: process.execPath
        })
        return { success: true, enabled: !!enabled }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    })

    // 自动更新：检查更新（只检查不下载，由用户确认后再下载）
    ipcMain.handle('check-for-updates', async (event) => {
      if (!this.validateSender(event)) return { success: false, hasUpdate: false, error: 'Unauthorized' }
      return await this.updateController.checkForUpdates()
    })

    // 自动更新：启动时后台检查（只提醒，不下载）
    ipcMain.handle('check-updates-on-startup', async (event) => {
      if (!this.validateSender(event)) return { success: false, hasUpdate: false, error: 'Unauthorized' }
      return await this.updateController.checkForUpdatesOnStartup()
    })

    // 自动更新：下载最新版本安装包（用户在更新弹窗中确认后调用）
    ipcMain.handle('download-update', async (event) => {
      if (!this.validateSender(event)) return { success: false, error: 'Unauthorized' }
      return await this.updateController.downloadUpdate()
    })

    // 自动更新：重启更新（启动安装程序并退出应用）
    ipcMain.handle('restart-and-install', async (event) => {
      if (!this.validateSender(event)) return { success: false, error: 'Unauthorized' }
      return await this.updateController.restartAndInstall()
    })

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

    ipcMain.handle('set-taskbar-progress', (event, progress: number, mode?: string) => {
      if (!this.validateSender(event)) return
      this.windowController.setTaskbarProgress(progress, (mode as 'normal' | 'error' | 'paused') || 'normal')
    })

    ipcMain.handle('system-shutdown', async (event) => {
      if (!this.validateSender(event)) return { success: false, error: 'Unauthorized' }
      try {
        const { exec } = require('child_process')
        if (process.platform === 'win32') {
          exec('shutdown /s /t 60') // 60 秒后关机
        } else if (process.platform === 'darwin') {
          exec('osascript -e \'tell app "System Events" to shut down\'')
        } else {
          exec('shutdown -h +1')
        }
        return { success: true }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    })

    ipcMain.handle('system-hibernate', async (event) => {
      if (!this.validateSender(event)) return { success: false, error: 'Unauthorized' }
      try {
        const { exec } = require('child_process')
        if (process.platform === 'win32') {
          exec('shutdown /h')
        } else if (process.platform === 'darwin') {
          exec('osascript -e \'tell app "System Events" to sleep\'')
        } else {
          exec('systemctl suspend')
        }
        return { success: true }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    })

    ipcMain.handle('detect-system-proxy', async (event) => {
      if (!this.validateSender(event)) return { success: false, error: 'Unauthorized' }
      try {
        const { session } = require('electron')
        const proxy = await session.defaultSession.resolveProxy('http://www.google.com')
        if (proxy && proxy !== 'DIRECT') {
          // proxy 格式如 "PROXY host:port" 或 "SOCKS5 host:port"
          const match = proxy.match(/^(?:PROXY|SOCKS5?|HTTPS)\s+(.+)$/i)
          const proxyUrl = match ? match[1] : proxy
          const protocol = proxy.startsWith('SOCKS') ? 'socks5' : 'http'
          return { success: true, proxy: `${protocol}://${proxyUrl}` }
        }
        return { success: true, proxy: '' }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    })

    // 系统通知（通过 Electron Notification API，比 Web API 更可靠）
    ipcMain.handle('send-notification', (event, title: string, body: string) => {
      if (!this.validateSender(event)) return
      try {
        if (Notification.isSupported()) {
          const notification = new Notification({ title, body, silent: false })
          notification.show()
          notification.on('click', () => {
            const win = this.windowController.getMainWindow()
            if (win && !win.isDestroyed()) {
              win.show()
              win.focus()
            }
          })
        }
      } catch (e) {
        console.warn('[IpcController] Failed to send notification:', e)
      }
    })

    ipcMain.handle('system-cancel-shutdown', async (event) => {
      if (!this.validateSender(event)) return { success: false, error: 'Unauthorized' }
      try {
        if (process.platform === 'win32') {
          const { exec } = require('child_process')
          exec('shutdown /a')
        }
        return { success: true }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    })

    ipcMain.handle('get-store-value', (event, key: string) => {
      if (!this.validateSender(event)) return undefined
      if (!ALLOWED_STORE_KEYS.has(key)) {
        console.warn(`[IpcController] Blocked access to store key: ${key}`)
        return undefined
      }
      const value = this.store.get(key)
      // settings 含 RPC secret：返回前解密，渲染进程 RPC 连接需要真实明文 secret
      if (key === 'settings') {
        return decryptSettingsSecrets(value as AppSettings)
      }
      return value
    })

    ipcMain.handle('set-store-value', (event, key: string, value: unknown) => {
      if (!this.validateSender(event)) return { success: false, error: 'Unauthorized' }
      if (!ALLOWED_STORE_KEYS.has(key)) {
        console.warn(`[IpcController] Blocked write to store key: ${key}`)
        return { success: false, error: 'Key not allowed' }
      }
      // settings 含 RPC secret：写入前加密，磁盘上不保存明文
      if (key === 'settings') {
        this.store.set(key, encryptSettingsSecrets(value as AppSettings))
      } else {
        this.store.set(key, value)
      }
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

    ipcMain.handle('open-in-explorer', async (event, filePath: string) => {
      if (!this.validateSender(event)) return { success: false, error: 'Unauthorized' }
      try {
        const normalizedPath = path.normalize(filePath)
        if (fs.existsSync(normalizedPath)) {
          // 文件存在时在资源管理器中定位并选中它
          shell.showItemInFolder(normalizedPath)
          return { success: true }
        }
        // 文件尚未生成时，退化为打开其所在目录
        const dir = path.dirname(normalizedPath)
        if (fs.existsSync(dir)) {
          await shell.openPath(dir)
          return { success: true }
        }
        return { success: false, error: 'Path not found' }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    })

    ipcMain.handle('open-path', async (event, filePath: string) => {
      if (!this.validateSender(event)) return { success: false, error: 'Unauthorized' }
      try {
        const normalizedPath = path.normalize(filePath)
        if (!fs.existsSync(normalizedPath)) {
          // 目标文件不存在时，尝试打开其所在目录，提高可用性
          const dir = path.dirname(normalizedPath)
          if (fs.existsSync(dir)) {
            await shell.openPath(dir)
            return { success: true }
          }
          return { success: false, error: 'Path not found' }
        }
        await shell.openPath(normalizedPath)
        return { success: true }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    })

    ipcMain.handle('delete-files', async (event, filePaths: string[], taskDir?: string) => {
      if (!this.validateSender(event)) return { success: false, error: 'Unauthorized' }

      // 允许删除文件的根目录集合：默认下载目录 + 调用方传入的任务实际目录
      // （任务可下载到非默认目录，按任务目录放宽白名单）
      const settings = decryptSettingsSecrets(this.store.get('settings', {}) as AppSettings)
      const allowedRoots: string[] = []
      const settingDir = settings?.aria2?.downloadDir || settings?.download?.defaultDir || ''
      if (settingDir) allowedRoots.push(path.resolve(settingDir))
      // 未配置任何允许目录时拒绝所有删除操作，防止任意路径被删
      if (allowedRoots.length === 0) {
        console.warn('[IpcController] Blocked deletion: no download dir configured')
        return { success: false, error: 'Download dir not configured' }
      }

      // 预解析符号链接并做大小写不敏感比较（Windows 文件系统大小写不敏感）
      const isWindows = process.platform === 'win32'
      // 返回路径的真实路径；路径不存在或 realpath 失败时保留原路径
      const realPathIfExists = async (p: string): Promise<string> => {
        try {
          return fs.existsSync(p) ? await fs.promises.realpath(p) : p
        } catch {
          return p
        }
      }
      const normalizedRoots = (await Promise.all(allowedRoots.map(realPathIfExists)))
        .map(real => (isWindows ? real.toLowerCase() : real))
      // 判定路径是否落在任一允许根目录下
      const isAllowed = (norm: string): boolean =>
        normalizedRoots.some(root =>
          norm === root || norm.startsWith(root + path.sep)
        )

      // taskDir 由渲染进程传入，必须落在已配置下载目录的子树内，防止删除任意目录文件
      if (taskDir && taskDir.trim()) {
        const realTaskDir = await realPathIfExists(path.resolve(taskDir.trim()))
        const normTaskDir = isWindows ? realTaskDir.toLowerCase() : realTaskDir
        if (!isAllowed(normTaskDir)) {
          console.warn(`[IpcController] Blocked taskDir outside allowed roots: ${realTaskDir}`)
          return { success: false, error: 'taskDir outside allowed root' }
        }
        // 校验通过后放宽白名单，允许删除该任务目录下文件
        allowedRoots.push(path.resolve(taskDir.trim()))
        normalizedRoots.push(normTaskDir)
      }

      const results: unknown[] = []
      for (const p of filePaths) {
        try {
          const normalized = path.resolve(path.normalize(p))

          // 校验文件路径是否在允许的目录范围内
          const target = await realPathIfExists(normalized)
          const normTarget = isWindows ? target.toLowerCase() : target
          if (!isAllowed(normTarget)) {
            console.warn(`[IpcController] Blocked deletion of path outside allowed dirs: ${target}`)
            results.push({ path: p, success: false, error: 'Path outside allowed directory' })
            continue
          }

          // 删除时使用校验阶段的 realpath 目标（target），而非二次 path.normalize，
          // 减小 TOCTOU 窗口：符号链接在校验与被删之间被替换时，不会沿新链接删除目录外文件
          try {
            const stats = await fs.promises.stat(target)
            if (stats.isDirectory()) {
              await fs.promises.rm(target, { recursive: true, force: true })
            } else {
              await fs.promises.unlink(target)
            }
            results.push({ path: p, success: true })
          } catch (statErr) {
            if ((statErr as NodeJS.ErrnoException).code === 'ENOENT') {
              results.push({ path: p, success: false, error: 'Not found' })
            } else {
              throw statErr
            }
          }
        } catch (e) {
          results.push({ path: p, success: false, error: String(e) })
        }
      }
      return { success: true, results }
    })
  }

  /** 已完成任务记录持久化到 userData（替代 localStorage，规避配额限制） */
  private registerPersistedTasksHandlers() {
    const filePath = path.join(app.getPath('userData'), 'persisted-tasks.json')

    ipcMain.handle('persisted-tasks-load', async (event) => {
      if (!this.validateSender(event)) return {}
      try {
        if (!fs.existsSync(filePath)) return {}
        // 使用异步 IO，避免大文件（上限 10MB）读写阻塞主进程事件循环
        const content = await fs.promises.readFile(filePath, 'utf-8')
        return JSON.parse(content || '{}')
      } catch (e) {
        console.error('[IpcController] Failed to load persisted tasks:', e)
        return {}
      }
    })

    ipcMain.handle('persisted-tasks-save', async (event, data: unknown) => {
      if (!this.validateSender(event)) return { success: false, error: 'Unauthorized' }
      try {
        const serialized = JSON.stringify(data ?? {})
        // 序列化大小上限：防止异常/恶意数据写超大文件到 userData
        if (serialized.length > 10 * 1024 * 1024) return { success: false, error: 'Data too large' }
        const dir = path.dirname(filePath)
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
        await fs.promises.writeFile(filePath, serialized, { encoding: 'utf-8', mode: 0o600 })
        return { success: true }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    })
  }

  /** yt-dlp 流媒体支持（可选外部引擎） */
  private registerYtdlpHandlers() {
    ipcMain.handle('ytdlp-check', async (event) => {
      if (!this.validateSender(event)) return { available: false, error: 'Unauthorized' }
      return checkYtdlpAvailable()
    })

    ipcMain.handle('ytdlp-video-info', async (event, url: string) => {
      if (!this.validateSender(event)) return { success: false, error: 'Unauthorized' }
      return getVideoInfo(url)
    })

    ipcMain.handle('ytdlp-format-url', async (event, url: string, formatId: string) => {
      if (!this.validateSender(event)) return { success: false, error: 'Unauthorized' }
      return getFormatUrl(url, formatId)
    })
  }

  /** 插件管理 */
  private registerPluginHandlers() {
    ipcMain.handle('plugins-list', (event) => {
      if (!this.validateSender(event)) return []
      return this.pluginManager.getPlugins()
    })

    ipcMain.handle('plugins-enable', (event, pluginId: string) => {
      if (!this.validateSender(event)) return { success: false, error: 'Unauthorized' }
      return { success: this.pluginManager.enable(pluginId) }
    })

    ipcMain.handle('plugins-disable', (event, pluginId: string) => {
      if (!this.validateSender(event)) return { success: false, error: 'Unauthorized' }
      return { success: this.pluginManager.disable(pluginId) }
    })

    ipcMain.handle('plugins-uninstall', (event, pluginId: string) => {
      if (!this.validateSender(event)) return { success: false, error: 'Unauthorized' }
      return { success: this.pluginManager.uninstall(pluginId) }
    })
  }
}
