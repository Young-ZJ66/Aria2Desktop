/**
 * Electron Store 数据类型定义
 */

/** 应用设置 */
export interface AppSettings {
  theme?: 'light' | 'dark' | 'system'
  language?: string
  refreshInterval?: number
  autoConnect?: boolean
  minimizeToTray?: boolean
  closeToTray?: boolean
  startMinimized?: boolean
  keepWindowState?: boolean
  aria2?: {
    host?: string
    port?: number
    rpcSecret?: string
    downloadDir?: string
    [key: string]: unknown
  }
  download?: {
    defaultDir?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

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
