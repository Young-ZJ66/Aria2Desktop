import { ipcMain } from 'electron'
import Store from 'electron-store'
import { getAria2ProcessManager, Aria2ProcessManager } from '../managers/Aria2ProcessManager'

export class Aria2Controller {
    private aria2Manager: Aria2ProcessManager | null = null
    private store: Store

    constructor(store: Store) {
        this.store = store
    }

    public async initialize() {
        try {
            const settings = this.store.get('settings', {}) as any
            const aria2Settings = settings.aria2 || {}

            const aria2Config = {
                port: aria2Settings.port || 6800,
                secret: aria2Settings.secret || '',
                downloadDir: aria2Settings.downloadDir || 'D:/Downloads/Aria2Downloads',
                autoStart: aria2Settings.autoStart !== undefined ? aria2Settings.autoStart : true
            }

            console.log('Initializing Aria2 with config:', aria2Config)

            this.aria2Manager = getAria2ProcessManager(aria2Config)

            if (aria2Config.autoStart) {
                const success = await this.aria2Manager.start()
                console.log(`Aria2 auto-start result: ${success}`)
            }
        } catch (error) {
            console.error('Failed to initialize Aria2 manager:', error)
        }
    }

    public getManager(): Aria2ProcessManager | null {
        return this.aria2Manager
    }

    public async stop() {
        if (this.aria2Manager && this.aria2Manager.isRunning()) {
            await this.aria2Manager.stop()
        }
    }

    public registerIpcHandlers() {
        ipcMain.handle('aria2-start', async () => {
            if (!this.aria2Manager) await this.initialize()
            return { success: await this.aria2Manager!.start() }
        })

        ipcMain.handle('aria2-stop', async () => {
            if (!this.aria2Manager) return { success: true }
            return { success: await this.aria2Manager.stop() }
        })

        ipcMain.handle('aria2-restart', async () => {
            if (!this.aria2Manager) await this.initialize()
            return { success: await this.aria2Manager!.restart() }
        })

        ipcMain.handle('aria2-status', () => {
            if (!this.aria2Manager) return { isRunning: false, error: 'Not initialized' }
            return this.aria2Manager.getProcessInfo()
        })

        ipcMain.handle('aria2-save-session', async () => {
            // 这通常需要前端服务逻辑，但我们可以尝试触发它
            // 现在，我们只需要确保进程正在运行
            // main.ts 中的实际保存逻辑需要 src/services/aria2Service
            // 我们将在 IpcController 中重新实现该桥接，或者如果可以引入服务则保留在这里
            // 由于 aria2Service 是使用 WebSocket 的前端/渲染器服务，
            // 从主进程"保存会话"比较棘手，需要向渲染器发送 IPC
            // 或者从主进程建立单独的 WebSocket 连接
            // 原始的 main.ts 直接在 Node 环境中导入 src/services/aria2Service.ts
            // 现在暂时保持这种模式
            try {
                const aria2Service = require('../../src/services/aria2Service')
                if (aria2Service && aria2Service.Aria2Service) {
                    const service = new aria2Service.Aria2Service()
                    await service.saveSession()
                    return { success: true }
                }
                return { success: false, error: 'Service not found' }
            } catch (e) {
                return { success: false, error: String(e) }
            }
        })

        ipcMain.handle('aria2-update-config', async (_, config) => {
            if (!this.aria2Manager) await this.initialize()

            const serializableConfig = {
                port: config.port,
                secret: config.secret,
                downloadDir: config.downloadDir,
                enableRpc: config.enableRpc,
                rpcAllowOriginAll: config.rpcAllowOriginAll,
                autoStart: config.autoStart
            }

            this.aria2Manager!.updateConfig(serializableConfig)

            // 更新存储
            const currentSettings = this.store.get('settings', {}) as any
            const updatedSettings = {
                ...currentSettings,
                aria2: {
                    ...currentSettings.aria2,
                    host: 'localhost',
                    port: serializableConfig.port,
                    protocol: 'http',
                    secret: serializableConfig.secret,
                    path: '/jsonrpc',
                    downloadDir: serializableConfig.downloadDir,
                    autoStart: serializableConfig.autoStart
                }
            }
            this.store.set('settings', updatedSettings)
            return { success: true }
        })
    }
}
