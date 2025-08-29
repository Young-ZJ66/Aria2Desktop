import { spawn, ChildProcess } from 'child_process'
import { join } from 'path'
import * as path from 'path'
import { existsSync, mkdirSync } from 'fs'
import { app } from 'electron'
import { ResourceManager } from '../utils/resourceManager'
import { Aria2ConfigManager } from '../utils/aria2ConfigManager'

export interface Aria2ProcessConfig {
  executablePath?: string
  configPath?: string
  port?: number
  secret?: string
  downloadDir?: string
  enableRpc?: boolean
  rpcAllowOriginAll?: boolean
  autoStart?: boolean
}

export class Aria2ProcessManager {
  private process: ChildProcess | null = null
  private config: Required<Aria2ProcessConfig>
  private isStarting = false
  private isStopping = false
  private isRestarting = false  // {{ AURA: Add - 添加重启状态标志防止竞态条件 }}
  private retryCount = 0
  private maxRetries = 3
  private restartTimer: NodeJS.Timeout | null = null
  private configUpdateLock = false  // {{ AURA: Add - 配置更新锁 }}
  private resourceManager: ResourceManager
  private configManager: Aria2ConfigManager

  constructor(config: Partial<Aria2ProcessConfig> = {}) {
    this.resourceManager = ResourceManager.getInstance()
    this.config = this.normalizeConfig(config)
    this.configManager = new Aria2ConfigManager(this.config.configPath)
  }

  private normalizeConfig(config: Partial<Aria2ProcessConfig>): Required<Aria2ProcessConfig> {
    // 初始化资源管理器
    const resources = this.resourceManager.initializeResources()
    
    return {
      executablePath: config.executablePath || resources.executablePath,
      configPath: config.configPath || resources.configPath,
      port: config.port || 6800,
      secret: config.secret || '', // 默认不启用密钥
      downloadDir: config.downloadDir || 'D:/Downloads/Aria2Downloads',
      enableRpc: config.enableRpc ?? true,
      rpcAllowOriginAll: config.rpcAllowOriginAll ?? true,
      autoStart: config.autoStart ?? true
    }
  }

  private generateSecret(): string {
    return Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2)
  }

  private ensureDownloadDirectory(): void {
    // 简单检查：只确保会话文件路径在配置中正确设置
    const sessionPath = this.resourceManager.getSessionFilePath().replace(/\\/g, '/')
    const currentInputFile = this.configManager.getConfigValue('input-file')
    const currentSaveSession = this.configManager.getConfigValue('save-session')
    
    if (!currentInputFile) {
      console.log('设置会话输入文件路径:', sessionPath)
      this.configManager.setConfigValue('input-file', sessionPath)
    }
    
    if (!currentSaveSession) {
      console.log('设置会话保存文件路径:', sessionPath)
      this.configManager.setConfigValue('save-session', sessionPath)
    }
    
    // 不再验证或修改下载目录，完全交给Aria2处理
    console.log('下载目录配置交给Aria2处理，不做任何修改')
  }

  public async start(): Promise<boolean> {
    if (this.process && !this.process.killed) {
      console.log('Aria2 进程已经在运行')
      return true
    }

    if (this.isStarting) {
      console.log('Aria2 进程正在启动中')
      return false
    }

    this.isStarting = true

    try {
      // 检查可执行文件是否存在
      if (!existsSync(this.config.executablePath)) {
        throw new Error(`Aria2 可执行文件不存在: ${this.config.executablePath}`)
      }

      // 确保下载目录存在并更新配置
      this.ensureDownloadDirectory()

      // 启动 Aria2 进程 - 简化启动命令，只使用配置文件
      const args = [
        `--conf-path=${this.config.configPath}`
      ]

      console.log('启动 Aria2:', this.config.executablePath, args.join(' '))

      this.process = spawn(this.config.executablePath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
        windowsHide: true
      })

      this.setupProcessHandlers()

      // 等待进程启动 - 简化检测逻辑，只检查进程是否运行
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Aria2 启动超时'))
        }, 10000) // 10秒超时

        // 监听进程错误和退出
        this.process?.on('error', (error) => {
          clearTimeout(timeout)
          reject(error)
        })

        this.process?.on('exit', (code) => {
          clearTimeout(timeout)
          if (code !== 0 && code !== null) {
            reject(new Error(`Aria2 进程异常退出，代码: ${code}`))
          }
        })

        // 简单延迟后认为启动成功
        setTimeout(() => {
          clearTimeout(timeout)
          console.log('Aria2 进程启动成功')
          resolve()
        }, 3000) // 3秒后认为启动成功
      })

      console.log('Aria2 进程启动成功, PID:', this.process?.pid)
      this.retryCount = 0
      return true

    } catch (error) {
      console.error('启动 Aria2 失败:', error)
      
      // 提供更详细的错误信息
      if (error instanceof Error) {
        if (error.message.includes('ENOENT')) {
          console.error('错误原因: Aria2 可执行文件不存在')
        } else if (error.message.includes('EACCES')) {
          console.error('错误原因: 权限不足，无法启动 Aria2')
        } else if (error.message.includes('EADDRINUSE')) {
          console.error('错误原因: 端口已被占用')
        } else if (error.message.includes('启动超时')) {
          console.error('错误原因: Aria2 启动超时，可能是配置文件有问题')
        } else if (error.message.includes('RPC 服务启动失败')) {
          console.error('错误原因: Aria2 RPC 服务启动失败，请检查配置文件')
        } else {
          console.error('错误原因:', error.message)
        }
      }
      
      this.process = null
      return false
    } finally {
      this.isStarting = false
    }
  }

  private setupProcessHandlers(): void {
    if (!this.process) return

    this.process.stdout?.on('data', (data) => {
      const output = data.toString().trim()
      // 只输出有意义的内容，过滤空行和重复信息
      if (output && !output.match(/^\s*$/)) {
        // 过滤不重要的日志和RPC相关输出
        if (!output.includes('Serialized session') && 
            !output.includes('[INFO]') && 
            !output.includes('[DEBUG]') &&
            !output.includes('Executing RPC method') &&
            !output.includes('RPC: Accepted the connection') &&
            !output.includes('Got EOF from peer') &&
            !output.includes('Error occurred while reading HTTP request')) {
          console.log('[Aria2 stdout]:', output)
        }
      }
    })

    this.process.stderr?.on('data', (data) => {
      const error = data.toString().trim()
      if (error && !error.match(/^\s*$/)) {
        console.error('[Aria2 stderr]:', error)
      }
    })

    this.process.on('error', (error) => {
      console.error('Aria2 进程错误:', error)
      this.handleProcessExit(null, 'error')
    })

    this.process.on('exit', (code, signal) => {
      console.log(`Aria2 进程退出: code=${code}, signal=${signal}`)
      this.handleProcessExit(code, signal)
    })
  }

  private handleProcessExit(code: number | null, signal: string | null): void {
    this.process = null

    // 如果是正常退出或者手动停止，不重启
    if (code === 0 || signal === 'SIGTERM' || signal === 'SIGKILL') {
      console.log('Aria2 进程正常退出')
      return
    }

    // 如果启用了自动重启且重试次数未超限
    if (this.config.autoStart && this.retryCount < this.maxRetries) {
      this.retryCount++
      console.log(`Aria2 进程异常退出，${3}秒后尝试第${this.retryCount}次重启`)
      
      this.restartTimer = setTimeout(() => {
        this.start().catch(error => {
          console.error(`第${this.retryCount}次重启失败:`, error)
        })
      }, 3000)
    } else {
      console.error('Aria2 进程重启次数超限，停止自动重启')
    }
  }

  public async stop(): Promise<boolean> {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }

    if (!this.process || this.process.killed) {
      console.log('Aria2 进程未运行')
      return true
    }

    try {
      console.log('正在停止 Aria2 进程...')
      
      // 优雅关闭
      this.process.kill('SIGTERM')
      
      // 等待进程退出 - 确保完全退出
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          // 强制终止
          if (this.process && !this.process.killed) {
            console.log('强制终止 Aria2 进程')
            this.process.kill('SIGKILL')
          }
          resolve()
        }, 8000) // 增加到8秒，给进程更多时间优雅退出

        this.process?.on('exit', () => {
          clearTimeout(timeout)
          resolve()
        })
      })

      this.process = null
      console.log('Aria2 进程已停止')
      return true
    } catch (error) {
      console.error('停止 Aria2 进程失败:', error)
      return false
    }
  }

  public isRunning(): boolean {
    return this.process !== null && !this.process.killed
  }

  public getConfig(): Required<Aria2ProcessConfig> {
    // 直接读取配置文件中的值
    this.configManager = new Aria2ConfigManager(this.config.configPath)
    const actualConfigs = this.configManager.getRelevantConfigs()
    
    const result = {
      ...this.config,
      // 直接使用配置文件中的值
      downloadDir: actualConfigs.dir || '',  
      port: actualConfigs.port ? parseInt(actualConfigs.port) : this.config.port,
      secret: actualConfigs.secret || ''
    }
    
    return result
  }

  public updateConfig(newConfig: Partial<Aria2ProcessConfig>): void {
    const oldConfig = { ...this.config }
    this.config = { ...this.config, ...newConfig }
    
    // 直接修改配置文件中的相关配置项
    try {
      const configUpdates: Record<string, string | number> = {}
      
      if (newConfig.port !== undefined) {
        configUpdates['rpc-listen-port'] = newConfig.port
      }
      
      if (newConfig.secret !== undefined) {
        if (newConfig.secret && newConfig.secret.trim() !== '') {
          configUpdates['rpc-secret'] = newConfig.secret
        } else {
          // 如果密钥为空，需要注释掉该行
          this.configManager.setConfigValue('#rpc-secret', '')
        }
      }
      
      if (newConfig.downloadDir !== undefined && newConfig.downloadDir.trim() !== '') {
        // 简化下载目录验证，只做基本检查
        const downloadDir = newConfig.downloadDir.trim().replace(/\\/g, '/')
        
        try {
          const fs = require('fs')
          
          // 只检查路径格式是否合理，不强制创建目录
          if (downloadDir && downloadDir.length > 0) {
            configUpdates['dir'] = downloadDir
            console.log(`设置下载目录: ${downloadDir}`)
          }
        } catch (error) {
          console.error(`下载目录设置失败: ${downloadDir}`, error)
          // 即使验证失败，也继续更新配置，让Aria2自己处理
          configUpdates['dir'] = downloadDir
        }
      }
      
      if (Object.keys(configUpdates).length > 0) {
        this.configManager.setMultipleConfigs(configUpdates)
      }
    } catch (error) {
      console.error('更新配置文件失败:', error)
    }

    // 检查是否有需要重启才能生效的配置变更
    const needsRestart = this.checkIfRestartNeeded(oldConfig, this.config)
    if (needsRestart && this.isRunning()) {
      console.log('检测到需要重启的配置变更，将自动重启 Aria2 服务')
      // 增加延迟并确保配置文件完全写入
      setTimeout(async () => {
        try {
          // 等待配置文件写入完成
          await this.waitForConfigFileSync()
          // 执行重启
          await this.restart()
        } catch (error) {
          console.error('自动重启 Aria2 失败:', error)
        }
      }, 1500) // 增加到1.5秒，确保配置文件完全写入
    }
  }

  // 新增：等待配置文件同步完成
  private async waitForConfigFileSync(): Promise<void> {
    // 等待文件系统同步
    await new Promise(resolve => setTimeout(resolve, 800))
    
    // 验证配置文件是否可读
    let attempts = 0
    const maxAttempts = 5
    
    while (attempts < maxAttempts) {
      try {
        // 尝试重新加载配置管理器以验证文件完整性
        this.configManager = new Aria2ConfigManager(this.config.configPath)
        break
      } catch (error) {
        attempts++
        
        if (attempts >= maxAttempts) {
          console.error('配置文件同步验证失败:', error)
          throw new Error('配置文件同步验证失败')
        }
        
        await new Promise(resolve => setTimeout(resolve, 200))
      }
    }
  }

  private checkIfRestartNeeded(oldConfig: Required<Aria2ProcessConfig>, newConfig: Required<Aria2ProcessConfig>): boolean {
    // 以下配置变更需要重启才能生效
    const restartRequiredFields: (keyof Aria2ProcessConfig)[] = [
      'port',
      'secret',
      'downloadDir'
    ]

    return restartRequiredFields.some(field => oldConfig[field] !== newConfig[field])
  }

  public async restart(): Promise<boolean> {
    if (this.isStarting) {
      console.log('进程正在启动中，无法重启')
      return false
    }

    console.log('开始重启 Aria2 进程...')
    
    try {
      // 先停止进程
      const stopSuccess = await this.stop()
      if (!stopSuccess) {
        throw new Error('停止进程失败')
      }

      // 等待进程完全清理
      await this.waitForProcessCleanup()
      
      // 额外等待确保端口完全释放
      console.log('等待端口完全释放...')
      await new Promise(resolve => setTimeout(resolve, 2000))

      // 启动进程
      const startSuccess = await this.start()
      if (!startSuccess) {
        throw new Error('启动进程失败')
      }

      console.log('Aria2 进程重启成功')
      return true
    } catch (error) {
      console.error('重启 Aria2 进程失败:', error)
      return false
    }
  }

  private async waitForProcessCleanup(): Promise<void> {
    // 等待进程完全退出
    let attempts = 0
    const maxAttempts = 20 // 增加到20次
    
    while (attempts < maxAttempts) {
      // 检查进程是否还在运行
      if (!this.isRunning()) {
        break
      }
      
      await new Promise(resolve => setTimeout(resolve, 500))
      attempts++
    }
    
    // 额外等待确保端口释放
    await new Promise(resolve => setTimeout(resolve, 1500)) // 增加到1.5秒
  }

  public getProcessInfo() {
    return {
      isRunning: this.isRunning(),
      pid: this.process?.pid,
      retryCount: this.retryCount,
      config: this.getConfig(), // 使用getConfig()读取配置文件中的最新值
      isAria2Available: this.resourceManager.isAria2Available(),
      resourceInfo: this.resourceManager.getResourceInfo()
    }
  }

  public isAria2Available(): boolean {
    return this.resourceManager.isAria2Available()
  }
}

// 单例模式
let aria2Manager: Aria2ProcessManager | null = null

export function getAria2ProcessManager(config?: Partial<Aria2ProcessConfig>): Aria2ProcessManager {
  if (!aria2Manager) {
    aria2Manager = new Aria2ProcessManager(config)
  }
  return aria2Manager
}
