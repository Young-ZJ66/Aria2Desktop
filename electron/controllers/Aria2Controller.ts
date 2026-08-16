import { ipcMain, app, BrowserWindow } from 'electron'
import Store from 'electron-store'
import http from 'http'
import * as path from 'path'
import { getAria2ProcessManager, Aria2ProcessManager } from '../managers/Aria2ProcessManager'
import { WindowController } from './WindowController'
import type { StoreData, AppSettings } from '../types/store'

export class Aria2Controller {
  private aria2Manager: Aria2ProcessManager | null = null
  private store: Store<StoreData>
  private windowController: WindowController

  constructor(store: Store<StoreData>, windowController: WindowController) {
    this.store = store
    this.windowController = windowController
  }

  /**
     * 校验 IPC 调用来源是否为主窗口
     */
  private validateSender(event: Electron.IpcMainInvokeEvent): boolean {
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    const mainWindow = this.windowController.getMainWindow()
    return senderWindow !== null && senderWindow === mainWindow
  }

  public async initialize() {
    try {
      const settings = this.store.get('settings', {}) as AppSettings
      const aria2Settings = settings.aria2 || {}

      const aria2Config = {
        port: Number(aria2Settings.port) || 6800,
        secret: String(aria2Settings.secret || ''),
        downloadDir: aria2Settings.downloadDir ? String(aria2Settings.downloadDir) : app.getPath('downloads'),
        autoStart: aria2Settings.autoStart !== undefined ? Boolean(aria2Settings.autoStart) : true
      }

      console.log('Initializing Aria2 with config:', aria2Config)

      this.aria2Manager = getAria2ProcessManager(aria2Config)

      if (aria2Config.autoStart) {
        const success = await this.aria2Manager.start()
        console.log(`Aria2 auto-start result: ${success}`)
        if (!success) {
          throw new Error('Aria2 进程启动失败，请检查可执行文件与配置')
        }
      }
    } catch (error) {
      console.error('Failed to initialize Aria2 manager:', error)
      // 向上抛出，让 AppLifecycle 显示用户友好的错误对话框
      throw error
    }
  }

  /**
     * 通过 HTTP 直接调用 Aria2 JSON-RPC 接口
     * 避免从主进程导入渲染进程的 service 代码
     */
  private callAria2Rpc(port: number, secret: string, method: string, params: unknown[] = [], timeoutMs = 10000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const rpcParams = secret ? [`token:${secret}`, ...params] : params
      const body = JSON.stringify({
        jsonrpc: '2.0',
        id: '1',
        method,
        params: rpcParams
      })

      const req = http.request({
        hostname: 'localhost',
        port,
        path: '/jsonrpc',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      }, (res) => {
        let data = ''
        res.on('data', (chunk) => { data += chunk })
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data)
            if (parsed.error) {
              reject(new Error(`Aria2 RPC Error: ${parsed.error.message}`))
            } else {
              resolve(parsed.result)
            }
          } catch (e) {
            reject(new Error(`Failed to parse RPC response: ${e}`))
          }
        })
      })

      req.on('error', (e) => reject(e))
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error('RPC request timeout'))
      })
      req.write(body)
      req.end()
    })
  }

  /** 从设置中读取当前 RPC 连接参数 */
  private getRpcSettings(): { port: number; secret: string } {
    const settings = this.store.get('settings', {}) as AppSettings
    const aria2Settings = settings.aria2 || {}
    return {
      port: Number(aria2Settings.port) || 6800,
      secret: String(aria2Settings.secret || '')
    }
  }

  public getManager(): Aria2ProcessManager | null {
    return this.aria2Manager
  }

  public async stop() {
    if (this.aria2Manager && this.aria2Manager.isRunning()) {
      // Windows 上进程信号是强杀且不保存会话，先通过 RPC 优雅关闭（触发 save-session）
      try {
        const { port, secret } = this.getRpcSettings()
        await this.callAria2Rpc(port, secret, 'aria2.shutdown', [], 3000)
      } catch {
        // RPC 不可用时回退到进程信号关闭
      }
      await this.aria2Manager.stop()
    }
  }

  public registerIpcHandlers() {
    ipcMain.handle('aria2-start', async (event) => {
      if (!this.validateSender(event)) return { success: false, error: 'Unauthorized' }
      if (!this.aria2Manager) await this.initialize()
      if (!this.aria2Manager) return { success: false, error: 'Aria2 manager not initialized' }
      return { success: await this.aria2Manager.start() }
    })

    ipcMain.handle('aria2-stop', async (event) => {
      if (!this.validateSender(event)) return { success: false, error: 'Unauthorized' }
      if (!this.aria2Manager) return { success: true }
      await this.stop()
      return { success: true }
    })

    ipcMain.handle('aria2-restart', async (event) => {
      if (!this.validateSender(event)) return { success: false, error: 'Unauthorized' }
      if (!this.aria2Manager) await this.initialize()
      if (!this.aria2Manager) return { success: false, error: 'Aria2 manager not initialized' }
      return { success: await this.aria2Manager.restart() }
    })

    ipcMain.handle('aria2-status', (event) => {
      if (!this.validateSender(event)) return { isRunning: false, error: 'Unauthorized' }
      if (!this.aria2Manager) return { isRunning: false, error: 'Not initialized' }
      return this.aria2Manager.getProcessInfo()
    })

    ipcMain.handle('aria2-save-session', async (event) => {
      if (!this.validateSender(event)) return { success: false, error: 'Unauthorized' }
      // 通过 HTTP 直接调用 Aria2 RPC 保存会话，避免跨进程导入渲染进程代码
      try {
        const { port, secret } = this.getRpcSettings()
        await this.callAria2Rpc(port, secret, 'aria2.saveSession')
        return { success: true }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    })

    ipcMain.handle('aria2-save-global-options', (event, options) => {
      if (!this.validateSender(event)) return { success: false, error: 'Unauthorized' }
      if (!this.aria2Manager) return { success: false, error: 'Aria2 manager not initialized' }
      try {
        this.aria2Manager.saveGlobalOptionsToConfig(options || {})
        return { success: true }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    })

    ipcMain.handle('aria2-update-config', async (event, config) => {
      if (!this.validateSender(event)) return { success: false, error: 'Unauthorized' }
      if (!this.aria2Manager) await this.initialize()
      if (!this.aria2Manager) return { success: false, error: 'Aria2 manager not initialized' }

      const serializableConfig = {
        port: config.port,
        secret: config.secret,
        downloadDir: config.downloadDir,
        enableRpc: config.enableRpc,
        rpcAllowOriginAll: config.rpcAllowOriginAll,
        autoStart: config.autoStart
      }

      this.aria2Manager.updateConfig(serializableConfig)

      // 更新存储
      const currentSettings = this.store.get('settings', {}) as AppSettings
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
