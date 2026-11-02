import type { ExtensionConnection } from '../shared/extensionVersion'

// 自动更新状态推送类型
export interface UpdateStatus {
  state: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  /** available 时随推送携带（定时复查路径没有 IPC 返回值，弹窗日志区依赖它） */
  notes?: string
  /** 该平台不支持应用内安装（macOS/Linux），弹窗应显示"前往下载"而非"立即更新" */
  manualDownload?: boolean
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

/** yt-dlp 下载模式的进度/结果事件（主进程 → 渲染层） */
export type StreamDownloadEvent =
  | {
    type: 'started'
    id: string
    url: string
    title?: string
    formatId?: string
    merge: boolean
    outputDir: string
  }
  | {
    type: 'progress'
    id: string
    percent: number
    speed?: string
    eta?: string
    downloadedBytes?: number
    totalBytes?: number
    /** 速度原始值（字节/秒） */
    speedBytes?: number
  }
  | { type: 'completed'; id: string; filePath: string }
  | { type: 'failed'; id: string; error: string }
  | { type: 'cancelled'; id: string }

export interface ElectronAPI {
  // 应用信息
  getAppVersion: () => Promise<string>

  // 浏览器扩展最近一次连接（connection.version 为 null 表示还没连过或旧版扩展不带版本头）
  getExtensionStatus: () => Promise<{ appVersion: string; connection: ExtensionConnection }>

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

  /** 在系统浏览器中打开外部链接（仅白名单站点，见 electron/utils/externalUrlCore） */
  openExternalUrl: (url: string) => Promise<{ success: boolean; error?: string }>

  // 下载文件名探测：URL 里没有文件名（网盘直链/跳转链接）时，向文件服务器取
  // Content-Disposition 中的真实文件名（不下载正文）；失败返回空串
  probeDownloadName: (url: string) => Promise<string>

  // 下载重名处理：目标文件已存在且无 .aria2 控制文件时，返回带序号的空闲文件名（如 xxx (1).rar）；
  // 无冲突/上次中断可续传时原样返回
  resolveDownloadConflict: (dir: string, fileName: string) => Promise<{ fileName: string; conflict: boolean }>

  // 下载完成后自动解压（仅支持 zip/7z/tar 系；主进程校验路径必须位于下载目录内）
  extractArchive: (filePath: string) => Promise<{
    success: boolean
    /** 是否执行了解压（false 表示按格式规则跳过，不算失败） */
    extracted: boolean
    reason?: string
    targetDir?: string
  }>

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
    /** 该平台不支持应用内安装（macOS/Linux），应引导用户去 Release 页 */
    manualDownload?: boolean
    error?: string
  }>
  checkUpdatesOnStartup: () => Promise<{
    success: boolean
    hasUpdate?: boolean
    version?: string
    notes?: string
    alreadyDownloaded?: boolean
    manualDownload?: boolean
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
    /**
     * 更新引擎配置。失败时返回**稳定错误码**（invalid_port / invalid_download_dir /
     * config_write_failed / not_initialized），渲染层按 code 分支展示提示，
     * 不要依赖 `error` 文案（改文案会让分支静默失效）。
     */
    updateConfig: (config: Aria2UpdateConfig) => Promise<{ success: boolean; code?: string; error?: string }>
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

  // 托盘菜单快捷动作（new-task / settings / pause-all / resume-all）
  onTrayAction: (callback: (action: string) => void) => () => void

  /** 引擎意外退出（崩溃后会被自动重启）：retryCount 是第几次尝试重启 */
  onEngineCrashed: (callback: (info: { retryCount: number }) => void) => () => void
  onEngineStarted: (callback: () => void) => () => void
  onEngineGaveUp: (callback: (info: { attempts: number }) => void) => () => void

  // 插件管理
  pluginsList: () => Promise<Array<{ manifest: { id: string; name: string; version: string; description?: string; author?: string; permissions?: string[] }; enabled: boolean; path: string; error?: string }>>
  pluginsEnable: (id: string) => Promise<{ success: boolean }>
  pluginsDisable: (id: string) => Promise<{ success: boolean }>
  pluginsUninstall: (id: string) => Promise<{ success: boolean }>
  /** 插件目录真实路径（由主进程解析，跨平台一致） */
  pluginsDir: () => Promise<{ success: boolean; path?: string; error?: string }>
  /** 打开插件目录（主进程用真实路径打开，不存在时自动创建） */
  pluginsOpenDir: () => Promise<{ success: boolean; error?: string }>

  /** 应用自身日志文件与所在目录（由 electron-log 解析，报障时用户附上该文件） */
  getLogsPath: () => Promise<{ success: boolean; file?: string; dir?: string }>
  /** 打开应用日志目录（不存在时自动创建） */
  openLogsDir: () => Promise<{ success: boolean; dir?: string; error?: string }>

  /** 把 aria2 下载事件转发给主进程插件系统（fire-and-forget，无返回值） */
  notifyDownloadEvent: (kind: 'downloadComplete' | 'downloadStart', gid: string, name: string) => void

  // yt-dlp 流媒体支持（可选外部引擎，首次使用时按需下载）
  ytdlpCheck: () => Promise<{ available: boolean; version?: string; error?: string; source?: 'downloaded' | 'bundled' | 'path'; installable: boolean; approxSizeMB?: number }>
  /** 检查 yt-dlp 是否有新版本（GitHub Release 最新 tag 与本地版本比较） */
  ytdlpCheckUpdate: () => Promise<{ success: boolean; updateAvailable: boolean; checkable: boolean; currentVersion?: string; latestVersion?: string; error?: string }>
  /** 下载当前平台的官方 yt-dlp（校验 SHA-256 后安装到 userData），进度走 onYtdlpInstallProgress */
  ytdlpInstall: () => Promise<{ success: boolean; version?: string; error?: string }>
  /** 订阅安装进度，返回取消订阅函数 */
  onYtdlpInstallProgress: (callback: (progress: { percent: number; transferred: number; total: number }) => void) => () => void
  ytdlpVideoInfo: (url: string) => Promise<{ success: boolean; info?: { title: string; url: string; ext: string; filesize: number | null; format: string; formats: Array<{ formatId: string; ext: string; resolution: string; fps: number | null; filesize: number | null; vcodec: string; acodec: string; note: string }>; httpHeaders?: Record<string, string> }; error?: string }>
  ytdlpFormatUrl: (url: string, formatId: string) => Promise<{ success: boolean; downloadUrl?: string; title?: string; ext?: string; httpHeaders?: Record<string, string>; error?: string }>

  // ffmpeg：合并音视频时按需下载
  ffmpegCheck: () => Promise<{ available: boolean; version?: string; error?: string; source?: 'downloaded' | 'path'; installable: boolean; approxSizeMB?: number }>
  /** 检查 ffmpeg 是否有新构建（滚动构建按构建日期比较） */
  ffmpegCheckUpdate: () => Promise<{ success: boolean; updateAvailable: boolean; checkable: boolean; currentVersion?: string; latestVersion?: string; error?: string }>
  ffmpegInstall: () => Promise<{ success: boolean; version?: string; error?: string }>
  onFfmpegInstallProgress: (callback: (progress: { percent: number; transferred: number; total: number }) => void) => () => void

  // yt-dlp 下载模式（分离音视频站点：由 yt-dlp 下载并合并音轨）
  streamDownloadStart: (request: { url: string; formatId?: string; merge?: boolean; title?: string; outputDir: string }) => Promise<{ success: boolean; id?: string; code?: 'ffmpeg_missing' | 'invalid_request'; error?: string }>
  streamDownloadCancel: (id: string) => Promise<boolean>
  onStreamDownloadEvent: (callback: (event: StreamDownloadEvent) => void) => () => void

  // 通知主进程渲染进程已就绪
  notifyAppReady: () => void

  // 渲染层异常日志（落主进程 electron-log 文件）
  reportRendererError: (payload: { message: string; stack?: string; kind?: string }) => void

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
    /** 主进程退出链路调用：渲染层刷盘合批中的任务记录/时间记录（useAppLifecycle 挂载） */
    __flushPendingTaskData?: () => Promise<void>
  }
}
