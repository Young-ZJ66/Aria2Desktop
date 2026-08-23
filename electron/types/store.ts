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
  autoLaunch?: boolean
  aria2?: {
    host?: string
    port?: number
    secret?: string
    protocol?: string
    path?: string
    autoStart?: boolean
    downloadDir?: string
  }
  // 多连接配置预设（与 src/services/settingsService.ts 中的定义保持一致）
  connectionProfiles?: Array<{
    id: string
    name: string
    config: {
      host: string
      port: number
      protocol: string
      secret: string
      path: string
    }
  }>
  activeProfileId?: string
  // 界面设置
  ui?: {
    showStatusBar?: boolean
    showToolbar?: boolean
    taskListColumns?: string[]
    defaultView?: 'downloading' | 'waiting' | 'stopped'
  }
  // 下载设置
  download?: {
    defaultDir?: string
    maxConcurrentDownloads?: number
    maxConnectionPerServer?: number
    minSplitSize?: string
    autoStart?: boolean
  }
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
