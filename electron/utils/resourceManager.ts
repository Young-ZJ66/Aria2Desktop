import { app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { createLogger } from './logger'

// 本文件日志文案自带 [ResourceManager] 前缀（历史风格），故 scope 传空避免前缀重复
const logger = createLogger('')

/**
 * ResourceManager - 管理 Aria2 相关资源路径
 */
export class ResourceManager {
  private static instance: ResourceManager | null = null
  private executablePath: string = ''
  private configPath: string = ''
  private sessionFilePath: string = ''

  private constructor() {
    this.initializeResources()
  }

  public static getInstance(): ResourceManager {
    if (!ResourceManager.instance) {
      ResourceManager.instance = new ResourceManager()
    }
    return ResourceManager.instance
  }

  public initializeResources() {
    // Aria2 可执行文件路径（跨平台：Windows 为 .exe，其他平台无后缀）
    // 打包后位于 resources 目录（extraResources，只读）；开发环境位于项目 resources/
    const executableName = process.platform === 'win32' ? 'aria2c.exe' : 'aria2c'
    this.executablePath = app.isPackaged
      ? path.join(process.resourcesPath, executableName)
      : path.join(process.cwd(), 'resources', executableName)
    logger.info('[ResourceManager] Looking for aria2 executable at:', this.executablePath)

    // 配置/会话目录：userData（可写），与 electron-store 数据同根。
    // 不再写入 exe 旁目录（Program Files / 只读位置会写入失败）
    const configDir = path.join(app.getPath('userData'), 'aria2')
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true })
    }
    this.configPath = path.join(configDir, 'aria2.conf')

    // 会话文件路径 - 同样在 userData/aria2 目录
    this.sessionFilePath = path.join(configDir, 'aria2.session')

    // 确保会话文件存在
    if (!fs.existsSync(this.sessionFilePath)) {
      fs.writeFileSync(this.sessionFilePath, '', 'utf-8')
      logger.info('[ResourceManager] Created session file:', this.sessionFilePath)
    }

    logger.info('[ResourceManager] Config path:', this.configPath)
    logger.info('[ResourceManager] Session path:', this.sessionFilePath)

    return {
      executablePath: this.executablePath,
      configPath: this.configPath,
      sessionFilePath: this.sessionFilePath
    }
  }

  public isAria2Available(): boolean {
    return fs.existsSync(this.executablePath)
  }

  public getResourceInfo() {
    return {
      executablePath: this.executablePath,
      configPath: this.configPath,
      sessionFilePath: this.sessionFilePath,
      /** 应用数据根目录：设置页"引擎启动失败"提示会展示，便于用户去该目录查配置/会话/日志 */
      userDataPath: app.getPath('userData'),
      exists: this.isAria2Available()
    }
  }

  public getSessionFilePath(): string {
    return this.sessionFilePath
  }
}
