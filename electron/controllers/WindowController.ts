import { BrowserWindow, Menu, shell, screen, nativeTheme, session, app, clipboard } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import Store from 'electron-store'
import { appState } from '../utils/appState'
import { getSettings } from '../utils/settingsAccessor'
import { registerSecureListener } from '../utils/ipcSecurity'
import { DEV_ALLOWED_ORIGINS, normalizeFileUrl } from '../utils/ipcSecurityCore'
import { resolveAppIconPath, resolveRendererIndexPath } from '../utils/resolvePaths'
import { createLogger } from '../utils/logger'
import type { StoreData, WindowState } from '../types/store'

// 本文件日志文案自带 [WindowController] 前缀（历史风格），故 scope 传空避免前缀重复
const logger = createLogger('')

/** 允许通过 shell.openExternal 打开的外部 URL 协议白名单 */
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/** 等待内容就绪的最大重试次数与间隔（100 次 × 100ms = 10 秒上限） */
const MAX_SHOW_RETRIES = 100
const SHOW_RETRY_INTERVAL = 100

export class WindowController {
  private mainWindow: BrowserWindow | null = null
  private store: Store<StoreData>
  private isContentReady = false // 页面内容是否已加载完成
  /**
   * 供 ipcSecurity 工厂使用的窗口取值器。
   * 注意与其它控制器传 `windowController.getMainWindow()` 不同，这里直接用本类字段——
   * 但事件触发时 this.mainWindow 已是创建好的窗口，判定口径与其它处一致。
   */
  private windowRef = () => this.mainWindow
  /** 等待内容就绪的重试定时器（去重：窗口重建/重复调用 show() 时避免叠加多次重试链） */
  private pendingShowTimer: NodeJS.Timeout | null = null
  /**
   * 渲染层就绪回调（由 main.ts 注入，用于投递启动期缓存的协议链接）。
   * 用"就绪信号"而不是固定延时：冷启动耗时不确定，赌时间必然偶尔丢链接。
   */
  private onRendererReady: (() => void) | null = null

  /** 注册渲染层就绪回调（覆盖式：main.ts 只注册一次） */
  public setOnRendererReady(callback: (() => void) | null): void {
    this.onRendererReady = callback
  }

  constructor(store: Store<StoreData>) {
    this.store = store

    // 注入 CSP 响应头（纵深防御）。注意：webRequest 仅对 http(s) 响应生效，
    // 生产环境 file:// 页面仍依赖 index.html 中的 meta 标签兜底
    this.setupCsp()

    // 监听渲染进程的 app-ready 消息（只注册一次，避免重复创建窗口时叠加监听器）
    // 经工厂注册：来源校验（必须为主窗口）由工厂保证，防止其他 webContents 伪造就绪信号
    registerSecureListener('app-ready', () => {
      logger.debug('[WindowController] Received app-ready from renderer')
      this.isContentReady = true
      // 渲染层的 IPC 监听此刻已注册完毕，可以安全投递启动期缓存的协议链接
      this.onRendererReady?.()
    }, { getMainWindow: this.windowRef })

    /**
     * 「下载完成后关闭应用」走此通道（preload 用 send，故为事件而非 invoke）。
     *
     * 语义是**退出应用**而非"关掉窗口"：这里不能调 window.close()——本类的 close 拦截
     * 在 minimizeToTray 开启时会把"关闭"改成"隐藏到托盘"，与用户所选「关闭应用」不符。
     * 与托盘「退出」菜单同路径：先 markQuitting() 让 close 拦截放行，
     * 再 app.quit() 走 before-quit 的优雅关闭（保存 aria2 会话后退出）。
     */
    registerSecureListener('window-close', () => {
      appState.markQuitting()
      app.quit()
    }, { getMainWindow: this.windowRef })
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

      // 权限一律拒绝：本应用不需要摄像头/麦克风/定位等 Chromium 权限——
      // 系统通知走主进程 Notification API、剪贴板走主进程 IPC，渲染层也没有申请过任何权限。
      // 拒绝而不是放任，避免渲染层被注入后借权限接口扩大影响面。
      session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
        logger.debug('[WindowController] Denied permission request:', permission)
        callback(false)
      })
    })
  }

  /**
   * 主窗口是否允许导航到该 URL。
   *
   * 判定口径与 IPC 来源校验保持一致（同一套常量与归一化函数）：
   * - 开发环境：Vite dev server 的精确 origin（支持 HMR 整页刷新）
   * - 生产环境：本应用渲染层入口（file://，归一化后比对；hash/query 与百分号编码差异不影响）
   */
  private isAllowedNavigation(targetUrl: string): boolean {
    try {
      if (process.env.NODE_ENV === 'development') {
        return DEV_ALLOWED_ORIGINS.includes(new URL(targetUrl).origin)
      }
      if (!targetUrl.startsWith('file://')) return false
      const entry = pathToFileURL(resolveRendererIndexPath()).toString()
      return normalizeFileUrl(targetUrl) === normalizeFileUrl(entry)
    } catch {
      // 入口路径解析失败时不阻断：宁可少一层加固，也不能让应用变成完全无法导航
      return true
    }
  }

  public createWindow(): BrowserWindow {
    logger.info('[WindowController] Creating main window...')

    // 重置内容就绪标记与等待重试链（窗口重建场景，避免沿用旧值/旧定时器）
    this.isContentReady = false
    if (this.pendingShowTimer) {
      clearTimeout(this.pendingShowTimer)
      this.pendingShowTimer = null
    }

    // 完全移除应用菜单栏
    Menu.setApplicationMenu(null)

    // 如果启用，恢复窗口状态
    const settings = getSettings()
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
      // 图标统一由 resolvePaths 解析（此前生产分支指向不存在的 dist/electron/build/Icon.ico）
      icon: resolveAppIconPath() ?? undefined,
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
        logger.debug('[WindowController] Restoring window bounds:', bounds)
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
      logger.debug('[WindowController] Window ready-to-show event')
      // 不在这里自动显示 - 让 AppLifecycle 控制显示时机

      // 初始化主题
      const settings = getSettings()
      const isDarkTheme = settings.theme === 'dark'
      this.setWindowTheme(isDarkTheme)

      // 标记内容已准备好（HTML 已加载）
      this.isContentReady = true
    })

    // 拦截关闭事件 - 如果启用了托盘，隐藏而不是关闭
    this.mainWindow.on('close', (event) => {
      const settings = getSettings()
      const minimizeToTray = settings.minimizeToTray !== false

      // 如果启用了托盘且不是真正退出应用
      if (minimizeToTray && !appState.isQuitting()) {
        event.preventDefault()
        this.hide()
        logger.info('[WindowController] Window hidden to tray')
      }
    })

    // 窗口获得焦点时读取剪贴板并推送给渲染层（用于智能检测下载链接）
    // 比渲染层的 visibilitychange/focus 事件更可靠，覆盖 Alt+Tab、托盘恢复等场景
    this.mainWindow.on('focus', () => {
      try {
        const text = clipboard.readText() || ''
        if (text && /^(https?|ftp|magnet):/i.test(text.trim()) && text.trim().length <= 2048) {
          this.mainWindow?.webContents.send('clipboard-url-detected', text.trim())
        }
      } catch {
        // 剪贴板读取失败，静默忽略
      }
    })

    this.mainWindow.webContents.setWindowOpenHandler((details) => {
      // 仅放行安全的协议，防止 file://、自定义协议等触发系统级处理程序
      try {
        const protocol = new URL(details.url).protocol
        if (ALLOWED_EXTERNAL_PROTOCOLS.has(protocol)) {
          shell.openExternal(details.url)
        } else {
          logger.warn('[WindowController] Blocked openExternal for unsafe protocol:', protocol)
        }
      } catch {
        logger.warn('[WindowController] Blocked openExternal for invalid URL:', details.url)
      }
      return { action: 'deny' }
    })

    /**
     * 阻断页面级导航：主窗口只允许停留在本应用自己的渲染层页面。
     *
     * 为什么必须挡：生产环境的 IPC 授权虽然已收紧为"与渲染层入口精确比对"，
     * 但纵深防御要求从源头就不让主窗口跑到别的页面上——例如把本地 HTML 文件拖进窗口，
     * 若导航成功，该页面就继承了 preload 暴露的完整特权桥。
     */
    this.mainWindow.webContents.on('will-navigate', (event, url) => {
      if (!this.isAllowedNavigation(url)) {
        event.preventDefault()
        logger.warn('[WindowController] Blocked navigation to:', url)
      }
    })

    // 本应用不使用 <webview>：直接阻断挂载，避免将来被引入时绕过上述导航限制
    this.mainWindow.webContents.on('will-attach-webview', (event) => {
      event.preventDefault()
      logger.warn('[WindowController] Blocked webview attachment')
    })

    // 保存窗口状态（防抖处理）
    this.setupWindowStatePersistence()
  }

  private setupWindowStatePersistence() {
    if (!this.mainWindow) return

    const settings = getSettings()
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

      logger.debug('[WindowController] Window state saved:', { bounds, isMaximized, isFullScreen })
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

    logger.info('[WindowController] Loading content...')
    if (process.env.NODE_ENV === 'development') {
      logger.info('[WindowController] Loading development URL: http://localhost:5173')
      this.mainWindow.loadURL('http://localhost:5173').catch(err => {
        logger.error('[WindowController] Failed to load URL:', err)
      })
    } else {
      // 生产环境：唯一定位渲染层入口（路径口径见 electron/utils/resolvePaths.ts）
      const indexPath = resolveRendererIndexPath()
      logger.info('[WindowController] Loading production file from:', indexPath)
      this.mainWindow.loadFile(indexPath).catch(err => {
        logger.error('[WindowController] Failed to load file:', err)
        // 加载失败提示页面，避免用户看到空白窗口
        void this.mainWindow?.loadURL(
          'data:text/html,<html><body style="font-family:sans-serif;padding:40px;text-align:center"><h2>应用资源加载失败</h2><p>未找到 index.html，请重新安装应用。</p></body></html>'
        )
      })
    }
  }

  public getMainWindow(): BrowserWindow | null {
    return this.mainWindow
  }

  public show() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      // 已有等待内容就绪的重试链在跑，避免重复调用叠加多个 setTimeout 链
      if (this.pendingShowTimer) return
      // 等待内容加载完成后再显示
      if (this.isContentReady) {
        // 每次显示窗口都会走到这里（托盘恢复/Alt+Tab 等），降级为 debug 避免刷屏
        logger.debug('[WindowController] Showing window (content ready)')
        this.mainWindow.show()
        this.mainWindow.focus()
      } else {
        logger.debug('[WindowController] Waiting for content to be ready...')
        // 等待 ready-to-show 事件，最多重试 MAX_SHOW_RETRIES 次（10 秒），超时后强制显示
        let attempts = 0
        const showWhenReady = () => {
          this.pendingShowTimer = null
          // 窗口已销毁时终止重试
          if (!this.mainWindow || this.mainWindow.isDestroyed()) return
          if (this.isContentReady || attempts >= MAX_SHOW_RETRIES) {
            if (!this.isContentReady) {
              logger.warn('[WindowController] Timed out waiting for content, forcing show')
            }
            this.mainWindow.show()
            this.mainWindow.focus()
          } else {
            attempts++
            this.pendingShowTimer = setTimeout(showWhenReady, SHOW_RETRY_INTERVAL)
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

  /**
   * 设置任务栏进度条（Windows/macOS）。
   * @param progress 0-1 之间的进度值，-1 表示不确定状态，0 表示无进度（清除）
   * @param mode 'normal' | 'error' | 'paused' 进度条颜色模式
   */
  public setTaskbarProgress(progress: number, mode: 'normal' | 'error' | 'paused' = 'normal'): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return
    try {
      if (progress <= 0) {
        this.mainWindow.setProgressBar(-1) // 清除进度条
      } else {
        this.mainWindow.setProgressBar(Math.min(1, progress), { mode })
      }
    } catch {
      // 非所有平台都支持，忽略
    }
  }

  public setWindowTheme(isDark: boolean) {
    if (!this.mainWindow) return

    // 幂等：主题与当前值一致时直接返回。
    // 该入口被多处调用（窗口初始化、配置热更新、渲染层 IPC），
    // 避免重复设置与重复打印日志；且主题变化日志只在真正切换时输出一次。
    const target: 'dark' | 'light' = isDark ? 'dark' : 'light'
    if (nativeTheme.themeSource === target) return

    try {
      // 原生主题始终生效
      nativeTheme.themeSource = target
      logger.info(`[WindowController] Window theme set to ${target}`)
    } catch (error) {
      logger.error('[WindowController] Failed to set window theme:', error)
    }
  }
}
