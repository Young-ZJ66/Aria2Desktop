import { ipcMain, app } from 'electron'
import Store from 'electron-store'
import http from 'http'
import * as path from 'path'
import { getAria2ProcessManager, Aria2ProcessManager } from '../managers/Aria2ProcessManager'

export class Aria2Controller {
  private aria2Manager: Aria2ProcessManager | null = null
  private store: Store

  constructor(store: Store) {
    this.store = store
  }

  public async initialize() {
    try {
      const settings = this.store.get('settings', {}) as unknown
      const aria2Settings = settings.aria2 || {}

      const aria2Config = {
        port: aria2Settings.port || 6800,
        secret: aria2Settings.secret || '',
        downloadDir: aria2Settings.downloadDir || path.join(app.getPath('downloads'), 'Aria2Downloads'),
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

  /**
     * 通过 HTTP 直接调用 Aria2 JSON-RPC 接口
     * 避免从主进程导入渲染进程的 service 代码
     */
  private callAria2Rpc(port: number, secret: string, method: string, params: unknown[] = []): Promise<unknown> {
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
      req.setTimeout(10000, () => {
        req.destroy(new Error('RPC request timeout'))
      })
      req.write(body)
      req.end()
    })
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
      // 通过 HTTP 直接调用 Aria2 RPC 保存会话，避免跨进程导入渲染进程代码
      try {
        const settings = this.store.get('settings', {}) as unknown
        const aria2Settings = settings.aria2 || {}
        const port = aria2Settings.port || 6800
        const secret = aria2Settings.secret || ''

        await this.callAria2Rpc(port, secret, 'aria2.saveSession')
        return { success: true }
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
            const currentSettings = this.store.get('settings', {}) as unknown
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
