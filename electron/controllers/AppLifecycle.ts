import { dialog } from 'electron'
import Store from 'electron-store'
import { WindowController } from './WindowController'
import { TrayController } from './TrayController'
import { Aria2Controller } from './Aria2Controller'
import { IpcController } from './IpcController'
import { ConfigWatcher } from '../utils/ConfigWatcher'
import { getSettings } from '../utils/settingsAccessor'
import { createLogger } from '../utils/logger'
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
      logger.info('[AppLifecycle] Step 1: Creating window...')
      this.windowController.createWindow()

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

      // 步骤 7: 显示窗口
      logger.info('[AppLifecycle] Step 7: Showing window...')
      this.windowController.show()

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
   * 初始化 Aria2，带用户友好的错误处理
   */
  private async initializeAria2WithErrorHandling(): Promise<void> {
    try {
      await this.aria2Controller.initialize()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('[AppLifecycle] Aria2 initialization failed:', errorMessage)

      // 显示用户友好的错误对话框
      const result = await dialog.showMessageBox({
        type: 'error',
        title: 'Aria2 启动失败',
        message: 'Aria2 下载引擎启动失败',
        detail: `错误详情: ${errorMessage}\n\n可能的原因:\n• Aria2 可执行文件缺失或损坏\n• 端口已被占用\n• 配置文件错误\n\n您可以继续使用应用，但下载功能将不可用。`,
        buttons: ['继续', '退出应用'],
        defaultId: 0,
        cancelId: 1
      })

      if (result.response === 1) {
        // 用户选择退出
        throw new UserCancelledError('User cancelled due to Aria2 startup failure')
      }
      // 用户选择继续 - 仅记录，不阻断初始化
    }
  }

  /**
   * 如果设置中启用，则创建托盘
   */
  private createTrayIfEnabled() {
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
