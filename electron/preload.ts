import { contextBridge, ipcRenderer } from 'electron'
import type { Aria2UpdateConfig } from '../src/shared/electronBridge'
import type { UpdateStatus } from '../src/types/electron'
// 自动导入（RSS 订阅 / 监听文件夹）的载荷结构：主进程与渲染层共用一份契约
import type { RssSubscription, WatchFolderConfig } from '../src/shared/autoImport'

// 暴露给渲染进程的API
const electronAPI = {
  // 应用信息
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  // 浏览器扩展最近一次连接（设置页提示"扩展是旧版吗"用）
  getExtensionStatus: () => ipcRenderer.invoke('get-extension-status'),
  exportTaskTorrent: (gid: string) => ipcRenderer.invoke('export-task-torrent', gid),
  webConsoleStatus: () => ipcRenderer.invoke('web-console-status'),
  lookupPeerLocations: (ips: string[]) => ipcRenderer.invoke('lookup-peer-locations', ips),
  webConsoleRestart: () => ipcRenderer.invoke('web-console-restart'),
  // 应用默认下载目录（Windows 系统"下载"文件夹）
  getDefaultDownloadDir: () => ipcRenderer.invoke('get-default-download-dir'),

  // 数据存储
  getStoreValue: (key: string) => ipcRenderer.invoke('get-store-value', key),
  setStoreValue: (key: string, value: unknown) => ipcRenderer.invoke('set-store-value', key, value),

  // 文件对话框
  showSaveDialog: (options: unknown) => ipcRenderer.invoke('show-save-dialog', options),
  showOpenDialog: (options: unknown) => ipcRenderer.invoke('show-open-dialog', options),

  // 文件系统操作
  showItemInFolder: (path: string, taskDir?: string) => ipcRenderer.invoke('show-item-in-folder', path, taskDir),
  openPath: (path: string) => ipcRenderer.invoke('open-path', path),
  openInExplorer: (path: string, taskDir?: string) => ipcRenderer.invoke('open-in-explorer', path, taskDir),
  openFile: (path: string, taskDir?: string) => ipcRenderer.invoke('open-file', path, taskDir),
  deleteFiles: (paths: string[], taskDir?: string) => ipcRenderer.invoke('delete-files', paths, taskDir),

  // 在系统浏览器里打开外部链接（主进程按站点白名单校验，见 utils/externalUrlCore）
  openExternalUrl: (url: string) => ipcRenderer.invoke('open-external-url', url),

  // 下载文件名探测（网盘直链/跳转链接的 URL 无文件名，分类需要从响应头拿真实文件名）
  probeDownloadName: (url: string) => ipcRenderer.invoke('download-probe-filename', url),

  // 下载重名处理：目标文件已存在且无 .aria2 控制文件时，返回带序号的空闲文件名
  //（continue=true 下 aria2 会把同名完整文件当作已完成而秒结束，auto-file-renaming 不会生效）
  resolveDownloadConflict: (dir: string, fileName: string) =>
    ipcRenderer.invoke('resolve-download-conflict', dir, fileName),

  // 磁盘剩余空间查询（新建任务提交前预检；查询失败返回 free=-1，渲染层跳过预检）
  getDiskFreeSpace: (dir: string) => ipcRenderer.invoke('get-disk-free-space', dir),

  // UPnP 端口映射（BT 设置页展示状态 / 手动重映射）
  getUpnpStatus: () => ipcRenderer.invoke('get-upnp-status'),
  remapUpnp: () => ipcRenderer.invoke('upnp-remap'),

  // 下载完成后自动解压（仅在设置开启时由渲染层调用；主进程校验路径必须位于下载目录内）
  extractArchive: (filePath: string) => ipcRenderer.invoke('archive-extract', filePath),

  // 托盘控制
  setTrayEnabled: (enabled: boolean) => ipcRenderer.invoke('set-tray-enabled', enabled),
  setWindowTheme: (isDark: boolean) => ipcRenderer.invoke('set-window-theme', isDark),

  // 开机自启
  getAutoLaunch: () => ipcRenderer.invoke('get-auto-launch'),
  setAutoLaunch: (enabled: boolean) => ipcRenderer.invoke('set-auto-launch', enabled),

  // 自动更新
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  checkUpdatesOnStartup: () => ipcRenderer.invoke('check-updates-on-startup'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  restartAndInstall: () => ipcRenderer.invoke('restart-and-install'),
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: UpdateStatus) => callback(status)
    ipcRenderer.on('update:status', listener)
    return () => {
      ipcRenderer.removeListener('update:status', listener)
    }
  },

  // Aria2 进程管理
  aria2: {
    start: () => ipcRenderer.invoke('aria2-start'),
    stop: () => ipcRenderer.invoke('aria2-stop'),
    restart: () => ipcRenderer.invoke('aria2-restart'),
    getStatus: () => ipcRenderer.invoke('aria2-status'),
    updateConfig: (config: Aria2UpdateConfig) => ipcRenderer.invoke('aria2-update-config', config),
    saveGlobalOptions: (options: Record<string, string | number>) => ipcRenderer.invoke('aria2-save-global-options', options)
  },

  // 会话管理
  saveSession: () => ipcRenderer.invoke('aria2-save-session'),

  // Tracker 订阅
  tracker: {
    getStatus: () => ipcRenderer.invoke('tracker-subscription-status'),
    setAutoUpdate: (enabled: boolean, customSources?: string[], syncIntervalHours?: number) =>
      ipcRenderer.invoke('tracker-set-auto-update', enabled, customSources, syncIntervalHours),
    updateNow: (customSources?: string[]) => ipcRenderer.invoke('tracker-update-now', customSources),
    onUpdated: (callback: (result: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, result: unknown) => callback(result)
      ipcRenderer.on('tracker:updated', listener)
      return () => {
        ipcRenderer.removeListener('tracker:updated', listener)
      }
    }
  },

  // RSS/Atom 订阅 + 监听文件夹自动导入（通道由 rssSubscriptionService /
  // watchFolderService 注册；主进程无主动推送，渲染层靠轮询与手动刷新拿最新状态）
  rssSubsList: () => ipcRenderer.invoke('rss-subs-list'),
  rssSubsSave: (subscription: RssSubscription) => ipcRenderer.invoke('rss-subs-save', subscription),
  rssSubsDelete: (id: string) => ipcRenderer.invoke('rss-subs-delete', id),
  rssSubsFetchNow: (id: string) => ipcRenderer.invoke('rss-subs-fetch-now', id),
  watchFoldersList: () => ipcRenderer.invoke('watch-folders-list'),
  watchFoldersSave: (folder: WatchFolderConfig) => ipcRenderer.invoke('watch-folders-save', folder),
  watchFoldersDelete: (id: string) => ipcRenderer.invoke('watch-folders-delete', id),
  watchFoldersScanNow: (id: string) => ipcRenderer.invoke('watch-folders-scan-now', id),
  autoImportLogList: () => ipcRenderer.invoke('auto-import-log-list'),

  // Webhook 投递队列（通道由 webhookDispatchService 注册：重试/指数退避/失败队列）
  webhookQueueList: () => ipcRenderer.invoke('webhook-queue-list'),
  webhookQueueRetry: (id: string) => ipcRenderer.invoke('webhook-queue-retry', id),
  webhookQueueClear: () => ipcRenderer.invoke('webhook-queue-clear'),

  // 设置导出/导入（配置同步；导出默认脱敏敏感字段）
  settingsExport: (options?: { includeSecrets?: boolean }) => ipcRenderer.invoke('settings-export', options),
  settingsImport: (data: unknown, options?: { dryRun?: boolean }) => ipcRenderer.invoke('settings-import', data, options),

  // 已完成任务持久化（替代 localStorage，存于 userData）
  loadPersistedTasks: () => ipcRenderer.invoke('persisted-tasks-load'),
  savePersistedTasks: (data: unknown) => ipcRenderer.invoke('persisted-tasks-save', data),
  // 增量通道：完成一条写一条、删哪条删哪条（SQLite 后端；JSON 回退时返回 fallback:true）
  savePersistedTask: (gid: string, task: unknown) => ipcRenderer.invoke('persisted-tasks-save-one', gid, task),
  deletePersistedTasks: (gids: string[]) => ipcRenderer.invoke('persisted-tasks-delete', gids),
  clearPersistedTasks: () => ipcRenderer.invoke('persisted-tasks-clear'),
  getPersistedTasksStats: () => ipcRenderer.invoke('persisted-tasks-stats'),

  // 平台信息（值而非函数：平台在进程生命周期内不变，直接暴露简化渲染层访问）
  platform: process.platform,

  // 剪贴板读取（经主进程 IPC：sandbox:true 下 preload 不可直接使用 clipboard 模块，
  // 官方白名单仅含 contextBridge/crashReporter/ipcRenderer/nativeImage/webFrame/webUtils）
  readClipboard: (): Promise<string> => ipcRenderer.invoke('read-clipboard'),

  // 剪贴板写入（同样经主进程：sandbox:true 下 preload 不可直接用 clipboard 模块）
  writeClipboard: (text: string): Promise<boolean> => ipcRenderer.invoke('write-clipboard', text),

  // 系统密钥环是否可用（false 时 RPC secret 会以明文落盘，设置页据此提示）
  getSecretStorageStatus: (): Promise<{ available: boolean; platform: string }> => ipcRenderer.invoke('get-secret-storage-status'),

  // 系统通知（通过主进程 Electron Notification API）
  sendNotification: (title: string, body: string) => ipcRenderer.invoke('send-notification', title, body),

  // 主进程窗口焦点时推送的剪贴板 URL（由 WindowController 检测）
  onClipboardUrlDetected: (callback: (url: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, url: string) => callback(url)
    ipcRenderer.on('clipboard-url-detected', listener)
    return () => {
      ipcRenderer.removeListener('clipboard-url-detected', listener)
    }
  },

  // 托盘菜单快捷动作（新建下载/设置/暂停全部/恢复全部）
  onTrayAction: (callback: (action: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, action: string) => callback(action)
    ipcRenderer.on('tray-action', listener)
    return () => {
      ipcRenderer.removeListener('tray-action', listener)
    }
  },

  // 引擎意外退出（崩溃后会被自动重启）：让界面能给用户一句说明，
  // 否则用户只看到下载卡了几秒，不知道发生过什么
  onEngineCrashed: (callback: (info: { retryCount: number }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, info: { retryCount: number }) => callback(info)
    ipcRenderer.on('aria2-engine-crashed', listener)
    return () => {
      ipcRenderer.removeListener('aria2-engine-crashed', listener)
    }
  },

  // 引擎（重新）启动成功：界面据此收掉"已放弃自动重启"这类过期提示
  onEngineStarted: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('aria2-engine-started', listener)
    return () => {
      ipcRenderer.removeListener('aria2-engine-started', listener)
    }
  },

  // 引擎连续重启失败、已经放弃自动重启：让界面明确告诉用户"不会再自己恢复了"
  onEngineGaveUp: (callback: (info: { attempts: number }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, info: { attempts: number }) => callback(info)
    ipcRenderer.on('aria2-engine-gave-up', listener)
    return () => {
      ipcRenderer.removeListener('aria2-engine-gave-up', listener)
    }
  },

  // 插件管理
  pluginsList: () => ipcRenderer.invoke('plugins-list'),
  pluginsEnable: (id: string) => ipcRenderer.invoke('plugins-enable', id),
  pluginsDisable: (id: string) => ipcRenderer.invoke('plugins-disable', id),
  pluginsUninstall: (id: string) => ipcRenderer.invoke('plugins-uninstall', id),
  pluginsDir: () => ipcRenderer.invoke('plugins-dir'),
  pluginsOpenDir: () => ipcRenderer.invoke('plugins-open-dir'),
  pluginsMarketList: (force?: boolean) => ipcRenderer.invoke('plugins-market-list', force === true),
  pluginsMarketInstall: (pluginId: string) => ipcRenderer.invoke('plugins-market-install', pluginId),

  // 应用自身日志：报障时用户需要附上这个文件，界面提供路径与「打开目录」
  getLogsPath: () => ipcRenderer.invoke('get-logs-path'),
  openLogsDir: () => ipcRenderer.invoke('open-logs-dir'),

  // 下载事件转发给主进程插件系统（aria2 通知由渲染层的 WebSocket 接收，插件运行在主进程）
  notifyDownloadEvent: (kind: 'downloadComplete' | 'downloadStart' | 'downloadError', gid: string, name: string) =>
    ipcRenderer.send('download-event', kind, gid, name),

  // yt-dlp 流媒体支持（可选外部引擎，首次使用时按需下载）
  ytdlpCheck: () => ipcRenderer.invoke('ytdlp-check'),
  ytdlpCheckUpdate: () => ipcRenderer.invoke('ytdlp-check-update'),
  ytdlpInstall: () => ipcRenderer.invoke('ytdlp-install'),
  onYtdlpInstallProgress: (callback: (progress: { percent: number; transferred: number; total: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: { percent: number; transferred: number; total: number }) => callback(progress)
    ipcRenderer.on('ytdlp-install-progress', handler)
    return () => { ipcRenderer.removeListener('ytdlp-install-progress', handler) }
  },
  ytdlpVideoInfo: (url: string) => ipcRenderer.invoke('ytdlp-video-info', url),
  ytdlpPlaylistInfo: (url: string) => ipcRenderer.invoke('ytdlp-playlist-info', url),
  ytdlpFormatUrl: (url: string, formatId: string) => ipcRenderer.invoke('ytdlp-format-url', url, formatId),

  // ffmpeg：合并音视频时按需下载
  ffmpegCheck: () => ipcRenderer.invoke('ffmpeg-check'),
  ffmpegCheckUpdate: () => ipcRenderer.invoke('ffmpeg-check-update'),
  ffmpegInstall: () => ipcRenderer.invoke('ffmpeg-install'),
  onFfmpegInstallProgress: (callback: (progress: { percent: number; transferred: number; total: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: { percent: number; transferred: number; total: number }) => callback(progress)
    ipcRenderer.on('ffmpeg-install-progress', handler)
    return () => { ipcRenderer.removeListener('ffmpeg-install-progress', handler) }
  },

  // yt-dlp 下载模式（分离音视频站点：由 yt-dlp 下载并合并）
  // playlist/subtitle/cookieFile/extractAudio 为流媒体页新增能力，全部可选（旧调用方不受影响）
  streamDownloadStart: (request: {
    url: string
    formatId?: string
    merge?: boolean
    title?: string
    outputDir: string
    playlist?: { ids: string[] }
    subtitle?: { enabled: boolean; languages: string[]; includeAuto?: boolean }
    cookieFile?: string
    extractAudio?: boolean
  }) =>
    ipcRenderer.invoke('stream-download-start', request),
  streamDownloadCancel: (id: string) => ipcRenderer.invoke('stream-download-cancel', id),
  onStreamDownloadEvent: (callback: (event: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
    ipcRenderer.on('stream-download-event', handler)
    return () => { ipcRenderer.removeListener('stream-download-event', handler) }
  },

  // 通知主进程渲染进程已就绪
  notifyAppReady: () => ipcRenderer.send('app-ready'),

  // 渲染层异常日志（落主进程 electron-log 文件；打包后用户打不开 devtools，这是唯一可见通道）
  reportRendererError: (payload: { message: string; stack?: string; kind?: string }) =>
    ipcRenderer.send('renderer-error', payload),

  // 窗口控制
  // 注：原先还暴露了 window-minimize / window-maximize，但主进程从未注册对应 handler、
  // 渲染层也无任何调用者（纯死通道），故一并删除。需要时再补 handler 与暴露。
  // close 的语义是"退出应用"（主进程 window-close 会走 app.quit），用于"下载完成后关闭应用"。
  close: () => ipcRenderer.send('window-close'),

  // 系统电源操作（下载完成后自动关机/休眠）
  systemShutdown: () => ipcRenderer.invoke('system-shutdown'),
  systemHibernate: () => ipcRenderer.invoke('system-hibernate'),
  systemCancelShutdown: () => ipcRenderer.invoke('system-cancel-shutdown'),

  // 系统代理检测
  detectSystemProxy: () => ipcRenderer.invoke('detect-system-proxy'),

  // 任务栏进度条（Windows/macOS）
  setTaskbarProgress: (progress: number, mode?: string) => ipcRenderer.invoke('set-taskbar-progress', progress, mode),

  // 配置热重载（返回取消订阅函数）
  onConfigChanged: (callback: (data: { key: string; value: unknown }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { key: string; value: unknown }) => callback(data)
    ipcRenderer.on('config:changed', listener)
    return () => {
      ipcRenderer.removeListener('config:changed', listener)
    }
  },

  // 待处理的下载链接（magnet: 等协议链接，由主进程推送）
  onPendingDownloadUrl: (callback: (url: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, url: string) => callback(url)
    ipcRenderer.on('pending-download-url', listener)
    return () => {
      ipcRenderer.removeListener('pending-download-url', listener)
    }
  },

  // 系统文件关联打开的 .torrent/.metalink 文件（主进程读取后以 base64 推送）
  onPendingTaskFile: (callback: (file: { name: string; data: string; kind: 'torrent' | 'metalink' }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, file: { name: string; data: string; kind: 'torrent' | 'metalink' }) => callback(file)
    ipcRenderer.on('pending-task-file', listener)
    return () => {
      ipcRenderer.removeListener('pending-task-file', listener)
    }
  }
}

// 类型声明
export type ElectronAPI = typeof electronAPI

// 将API暴露给渲染进程
contextBridge.exposeInMainWorld('electronAPI', electronAPI)
