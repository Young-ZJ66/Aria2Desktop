import { BrowserWindow, Menu, shell, screen, ipcMain, nativeTheme, session, app } from 'electron'
import { join } from 'path'
import * as fs from 'fs'
import Store from 'electron-store'
import { appState } from '../utils/appState'
import { decryptSettingsSecrets } from '../utils/secretCipher'
import { createSenderValidator } from '../utils/ipcSecurity'
import type { StoreData, AppSettings, WindowState } from '../types/store'

/** 允许通过 shell.openExternal 打开的外部 URL 协议白名单 */
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/** 等待内容就绪的最大重试次数与间隔（100 次 × 100ms = 10 秒上限） */
const MAX_SHOW_RETRIES = 100
const SHOW_RETRY_INTERVAL = 100

export class WindowController {
  private mainWindow: BrowserWindow | null = null
  private store: Store<StoreData>
  private isContentReady = false // 页面内容是否已加载完成
  private validateSender = createSenderValidator(() => this.mainWindow)

  constructor(store: Store<StoreData>) {
    this.store = store

    // 注入 CSP 响应头（纵深防御）。注意：webRequest 仅对 http(s) 响应生效，
    // 生产环境 file:// 页面仍依赖 index.html 中的 meta 标签兜底
    this.setupCsp()

    // 监听渲染进程的 app-ready 消息（只注册一次，避免重复创建窗口时叠加监听器）
    ipcMain.on('app-ready', (event) => {
      // 校验来源为主窗口，防止其他 webContents 伪造就绪信号
      if (!this.validateSender(event)) return
      console.log('[WindowController] Received app-ready from renderer')
      this.isContentReady = true
    })
  }

  /** 通过响应头注入 CSP，不依赖渲染层 meta（开发环境对 localhost:5173 生效） */
  private setupCsp(): void {
    // session.defaultSession 仅在 app ready 之后可用，构造函数执行时（whenReady 之前）调用
    // 会抛 "Session can only be received when app is ready"，因此延迟到就绪后再注册。
    app.whenReady().then(() => {
      session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            // connect-src 放行 Vite HMR 的 websocket；生产加载 file:// 页面时本头不生效
            'Content-Security-Policy': [
              "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://localhost:* http://localhost:*"
            ]
          }
        })
      })
    })
  }

  public createWindow(): BrowserWindow {
    console.log('[WindowController] Creating main window...')

    // 重置内容就绪标记（窗口重建场景，避免沿用旧值提前 show）
    this.isContentReady = false

    // 完全移除应用菜单栏
    Menu.setApplicationMenu(null)

    // 如果启用，恢复窗口状态
    const settings = decryptSettingsSecrets(this.store.get('settings', {}) as AppSettings)
    const keepWindowState = settings.keepWindowState !== false
    const savedState = this.store.get('windowState') as WindowState

    // 标题栏使用系统默认样式（如需自定义标题栏，可在此扩展 hidden/hiddenInset + overlay 配置）
    const titleBarStyle = 'default' as 'default' | 'hidden' | 'hiddenInset'

    let windowOptions: Electron.BrowserWindowConstructorOptions = {
      width: 1200,
      height: 800,
      minWidth: 800,
      minHeight: 600,
      show: false, // 不立即显示 - 由 AppLifecycle 控制
      autoHideMenuBar: false,
      center: !keepWindowState || !savedState, // 仅在没有保存状态时居中
      resizable: true,
      titleBarStyle,
      icon: process.env.NODE_ENV === 'development'
        ? join(process.cwd(), 'build/Icon.ico')
        : join(__dirname, '../../build/Icon.ico'),
      webPreferences: {
        preload: join(__dirname, '../preload.js'),
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false // 防止后台时性能降低
      }
    }

    // 如果可用，应用保存的边界
    if (keepWindowState && savedState?.bounds) {
      const { bounds } = savedState

      // 验证边界是否在屏幕区域内
      if (this.isValidBounds(bounds)) {
        windowOptions = {
          ...windowOptions,
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height
        }
        console.log('[WindowController] Restoring window bounds:', bounds)
      }
    }

    // 创建主窗口
    this.mainWindow = new BrowserWindow(windowOptions)

    // 恢复最大化/全屏状态
    if (keepWindowState && savedState) {
      if (savedState.isMaximized) {
        this.mainWindow.maximize()
      }
      if (savedState.isFullScreen) {
        this.mainWindow.setFullScreen(true)
      }
    }

    this.setupEventHandlers()
    this.loadContent()

    return this.mainWindow
  }

  /**
   * 检查窗口边界是否有效（在屏幕区域内）
   */
  private isValidBounds(bounds: { x: number; y: number; width: number; height: number }): boolean {
    const displays = screen.getAllDisplays()

    // 检查窗口中心是否在任何显示器内
    const centerX = bounds.x + bounds.width / 2
    const centerY = bounds.y + bounds.height / 2

    return displays.some((display: Electron.Display) => {
      const { x, y, width, height } = display.bounds
      return centerX >= x && centerX < x + width &&
        centerY >= y && centerY < y + height
    })
  }

  private setupEventHandlers() {
    if (!this.mainWindow) return

    this.mainWindow.on('ready-to-show', () => {
      console.log('[WindowController] Window ready-to-show event')
      // 不在这里自动显示 - 让 AppLifecycle 控制显示时机

      // 初始化主题
      const settings = decryptSettingsSecrets(this.store.get('settings', {}) as AppSettings)
      const isDarkTheme = settings.theme === 'dark'
      this.setWindowTheme(isDarkTheme)

      // 标记内容已准备好（HTML 已加载）
      this.isContentReady = true
    })

    // 拦截关闭事件 - 如果启用了托盘，隐藏而不是关闭
    this.mainWindow.on('close', (event) => {
      const settings = decryptSettingsSecrets(this.store.get('settings', {}) as AppSettings)
      const minimizeToTray = settings.minimizeToTray !== false

      // 如果启用了托盘且不是真正退出应用
      if (minimizeToTray && !appState.isQuitting()) {
        event.preventDefault()
        this.hide()
        console.log('[WindowController] Window hidden to tray')
      }
    })

    this.mainWindow.webContents.setWindowOpenHandler((details) => {
      // 仅放行安全的协议，防止 file://、自定义协议等触发系统级处理程序
      try {
        const protocol = new URL(details.url).protocol
        if (ALLOWED_EXTERNAL_PROTOCOLS.has(protocol)) {
          shell.openExternal(details.url)
        } else {
          console.warn('[WindowController] Blocked openExternal for unsafe protocol:', protocol)
        }
      } catch {
        console.warn('[WindowController] Blocked openExternal for invalid URL:', details.url)
      }
      return { action: 'deny' }
    })

    // 保存窗口状态（防抖处理）
    this.setupWindowStatePersistence()
  }

  private setupWindowStatePersistence() {
    if (!this.mainWindow) return

    const settings = decryptSettingsSecrets(this.store.get('settings', {}) as AppSettings)
    const keepWindowState = settings.keepWindowState !== false

    if (!keepWindowState) return

    let saveTimeout: NodeJS.Timeout | null = null

    const saveWindowState = () => {
      if (!this.mainWindow) return

      const bounds = this.mainWindow.getBounds()
      const isMaximized = this.mainWindow.isMaximized()
      const isFullScreen = this.mainWindow.isFullScreen()

      this.store.set('windowState', {
        bounds,
        isMaximized,
        isFullScreen
      })

      console.log('[WindowController] Window state saved:', { bounds, isMaximized, isFullScreen })
    }

    const debouncedSave = () => {
      if (saveTimeout) clearTimeout(saveTimeout)
      saveTimeout = setTimeout(saveWindowState, 500)
    }

    this.mainWindow.on('resize', debouncedSave)
    this.mainWindow.on('move', debouncedSave)
    this.mainWindow.on('maximize', saveWindowState)
    this.mainWindow.on('unmaximize', saveWindowState)
    this.mainWindow.on('enter-full-screen', saveWindowState)
    this.mainWindow.on('leave-full-screen', saveWindowState)
    // 窗口销毁时清理未触发的防抖保存，避免向已销毁窗口写入状态
    this.mainWindow.on('closed', () => {
      if (saveTimeout) clearTimeout(saveTimeout)
    })
  }

  private loadContent() {
    if (!this.mainWindow) return

    console.log('[WindowController] Loading content...')
    if (process.env.NODE_ENV === 'development') {
      console.log('[WindowController] Loading development URL: http://localhost:5173')
      this.mainWindow.loadURL('http://localhost:5173').catch(err => {
        console.error('[WindowController] Failed to load URL:', err)
      })
    } else {
      // 生产环境：尝试多个可能的路径
      const possiblePaths = [
        join(__dirname, '../vue/index.html'),
        join(__dirname, '../../vue/index.html'),
        join(process.resourcesPath, 'app.asar/dist/vue/index.html'),
        join(process.resourcesPath, 'vue/index.html')
      ]

      let loaded = false
      for (const htmlPath of possiblePaths) {
        if (fs.existsSync(htmlPath)) {
          console.log('[WindowController] Loading production file from:', htmlPath)
          this.mainWindow.loadFile(htmlPath).catch(err => {
            console.error('[WindowController] Failed to load file:', err)
          })
          loaded = true
          break
        }
      }

      if (!loaded) {
        console.error('[WindowController] Could not find index.html in any expected location')
        console.error('[WindowController] Tried paths:', possiblePaths)
      }
    }
  }

  public getMainWindow(): BrowserWindow | null {
    return this.mainWindow
  }

  public show() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      // 等待内容加载完成后再显示
      if (this.isContentReady) {
        console.log('[WindowController] Showing window (content ready)')
        this.mainWindow.show()
        this.mainWindow.focus()
      } else {
        console.log('[WindowController] Waiting for content to be ready...')
        // 等待 ready-to-show 事件，最多重试 MAX_SHOW_RETRIES 次（10 秒），超时后强制显示
        let attempts = 0
        const showWhenReady = () => {
          // 窗口已销毁时终止重试
          if (!this.mainWindow || this.mainWindow.isDestroyed()) return
          if (this.isContentReady || attempts >= MAX_SHOW_RETRIES) {
            if (!this.isContentReady) {
              console.warn('[WindowController] Timed out waiting for content, forcing show')
            }
            this.mainWindow.show()
            this.mainWindow.focus()
          } else {
            attempts++
            setTimeout(showWhenReady, SHOW_RETRY_INTERVAL)
          }
        }
        showWhenReady()
      }
    }
  }

  public hide() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.hide()
    }
  }

  public isVisible(): boolean {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return false
    }
    return this.mainWindow.isVisible()
  }

  public setWindowTheme(isDark: boolean) {
    if (!this.mainWindow) return

    console.log(`[WindowController] Setting window theme: ${isDark ? 'dark' : 'light'}`)

    try {
      // 原生主题始终生效
      nativeTheme.themeSource = isDark ? 'dark' : 'light'
    } catch (error) {
      console.error('[WindowController] Failed to set window theme:', error)
    }
  }
}
