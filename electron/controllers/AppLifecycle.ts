import { EventEmitter } from 'events'
import { dialog } from 'electron'
import Store from 'electron-store'
import { WindowController } from './WindowController'
import { TrayController } from './TrayController'
import { Aria2Controller } from './Aria2Controller'
import { IpcController } from './IpcController'
import { ConfigWatcher } from '../utils/ConfigWatcher'

export enum AppStatus {
    INITIALIZING = 'initializing',
    READY = 'ready',
    ERROR = 'error',
    SHUTTING_DOWN = 'shutting_down'
}

/**
 * AppLifecycle - 集中式应用生命周期管理
 * 协调初始化、就绪状态和优雅关闭
 */
export class AppLifecycle extends EventEmitter {
    private status: AppStatus = AppStatus.INITIALIZING
    private store: Store
    private configWatcher: ConfigWatcher
    private windowController: WindowController
    private trayController: TrayController
    private aria2Controller: Aria2Controller
    private ipcController: IpcController

    constructor(
        store: Store,
        windowController: WindowController,
        trayController: TrayController,
        aria2Controller: Aria2Controller,
        ipcController: IpcController
    ) {
        super()
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
        console.log('[AppLifecycle] Starting initialization...')
        this.status = AppStatus.INITIALIZING

        try {
            // 步骤 1: 创建窗口（隐藏）
            console.log('[AppLifecycle] Step 1: Creating window...')
            this.windowController.createWindow()

            // 步骤 2: 注册 IPC 处理器
            console.log('[AppLifecycle] Step 2: Registering IPC handlers...')
            this.ipcController.registerHandlers()

            // 步骤 3: 设置配置监听器
            console.log('[AppLifecycle] Step 3: Setting up config watchers...')
            this.setupConfigWatchers()

            // 步骤 4: 初始化 Aria2（带错误处理）
            console.log('[AppLifecycle] Step 4: Initializing Aria2...')
            await this.initializeAria2WithErrorHandling()

            // 步骤 5: 创建托盘（如果启用）
            console.log('[AppLifecycle] Step 5: Creating tray...')
            this.createTrayIfEnabled()

            // 步骤 6: 标记为就绪
            this.status = AppStatus.READY
            console.log('[AppLifecycle] ✓ Initialization complete')
            this.emit('ready')

            // 步骤 7: 显示窗口
            console.log('[AppLifecycle] Step 7: Showing window...')
            this.windowController.show()

        } catch (error) {
            console.error('[AppLifecycle] ✗ Initialization failed:', error)
            this.status = AppStatus.ERROR
            this.emit('error', error)
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
            console.error('[AppLifecycle] Aria2 initialization failed:', errorMessage)

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
                throw new Error('User cancelled due to Aria2 startup failure')
            }

            // 用户选择继续 - 发出警告但不抛出异常
            this.emit('aria2-error', error)
        }
    }

    /**
     * 如果设置中启用，则创建托盘
     */
    private createTrayIfEnabled() {
        const settings = this.store.get('settings', {}) as any
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
        this.configWatcher.watch('settings.theme', (newValue, oldValue) => {
            console.log('[AppLifecycle] Theme changed:', newValue)
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
        this.configWatcher.watch('settings.refreshInterval', (newValue, oldValue) => {
            console.log('[AppLifecycle] Refresh interval changed:', newValue)

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
        this.configWatcher.watch('settings.minimizeToTray', (newValue, oldValue) => {
            console.log('[AppLifecycle] Minimize to tray changed:', newValue)

            if (newValue && !this.trayController.getTray()) {
                this.trayController.createTray()
            } else if (!newValue && this.trayController.getTray()) {
                this.trayController.destroyTray()
            }
        })
    }

    /**
     * 优雅关闭序列
     */
    async shutdown(): Promise<void> {
        if (this.status === AppStatus.SHUTTING_DOWN) {
            console.log('[AppLifecycle] Already shutting down...')
            return
        }

        console.log('[AppLifecycle] Starting graceful shutdown...')
        this.status = AppStatus.SHUTTING_DOWN

        try {
            // 步骤 1: 停止配置监听器
            console.log('[AppLifecycle] Step 1: Stopping config watchers...')
            this.configWatcher.unwatchAll()

            // 步骤 2: 断开 Aria2 RPC 连接（如果已连接）
            console.log('[AppLifecycle] Step 2: Disconnecting from Aria2 RPC...')
            // 这将由前端的 connectionStore 处理

            // 步骤 3: 停止 Aria2 进程
            console.log('[AppLifecycle] Step 3: Stopping Aria2 process...')
            await this.aria2Controller.stop()

            // 步骤 4: 销毁托盘
            console.log('[AppLifecycle] Step 4: Destroying tray...')
            this.trayController.destroyTray()

            console.log('[AppLifecycle] ✓ Shutdown complete')
        } catch (error) {
            console.error('[AppLifecycle] Shutdown error:', error)
            // 即使有错误也继续关闭
        }
    }

    /**
     * 检查应用是否就绪
     */
    isReady(): boolean {
        return this.status === AppStatus.READY
    }

    /**
     * 获取当前状态
     */
    getStatus(): AppStatus {
        return this.status
    }

    /**
     * 获取配置监听器实例
     */
    getConfigWatcher(): ConfigWatcher {
        return this.configWatcher
    }
}
