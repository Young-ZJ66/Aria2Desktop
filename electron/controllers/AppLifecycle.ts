import { app, dialog, Notification, shell } from 'electron'
import Store from 'electron-store'
import { WindowController } from './WindowController'
import { TrayController } from './TrayController'
import { Aria2Controller } from './Aria2Controller'
import { IpcController } from './IpcController'
import { ConfigWatcher } from '../utils/ConfigWatcher'
import { getSettings } from '../utils/settingsAccessor'
import { createLogger, getLogFilePaths } from '../utils/logger'
// 启动失败分类是纯函数（不依赖 electron），便于单测；见 utils/engineStartupFailureCore
import { buildEngineStartupFailureInfo, engineStartupActionLabels } from '../utils/engineStartupFailureCore'
import type { EngineStartupAction, EngineStartupFailureInfo } from '../utils/engineStartupFailureCore'
import { mainLocaleFrom } from '../utils/mainLocale'
import type { MainLocale } from '../utils/mainLocale'
import { mainError } from '../utils/mainErrorCopy'
import type { StoreData } from '../types/store'

// 本文件日志文案自带 [AppLifecycle] 前缀（历史风格），故 scope 传空避免前缀重复
const logger = createLogger('')

export enum AppStatus {
  INITIALIZING = 'initializing',
  READY = 'ready',
  ERROR = 'error',
  SHUTTING_DOWN = 'shutting_down'
}

/** 用户在错误对话框中选择退出时抛出的标记错误 */
class UserCancelledError extends Error {}

/**
 * AppLifecycle - 集中式应用生命周期管理
 * 协调初始化、就绪状态和优雅关闭
 */
export class AppLifecycle {
  private status: AppStatus = AppStatus.INITIALIZING
  private store: Store<StoreData>
  private configWatcher: ConfigWatcher
  private windowController: WindowController
  private trayController: TrayController
  private aria2Controller: Aria2Controller
  private ipcController: IpcController
  /** `--headless`：不显示主窗口，只保留引擎、托盘与后台服务（服务器/远程管理场景） */
  private readonly headless = process.argv.includes('--headless')

  constructor(
    store: Store<StoreData>,
    windowController: WindowController,
    trayController: TrayController,
    aria2Controller: Aria2Controller,
    ipcController: IpcController
  ) {
    this.store = store
    this.configWatcher = new ConfigWatcher(store)
    this.windowController = windowController
    this.trayController = trayController
    this.aria2Controller = aria2Controller
    this.ipcController = ipcController
  }

  /**
   * 按正确顺序初始化所有子系统
   */
  async initialize(): Promise<void> {
    logger.info('[AppLifecycle] Starting initialization...')
    this.status = AppStatus.INITIALIZING

    try {
      // 步骤 1: 创建窗口（隐藏）
      //
      // --headless（服务器/远程管理场景）下**不建窗口**：只跑引擎、Web 控制台与 MCP。
      // 过去这里无条件建窗，导致无头模式仍会拉起一个 Chromium 渲染进程（常驻内存 + 在
      // 无 X11 的 Linux 上直接启动失败），"无头"名不副实。
      if (this.headless) {
        logger.info('[AppLifecycle] --headless: 跳过创建主窗口（仅引擎与后台服务）')
      } else {
        logger.info('[AppLifecycle] Step 1: Creating window...')
        this.createWindowSafely()
      }

      // 步骤 2: 注册 IPC 处理器
      logger.info('[AppLifecycle] Step 2: Registering IPC handlers...')
      this.ipcController.registerHandlers()

      // 步骤 3: 设置配置监听器
      logger.info('[AppLifecycle] Step 3: Setting up config watchers...')
      this.setupConfigWatchers()

      // 步骤 4: 初始化 Aria2（带错误处理）
      logger.info('[AppLifecycle] Step 4: Initializing Aria2...')
      await this.initializeAria2WithErrorHandling()

      // 步骤 5: 创建托盘（如果启用）
      logger.info('[AppLifecycle] Step 5: Creating tray...')
      this.createTrayIfEnabled()

      // 步骤 6: 标记为就绪
      this.status = AppStatus.READY
      logger.info('[AppLifecycle] Initialization complete')

      // 步骤 7: 显示窗口（--headless 时保持隐藏，由托盘/远程接口控制）
      if (this.headless) {
        logger.info('[AppLifecycle] --headless: 跳过显示主窗口')
      } else if (this.windowController.getMainWindow()) {
        logger.info('[AppLifecycle] Step 7: Showing window...')
        this.windowController.show()
      } else {
        // 建窗失败（典型：Linux 无 DISPLAY/WAYLAND_DISPLAY）不致命：引擎与后台服务照常工作
        logger.warn('[AppLifecycle] 无可用主窗口，跳过显示（无 GUI 环境）')
      }

    } catch (error) {
      // 用户主动选择退出：先执行优雅关闭（Aria2 子进程可能已启动），再向上抛出
      if (error instanceof UserCancelledError) {
        await this.shutdown()
        throw error
      }
      logger.error('[AppLifecycle] Initialization failed:', error)
      this.status = AppStatus.ERROR
      throw error
    }
  }

  /**
   * 创建主窗口，并对"没有图形环境"做容错。
   *
   * 为什么不能让它中断初始化：Linux 服务器/容器里没有 DISPLAY 时 BrowserWindow 构造会抛
   * "Missing X server or $DISPLAY"。过去这个异常直接冒到 initialize 的 catch，导致引擎、
   * Web 控制台、MCP 全都起不来 —— 但窗口只是界面载体，缺它不影响任何后台能力。
   * 这里降级为告警：窗口没建出来，后续 show() 会被跳过（见步骤 7）。
   */
  private createWindowSafely(): void {
    try {
      this.windowController.createWindow()
    } catch (error) {
      logger.warn('[AppLifecycle] 创建主窗口失败，将以无界面模式继续运行:', error)
    }
  }

  /**
   * 初始化 Aria2，带用户友好的错误处理。
   *
   * 失败不再只给一个笼统的「继续/退出」：底层（reclaimLeftoverEngineOnPort 的端口探测）
   * 其实知道到底是"别的 aria2 占着端口"、"端口上是别的服务"还是"可执行文件缺失"，
   * 这里把它翻译成可点的下一步（换端口 / 重试 / 看日志 / 继续 / 退出）。
   */
  private async initializeAria2WithErrorHandling(): Promise<void> {
    for (;;) {
      try {
        await this.aria2Controller.initialize()
        return
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        logger.error('[AppLifecycle] Aria2 initialization failed:', errorMessage)

        // 无头模式没有用户可点对话框：直接失败退出，避免后台进程带病运行
        if (this.headless) {
          throw new Error(mainError(this.mainLocale(), 'engine.headlessStartFailed', { detail: errorMessage }))
        }

        const info = buildEngineStartupFailureInfo(error, this.readConfiguredPort(), this.mainLocale())
        let action = await this.promptEngineStartupAction(info, errorMessage)

        // 「查看日志」不结束对话：打开日志目录后重新弹一次，让用户看完再决定
        while (action === 'open-logs') {
          await this.openLogDirectory()
          action = await this.promptEngineStartupAction(info, errorMessage)
        }

        switch (action) {
          case 'retry':
            // 端口类问题常常再试一次就好（对方进程刚退出）；重试即重新走一遍完整初始化
            logger.info('[AppLifecycle] 用户选择重试启动下载引擎')
            continue
          case 'change-port':
            // 不再阻断初始化：把用户送到设置页的引擎分组，改完端口由他自己点启动
            logger.info('[AppLifecycle] 用户选择更换 RPC 端口，打开引擎设置')
            await this.openEngineSettings()
            return
          case 'quit':
            throw new UserCancelledError('User cancelled due to Aria2 startup failure')
          default:
            // 继续使用：仅记录，不阻断初始化
            return
        }
      }
    }
  }

  /**
   * 主进程文案语言。
   *
   * 主进程没有 i18n 实例，托盘菜单用同样的 `app.getLocale()` 二分中英文；
   * 这里复用同一口径，避免"托盘英文、失败对话框中文"的割裂。
   */
  private mainLocale(): MainLocale {
    return mainLocaleFrom(() => app.getLocale())
  }

  /** 读取设置里的 RPC 端口（仅用于失败提示文案；设置不可读时返回 null） */
  private readConfiguredPort(): number | null {
    try {
      const port = Number(getSettings().aria2?.port)
      return Number.isFinite(port) && port > 0 && port <= 65535 ? port : null
    } catch {
      return null
    }
  }

  /** 按失败分类弹出带行动项的对话框，返回用户选中的动作 */
  private async promptEngineStartupAction(
    info: EngineStartupFailureInfo,
    errorMessage: string
  ): Promise<EngineStartupAction> {
    const locale = this.mainLocale()
    const labels = engineStartupActionLabels(locale)
    const buttons = info.actions.map((action) => labels[action])
    // 默认项优先「重试启动」；cancelId 指向「退出应用」（Esc 关闭 = 退出，与旧行为一致）
    const preferred = info.actions.includes('retry') ? 'retry' : info.actions[0]
    const defaultId = Math.max(info.actions.indexOf(preferred), 0)
    const cancelId = Math.max(info.actions.indexOf('quit'), 0)
    const zh = locale === 'zh'

    const result = await dialog.showMessageBox({
      type: 'error',
      title: zh ? 'Aria2 启动失败' : 'Aria2 failed to start',
      message: zh ? 'Aria2 下载引擎启动失败' : 'The Aria2 download engine failed to start',
      detail: zh
        ? `${info.summary}\n\n建议下一步：${info.hint}\n\n错误详情: ${errorMessage}`
        : `${info.summary}\n\nSuggested next step: ${info.hint}\n\nError details: ${errorMessage}`,
      buttons,
      defaultId,
      cancelId,
      noLink: true
    })

    return info.actions[result.response] ?? 'continue'
  }

  /** 打开日志目录（引擎失败时用户最需要的证据都在这里） */
  private async openLogDirectory(): Promise<void> {
    try {
      const { dir } = getLogFilePaths()
      const failure = await shell.openPath(dir)
      if (failure) logger.warn('[AppLifecycle] 打开日志目录失败:', failure)
    } catch (error) {
      logger.warn('[AppLifecycle] 打开日志目录异常:', error)
    }
  }

  /**
   * 打开设置页的「引擎」分组，让用户就地改 rpc-listen-port。
   *
   * 复用渲染层已有的托盘动作通道（tray-action）而不是新开 IPC：切页逻辑只有一份。
   * 启动失败对话框通常早于页面加载完成，因此这里等渲染层就绪后再投递，否则消息会石沉大海。
   */
  private async openEngineSettings(): Promise<void> {
    if (!this.windowController.getMainWindow()) {
      logger.warn('[AppLifecycle] 无主窗口，无法打开引擎设置')
      return
    }
    this.windowController.show()

    const deadline = Date.now() + 10000
    while (Date.now() < deadline && !this.windowController.isRendererContentReady()) {
      await new Promise((resolve) => setTimeout(resolve, 200))
    }

    const win = this.windowController.getMainWindow()
    if (!win || win.isDestroyed()) {
      logger.warn('[AppLifecycle] 主窗口已销毁，无法打开引擎设置')
      return
    }
    win.webContents.send('tray-action', 'open-engine-settings')
  }

  /**
   * 引擎连续崩溃、已放弃自动重启时的**系统级**提醒。
   *
   * 为什么需要：过去这条消息只以渲染层 toast（duration 0）的形式存在，托盘模式、
   * 无头模式或窗口被隐藏时用户完全看不到 —— 而"引擎已经不会再起来"是必须被知道的
   * 状态，否则他会一直等一个永远不会恢复的下载队列。系统通知不受窗口可见性影响。
   *
   * @param attempts 连续失败次数（来自管理器）
   */
  public notifyEngineGaveUp(attempts: number): void {
    const zh = this.mainLocale() === 'zh'
    const message = zh
      ? `aria2 引擎连续 ${attempts} 次重启失败，已停止自动重启。可在「设置 → 引擎设置」里手动重启，或打开应用日志查看原因。`
      : `The aria2 engine failed to restart ${attempts} times in a row and has stopped auto-restarting. Restart it manually under Settings → Engine, or open the app logs for details.`
    try {
      if (Notification.isSupported()) {
        new Notification({
          title: zh ? 'Aria2 引擎已停止自动重启' : 'Aria2 engine stopped auto-restarting',
          body: message.slice(0, 500),
          urgency: 'critical'
        }).show()
      } else {
        logger.warn('[AppLifecycle] 系统通知不可用，引擎放弃重启事件仅记录日志')
      }
    } catch (error) {
      logger.warn('[AppLifecycle] 发送引擎异常系统通知失败:', error)
    }
    logger.error(`[AppLifecycle] ${message}`)
  }

  /**
   * 如果设置中启用，则创建托盘
   */
  private createTrayIfEnabled() {
    if (this.headless) {
      logger.info('[AppLifecycle] --headless: 跳过创建托盘')
      return
    }
    const settings = getSettings()
    const minimizeToTray = settings.minimizeToTray !== false
    if (minimizeToTray) {
      this.trayController.createTray()
    }
  }

  /**
   * 设置配置监听器以实现热更新
   */
  private setupConfigWatchers() {
    // 监听主题变更
    this.configWatcher.watch('settings.theme', (newValue, _oldValue) => {
      logger.info('[AppLifecycle] Theme changed:', newValue)
      const isDark = newValue === 'dark'
      this.windowController.setWindowTheme(isDark)

      // Notify renderer
      const mainWindow = this.windowController.getMainWindow()
      if (mainWindow) {
        mainWindow.webContents.send('config:changed', {
          key: 'theme',
          value: newValue
        })
      }
    })

    // 监听刷新间隔变更
    this.configWatcher.watch('settings.refreshInterval', (newValue, _oldValue) => {
      logger.info('[AppLifecycle] Refresh interval changed:', newValue)

      // Notify renderer
      const mainWindow = this.windowController.getMainWindow()
      if (mainWindow) {
        mainWindow.webContents.send('config:changed', {
          key: 'refreshInterval',
          value: newValue
        })
      }
    })

    // 监听最小化到托盘变更
    this.configWatcher.watch('settings.minimizeToTray', (newValue, _oldValue) => {
      logger.info('[AppLifecycle] Minimize to tray changed:', newValue)

      if (newValue && !this.trayController.getTray()) {
        this.trayController.createTray()
      } else if (!newValue && this.trayController.getTray()) {
        this.trayController.destroy()
      }
    })
  }

  /**
   * 优雅关闭序列
   */
  async shutdown(): Promise<void> {
    if (this.status === AppStatus.SHUTTING_DOWN) {
      logger.info('[AppLifecycle] Already shutting down...')
      return
    }

    logger.info('[AppLifecycle] Starting graceful shutdown...')
    this.status = AppStatus.SHUTTING_DOWN

    try {
      /**
       * 步骤 1: 先收起界面（隐藏窗口 + 销毁托盘）。
       *
       * 这两步是瞬时的、且与 aria2 无关，必须在停止引擎**之前**做：
       * 停止 aria2 可能要花数秒（RPC 保存会话 + 请求关闭 + 等待退出 + 信号回退），
       * 若等它结束才收界面，用户看到的就是"点了退出，窗口和托盘图标卡住几秒才消失"。
       *
       * ⚠️ 只 `hide()` 窗口，**不要 close/destroy**：销毁窗口会触发 window-all-closed，
       * 而那里在 minimizeToTray=false 时会再次 app.quit()；此时 hasShutdownStarted 已置位、
       * before-quit 会直接放行，收尾流程就被截断（aria2 变成孤儿进程继续占着 RPC 端口）。
       * 隐藏不触发该事件，进程真正退出时窗口自然一起消失。
       */
      logger.info('[AppLifecycle] Step 1: Hiding window and destroying tray...')
      this.windowController.hide()
      this.trayController.destroy()

      // 步骤 2: 停止配置监听器
      logger.info('[AppLifecycle] Step 2: Stopping config watchers...')
      this.configWatcher.unwatchAll()

      // 步骤 3: 断开 Aria2 RPC 连接（如果已连接）
      logger.info('[AppLifecycle] Step 3: Disconnecting from Aria2 RPC...')
      // 这将由前端的 connectionStore 处理

      // 步骤 4: 停止 Aria2 进程（耗时步骤：保存会话 + 请求关闭 + 等待退出）
      logger.info('[AppLifecycle] Step 4: Stopping Aria2 process...')
      await this.aria2Controller.stop()

      // 步骤 5: 关闭插件管理器
      logger.info('[AppLifecycle] Step 5: Closing plugins...')
      this.ipcController.shutdown()

      logger.info('[AppLifecycle] Shutdown complete')
    } catch (error) {
      logger.error('[AppLifecycle] Shutdown error:', error)
      // 即使有错误也继续关闭
    }
  }
}
