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
  downloadUpdate: () => Promise<{ success: boolean; error?: string }>
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
      config: Record<string, unknown> | null
      error?: string
    }>
    updateConfig: (config: unknown) => Promise<{ success: boolean; error?: string }>
    saveGlobalOptions: (options: Record<string, string | number>) => Promise<{ success: boolean; error?: string }>
  }

  // 会话管理
  saveSession: () => Promise<{ success: boolean; error?: string }>

  // 已完成任务持久化（存于 userData，替代 localStorage）
  loadPersistedTasks: () => Promise<Record<string, unknown>>
  savePersistedTasks: (data: unknown) => Promise<{ success: boolean; error?: string }>

  // 平台信息
  platform: string

  // 通知主进程渲染进程已就绪
  notifyAppReady: () => void

  // 窗口控制
  minimize: () => void
  maximize: () => void
  close: () => void

  // 配置热重载（返回取消订阅函数）
  onConfigChanged: (callback: (data: { key: string; value: unknown }) => void) => () => void
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}
