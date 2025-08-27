// 设置管理服务
export interface AppSettings {
  // AriaNg 设置
  language: string
  theme: 'light' | 'dark' | 'auto'
  refreshInterval: number
  autoConnect: boolean
  minimizeToTray: boolean
  
  // 连接设置
  aria2: {
    host: string
    port: number
    protocol: 'http' | 'https' | 'ws' | 'wss'
    secret: string
    path: string
  }
  
  // 界面设置
  ui: {
    showStatusBar: boolean
    showToolbar: boolean
    taskListColumns: string[]
    defaultView: 'downloading' | 'waiting' | 'stopped'
  }
  
  // 下载设置
  download: {
    defaultDir: string
    maxConcurrentDownloads: number
    maxConnectionPerServer: number
    minSplitSize: string
    autoStart: boolean
  }
}

export const defaultSettings: AppSettings = {
  language: 'zh-CN',
  theme: 'light',
  refreshInterval: 1000,
  autoConnect: true,
  minimizeToTray: true,
  
  aria2: {
    host: 'localhost',
    port: 6800,
    protocol: 'http',
    secret: '',
    path: '/jsonrpc'
  },
  
  ui: {
    showStatusBar: true,
    showToolbar: true,
    taskListColumns: ['name', 'size', 'progress', 'status', 'speed'],
    defaultView: 'downloading'
  },
  
  download: {
    defaultDir: '',
    maxConcurrentDownloads: 5,
    maxConnectionPerServer: 5,
    minSplitSize: '10M',
    autoStart: true
  }
}

class SettingsService {
  private settings: AppSettings = { ...defaultSettings }
  private listeners: Array<(settings: AppSettings) => void> = []

  constructor() {
    this.loadSettings()
  }

  // 加载设置
  async loadSettings(): Promise<void> {
    try {
      if (window.electronAPI) {
        // Electron 环境：从 electron-store 加载
        const savedSettings = await window.electronAPI.getStoreValue('settings')
        if (savedSettings) {
          this.settings = { ...defaultSettings, ...savedSettings }
        }
      } else {
        // 浏览器环境：从 localStorage 加载
        const savedSettings = localStorage.getItem('aria2-desktop-settings')
        if (savedSettings) {
          this.settings = { ...defaultSettings, ...JSON.parse(savedSettings) }
        }
      }
    } catch (error) {
      console.error('Failed to load settings:', error)
      this.settings = { ...defaultSettings }
    }
    
    this.notifyListeners()
  }

  // 保存设置
  async saveSettings(newSettings: Partial<AppSettings>): Promise<void> {
    this.settings = { ...this.settings, ...newSettings }
    
    try {
      if (window.electronAPI) {
        // Electron 环境：保存到 electron-store
        await window.electronAPI.setStoreValue('settings', this.settings)
      } else {
        // 浏览器环境：保存到 localStorage
        localStorage.setItem('aria2-desktop-settings', JSON.stringify(this.settings))
      }
    } catch (error) {
      console.error('Failed to save settings:', error)
      throw error
    }
    
    this.notifyListeners()
  }

  // 获取设置
  getSettings(): AppSettings {
    return { ...this.settings }
  }

  // 获取特定设置
  getSetting<K extends keyof AppSettings>(key: K): AppSettings[K] {
    return this.settings[key]
  }

  // 更新特定设置
  async updateSetting<K extends keyof AppSettings>(
    key: K, 
    value: AppSettings[K]
  ): Promise<void> {
    await this.saveSettings({ [key]: value } as Partial<AppSettings>)
  }

  // 重置设置
  async resetSettings(): Promise<void> {
    await this.saveSettings(defaultSettings)
  }

  // 监听设置变化
  onSettingsChange(listener: (settings: AppSettings) => void): void {
    this.listeners.push(listener)
  }

  // 移除监听器
  removeListener(listener: (settings: AppSettings) => void): void {
    const index = this.listeners.indexOf(listener)
    if (index > -1) {
      this.listeners.splice(index, 1)
    }
  }

  // 通知监听器
  private notifyListeners(): void {
    this.listeners.forEach(listener => {
      try {
        listener(this.getSettings())
      } catch (error) {
        console.error('Settings listener error:', error)
      }
    })
  }

  // 导出设置
  exportSettings(): string {
    return JSON.stringify(this.settings, null, 2)
  }

  // 导入设置
  async importSettings(settingsJson: string): Promise<void> {
    try {
      const importedSettings = JSON.parse(settingsJson)
      await this.saveSettings(importedSettings)
    } catch (error) {
      console.error('Failed to import settings:', error)
      throw new Error('无效的设置文件格式')
    }
  }
}

// 创建单例实例
export const settingsService = new SettingsService()

// 导出类型和服务
export { SettingsService }
