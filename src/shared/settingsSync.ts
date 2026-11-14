/**
 * 设置导出/导入（配置同步）契约：主进程 settingsSync 工具与渲染层共用
 */

/** 设置导出文件结构（JSON，可跨实例迁移） */
export interface SettingsExport {
  app: 'Aria2Desktop'
  /** 导出时的应用版本（如 1.3.7） */
  version: string
  /** 导出时间（ISO 8601） */
  exportedAt: string
  /** true 表示敏感字段（密钥/令牌/签名密钥）已脱敏为空字符串 */
  redacted: boolean
  settings: Record<string, unknown>
}

/** 导入校验/应用报告（dryRun 与正式应用共用同一结构） */
export interface SettingsImportReport {
  /** 成功写入（或 dryRun 时将写入）的顶层键 */
  applied: string[]
  /** 导出文件中存在、但本版本不接受导入的顶层键 */
  skipped: string[]
  /** 值非法被拒绝的键及原因 */
  rejected: { key: string; reason: string }[]
  /** 脱敏导出中为空的敏感字段数（这些字段保留本地值不覆盖） */
  preservedSecrets: number
}
