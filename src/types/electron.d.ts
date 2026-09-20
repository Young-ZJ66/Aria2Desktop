// 自动更新状态推送类型
export interface UpdateStatus {
  state: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  percent?: number
  transferred?: number
  total?: number
  bytesPerSecond?: number
  error?: string
}

// Electron API 类型定义（与 electron/preload.ts 暴露的接口对齐，唯一声明处）
// 结构化参数类型见 @/shared/electronBridge（preload 与渲染层共用）
import type { Aria2UpdateConfig } from '@/shared/electronBridge'
export type { Aria2UpdateConfig } from '@/shared/electronBridge'

export interface ElectronAPI {
  // 应用信息
  getAppVersion: () => Promise<string>

  // 应用默认下载目录（Windows 系统"下载"文件夹）
  getDefaultDownloadDir: () => Promise<{ success: boolean; path?: string; error?: string }>

  // 数据存储
  getStoreValue: (key: string) => Promise<unknown>
  setStoreValue: (key: string, value: unknown) => Promise<{ success: boolean; error?: string }>

  // 文件对话框
  showSaveDialog: (options: unknown) => Promise<{ canceled: boolean; filePath?: string }>
  showOpenDialog: (options: unknown) => Promise<{ canceled: boolean; filePaths: string[] }>

  // 文件系统操作
  showItemInFolder: (path: string) => Promise<{ success: boolean; error?: string }>
  openPath: (path: string) => Promise<{ success: boolean; error?: string }>
  openInExplorer: (path: string) => Promise<{ success: boolean; error?: string }>
  deleteFiles: (paths: string[], taskDir?: string) => Promise<{
    success: boolean
    error?: string
    results?: Array<{ path: string; success: boolean; error?: string }>
  }>

  // 下载文件名探测：URL 里没有文件名（网盘直链/跳转链接）时，向文件服务器取
  // Content-Disposition 中的真实文件名（不下载正文）；失败返回空串
  probeDownloadName: (url: string) => Promise<string>

  // 下载重名处理：目标文件已存在且无 .aria2 控制文件时，返回带序号的空闲文件名（如 xxx (1).rar）；
  // 无冲突/上次中断可续传时原样返回
  resolveDownloadConflict: (dir: string, fileName: string) => Promise<{ fileName: string; conflict: boolean }>

  // 托盘控制
  setTrayEnabled: (enabled: boolean) => Promise<{ success: boolean; error?: string }>

  // 窗口主题设置
  setWindowTheme: (isDark: boolean) => Promise<{ success: boolean; error?: string }>

  // 开机自启
  getAutoLaunch: () => Promise<{ success: boolean; enabled?: boolean; error?: string }>
  setAutoLaunch: (enabled: boolean) => Promise<{ success: boolean; enabled?: boolean; error?: string }>

  // 自动更新
  checkForUpdates: () => Promise<{
    success: boolean
    hasUpdate?: boolean
    version?: string
    notes?: string
    alreadyDownloaded?: boolean
    error?: string
  }>
  checkUpdatesOnStartup: () => Promise<{
    success: boolean
    hasUpdate?: boolean
    version?: string
    notes?: string
    alreadyDownloaded?: boolean
    error?: string
  }>
  downloadUpdate: () => Promise<{ success: boolean; error?: string; checksumUnavailable?: boolean }>
  restartAndInstall: () => Promise<{ success: boolean; error?: string }>
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void

  // Aria2 进程管理
  aria2: {
    start: () => Promise<{ success: boolean; error?: string }>
    stop: () => Promise<{ success: boolean; error?: string }>
    restart: () => Promise<{ success: boolean; error?: string }>
    getStatus: () => Promise<{
      isRunning: boolean
      pid: number | null
      retryCount: number
      config: {
        executablePath: string
        configPath: string
        port: number
        secret: string
        downloadDir: string
        enableRpc: boolean
        rpcAllowOriginAll: boolean
        autoStart: boolean
      } | null
      error?: string
      isAria2Available?: boolean
      resourceInfo?: {
        executablePath: string
        configPath: string
        sessionFilePath: string
        /** 应用数据根目录（引擎启动失败提示里用于指引用户去查看配置/会话/日志） */
        userDataPath: string
        exists: boolean
      }
    }>
    updateConfig: (config: Aria2UpdateConfig) => Promise<{ success: boolean; error?: string }>
    saveGlobalOptions: (options: Record<string, string | number>) => Promise<{ success: boolean; error?: string }>
  }

  // 会话管理
  saveSession: () => Promise<{ success: boolean; error?: string }>

  // Tracker 订阅
  tracker: {
    getStatus: () => Promise<{
      success: boolean
      autoUpdate?: boolean
      lastUpdate?: string | null
      lastSource?: string
      lastCount?: number
      customSources?: string[]
      syncIntervalHours?: number
      error?: string
    }>
    setAutoUpdate: (enabled: boolean, customSources?: string[], syncIntervalHours?: number) => Promise<{
      success: boolean
      autoUpdate?: boolean
      lastUpdate?: string | null
      lastSource?: string
      lastCount?: number
      customSources?: string[]
      syncIntervalHours?: number
      error?: string
    }>
    updateNow: (customSources?: string[]) => Promise<{
      success: boolean
      csv?: string
      count?: number
      lastUpdate?: string | null
      lastSource?: string
      error?: string
    }>
    onUpdated: (callback: (result: {
      success: boolean
      csv?: string
      count?: number
      lastUpdate?: string | null
      lastSource?: string
      error?: string
    }) => void) => () => void
  }

  // 已完成任务持久化（存于 userData，替代 localStorage）
  loadPersistedTasks: () => Promise<Record<string, unknown>>
  savePersistedTasks: (data: unknown) => Promise<{ success: boolean; error?: string }>

  // 平台信息
  platform: string

  // 剪贴板读取（经主进程 IPC：sandbox:true 下 preload 拿不到 clipboard 模块）
  readClipboard: () => Promise<string>

  // 剪贴板写入（同上，经主进程）
  writeClipboard: (text: string) => Promise<boolean>

  // 系统通知（通过主进程 Electron Notification API，比 Web API 更可靠）
  sendNotification: (title: string, body: string) => Promise<void>

  // 主进程窗口焦点时推送的剪贴板 URL
  onClipboardUrlDetected: (callback: (url: string) => void) => () => void

  // 插件管理
  pluginsList: () => Promise<Array<{ manifest: { id: string; name: string; version: string; description?: string; author?: string; permissions?: string[] }; enabled: boolean; path: string; error?: string }>>
  pluginsEnable: (id: string) => Promise<{ success: boolean }>
  pluginsDisable: (id: string) => Promise<{ success: boolean }>
  pluginsUninstall: (id: string) => Promise<{ success: boolean }>

  // yt-dlp 流媒体支持（可选外部引擎）
  ytdlpCheck: () => Promise<{ available: boolean; version?: string; error?: string }>
  ytdlpVideoInfo: (url: string) => Promise<{ success: boolean; info?: { title: string; url: string; ext: string; filesize: number | null; format: string; formats: Array<{ formatId: string; ext: string; resolution: string; fps: number | null; filesize: number | null; vcodec: string; acodec: string; note: string }> }; error?: string }>
  ytdlpFormatUrl: (url: string, formatId: string) => Promise<{ success: boolean; downloadUrl?: string; title?: string; ext?: string; error?: string }>

  // 通知主进程渲染进程已就绪
  notifyAppReady: () => void

  // 窗口控制（minimize/maximize 已删除：无 handler、无调用者的死通道）
  // close 的语义是"退出应用"，非"关闭窗口"
  close: () => void

  // 系统电源操作
  systemShutdown: () => Promise<{ success: boolean; error?: string }>
  systemHibernate: () => Promise<{ success: boolean; error?: string }>
  systemCancelShutdown: () => Promise<{ success: boolean; error?: string }>

  // 系统代理检测
  detectSystemProxy: () => Promise<{ success: boolean; proxy?: string; error?: string }>

  // 任务栏进度条（Windows/macOS，progress: 0-1 或 -1 清除，mode: normal/error/paused）
  setTaskbarProgress: (progress: number, mode?: string) => Promise<void>

  // 配置热重载（返回取消订阅函数）
  onConfigChanged: (callback: (data: { key: string; value: unknown }) => void) => () => void

  // 待处理的下载链接（magnet: 等协议链接）
  onPendingDownloadUrl: (callback: (url: string) => void) => () => void
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}
