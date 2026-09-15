/**
 * Electron Store 数据类型定义
 *
 * AppSettings 的单一事实来源在 src/shared/appSettings.ts（主进程与渲染层共用），
 * 修改持久化数据结构时只改那一处，本文件仅 re-export。
 */
export type { AppSettings } from '../../src/shared/appSettings'
import type { AppSettings } from '../../src/shared/appSettings'

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
  [key: string]: unknown
}
