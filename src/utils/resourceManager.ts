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
    // 获取资源路径 - 简化结构，Aria2 文件直接放在应用目录
    if (app.isPackaged) {
      // 生产环境：从应用安装目录
      this.resourcesPath = join(process.execPath, '..')
    } else {
      // 开发环境：从项目根目录的 resources 目录
      this.resourcesPath = join(app.getAppPath(), 'resources')
    }

    // 用户数据目录 - 使用安装目录的 data 文件夹
    const appDirectory = app.isPackaged 
      ? join(process.execPath, '..') 
      : process.cwd()
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
    
    // 直接从应用安装目录查找 aria2c.exe
    const bundledExecutable = join(this.resourcesPath, executableName)
    if (existsSync(bundledExecutable)) {
      // 只在首次发现时记录日志
      const logKey = `found_bundled_${bundledExecutable}`
      if (!this.loggedStatus[logKey]) {
        console.log('Found bundled Aria2 executable:', bundledExecutable)
        this.loggedStatus[logKey] = true
      }
      return bundledExecutable
    }

    // 如果内置资源不存在，尝试用户数据目录
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
   * 复制默认配置文件（如果存在）
   */
  public copyDefaultConfigIfNeeded(): boolean {
    const sourceConfig = join(this.resourcesPath, 'aria2.conf')
    const targetConfig = this.getConfigFilePath()

    // 如果目标配置文件已存在，不覆盖
    if (existsSync(targetConfig)) {
      console.log('Config file already exists:', targetConfig)
      return true
    }

    // 如果源配置文件存在，复制它
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

    console.log('No default config file to copy')
    return false
  }

  /**
   * 复制默认会话文件（如果存在）
   */
  public copyDefaultSessionIfNeeded(): boolean {
    const sourceSession = join(this.resourcesPath, 'aria2.session')
    const targetSession = this.getSessionFilePath()

    // 如果目标会话文件已存在，不覆盖
    if (existsSync(targetSession)) {
      console.log('Session file already exists:', targetSession)
      return true
    }

    // 如果源会话文件存在，复制它
    if (existsSync(sourceSession)) {
      try {
        copyFileSync(sourceSession, targetSession)
        console.log('Copied default session file:', sourceSession, '→', targetSession)
        return true
      } catch (error) {
        console.error('Failed to copy default session file:', error)
        return false
      }
    }

    console.log('No default session file to copy')
    return false
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
