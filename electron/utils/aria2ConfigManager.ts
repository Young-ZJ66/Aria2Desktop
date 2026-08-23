import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'

/**
 * Aria2ConfigManager - 管理 Aria2 配置文件
 * 保留原始文件中的注释和空行，仅更新已修改的键值对
 */
export class Aria2ConfigManager {
  private configPath: string
  /** 原始文件行列表（保留注释、空行） */
  private rawLines: string[] = []
  /** 已解析的键值对（仅非注释行） */
  private configContent: Map<string, string> = new Map()
  /** 被注释掉的键及其在 rawLines 中的索引 */
  private commentedKeys: Map<string, number> = new Map()

  constructor(configPath: string) {
    this.configPath = configPath
    this.loadConfig()
  }

  /** 重新加载配置文件（复用实例，替代反复 new） */
  reload(): void {
    this.configContent.clear()
    this.commentedKeys.clear()
    this.rawLines = []
    this.loadConfig()
  }

  private loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        // 统一处理 CRLF / CR，避免行尾 \r 残留在键值中
        const content = fs.readFileSync(this.configPath, 'utf-8').replace(/\r\n?/g, '\n')
        this.rawLines = content.split('\n')

        for (let i = 0; i < this.rawLines.length; i++) {
          const trimmed = this.rawLines[i].trim()
          if (!trimmed) continue

          // 解析被注释掉的键值对（如 #rpc-secret=xxx）
          if (trimmed.startsWith('#')) {
            const uncommented = trimmed.substring(1)
            const [key, ...valueParts] = uncommented.split('=')
            // 仅收集符合 aria2 选项命名格式的键，避免普通注释文本（含 = 的 URL 等）被误判
            if (key && valueParts.length > 0 && /^[a-z][a-z0-9-]*$/.test(key.trim())) {
              this.commentedKeys.set(key.trim(), i)
            }
            continue
          }

          // 解析正常的键值对
          const [key, ...valueParts] = trimmed.split('=')
          if (key && valueParts.length > 0) {
            this.configContent.set(key.trim(), valueParts.join('=').trim())
          }
        }
      } else {
        this.createDefaultConfig()
      }
    } catch (error) {
      console.error('Failed to load Aria2 config:', error)
      this.createDefaultConfig()
    }
  }

  private createDefaultConfig() {
    const defaultDownloadDir = app.getPath('downloads').replace(/\\/g, '/')
    const defaultConfig = `# Aria2 Configuration File
dir=${defaultDownloadDir}
rpc-listen-port=6800
rpc-allow-origin-all=true
enable-rpc=true
event-poll=select
max-concurrent-downloads=5
max-connection-per-server=16
min-split-size=10M
split=16
continue=true
save-session-interval=60
log-level=warn
max-mmap-limit=0
`
    try {
      const dir = path.dirname(this.configPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      // 0o600：配置可能包含 rpc-secret，限制为仅当前用户可读写（Windows 上等效继承 ACL，POSIX 上生效）
      fs.writeFileSync(this.configPath, defaultConfig, { encoding: 'utf-8', mode: 0o600 })
      // 直接从默认配置字符串解析内存状态，不再调用 loadConfig()，
      // 避免与 loadConfig 的 catch 分支形成无限递归（文件系统持续失败时栈溢出）
      this.rawLines = defaultConfig.split('\n')
      this.configContent.clear()
      this.commentedKeys.clear()
      for (const line of this.rawLines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const [key, ...valueParts] = trimmed.split('=')
        if (key && valueParts.length > 0) {
          this.configContent.set(key.trim(), valueParts.join('=').trim())
        }
      }
    } catch (error) {
      console.error('Failed to create default config:', error)
    }
  }

  public getConfigValue(key: string): string | undefined {
    return this.configContent.get(key)
  }

  public setConfigValue(key: string, value: string | number) {
    this.configContent.set(key, String(value))
    this.saveConfig()
  }

  public setMultipleConfigs(configs: Record<string, string | number>) {
    for (const [key, value] of Object.entries(configs)) {
      this.configContent.set(key, String(value))
    }
    this.saveConfig()
  }

  /**
   * 注释掉指定配置项（保留原行内容，仅加 # 前缀）
   * 用于禁用某个配置而不丢失其值
   */
  public commentConfigValue(key: string): void {
    this.configContent.delete(key)
    for (let i = 0; i < this.rawLines.length; i++) {
      const trimmed = this.rawLines[i].trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const [k, ...valueParts] = trimmed.split('=')
      if (k && k.trim() === key && valueParts.length > 0) {
        this.rawLines[i] = `#${trimmed}`
        break
      }
    }
    this.saveConfig()
  }

  /**
   * 更新已存在的键值对（包括被注释的 #key=value 行），返回更新后的行列表
   */
  private buildUpdatedLines(lines: string[]): string[] {
    // 更新已存在的键值对（包括被注释的）
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim()
      if (!trimmed) continue

      // 检查被注释的键值对
      if (trimmed.startsWith('#')) {
        const uncommented = trimmed.substring(1)
        const [key, ...valueParts] = uncommented.split('=')
        if (key && valueParts.length > 0) {
          const cleanKey = key.trim()
          // 如果该键现在有值且不在 commentedKeys 中被标记为需要注释
          if (this.configContent.has(cleanKey)) {
            // 取消注释并更新值
            lines[i] = `${cleanKey}=${this.configContent.get(cleanKey)}`
          }
        }
        continue
      }

      // 更新正常键值对
      const [key, ...valueParts] = trimmed.split('=')
      if (key && valueParts.length > 0) {
        const cleanKey = key.trim()
        if (this.configContent.has(cleanKey)) {
          lines[i] = `${cleanKey}=${this.configContent.get(cleanKey)}`
        }
      }
    }

    return lines
  }

  /**
   * 追加新增的键值对（原文件中不存在的），返回追加后的行列表
   */
  private appendNewKeys(lines: string[]): string[] {
    // 重新推导文件中已存在的键（含被注释的 #key=value 行），
    // 等价于更新阶段收集的已更新键集合：在文件中的键不追加，configContent 中独有的键追加
    const existingKeys = new Set<string>()
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      if (trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.substring(1).split('=')
        if (key && valueParts.length > 0) existingKeys.add(key.trim())
        continue
      }
      const [key, ...valueParts] = trimmed.split('=')
      if (key && valueParts.length > 0) existingKeys.add(key.trim())
    }

    const newKeys = Array.from(this.configContent.keys())
      .filter(k => !existingKeys.has(k))

    if (newKeys.length > 0) {
      // 确保文件末尾有换行
      if (lines.length > 0 && lines[lines.length - 1].trim() !== '') {
        lines.push('')
      }
      for (const key of newKeys) {
        lines.push(`${key}=${this.configContent.get(key)}`)
      }
    }

    return lines
  }

  /**
   * 将完整配置内容写入磁盘（0o600：配置可能包含 rpc-secret，限制为仅当前用户可读写）
   */
  private writeToDisk(output: string): void {
    fs.writeFileSync(this.configPath, output, { encoding: 'utf-8', mode: 0o600 })
  }

  /**
   * 保存配置：保留原始文件结构（注释、空行），仅更新已修改的键值对
   * 新增的键值对追加到文件末尾。
   * 写入失败时抛出异常，由调用方决定如何反馈（避免静默丢配置）。
   */
  private saveConfig() {
    let lines: string[] = [...this.rawLines]

    // 更新已存在的键值对（包括被注释的）
    lines = this.buildUpdatedLines(lines)

    // 追加新增的键值对（原文件中不存在的）
    lines = this.appendNewKeys(lines)

    // 确保文件末尾有换行
    if (lines.length === 0 || lines[lines.length - 1] !== '') {
      lines.push('')
    }

    // 写盘（0o600：配置可能包含 rpc-secret，限制为仅当前用户可读写）
    this.writeToDisk(lines.join('\n'))

    // 更新 rawLines 以反映最新状态
    this.rawLines = lines
  }

  /**
   * 移除指定配置项的所有行（正常键值行 + 注释行），并从内存清除。
   * 用于清理曾被误写入、但当前 aria2c 不支持的选项残留。
   * @returns 是否实际有删除（true 表示文件已变更并重新落盘）
   */
  public removeConfigKey(key: string): boolean {
    const beforeLen = this.rawLines.length
    this.configContent.delete(key)
    this.commentedKeys.delete(key)
    this.rawLines = this.rawLines.filter(line => {
      const trimmed = line.trim()
      if (!trimmed) return true
      // 注释行 #key=...
      if (trimmed.startsWith('#')) {
        const [k, ...rest] = trimmed.substring(1).split('=')
        return !(k && k.trim() === key && rest.length > 0)
      }
      const [k, ...rest] = trimmed.split('=')
      return !(k && k.trim() === key && rest.length > 0)
    })
    if (this.rawLines.length !== beforeLen) {
      this.saveConfig()
      return true
    }
    return false
  }

  public getRelevantConfigs() {
    return {
      dir: this.getConfigValue('dir'),
      port: this.getConfigValue('rpc-listen-port'),
      secret: this.getConfigValue('rpc-secret')
    }
  }
}
