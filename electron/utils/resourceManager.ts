import { app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { createLogger } from './logger'
import { getEngineArchDir } from './platform'
import { isPackagedApp } from './appEnv'

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
    // 打包后位于 resources 根目录（extraResources 按平台/架构映射，见 package.json build.*.extraResources）；
    // 开发环境位于项目 resources/aria2/<platform>/<arch>/（与打包源同一份文件）
    const executableName = process.platform === 'win32' ? 'aria2c.exe' : 'aria2c'
    this.executablePath = isPackagedApp
      ? path.join(process.resourcesPath, executableName)
      : this.resolveDevExecutablePath(executableName)
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

  /**
   * 开发环境引擎路径：`resources/aria2/<platform>/<arch>/aria2c[.exe]`。
   *
   * 为什么不再用 `process.cwd()`：启动目录不一定是项目根（IDE、快捷方式、`electron .` 的调用位置都可能变），
   * 用 `app.getAppPath()` 才是稳定的项目根。同时按平台/架构分目录后，一份仓库可同时存放
   * 多平台引擎（Windows 已内置，macOS/Linux 由各自的构建机提供）。
   *
   * 兼容：旧布局 `resources/aria2c.exe` 若存在仍会被采用，避免本地旧检出直接报"引擎不存在"。
   */
  private resolveDevExecutablePath(executableName: string): string {
    const resourcesRoot = path.join(app.getAppPath(), 'resources')
    const archDir = getEngineArchDir(process.platform, process.arch)
    const scoped = path.join(resourcesRoot, 'aria2', process.platform, archDir, executableName)
    if (fs.existsSync(scoped)) return scoped

    const legacy = path.join(resourcesRoot, executableName)
    if (fs.existsSync(legacy)) {
      logger.warn('[ResourceManager] 命中旧布局引擎路径（建议迁移到 resources/aria2/<platform>/<arch>/）:', legacy)
      return legacy
    }
    // 两者都不存在时返回新布局路径：错误信息里给出的是"应该放在哪"，便于一次改对
    return scoped
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
