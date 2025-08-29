import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

/**
 * Aria2 配置文件管理器
 * 负责读取和修改 aria2.conf 文件中的配置项
 */
export class Aria2ConfigManager {
  private configPath: string
  private configContent: string[] = []

  constructor(configPath: string) {
    this.configPath = configPath
    this.loadConfig()
  }

  /**
   * 加载配置文件内容
   */
  private loadConfig(): void {
    if (!existsSync(this.configPath)) {
      throw new Error(`配置文件不存在: ${this.configPath}`)
    }
    
    const content = readFileSync(this.configPath, 'utf-8')
    this.configContent = content.split('\n')
  }

  /**
   * 保存配置文件
   */
  private saveConfig(): void {
    const content = this.configContent.join('\n')
    writeFileSync(this.configPath, content, 'utf-8')
  }

  /**
   * 设置配置项的值
   * @param key 配置项名称
   * @param value 配置项值
   */
  public setConfigValue(key: string, value: string | number): void {
    this.setConfigValueInMemory(key, value)
    this.saveConfig()
  }

  /**
   * 获取配置项的值
   * @param key 配置项名称
   * @returns 配置项值，如果不存在则返回 null
   */
  public getConfigValue(key: string): string | null {
    for (const line of this.configContent) {
      const trimmedLine = line.trim()
      // 跳过注释行
      if (trimmedLine.startsWith('#')) {
        continue
      }
      if (trimmedLine.startsWith(`${key}=`)) {
        return trimmedLine.substring(key.length + 1)
      }
    }
    return null
  }

  /**
   * 批量设置配置项（改进版，减少文件I/O）
   * @param configs 配置项对象
   */
  public setMultipleConfigs(configs: Record<string, string | number>): void {
    // 批量更新内存中的配置，但不立即保存
    for (const [key, value] of Object.entries(configs)) {
      this.setConfigValueInMemory(key, value)
    }
    
    // 一次性保存所有更改
    this.saveConfig()
  }

  /**
   * 仅在内存中设置配置项，不立即保存
   */
  private setConfigValueInMemory(key: string, value: string | number): void {
    let found = false

    // 处理注释配置项的特殊情况
    if (key.startsWith('#')) {
      const actualKey = key.substring(1)
      for (let i = 0; i < this.configContent.length; i++) {
        const line = this.configContent[i].trim()
        if (line.startsWith(`${actualKey}=`)) {
          this.configContent[i] = `#${line}`
          found = true

          break
        }
      }
      return
    }

    const configLine = `${key}=${value}`

    // 查找现有的配置项
    for (let i = 0; i < this.configContent.length; i++) {
      const line = this.configContent[i].trim()
      
      if (line.startsWith(`${key}=`) || line.startsWith(`#${key}=`)) {
        this.configContent[i] = configLine
        found = true

        break
      }
    }

    // 如果没有找到，添加到文件末尾
    if (!found) {
      this.configContent.push(configLine)

    }
  }

  /**
   * 获取所有相关的配置项
   */
  public getRelevantConfigs(): {
    dir: string | null
    port: string | null
    secret: string | null
    logLevel: string | null
    consoleLogLevel: string | null
    enableRpc: string | null
    rpcAllowOriginAll: string | null
  } {
    const configs = {
      dir: this.getConfigValue('dir'),
      port: this.getConfigValue('rpc-listen-port'),
      secret: this.getConfigValue('rpc-secret'),
      logLevel: this.getConfigValue('log-level'),
      consoleLogLevel: this.getConfigValue('console-log-level'),
      enableRpc: this.getConfigValue('enable-rpc'),
      rpcAllowOriginAll: this.getConfigValue('rpc-allow-origin-all')
    }
    

    return configs
  }
}
