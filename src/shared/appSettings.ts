/**
 * AppSettings 单一事实来源（主进程与渲染层共用）。
 *
 * 历史背景：此前主进程（electron/types/store.ts）与渲染层（src/services/settingsService.ts）
 * 各自维护一份 AppSettings 接口，要求"改一处同步另一处"，极易分叉。
 * 现在统一导入本文件的定义，任一侧新增字段只改这里。
 *
 * 注意：本文件不得 import electron，否则会污染渲染层打包。
 * 所有字段为可选，主进程按 Partial 语义读取（settings.aria2 || {}），
 * 渲染层通过 defaultSettings / mergeWithDefaults 提供缺省值。
 */
export interface ConnectionProfileConfig {
  host: string
  port: number
  protocol: 'http' | 'https' | 'ws' | 'wss'
  secret: string
  path: string
}

export interface ConnectionProfile {
  id: string
  name: string
  config: ConnectionProfileConfig
}

export interface AppSettings {
  // 常规设置
  language?: string
  theme?: 'light' | 'dark' | 'auto'
  refreshInterval?: number
  autoConnect?: boolean
  minimizeToTray?: boolean
  closeToTray?: boolean
  startMinimized?: boolean
  keepWindowState?: boolean
  autoLaunch?: boolean

  // 连接设置（保留兼容，实际使用 profiles）
  aria2?: {
    host?: string
    port?: number
    secret?: string
    protocol?: 'http' | 'https' | 'ws' | 'wss'
    path?: string
    autoStart?: boolean
    downloadDir?: string
  }

  // 多连接配置预设
  connectionProfiles?: ConnectionProfile[]
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
