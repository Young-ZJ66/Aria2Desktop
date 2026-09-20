import { contextBridge, ipcRenderer } from 'electron'
import type { Aria2UpdateConfig } from '../src/shared/electronBridge'
import type { UpdateStatus } from '../src/types/electron'

// 暴露给渲染进程的API
const electronAPI = {
  // 应用信息
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  // 应用默认下载目录（Windows 系统"下载"文件夹）
  getDefaultDownloadDir: () => ipcRenderer.invoke('get-default-download-dir'),

  // 数据存储
  getStoreValue: (key: string) => ipcRenderer.invoke('get-store-value', key),
  setStoreValue: (key: string, value: unknown) => ipcRenderer.invoke('set-store-value', key, value),

  // 文件对话框
  showSaveDialog: (options: unknown) => ipcRenderer.invoke('show-save-dialog', options),
  showOpenDialog: (options: unknown) => ipcRenderer.invoke('show-open-dialog', options),

  // 文件系统操作
  showItemInFolder: (path: string) => ipcRenderer.invoke('show-item-in-folder', path),
  openPath: (path: string) => ipcRenderer.invoke('open-path', path),
  openInExplorer: (path: string) => ipcRenderer.invoke('open-in-explorer', path),
  deleteFiles: (paths: string[], taskDir?: string) => ipcRenderer.invoke('delete-files', paths, taskDir),

  // 下载文件名探测（网盘直链/跳转链接的 URL 无文件名，分类需要从响应头拿真实文件名）
  probeDownloadName: (url: string) => ipcRenderer.invoke('download-probe-filename', url),

  // 下载重名处理：目标文件已存在且无 .aria2 控制文件时，返回带序号的空闲文件名
  //（continue=true 下 aria2 会把同名完整文件当作已完成而秒结束，auto-file-renaming 不会生效）
  resolveDownloadConflict: (dir: string, fileName: string) =>
    ipcRenderer.invoke('resolve-download-conflict', dir, fileName),

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

  // 已完成任务持久化（替代 localStorage，存于 userData）
  loadPersistedTasks: () => ipcRenderer.invoke('persisted-tasks-load'),
  savePersistedTasks: (data: unknown) => ipcRenderer.invoke('persisted-tasks-save', data),

  // 平台信息（值而非函数：平台在进程生命周期内不变，直接暴露简化渲染层访问）
  platform: process.platform,

  // 剪贴板读取（经主进程 IPC：sandbox:true 下 preload 不可直接使用 clipboard 模块，
  // 官方白名单仅含 contextBridge/crashReporter/ipcRenderer/nativeImage/webFrame/webUtils）
  readClipboard: (): Promise<string> => ipcRenderer.invoke('read-clipboard'),

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

  // 插件管理
  pluginsList: () => ipcRenderer.invoke('plugins-list'),
  pluginsEnable: (id: string) => ipcRenderer.invoke('plugins-enable', id),
  pluginsDisable: (id: string) => ipcRenderer.invoke('plugins-disable', id),
  pluginsUninstall: (id: string) => ipcRenderer.invoke('plugins-uninstall', id),

  // yt-dlp 流媒体支持（可选外部引擎）
  ytdlpCheck: () => ipcRenderer.invoke('ytdlp-check'),
  ytdlpVideoInfo: (url: string) => ipcRenderer.invoke('ytdlp-video-info', url),
  ytdlpFormatUrl: (url: string, formatId: string) => ipcRenderer.invoke('ytdlp-format-url', url, formatId),

  // 通知主进程渲染进程已就绪
  notifyAppReady: () => ipcRenderer.send('app-ready'),

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
  }
}

// 类型声明
export type ElectronAPI = typeof electronAPI

// 将API暴露给渲染进程
contextBridge.exposeInMainWorld('electronAPI', electronAPI)
