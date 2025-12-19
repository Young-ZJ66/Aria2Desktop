import { BrowserWindow, Menu, shell, app } from 'electron'
import { join } from 'path'
import * as path from 'path'
import Store from 'electron-store'

export class WindowController {
  private mainWindow: BrowserWindow | null = null
  private store: Store
  private isContentReady = false // 页面内容是否已加载完成

  constructor(store: Store) {
    this.store = store
  }

  public createWindow(): BrowserWindow {
    console.log('Creating main window...')

    // {{ AURA: Add - 完全移除应用菜单栏 }}
    Menu.setApplicationMenu(null)

    // 如果启用，恢复窗口状态
    const settings = this.store.get('settings', {}) as any
    const keepWindowState = settings.keepWindowState !== false
    const savedState = this.store.get('windowState') as any

    let windowOptions: any = {
      width: 1200,
      height: 800,
      minWidth: 800,
      minHeight: 600,
      show: false, // 不立即显示 - 由 AppLifecycle 控制
      autoHideMenuBar: false,
      center: !keepWindowState || !savedState, // 仅在没有保存状态时居中
      resizable: true,
      titleBarStyle: 'default',
      titleBarOverlay: {
        color: '#f0f0f0',
        symbolColor: '#000000',
        height: 32
      },
      icon: process.env.NODE_ENV === 'development'
        ? join(process.cwd(), 'build/Aria2.ico')
        : join(__dirname, '../../build/Aria2.ico'),
      webPreferences: {
        preload: join(__dirname, '../preload.js'),
        sandbox: false,
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false // 防止后台时性能降低
      }
    }

    // 如果可用，应用保存的边界
    if (keepWindowState && savedState?.bounds) {
      const { bounds, isMaximized, isFullScreen } = savedState

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

    Menu.setApplicationMenu(null)

    this.setupEventHandlers()
    this.loadContent()

    return this.mainWindow
  }

  /**
   * 检查窗口边界是否有效（在屏幕区域内）
   */
  private isValidBounds(bounds: { x: number; y: number; width: number; height: number }): boolean {
    const { screen } = require('electron')
    const displays = screen.getAllDisplays()

    // 检查窗口中心是否在任何显示器内
    const centerX = bounds.x + bounds.width / 2
    const centerY = bounds.y + bounds.height / 2

    return displays.some((display: any) => {
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
      const settings = this.store.get('settings', {}) as any
      const isDarkTheme = settings.theme === 'dark'
      this.setWindowTheme(isDarkTheme)

      // 标记内容已准备好（HTML 已加载）
      this.isContentReady = true
    })

    // 监听渲染进程的 app-ready 消息
    const { ipcMain } = require('electron')
    ipcMain.on('app-ready', () => {
      console.log('[WindowController] Received app-ready from renderer')
      this.isContentReady = true
    })

    // 拦截关闭事件 - 如果启用了托盘，隐藏而不是关闭
    this.mainWindow.on('close', (event) => {
      const settings = this.store.get('settings', {}) as any
      const minimizeToTray = settings.minimizeToTray !== false

      // 如果启用了托盘且不是真正退出应用
      if (minimizeToTray && !(app as any).isQuiting) {
        event.preventDefault()
        this.hide()
        console.log('[WindowController] Window hidden to tray')
      }
    })

    this.mainWindow.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })

    // 保存窗口状态（防抖处理）
    this.setupWindowStatePersistence()
  }

  private setupWindowStatePersistence() {
    if (!this.mainWindow) return

    const settings = this.store.get('settings', {}) as any
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
        if (require('fs').existsSync(htmlPath)) {
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
        // 等待 ready-to-show 事件
        const showWhenReady = () => {
          if (this.isContentReady) {
            console.log('[WindowController] Content ready, showing window')
            this.mainWindow?.show()
            this.mainWindow?.focus()
          } else {
            setTimeout(showWhenReady, 100)
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

    console.log(`Setting window theme: ${isDark ? 'dark' : 'light'}`)

    if (process.platform === 'win32') {
      try {
        const { nativeTheme } = require('electron')
        nativeTheme.themeSource = isDark ? 'dark' : 'light'

        const darkColor = '#1a1a1a'
        const lightColor = '#ffffff'
        const darkSymbol = '#ffffff'
        const lightSymbol = '#000000'

        this.mainWindow.setTitleBarOverlay({
          color: isDark ? darkColor : lightColor,
          symbolColor: isDark ? darkSymbol : lightSymbol,
          height: 32
        })

        // 强制重绘钩子
        this.mainWindow.setSize(this.mainWindow.getSize()[0], this.mainWindow.getSize()[1] + 1)
        setTimeout(() => {
          this.mainWindow?.setSize(this.mainWindow.getSize()[0], this.mainWindow.getSize()[1] - 1)
        }, 50)

      } catch (error) {
        console.error('Failed to set Windows theme:', error)
      }
    } else if (process.platform === 'darwin') {
      const { nativeTheme } = require('electron')
      nativeTheme.themeSource = isDark ? 'dark' : 'light'
    }
  }
}
