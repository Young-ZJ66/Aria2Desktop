// 设置管理服务
//
// AppSettings 的单一事实来源在 @/shared/appSettings，主进程（electron/types/store.ts）
// 与渲染层共用同一份定义，修改数据结构时只改共享文件。

export type { AppSettings } from '@/shared/appSettings'
import {
  DEFAULT_PLUGIN_REGISTRY_URL,
  DEFAULT_TRUSTED_PLUGIN_PUBLISHERS,
  type AppSettings
} from '@/shared/appSettings'
import { mergeCategoryRules } from '@/shared/fileCategories'
import { pickLocale, systemLocale } from '@/shared/locale'

/**
 * 归一化受信任发布者清单（D-02）。
 *
 * 默认清单必须非空，否则"无签名即拒绝"的策略形同虚设。老用户配置里可能存着
 * 空数组（旧版本默认值），或用户误删了全部条目 —— 这两种情况都回落内置官方公钥，
 * 而不是让系统静默变成"不校验签名"。
 */
export function normalizeTrustedPluginPublishers(list: readonly string[] | undefined): string[] {
  const cleaned = (list || []).map(item => String(item ?? '').trim()).filter(item => item.length > 0)
  return cleaned.length > 0 ? cleaned : [...DEFAULT_TRUSTED_PLUGIN_PUBLISHERS]
}

export const defaultSettings: AppSettings = {
  // 首次启动没有用户选择，按系统语言定；否则英文用户会先看到一屏中文
  language: pickLocale(null, systemLocale()),
  theme: 'light',
  refreshInterval: 1000,
  autoConnect: true,
  minimizeToTray: true,
  keepWindowState: true,
  autoLaunch: false,
  downloadCompleteAction: 'none',
  // 隐私敏感：默认关闭，用户在「常规设置」显式开启后才读取剪贴板（D-36）
  clipboardMonitorEnabled: false,

  aria2: {
    host: 'localhost',
    port: 6800,
    protocol: 'http',
    secret: '',
    path: '/jsonrpc',
    enableRpc: true,
    rpcAllowOriginAll: true,
    rpcListenAll: false,
    rpcSecure: false
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

  download: {
    defaultDir: '',
    maxConcurrentDownloads: 5,
    maxConnectionPerServer: 5,
    minSplitSize: '10M',
    autoStart: true,
    autoExtract: false
  },

  category: {
    autoClassify: true,
    // 拷贝一份，避免直接引用共享默认数组被后续修改污染
    categories: mergeCategoryRules(undefined)
  },

  speedSchedule: { enabled: false, rules: [] },
  downloadSchedule: { enabled: false, rules: [] },
  bt: { upnpEnabled: false },

  queue: {
    maxConcurrent: 5,
    retryEnabled: false,
    retryMaxAttempts: 3,
    retryDelaySeconds: 30
  },
  taskTemplates: [],
  completionRules: [],
  webConsole: {
    enabled: false,
    port: 6802,
    token: '',
    allowedIps: []
  },
  pluginMarket: {
    enabled: true,
    registryUrl: DEFAULT_PLUGIN_REGISTRY_URL,
    // 开发者模式默认关闭：允许装未签名插件是危险开关，必须用户显式打开
    developerMode: false
  },
  // 默认非空 = 默认强制 Ed25519 签名校验（无签名插件直接装不上）
  trustedPluginPublishers: [...DEFAULT_TRUSTED_PLUGIN_PUBLISHERS]
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
      // 清理损坏数据，避免下次启动仍反复 parse 失败
      try { localStorage.removeItem('aria2-desktop-settings') } catch { /* 忽略清理失败 */ }
      this.settings = { ...defaultSettings }
    }

    this.notifyListeners()
  }

  // 深合并嵌套对象（aria2/download/category），避免保存缺省字段时覆盖默认值；数组不深合
  // saved 允许为 Partial：electron-store 读取到空对象/缺省字段（如 {}）时也能正常合并
  private mergeWithDefaults(saved: Partial<AppSettings>): AppSettings {
    return {
      ...defaultSettings,
      ...saved,
      // 固定开启项：旧配置/导入文件里的 false 不允许生效
      keepWindowState: true,
      clipboardMonitorEnabled: saved.clipboardMonitorEnabled === true,
      aria2: { ...defaultSettings.aria2, ...(saved.aria2 || {}) },
      download: { ...defaultSettings.download, ...(saved.download || {}) },
      category: {
        autoClassify: saved.category?.autoClassify ?? defaultSettings.category!.autoClassify,
        categories: mergeCategoryRules(saved.category?.categories)
      },
      speedSchedule: {
        ...defaultSettings.speedSchedule!,
        ...(saved.speedSchedule || {}),
        rules: saved.speedSchedule?.rules ?? defaultSettings.speedSchedule!.rules
      },
      downloadSchedule: {
        ...defaultSettings.downloadSchedule!,
        ...(saved.downloadSchedule || {}),
        rules: saved.downloadSchedule?.rules ?? defaultSettings.downloadSchedule!.rules
      },
      bt: { ...defaultSettings.bt, ...(saved.bt || {}) },
      queue: { ...defaultSettings.queue, ...(saved.queue || {}) },
      webConsole: { ...defaultSettings.webConsole, ...(saved.webConsole || {}) },
      pluginMarket: { ...defaultSettings.pluginMarket, ...(saved.pluginMarket || {}) },
      taskTemplates: saved.taskTemplates ?? defaultSettings.taskTemplates,
      completionRules: saved.completionRules ?? defaultSettings.completionRules,
      // 空清单回落内置官方公钥：旧配置里的 [] 不能让签名校验被静默关掉
      trustedPluginPublishers: normalizeTrustedPluginPublishers(saved.trustedPluginPublishers)
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
    if (patch.download) {
      merged.download = { ...base.download, ...patch.download }
    }
    if (patch.category) {
      merged.category = {
        autoClassify: patch.category.autoClassify ?? base.category?.autoClassify,
        categories: mergeCategoryRules(patch.category.categories ?? base.category?.categories)
      }
    }
    if (patch.bt) {
      merged.bt = { ...base.bt, ...patch.bt }
    }
    if (patch.speedSchedule) {
      merged.speedSchedule = { ...base.speedSchedule, ...patch.speedSchedule }
    }
    if (patch.downloadSchedule) {
      merged.downloadSchedule = { ...base.downloadSchedule, ...patch.downloadSchedule }
    }
    if (patch.queue) {
      merged.queue = { ...base.queue, ...patch.queue }
    }
    if (patch.webConsole) {
      merged.webConsole = { ...base.webConsole, ...patch.webConsole }
    }
    if (patch.pluginMarket) {
      merged.pluginMarket = { ...base.pluginMarket, ...patch.pluginMarket }
    }
    if (patch.taskTemplates) {
      merged.taskTemplates = patch.taskTemplates
    }
    if (patch.completionRules) {
      merged.completionRules = patch.completionRules
    }
    if (patch.trustedPluginPublishers) {
      merged.trustedPluginPublishers = normalizeTrustedPluginPublishers(patch.trustedPluginPublishers)
    }
    if (patch.connectionProfiles) {
      merged.connectionProfiles = patch.connectionProfiles
    }
    if (patch.activeProfileId !== undefined) {
      merged.activeProfileId = patch.activeProfileId
    }
    // 固定开启项：即使调用方/导入文件传 false，也不允许关闭
    merged.keepWindowState = true
    // 剪贴板监控是用户可选项，不强制打开；未传时沿用当前值
    if (patch.clipboardMonitorEnabled !== undefined) {
      merged.clipboardMonitorEnabled = patch.clipboardMonitorEnabled === true
    }
    return merged
  }

  // 保存设置
  async saveSettings(newSettings: Partial<AppSettings>): Promise<void> {
    // 记下保存前的快照：deepMerge 之后无法还原「用户这次到底改了哪一项」。
    // 主进程收到的是一整包合并后的设置（含全部默认值），只有这里才知道真实意图。
    const before = this.settings
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
      // 保存失败时回滚内存：否则界面继续用未落盘的新值，下次读取又变回旧值
      this.settings = before
      console.error('Failed to save settings:', error)
      throw error
    }

    this.logSettingsChange(before, newSettings)
    this.notifyListeners()
  }

  /**
   * 把「用户改了哪些设置」写进应用日志，供设置里的「日志」页查看。
   * 只记录字段名，绝不记录值：settings.aria2.secret、Web 控制台令牌等都在设置里。
   */
  private logSettingsChange(before: AppSettings, patch: Partial<AppSettings>): void {
    try {
      if (!window.electronAPI?.writeLog) return
      const labels: string[] = []
      for (const key of Object.keys(patch) as Array<keyof AppSettings>) {
        const b = before[key]
        const a = this.settings[key]
        if (JSON.stringify(b) === JSON.stringify(a)) continue
        if (b && a && typeof b === 'object' && typeof a === 'object') {
          const bo = b as Record<string, unknown>
          const ao = a as Record<string, unknown>
          const subKeys = [...new Set([...Object.keys(bo), ...Object.keys(ao)])].filter(
            (subKey) => JSON.stringify(bo[subKey]) !== JSON.stringify(ao[subKey])
          )
          labels.push(subKeys.length > 0 ? `${String(key)}(${subKeys.join(',')})` : String(key))
        } else {
          labels.push(String(key))
        }
      }
      if (labels.length === 0) return
      void window.electronAPI.writeLog('info', `[Settings] 设置已更新: ${labels.join(', ')}`).catch(() => {})
    } catch {
      // 日志记录失败不能影响设置保存本身
    }
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
    const defaults: AppSettings = structuredClone(defaultSettings)
    /**
     * 保留 RPC 密钥（aria2.secret 与连接预设中的 secret）：
     * 密钥是"运行中 aria2 引擎的凭据"（真实来源是 aria2.conf），不属于用户偏好项。
     * 若随重置清空，运行中的引擎会立刻不可连（前端预设失去 token），
     * 且下次启动又会被 conf 值回填，造成状态反复。
     * 需要修改/清除密钥请使用 RPC 安全设置页（会同步写入 aria2.conf）。
     */
    const current = this.settings
    if (defaults.aria2) {
      defaults.aria2.secret = current.aria2?.secret || ''
      defaults.aria2.secretAutogenerated = current.aria2?.secretAutogenerated
    }
    const localProfiles = current.connectionProfiles || []
    defaults.connectionProfiles = defaults.connectionProfiles?.map(p => {
      const localSecret = localProfiles.find(lp => lp.id === p.id)?.config?.secret || ''
      return { ...p, config: { ...p.config, secret: localSecret } }
    })

    await this.saveSettings(defaults)
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
    // Web 控制台令牌同样是凭据：导出备份可能被分享/上传，绝不能带明文 token
    if (exported.webConsole) {
      if (exported.webConsole.token) {
        exported.webConsole.token = '***'
      }
      exported.webConsole.tokens?.forEach(item => {
        if (item?.token) {
          item.token = '***'
        }
      })
    }
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
      /**
       * 导入时忽略 secret 字段（导出时已脱敏为 '***'）。
       * 注意：不能写成 `secret = ''` —— 空值会经 deepMerge 覆盖本机真实密钥，
       * 导致 aria2 要求 token 而前端不带 token、连接失败。
       * 正确做法是删除该字段让合并保留本机值（connectionProfiles 为整体替换，
       * 需按 id 显式把本机密钥带回来）。
       */
      if (settings.aria2) {
        delete settings.aria2.secret
      }
      // 导出时 Web 控制台令牌被脱敏为 '***'，导入同样要保留本机值，
      // 否则一次"备份恢复"就会把用户所有 Web 端设备踢下线
      if (settings.webConsole) {
        const localConsole = this.settings.webConsole
        if (settings.webConsole.token === '***') {
          delete settings.webConsole.token
        }
        if (settings.webConsole.tokens) {
          const localTokens = localConsole?.tokens || []
          settings.webConsole.tokens = settings.webConsole.tokens.map(item => {
            if (item?.token !== '***') return item
            const local = localTokens.find(t => t.name === item.name)
            return local ? { ...item, token: local.token } : item
          })
        }
      }
      if (settings.connectionProfiles) {
        const localProfiles = this.settings.connectionProfiles || []
        settings.connectionProfiles = settings.connectionProfiles.map(profile => {
          if (!profile?.config) return profile
          const localSecret = localProfiles.find(p => p.id === profile.id)?.config?.secret || ''
          return { ...profile, config: { ...profile.config, secret: localSecret } }
        })
      }
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
