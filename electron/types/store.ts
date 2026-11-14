/**
 * Electron Store 数据类型定义
 *
 * AppSettings 的单一事实来源在 src/shared/appSettings.ts（主进程与渲染层共用），
 * 修改持久化数据结构时只改那一处，本文件仅 re-export。
 */
export type { AppSettings, SpeedScheduleRule } from '../../src/shared/appSettings'
import type { AppSettings } from '../../src/shared/appSettings'
// RSS/监听文件夹自动导入的契约类型同样源自 src/shared（主进程与渲染层共用，理由同上）
export type { RssSubscription, WatchFolderConfig, AutoImportLogEntry } from '../../src/shared/autoImport'
import type { RssSubscription, WatchFolderConfig, AutoImportLogEntry } from '../../src/shared/autoImport'
// Webhook 投递队列条目同样源自 src/shared（主进程与渲染层共用）
export type { WebhookQueueEntry } from '../../src/shared/webhookQueue'
import type { WebhookQueueEntry } from '../../src/shared/webhookQueue'

/** 窗口状态 */
export interface WindowState {
  bounds?: { x: number; y: number; width: number; height: number }
  isMaximized?: boolean
  isFullScreen?: boolean
}

/** Tracker 订阅状态 */
export interface TrackerSubscriptionState {
  /** 是否启用每日自动更新 */
  autoUpdate: boolean
  /** 上次成功更新时间（ISO 字符串） */
  lastUpdate: string | null
  /** 上次成功更新的来源 URL */
  lastSource: string
  /** 上次成功更新的 Tracker 数量 */
  lastCount: number
  /** 自定义订阅源列表 */
  customSources: string[]
  /** 同步频率（小时） */
  syncIntervalHours: number
}

/** Store 完整数据结构 */
export interface StoreData {
  settings: AppSettings
  windowState: WindowState
  trackerSubscription?: TrackerSubscriptionState
  disabledPlugins?: string[]
  /** 已播过的内置示例插件 id（用户卸载后不再自动重装） */
  seededBuiltinPlugins?: string[]
  // ── RSS/Atom 订阅自动下载 + 监听文件夹自动导入（见 services/rssSubscriptionService.ts / watchFolderService.ts）──
  // 全部可选键：旧版本磁盘上没有这些数据，服务读取时以空值兜底。
  /** RSS/Atom 订阅列表 */
  rssSubscriptions?: RssSubscription[]
  /** 每条订阅已见过的条目键（guid/enclosureUrl/link），数组上限 500 FIFO */
  rssSeenItems?: Record<string, string[]>
  /** 监听文件夹列表 */
  watchFolders?: WatchFolderConfig[]
  /** 已导入文件的内容哈希（sha256 hex），上限 1000 FIFO */
  watchSeenHashes?: string[]
  /** 自动导入日志（新→旧），上限 200 条 */
  autoImportLog?: AutoImportLogEntry[]
  /**
   * Webhook 投递队列（见 services/webhookDispatchService.ts）
   *
   * 独立顶层键而不是塞进 settings：队列是运行时状态，不该被"导出配置/恢复默认"
   * 牵动，也不该在设置页的通用保存里被整体回写覆盖。
   */
  webhookQueue?: WebhookQueueEntry[]
  [key: string]: unknown
}
