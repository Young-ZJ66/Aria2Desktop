import { contextBridge, ipcRenderer } from 'electron'

// 暴露给渲染进程的API
const electronAPI = {
  // 应用信息
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

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
  deleteFiles: (paths: string[]) => ipcRenderer.invoke('delete-files', paths),

  // 托盘控制
  setTrayEnabled: (enabled: boolean) => ipcRenderer.invoke('set-tray-enabled', enabled),
  // {{ AURA: Add - 窗口主题设置 IPC 方法 }}
  setWindowTheme: (isDark: boolean) => ipcRenderer.invoke('set-window-theme', isDark),

  // 开机自启
  getAutoLaunch: () => ipcRenderer.invoke('get-auto-launch'),
  setAutoLaunch: (enabled: boolean) => ipcRenderer.invoke('set-auto-launch', enabled),

  // 自动更新
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  quitAndInstall: () => ipcRenderer.invoke('quit-and-install'),
  onUpdateStatus: (callback: (status: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: unknown) => callback(status)
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
    updateConfig: (config: unknown) => ipcRenderer.invoke('aria2-update-config', config)
  },

  // 会话管理
  saveSession: () => ipcRenderer.invoke('aria2-save-session'),

  // 平台信息
  platform: process.platform,

  // 通知主进程渲染进程已就绪
  notifyAppReady: () => ipcRenderer.send('app-ready'),

  // 窗口控制
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),

  // 配置热重载（返回取消订阅函数）
  onConfigChanged: (callback: (data: { key: string; value: unknown }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { key: string; value: unknown }) => callback(data)
    ipcRenderer.on('config:changed', listener)
    return () => {
      ipcRenderer.removeListener('config:changed', listener)
    }
  }
}

// 类型声明
export type ElectronAPI = typeof electronAPI

// 将API暴露给渲染进程
contextBridge.exposeInMainWorld('electronAPI', electronAPI)
