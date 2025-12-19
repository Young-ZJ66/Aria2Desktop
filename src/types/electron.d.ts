// Electron API 类型定义
export interface ElectronAPI {
  // 应用信息
  getAppVersion: () => Promise<string>

  // 数据存储
  getStoreValue: (key: string) => Promise<any>
  setStoreValue: (key: string, value: any) => Promise<void>

  // 文件对话框
  showSaveDialog: (options: any) => Promise<any>
  showOpenDialog: (options: any) => Promise<any>

  // 文件系统操作
  showItemInFolder: (path: string) => Promise<any>
  openPath: (path: string) => Promise<any>
  openInExplorer: (path: string) => Promise<any>
  deleteFiles: (paths: string[]) => Promise<any>

  // 托盘控制
  setTrayEnabled: (enabled: boolean) => Promise<void>

  // {{ AURA: Add - 窗口主题设置方法 }}
  setWindowTheme: (isDark: boolean) => Promise<void>

  // 通用消息发送
  send: (channel: string, ...args: any[]) => void

  // Aria2 进程管理
  aria2: {
    start: () => Promise<any>
    stop: () => Promise<any>
    restart: () => Promise<any>
    getStatus: () => Promise<any>
    updateConfig: (config: any) => Promise<any>
  }

  // 会话管理
  saveSession: () => Promise<any>

  // 平台信息
  platform: string

  // 窗口控制
  minimize: () => void
  maximize: () => void
  close: () => void

  // Config hot-reload
  onConfigChanged: (callback: (data: { key: string; value: any }) => void) => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}