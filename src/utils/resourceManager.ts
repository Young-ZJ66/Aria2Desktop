import { app } from 'electron'
import { join } from 'path'
import { existsSync, copyFileSync, mkdirSync } from 'fs'

/**
 * 资源管理器 - 处理内置 Aria2 资源文件
 */
export class ResourceManager {
  private static instance: ResourceManager | null = null
  private resourcesPath: string
  private userDataPath: string
  private availabilityCache: { [key: string]: { result: boolean; timestamp: number } } = {}
  private loggedStatus: { [key: string]: boolean } = {}

  private constructor() {
    // 获取应用目录
    const appDirectory = app.isPackaged 
      ? join(process.execPath, '..') 
      : process.cwd()

    // 资源路径 - aria2c.exe 和配置文件模板存放位置
    if (app.isPackaged) {
      // 打包后：在 resources 目录下
      this.resourcesPath = join(appDirectory, 'resources')
    } else {
      // 开发环境：项目根目录的 resources 目录
      this.resourcesPath = join(process.cwd(), 'resources')
    }

    // 用户数据目录 - 配置文件和会话文件存放位置
    this.userDataPath = join(appDirectory, 'data', 'aria2')
    
    console.log('ResourceManager initialized:', {
      resourcesPath: this.resourcesPath,
      userDataPath: this.userDataPath,
      appDirectory,
      isPackaged: app.isPackaged
    })
  }

  public static getInstance(): ResourceManager {
    if (!ResourceManager.instance) {
      ResourceManager.instance = new ResourceManager()
    }
    return ResourceManager.instance
  }

  /**
   * 确保用户数据目录存在
   */
  private ensureUserDataDir(): void {
    if (!existsSync(this.userDataPath)) {
      mkdirSync(this.userDataPath, { recursive: true })
      console.log('Created user data directory:', this.userDataPath)
    }
  }

  /**
   * 获取 Aria2 可执行文件路径
   */
  public getAria2ExecutablePath(): string {
    const executableName = process.platform === 'win32' ? 'aria2c.exe' : 'aria2c'
    
    // aria2c.exe 应该在应用目录的 resources 文件夹中
    const bundledExecutable = join(this.resourcesPath, executableName)
    
    console.log('Looking for aria2c.exe at:', bundledExecutable)
    
    if (existsSync(bundledExecutable)) {
      // 只在首次发现时记录日志
      const logKey = `found_bundled_${bundledExecutable}`
      if (!this.loggedStatus[logKey]) {
        console.log('Found bundled Aria2 executable:', bundledExecutable)
        this.loggedStatus[logKey] = true
      }
      return bundledExecutable
    }

    // 如果内置资源不存在，尝试用户数据目录作为备用
    this.ensureUserDataDir()
    const userExecutable = join(this.userDataPath, executableName)
    if (existsSync(userExecutable)) {
      const logKey = `found_user_${userExecutable}`
      if (!this.loggedStatus[logKey]) {
        console.log('Found user Aria2 executable:', userExecutable)
        this.loggedStatus[logKey] = true
      }
      return userExecutable
    }

    // 都不存在，返回用户数据目录路径（供后续下载使用）
    const logKey = `not_found_${userExecutable}`
    if (!this.loggedStatus[logKey]) {
      console.log('No Aria2 executable found, will use:', userExecutable)
      this.loggedStatus[logKey] = true
    }
    return userExecutable
  }

  /**
   * 检查 Aria2 是否可用（带缓存）
   */
  public isAria2Available(): boolean {
    const executablePath = this.getAria2ExecutablePath()
    const cacheKey = `availability_${executablePath}`
    const now = Date.now()
    const CACHE_DURATION = 30000 // 30秒缓存，减少频繁检查
    
    // 检查缓存
    if (this.availabilityCache[cacheKey] && 
        (now - this.availabilityCache[cacheKey].timestamp) < CACHE_DURATION) {
      return this.availabilityCache[cacheKey].result
    }
    
    // 执行检查
    const available = existsSync(executablePath)
    
    // 更新缓存
    this.availabilityCache[cacheKey] = { result: available, timestamp: now }
    
    // 只在首次检查或状态改变时打印日志
    const logKey = `logged_${cacheKey}`
    if (this.loggedStatus[logKey] === undefined || this.loggedStatus[logKey] !== available) {
      console.log('Aria2 availability check:', { executablePath, available })
      this.loggedStatus[logKey] = available
    }
    
    return available
  }

  /**
   * 获取配置文件路径
   */
  public getConfigFilePath(): string {
    this.ensureUserDataDir()
    return join(this.userDataPath, 'aria2.conf')
  }

  /**
   * 获取会话文件路径
   */
  public getSessionFilePath(): string {
    this.ensureUserDataDir()
    return join(this.userDataPath, 'aria2.session')
  }

  /**
   * 创建默认配置文件（如果不存在）
   */
  public copyDefaultConfigIfNeeded(): boolean {
    const targetConfig = this.getConfigFilePath()  // 目标：data/aria2/aria2.conf

    console.log('Checking config file:', { targetConfig, exists: existsSync(targetConfig) })

    // 如果目标配置文件已存在，不覆盖
    if (existsSync(targetConfig)) {
      console.log('Config file already exists:', targetConfig)
      return true
    }

    // 开发环境：从 resources 目录复制模板
    if (!app.isPackaged) {
      const sourceConfig = join(this.resourcesPath, 'aria2.conf')
      if (existsSync(sourceConfig)) {
        try {
          copyFileSync(sourceConfig, targetConfig)
          console.log('Copied default config file:', sourceConfig, '→', targetConfig)
          return true
        } catch (error) {
          console.error('Failed to copy default config file:', error)
          return false
        }
      }
    }

    // 打包环境或开发环境没有模板时：创建默认配置
    try {
      const defaultConfig = this.generateDefaultConfig()
      const fs = require('fs')
      fs.writeFileSync(targetConfig, defaultConfig, 'utf8')
      console.log('Created default config file:', targetConfig)
      return true
    } catch (error) {
      console.error('Failed to create default config file:', error)
      return false
    }
  }

  /**
   * 生成默认配置内容
   */
  private generateDefaultConfig(): string {
    //const sessionPath = this.getSessionFilePath().replace(/\\/g, '/')
    const sessionPath = 'data/aria2/aria2.session'
    return `## Aria2 Desktop 默认配置 ##

## 文件保存相关 ##

# 文件的保存路径(可使用绝对路径或相对路径), 默认: 当前启动位置
dir=${app.getPath('downloads').replace(/\\\\/g, '/')}
# 启用磁盘缓存, 0为禁用缓存, 需1.16以上版本, 默认:16M
#disk-cache=32M
# 文件预分配方式, 能有效降低磁盘碎片, 默认:prealloc
# 预分配所需时间: none < falloc ? trunc < prealloc
# falloc和trunc则需要文件系统和内核支持
# NTFS建议使用falloc, EXT3/4建议trunc, MAC 下需要注释此项
file-allocation=none
# 断点续传
continue=true
#覆盖已有文件
allow-overwrite=false
#自动重命名
auto-file-renaming=true

## 下载连接相关 ##

# 最大同时下载任务数, 运行时可修改, 默认:5
#max-concurrent-downloads=5
# 同一服务器连接数, 添加时可指定, 默认:1
max-connection-per-server=5
# 最小文件分片大小, 添加时可指定, 取值范围1M -1024M, 默认:20M
# 假定size=10M, 文件为20MiB 则使用两个来源下载; 文件为15MiB 则使用一个来源下载
min-split-size=10M
# 单个任务最大线程数, 添加时可指定, 默认:5
#split=5
# 整体下载速度限制, 运行时可修改, 默认:0
#max-overall-download-limit=0
# 单个任务下载速度限制, 默认:0
#max-download-limit=0
# 整体上传速度限制, 运行时可修改, 默认:0
#max-overall-upload-limit=0
# 单个任务上传速度限制, 默认:0
#max-upload-limit=0
# 禁用IPv6, 默认:false
#disable-ipv6=true
# 连接超时时间, 默认:60
#timeout=60
# 最大重试次数, 设置为0表示不限制重试次数, 默认:5
#max-tries=5
# 设置重试等待的秒数, 默认:0
#retry-wait=0

## 进度保存相关 ##

# 从会话文件中读取下载任务
input-file=${sessionPath}
# 在Aria2退出时保存错误或未完成的下载任务到会话文件
save-session=${sessionPath}
# 定时保存会话, 0为退出时才保存, 默认:0
save-session-interval=60


## RPC相关设置 ##

# 启用RPC, 默认:false
enable-rpc=true
# 允许所有来源, 默认:false
rpc-allow-origin-all=true
# 允许非外部访问, 默认:false
rpc-listen-all=true
# 事件轮询方式, 取值:[epoll, kqueue, port, poll, select], 不同系统默认值不同
#event-poll=select
# RPC监听端口, 端口被占用时可以修改, 默认:6800
rpc-listen-port=6800
# 设置的RPC授权令牌, v1.18.4新增功能, 取代 --rpc-user 和 --rpc-passwd 选项
#rpc-secret=66777
# 设置的RPC访问用户名, 此选项新版已废弃, 建议改用 --rpc-secret 选项
#rpc-user=<USER>
# 设置的RPC访问密码, 此选项新版已废弃, 建议改用 --rpc-secret 选项
#rpc-passwd=<PASSWD>
# 是否启用 RPC 服务的 SSL/TLS 加密,
# 启用加密后 RPC 服务需要使用 https 或者 wss 协议连接
#rpc-secure=true
# 在 RPC 服务中启用 SSL/TLS 加密时的证书文件,
# 使用 PEM 格式时，您必须通过 --rpc-private-key 指定私钥
#rpc-certificate=/path/to/certificate.pem
# 在 RPC 服务中启用 SSL/TLS 加密时的私钥文件
#rpc-private-key=/path/to/certificate.key

## BT/PT下载相关 ##

# 当下载的是一个种子(以.torrent结尾)时, 自动开始BT任务, 默认:true
#follow-torrent=true
# BT监听端口, 当端口被屏蔽时使用, 默认:6881-6999
listen-port=51413
# 单个种子最大连接数, 默认:55
#bt-max-peers=55
# 打开DHT功能, PT需要禁用, 默认:true
enable-dht=false
# 打开IPv6 DHT功能, PT需要禁用
#enable-dht6=false
# DHT网络监听端口, 默认:6881-6999
#dht-listen-port=6881-6999
# 本地节点查找, PT需要禁用, 默认:false
#bt-enable-lpd=false
# 种子交换, PT需要禁用, 默认:true
enable-peer-exchange=false
# 每个种子限速, 对少种的PT很有用, 默认:50K
#bt-request-peer-speed-limit=50K
# 客户端伪装, PT需要
peer-id-prefix=-TR2770-
user-agent=Transmission/2.77
peer-agent=Transmission/2.77
# 当种子的分享率达到这个数时, 自动停止做种, 0为一直做种, 默认:1.0
seed-ratio=0
# 强制保存会话, 即使任务已经完成, 默认:false
# 较新的版本开启后会在任务完成后依然保留.aria2文件
#force-save=false
# BT校验相关, 默认:true
#bt-hash-check-seed=true
# 继续之前的BT任务时, 无需再次校验, 默认:false
bt-seed-unverified=true
# 保存磁力链接元数据为种子文件(.torrent文件), 默认:false
bt-save-metadata=true
`
  }

  /**
   * 复制默认会话文件（如果存在）
   */
  public copyDefaultSessionIfNeeded(): boolean {
    const targetSession = this.getSessionFilePath()

    console.log('Checking session file path:', { targetSession, exists: existsSync(targetSession) })

    // 如果目标会话文件已存在，不覆盖
    if (existsSync(targetSession)) {
      console.log('Session file already exists:', targetSession)
      return true
    }

    // 创建一个空的会话文件（aria2 会话文件通常开始时是空的）
    try {
      const fs = require('fs')
      fs.writeFileSync(targetSession, '', 'utf8')
      console.log('Created empty session file:', targetSession)
      return true
    } catch (error) {
      console.error('Failed to create session file:', error)
      return false
    }
  }

  /**
   * 初始化资源文件
   */
  public initializeResources(): {
    executablePath: string
    configPath: string
    sessionPath: string
    isAria2Available: boolean
  } {
    console.log('Initializing Aria2 resources...')
    
    // 确保用户数据目录存在
    this.ensureUserDataDir()
    
    // 复制默认文件
    this.copyDefaultConfigIfNeeded()
    this.copyDefaultSessionIfNeeded()
    
    const result = {
      executablePath: this.getAria2ExecutablePath(),
      configPath: this.getConfigFilePath(),
      sessionPath: this.getSessionFilePath(),
      isAria2Available: this.isAria2Available()
    }

    console.log('Resource initialization result:', result)
    return result
  }

  /**
   * 获取资源信息
   */
  public getResourceInfo(): {
    resourcesPath: string
    userDataPath: string
    isPackaged: boolean
  } {
    return {
      resourcesPath: this.resourcesPath,
      userDataPath: this.userDataPath,
      isPackaged: app.isPackaged
    }
  }
}
