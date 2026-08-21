/**
 * Electron Store 数据类型定义
 *
 * 注意：AppSettings 与 src/services/settingsService.ts 中的同名接口描述同一份
 * 持久化数据，枚举值（如 theme）必须保持一致，修改任一处时同步更新另一处。
 */

/** 应用设置 */
export interface AppSettings {
  theme?: 'light' | 'dark' | 'auto'
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
    secret?: string
    protocol?: string
    path?: string
    autoStart?: boolean
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
