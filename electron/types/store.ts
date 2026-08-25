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

/** Store 完整数据结构 */
export interface StoreData {
  settings: AppSettings
  windowState: WindowState
  [key: string]: unknown
}
