import { ipcMain, app } from 'electron'
import Store from 'electron-store'
import http from 'http'
import * as path from 'path'
import { getAria2ProcessManager } from '../managers/Aria2ProcessManager'
import type { Aria2ProcessManager } from '../managers/Aria2ProcessManager'
import { WindowController } from './WindowController'
import { createSenderValidator } from '../utils/ipcSecurity'
import { encryptSettingsSecrets, decryptSettingsSecrets } from '../utils/secretCipher'
import type { StoreData, AppSettings } from '../types/store'

/** 端口号合法范围（1024 以下为系统保留端口，65535 为上限） */
const MIN_PORT = 1024
const MAX_PORT = 65535

export class Aria2Controller {
  private aria2Manager: Aria2ProcessManager | null = null
  private store: Store<StoreData>
  private windowController: WindowController
  private validateSender = createSenderValidator(() => this.windowController.getMainWindow())

  constructor(store: Store<StoreData>, windowController: WindowController) {
    this.store = store
    this.windowController = windowController
  }

  public async initialize() {
    try {
      const settings = decryptSettingsSecrets(this.store.get('settings', {}) as AppSettings)
      const aria2Settings = settings.aria2 || {}

      const aria2Config = {
        port: Number(aria2Settings.port) || 6800,
        secret: String(aria2Settings.secret || ''),
        downloadDir: aria2Settings.downloadDir ? String(aria2Settings.downloadDir) : app.getPath('downloads'),
        autoStart: aria2Settings.autoStart !== undefined ? Boolean(aria2Settings.autoStart) : true
      }

      // 日志脱敏：不打印 RPC secret
      console.log('Initializing Aria2 with config:', {
        port: aria2Config.port,
        downloadDir: aria2Config.downloadDir,
        autoStart: aria2Config.autoStart,
        secret: aria2Config.secret ? '***' : ''
      })

      this.aria2Manager = getAria2ProcessManager(aria2Config)

      // 注入优雅关闭钩子：所有停止/重启路径（含配置变更触发的自动重启）
      // 统一先通过 RPC shutdown 保存会话，再退出进程（Windows 信号是强杀）
      this.aria2Manager.setGracefulShutdown(async () => {
        const { port, secret } = this.getRpcSettings()
        await this.callAria2Rpc(port, secret, 'aria2.shutdown', [], 3000)
      })

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
    const settings = decryptSettingsSecrets(this.store.get('settings', {}) as AppSettings)
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
      // stop 内部会先执行注入的 RPC 优雅关闭（保存会话），失败时回退信号关闭
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

    ipcMain.handle('aria2-save-global-options', (event, options: Record<string, string | number>) => {
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

      // 入参规范化与校验，防止异常类型写入 store / 配置文件
      const port = Number(config?.port)
      if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
        return { success: false, error: `Invalid port: ${config?.port}` }
      }
      const downloadDir = String(config?.downloadDir ?? '')
      // downloadDir 提供时必须为绝对路径，防止写入非法路径导致 aria2 启动失败；
      // 为空时保持原行为（由上游回退到默认下载目录）
      if (downloadDir && !path.isAbsolute(downloadDir)) {
        return { success: false, error: 'Invalid downloadDir: must be an absolute path' }
      }
      const serializableConfig = {
        port,
        secret: String(config?.secret ?? ''),
        downloadDir,
        enableRpc: config?.enableRpc === undefined ? true : Boolean(config.enableRpc),
        rpcAllowOriginAll: config?.rpcAllowOriginAll === undefined ? true : Boolean(config.rpcAllowOriginAll),
        autoStart: config?.autoStart === undefined ? true : Boolean(config.autoStart)
      }

      try {
        this.aria2Manager.updateConfig(serializableConfig)
      } catch (e) {
        // 配置文件写入失败时如实反馈，避免用户误以为保存成功
        const error = e instanceof Error ? e.message : String(e)
        console.error('Failed to write aria2 config:', error)
        return { success: false, error: `配置文件写入失败: ${error}` }
      }

      // 更新存储（显式标注 AppSettings 类型，避免对象字面量中的字面量类型被拓宽）
      const currentSettings = decryptSettingsSecrets(this.store.get('settings', {}) as AppSettings)
      const updatedSettings: AppSettings = {
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
      this.store.set('settings', encryptSettingsSecrets(updatedSettings))
      return { success: true }
    })
  }
}
