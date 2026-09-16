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

/** 单条速度调度规则 */
export interface SpeedScheduleRule {
  /** 规则名称（如"工作时段限速"） */
  name: string
  /** 星期几生效（0=周日，1=周一...6=周六），空数组表示每天 */
  days: number[]
  /** 开始时间（HH:mm 格式，如 "09:00"） */
  startTime: string
  /** 结束时间（HH:mm 格式，如 "18:00"），跨午夜时 endTime < startTime */
  endTime: string
  /** 该时段的下载限速（字节/秒），0 表示无限制 */
  downloadLimit: number
  /** 该时段的上传限速（字节/秒），0 表示无限制 */
  uploadLimit: number
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
  /** 下载全部完成后执行的操作：none=不操作，shutdown=关机，hibernate=休眠，close=关闭应用 */
  downloadCompleteAction?: 'none' | 'shutdown' | 'hibernate' | 'close'

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

  // 速度调度规则（按时段自动切换限速）
  speedSchedule?: {
    enabled: boolean
    rules: SpeedScheduleRule[]
  }

  // 分类下载设置
  category?: {
    /** 是否按文件类型自动分类到子目录 */
    autoClassify?: boolean
    /** 分类规则（结构固定：general + Video/Music/Images/Documents/Compressed/Programs，可编辑目录名与扩展名） */
    categories?: CategoryRule[]
  }
}

/** 单个分类规则。id 固定为系统预定义值，dir 为子目录名，extensions 为用户可编辑的扩展名集合 */
export interface CategoryRule {
  /** 分类标识：general | video | music | images | documents | compressed | programs；自定义规则为生成值 */
  id: string
  /** 子目录名（英文），general 为空字符串表示不归入子目录 */
  dir: string
  /** 匹配的文件扩展名（不含点，小写），空数组表示无匹配 */
  extensions: string[]
  /**
   * 自定义完整目标目录（可选）。为空时：
   * - general 落到主下载目录；其他分类落到 下载目录/子目录名
   * 设置了值则覆盖默认，直接使用该目录
   */
  customDir?: string
  /** 自定义规则的显示名（内置规则为空，用 i18n 文案展示） */
  name?: string
  /** 是否用户自定义规则（内置规则由系统提供，用户可删可改） */
  custom?: boolean
}
