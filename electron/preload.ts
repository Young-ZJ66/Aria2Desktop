import { contextBridge, ipcRenderer } from 'electron'

// 暴露给渲染进程的API
const electronAPI = {
  // 应用信息
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // 数据存储
  getStoreValue: (key: string) => ipcRenderer.invoke('get-store-value', key),
  setStoreValue: (key: string, value: any) => ipcRenderer.invoke('set-store-value', key, value),
  
  // 文件对话框
  showSaveDialog: (options: any) => ipcRenderer.invoke('show-save-dialog', options),
  showOpenDialog: (options: any) => ipcRenderer.invoke('show-open-dialog', options),

  // 文件系统操作
  showItemInFolder: (path: string) => ipcRenderer.invoke('show-item-in-folder', path),
  openPath: (path: string) => ipcRenderer.invoke('open-path', path),
  openInExplorer: (path: string) => ipcRenderer.invoke('open-in-explorer', path),
  deleteFiles: (paths: string[]) => ipcRenderer.invoke('delete-files', paths),
  
  // 平台信息
  platform: process.platform,
  
  // 窗口控制
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close')
}

// 类型声明
export type ElectronAPI = typeof electronAPI

// 将API暴露给渲染进程
contextBridge.exposeInMainWorld('electronAPI', electronAPI)
