// 设置管理服务
//
// AppSettings 的单一事实来源在 @/shared/appSettings，主进程（electron/types/store.ts）
// 与渲染层共用同一份定义，修改数据结构时只改共享文件。

export type { AppSettings } from '@/shared/appSettings'
import type { AppSettings } from '@/shared/appSettings'

export const defaultSettings: AppSettings = {
  language: 'zh-CN',
  theme: 'light',
  refreshInterval: 1000,
  autoConnect: true,
  minimizeToTray: true,
  autoLaunch: false,

  aria2: {
    host: 'localhost',
    port: 6800,
    protocol: 'http',
    secret: '',
    path: '/jsonrpc'
  },

  connectionProfiles: [
    {
      id: 'default',
      name: '',
      config: {
        host: 'localhost',
        port: 6800,
        protocol: 'http',
        secret: '',
        path: '/jsonrpc'
      }
    }
  ],
  activeProfileId: 'default',

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
          this.settings = this.mergeWithDefaults(savedSettings)
        }
      } else {
        // 浏览器环境：从 localStorage 加载
        const savedSettings = localStorage.getItem('aria2-desktop-settings')
        if (savedSettings) {
          this.settings = this.mergeWithDefaults(JSON.parse(savedSettings))
        }
      }
    } catch (error) {
      console.error('Failed to load settings:', error)
      this.settings = { ...defaultSettings }
    }

    this.notifyListeners()
  }

  // 深合并嵌套对象（aria2/ui/download），避免保存缺省字段时覆盖默认值；数组不深合
  // saved 允许为 Partial：electron-store 读取到空对象/缺省字段（如 {}）时也能正常合并
  private mergeWithDefaults(saved: Partial<AppSettings>): AppSettings {
    return {
      ...defaultSettings,
      ...saved,
      aria2: { ...defaultSettings.aria2, ...(saved.aria2 || {}) },
      ui: { ...defaultSettings.ui, ...(saved.ui || {}) },
      download: { ...defaultSettings.download, ...(saved.download || {}) }
    }
  }

  // 创建纯 JavaScript 对象，移除 Vue 响应式属性
  private toPlainObject(obj: unknown): unknown {
    return JSON.parse(JSON.stringify(obj))
  }

  /**
   * 深合并嵌套对象（aria2/ui/download/connectionProfiles），
   * 避免调用方传入局部嵌套（如 download: { defaultDir }）时覆盖同级其他字段。
   * 数组与叶子值直接替换。
   */
  private deepMerge(base: AppSettings, patch: Partial<AppSettings>): AppSettings {
    const merged: AppSettings = { ...base, ...patch }

    if (patch.aria2) {
      merged.aria2 = { ...base.aria2, ...patch.aria2 }
    }
    if (patch.ui) {
      merged.ui = { ...base.ui, ...patch.ui }
    }
    if (patch.download) {
      merged.download = { ...base.download, ...patch.download }
    }
    if (patch.connectionProfiles) {
      merged.connectionProfiles = patch.connectionProfiles
    }
    if (patch.activeProfileId !== undefined) {
      merged.activeProfileId = patch.activeProfileId
    }
    return merged
  }

  // 保存设置
  async saveSettings(newSettings: Partial<AppSettings>): Promise<void> {
    this.settings = this.deepMerge(this.settings, newSettings)

    try {
      if (window.electronAPI) {
        // Electron 环境：保存到 electron-store
        // 确保传递的是纯 JavaScript 对象
        const plainSettings = this.toPlainObject(this.settings)
        await window.electronAPI.setStoreValue('settings', plainSettings)
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
    // 深拷贝默认值，避免后续修改污染默认设置对象本身
    await this.saveSettings(structuredClone(defaultSettings))
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

  // 导出设置（导出前对 RPC 密钥脱敏，避免密钥明文随备份文件外泄）
  exportSettings(): string {
    const exported = this.toPlainObject(this.settings) as AppSettings
    if (exported.aria2?.secret) {
      exported.aria2.secret = '***'
    }
    exported.connectionProfiles?.forEach(profile => {
      if (profile?.config?.secret) {
        profile.config.secret = '***'
      }
    })
    return JSON.stringify(exported, null, 2)
  }

  // 导入设置
  async importSettings(settingsJson: string): Promise<void> {
    try {
      const importedSettings: unknown = JSON.parse(settingsJson)
      // 防原型污染：仅接受普通对象，排除 Array/Function/带有 __proto__/constructor 污染的对象
      if (
        typeof importedSettings !== 'object' ||
        importedSettings === null ||
        Object.getPrototypeOf(importedSettings) !== Object.prototype
      ) {
        throw new Error('invalid settings format')
      }
      const settings = importedSettings as Partial<AppSettings>
      // 导入时忽略 secret 字段（导出时已脱敏为 '***'），避免将占位符写回并覆盖本地真实密钥
      if (settings.aria2) {
        settings.aria2.secret = ''
      }
      settings.connectionProfiles?.forEach(profile => {
        if (profile?.config) {
          profile.config.secret = ''
        }
      })
      await this.saveSettings(settings)
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
