import { spawn, ChildProcess } from 'child_process'
import * as net from 'net'
import * as http from 'http'
import { existsSync } from 'fs'
import { app } from 'electron'
import { ResourceManager } from '../utils/resourceManager'
import { Aria2ConfigManager } from '../utils/aria2ConfigManager'

/** Aria2 stdout 中不重要的日志模式（运行时噪音，无需转发） */
const IGNORED_STDOUT_PATTERNS = [
  'Serialized session',
  '[INFO]',
  '[DEBUG]',
  'Executing RPC method',
  'RPC: Accepted the connection',
  'Got EOF from peer',
  'Error occurred while reading HTTP request'
]

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
  private retryCount = 0
  private maxRetries = 3
  private restartTimer: NodeJS.Timeout | null = null
  private pendingRestartTimer: NodeJS.Timeout | null = null
  private resourceManager: ResourceManager
  private configManager: Aria2ConfigManager
  /**
   * 优雅关闭钩子（由 Aria2Controller 注入，通过 RPC aria2.shutdown 触发会话保存）。
   * Windows 上进程信号是强杀，先走 RPC 才能保存会话；所有停止/重启路径统一经过 stop()。
   */
  private gracefulShutdownHook: (() => Promise<void>) | null = null

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
      downloadDir: config.downloadDir || app.getPath('downloads'),
      enableRpc: config.enableRpc ?? true,
      rpcAllowOriginAll: config.rpcAllowOriginAll ?? true,
      autoStart: config.autoStart ?? true
    }
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

    // 清理曾被误写入、但当前 aria2c 不支持的选项残留，避免启动时 Unknown option 告警
    if (this.configManager.removeConfigKey('max-piece-length')) {
      console.log('已从 aria2 配置文件移除不支持的 max-piece-length 选项')
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

      // 等待进程就绪：轮询探测 RPC 端口是否可连接，确保后续 RPC 调用可用
      await this.waitForRpcReady()

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

      // 若已 spawn 成功但后续等待就绪失败，先强制终止进程再清引用，避免僵尸进程泄漏
      if (this.process && !this.process.killed) {
        try { this.process.kill('SIGKILL') } catch { /* 进程可能已退出，忽略 kill 失败 */ }
      }
      this.process = null
      return false
    } finally {
      this.isStarting = false
    }
  }

  /**
   * 探测 RPC 端口是否可连接（TCP 层探活）
   * 最多等待 10 秒：端口通了即认为就绪；超时但进程仍存活时也视为启动成功（回退为宽容判定），
   * 进程已退出则抛出错误。替代原先固定延迟 3 秒就判定成功的做法。
   */
  private async waitForRpcReady(timeoutMs = 10000): Promise<void> {
    const port = this.config.port
    const secret = this.configManager.getConfigValue('rpc-secret') || this.config.secret
    const startAt = Date.now()

    while (Date.now() - startAt < timeoutMs) {
      // 进程已退出则直接失败
      if (!this.process || this.process.exitCode !== null || this.process.signalCode !== null) {
        throw new Error(`Aria2 进程异常退出，代码: ${this.process?.exitCode}`)
      }
      // TCP 端口通了之后，再验证 RPC 协议层就绪，排除端口被其他进程占用的情况
      if (await this.probePort(port)) {
        if (await this.probeRpc(port, secret)) {
          return
        }
      }
      await new Promise(resolve => setTimeout(resolve, 250))
    }

    // 超时但进程仍存活：宽容判定为成功（与旧行为兼容），仅记录警告
    if (this.process && !this.process.killed) {
      console.warn(`Aria2 RPC 端口 ${port} 探测超时，进程仍在运行，视为启动成功`)
      return
    }
    throw new Error('Aria2 启动超时')
  }

  /** 尝试建立 TCP 连接探测端口，300ms 内未连上视为未就绪 */
  private probePort(port: number): Promise<boolean> {
    return new Promise(resolve => {
      const socket = new net.Socket()
      const done = (ok: boolean) => {
        socket.destroy()
        resolve(ok)
      }
      socket.setTimeout(300)
      socket.once('connect', () => done(true))
      socket.once('timeout', () => done(false))
      socket.once('error', () => done(false))
      socket.connect(port, '127.0.0.1')
    })
  }

  /** 通过轻量 JSON-RPC 调用（getVersion）验证 RPC 协议层就绪 */
  private probeRpc(port: number, secret: string): Promise<boolean> {
    return new Promise(resolve => {
      const body = JSON.stringify({
        jsonrpc: '2.0',
        id: 'probe',
        method: 'aria2.getVersion',
        params: secret ? [`token:${secret}`] : []
      })
      const req = http.request({
        hostname: '127.0.0.1',
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
        res.on('end', () => resolve(data.includes('"jsonrpc"')))
      })
      req.setTimeout(1000, () => req.destroy())
      req.on('error', () => resolve(false))
      req.end(body)
    })
  }

  /** 等待端口释放（进程停止后 listen socket 立即释放，通常首轮即通过） */
  private async waitForPortRelease(port: number, timeoutMs: number): Promise<void> {
    const startAt = Date.now()
    while (Date.now() - startAt < timeoutMs) {
      if (!(await this.probePort(port))) return
      await new Promise(resolve => setTimeout(resolve, 150))
    }
    console.warn(`等待端口 ${port} 释放超时，继续后续操作`)
  }

  private setupProcessHandlers(): void {
    if (!this.process) return

    this.process.stdout?.on('data', (data) => {
      const output = data.toString().trim()
      // 只输出有意义的内容，过滤空行和不重要的日志/RPC 相关输出
      if (output && !output.match(/^\s*$/) && IGNORED_STDOUT_PATTERNS.every(p => !output.includes(p))) {
        console.log('[Aria2 stdout]:', output)
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
      // spawn 失败（如可执行文件不存在）时 exit 不会触发，此处清理进程引用
      if (!this.process?.pid) {
        this.process = null
      }
    })

    this.process.on('exit', (code, signal) => {
      console.log(`Aria2 进程退出: code=${code}, signal=${signal}`)
      this.handleProcessExit(code, signal)
    })
  }

  private handleProcessExit(code: number | null, signal: string | null): void {
    this.process = null

    // 手动停止、正常退出或被信号终止时，不自动重启
    if (this.isStopping || code === 0 || signal === 'SIGTERM' || signal === 'SIGKILL') {
      console.log('Aria2 进程正常退出')
      return
    }

    // 异常退出时自动重启（与 autoStart 无关，重试次数限制）
    if (this.retryCount < this.maxRetries) {
      this.retryCount++
      console.log(`Aria2 进程异常退出，3秒后尝试第${this.retryCount}次重启`)

      this.restartTimer = setTimeout(() => {
        this.start().catch(error => {
          console.error(`第${this.retryCount}次重启失败:`, error)
        })
      }, 3000)
    } else {
      console.error('Aria2 进程重启次数超限，停止自动重启')
    }
  }

  /** 注入优雅关闭钩子（RPC shutdown，触发 aria2 save-session） */
  public setGracefulShutdown(hook: () => Promise<void>): void {
    this.gracefulShutdownHook = hook
  }

  /** 等待进程退出（轮询 exitCode），超时返回 false */
  private async waitForExit(timeoutMs: number): Promise<boolean> {
    const startAt = Date.now()
    while (Date.now() - startAt < timeoutMs) {
      if (!this.process || this.process.exitCode !== null || this.process.signalCode !== null) {
        return true
      }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    return false
  }

  public async stop(): Promise<boolean> {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }

    if (this.pendingRestartTimer) {
      clearTimeout(this.pendingRestartTimer)
      this.pendingRestartTimer = null
    }

    if (!this.process || this.process.killed) {
      console.log('Aria2 进程未运行')
      return true
    }

    this.isStopping = true
    try {
      console.log('正在停止 Aria2 进程...')

      // 先尝试优雅关闭（RPC shutdown 会保存会话）；Windows 上直接发信号是强杀、不保存会话
      if (this.gracefulShutdownHook) {
        try {
          await this.gracefulShutdownHook()
          // RPC 关闭后等待进程自行退出
          if (await this.waitForExit(3000)) {
            this.process = null
            console.log('Aria2 进程已通过 RPC 优雅停止')
            return true
          }
        } catch {
          // RPC 不可用时回退到进程信号关闭
        }
      }

      // 信号关闭（此时进程仍存在：waitForExit 返回 false 才走到这里）
      const proc = this.process!
      proc.kill('SIGTERM')

      // 等待进程退出 - 确保完全退出
      await new Promise<void>((resolve) => {
        const proc = this.process!
        const timeout = setTimeout(() => {
          // 强制终止
          if (this.process && !this.process.killed) {
            console.log('强制终止 Aria2 进程')
            this.process.kill('SIGKILL')
          }
          finish()
        }, 8000) // 增加到8秒，给进程更多时间优雅退出

        const onExit = () => {
          clearTimeout(timeout)
          finish()
        }

        const finish = () => {
          // resolve 后移除监听器，避免并发 stop() 叠加 exit 监听导致泄漏
          proc.removeListener('exit', onExit)
          resolve()
        }

        proc.on('exit', onExit)
      })

      this.process = null
      console.log('Aria2 进程已停止')
      return true
    } catch (error) {
      console.error('停止 Aria2 进程失败:', error)
      return false
    } finally {
      this.isStopping = false
    }
  }

  public isRunning(): boolean {
    return this.process !== null && !this.process.killed
  }

  public getConfig(): Required<Aria2ProcessConfig> {
    // 重载配置文件中的最新值（复用缓存实例，避免每次 IPC 调用都重建对象）
    this.configManager.reload()
    const actualConfigs = this.configManager.getRelevantConfigs()

    const result = {
      ...this.config,
      // 直接使用配置文件中的值
      downloadDir: actualConfigs.dir || '',
      port: actualConfigs.port ? parseInt(actualConfigs.port, 10) : this.config.port,
      secret: actualConfigs.secret || ''
    }

    return result
  }

  public updateConfig(newConfig: Partial<Aria2ProcessConfig>): void {
    const oldConfig = { ...this.config }
    const mergedConfig = { ...this.config, ...newConfig }

    // 先写配置文件，成功后再更新内存值；写入失败时向上抛出，由 IPC 层反馈给用户
    const configUpdates: Record<string, string | number> = {}

    if (newConfig.port !== undefined) {
      configUpdates['rpc-listen-port'] = newConfig.port
    }

    if (newConfig.secret !== undefined) {
      if (newConfig.secret && newConfig.secret.trim() !== '') {
        configUpdates['rpc-secret'] = newConfig.secret
      } else {
        // 如果密钥为空，注释掉配置文件中的 rpc-secret 行
        this.configManager.commentConfigValue('rpc-secret')
      }
    }

    if (newConfig.downloadDir !== undefined && newConfig.downloadDir.trim() !== '') {
      // 只做路径规范化，目录是否可用交给 Aria2 处理
      configUpdates['dir'] = newConfig.downloadDir.trim().replace(/\\/g, '/')
    }

    if (Object.keys(configUpdates).length > 0) {
      this.configManager.setMultipleConfigs(configUpdates)
    }

    this.config = mergedConfig

    // 检查是否有需要重启才能生效的配置变更
    const needsRestart = this.checkIfRestartNeeded(oldConfig, this.config)
    if (needsRestart && this.isRunning()) {
      console.log('检测到需要重启的配置变更，将自动重启 Aria2 服务')
      // 保存定时器引用，stop() 时可取消，避免退出后复活子进程
      this.pendingRestartTimer = setTimeout(async () => {
        this.pendingRestartTimer = null
        try {
          // 等待配置文件写入完成
          await this.waitForConfigFileSync()
          // 执行重启
          await this.restart()
        } catch (error) {
          console.error('自动重启 Aria2 失败:', error)
        }
      }, 1500) // 1.5 秒缓冲，确保配置文件完全写入后再重启
    }
  }

  // 等待配置文件同步完成
  private async waitForConfigFileSync(): Promise<void> {
    // 等待文件系统同步
    await new Promise(resolve => setTimeout(resolve, 800))

    // 验证配置文件是否可读
    let attempts = 0
    const maxAttempts = 5

    while (attempts < maxAttempts) {
      try {
        // 重新加载配置管理器以验证文件完整性
        this.configManager.reload()
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
      // 先停止进程（stop 内部会先走 RPC 优雅关闭，保存会话后再退出）
      const stopSuccess = await this.stop()
      if (!stopSuccess) {
        throw new Error('停止进程失败')
      }

      // 等待进程完全清理
      await this.waitForProcessCleanup()

      // 等待端口释放（探活循环，通常瞬时完成，替代原先固定 2 秒等待）
      console.log('等待端口完全释放...')
      await this.waitForPortRelease(this.config.port, 5000)
      await new Promise(resolve => setTimeout(resolve, 300))

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
    // 等待进程完全退出（stop 已 await exit，这里做兜底轮询）
    let attempts = 0
    const maxAttempts = 20

    while (attempts < maxAttempts) {
      // 检查进程是否还在运行
      if (!this.isRunning()) {
        break
      }

      await new Promise(resolve => setTimeout(resolve, 500))
      attempts++
    }

    // 短暂缓冲，让句柄清理完成（端口释放由 restart 中的探活循环处理）
    await new Promise(resolve => setTimeout(resolve, 200))
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

  /**
   * 将运行时会话级全局选项持久化到 aria2 配置文件，
   * 使 aria2 进程重启（如每次软件启动）后仍能自动应用（如 max-mmap-limit）。
   */
  public saveGlobalOptionsToConfig(options: Record<string, string | number>): void {
    if (!options || Object.keys(options).length === 0) return

    // 键名白名单校验：
    // 1. 仅接受合法的 aria2 选项名格式（小写字母/数字/连字符），阻止任意内容写入配置文件
    // 2. 拒绝 on-download-* / on-bt-download-* 等执行外部命令的钩子选项，防止等价 RCE
    const BLOCKED_OPTION_PATTERN = /^on-(download|bt-download)-/
    const KEY_NAME_PATTERN = /^[a-z][a-z0-9-]*$/
    const safeOptions: Record<string, string | number> = {}

    for (const [key, value] of Object.entries(options)) {
      if (!KEY_NAME_PATTERN.test(key) || BLOCKED_OPTION_PATTERN.test(key)) {
        console.warn(`[Aria2ProcessManager] Blocked unsafe global option: ${key}`)
        continue
      }
      // 跳过空字符串值（表单占位/未设置项），避免把无意义默认值写进配置文件触发 Unknown option 警告
      if (typeof value === 'string' && value.trim() === '') continue
      if (typeof value === 'string' || typeof value === 'number') {
        safeOptions[key] = value
      }
    }

    if (Object.keys(safeOptions).length === 0) return
    // 重新加载配置文件，确保基于最新文件内容写入
    this.configManager.reload()
    this.configManager.setMultipleConfigs(safeOptions)
  }

  public isAria2Available(): boolean {
    return this.resourceManager.isAria2Available()
  }

  /**
   * 单例已存在时同步外部传入的最新配置（仅更新内存值，不写文件、不触发重启）。
   * 文件写入与重启判定由 updateConfig 负责，避免应用每次启动都重写配置文件。
   */
  public syncConfig(config: Partial<Aria2ProcessConfig>): void {
    const normalized = this.normalizeConfig(config)
    const keys = Object.keys(normalized) as (keyof Required<Aria2ProcessConfig>)[]
    const changed = keys.some(k => normalized[k] !== this.config[k])
    if (changed) {
      this.config = normalized
    }
  }
}

// 单例模式
let aria2Manager: Aria2ProcessManager | null = null

export function getAria2ProcessManager(config?: Partial<Aria2ProcessConfig>): Aria2ProcessManager {
  if (!aria2Manager) {
    aria2Manager = new Aria2ProcessManager(config)
  } else if (config) {
    // 已存在实例时同步最新配置，避免"改了端口不生效"的单例配置失效问题
    aria2Manager.syncConfig(config)
  }
  return aria2Manager
}
