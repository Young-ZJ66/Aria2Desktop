// 全局类型声明
declare global {
  interface Window {
    electronAPI?: {
      // 应用信息
      getAppVersion: () => Promise<string>

      // 数据存储
      getStoreValue: (key: string) => Promise<any>
      setStoreValue: (key: string, value: any) => Promise<void>

      // 文件对话框
      showSaveDialog: (options: any) => Promise<any>
      showOpenDialog: (options: any) => Promise<any>

      // 文件系统操作
      showItemInFolder: (path: string) => Promise<{ success: boolean; error?: string }>
      openPath: (path: string) => Promise<{ success: boolean; error?: string; method?: string }>
      openInExplorer: (path: string) => Promise<{ success: boolean; error?: string; method?: string }>
      deleteFiles: (paths: string[]) => Promise<{
        success: boolean;
        error?: string;
        results?: Array<{ path: string; success: boolean; error?: string }>
      }>

      // 平台信息
      platform: string

      // 窗口控制
      minimize: () => void
      maximize: () => void
      close: () => void
    }
  }
}

export {}
