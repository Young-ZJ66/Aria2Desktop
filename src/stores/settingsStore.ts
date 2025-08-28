import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { settingsService, type AppSettings } from '@/services/settingsService'

export const useSettingsStore = defineStore('settings', () => {
  // 状态
  const settings = ref<AppSettings>(settingsService.getSettings())
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  // 计算属性
  const aria2Config = computed(() => settings.value.aria2)
  const uiConfig = computed(() => settings.value.ui)
  const downloadConfig = computed(() => settings.value.download)
  const theme = computed(() => settings.value.theme)
  const language = computed(() => settings.value.language)

  // 初始化
  async function initialize() {
    isLoading.value = true
    error.value = null
    
    try {
      await settingsService.loadSettings()
      settings.value = settingsService.getSettings()
      
      // 监听设置变化
      settingsService.onSettingsChange((newSettings) => {
        settings.value = newSettings
      })
    } catch (err) {
      error.value = err instanceof Error ? err.message : '加载设置失败'
    } finally {
      isLoading.value = false
    }
  }

  // 更新设置
  async function updateSettings(newSettings: Partial<AppSettings>) {
    isLoading.value = true
    error.value = null
    
    try {
      await settingsService.saveSettings(newSettings)
      settings.value = settingsService.getSettings()
    } catch (err) {
      error.value = err instanceof Error ? err.message : '保存设置失败'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  // 更新特定设置
  async function updateSetting<K extends keyof AppSettings>(
    key: K, 
    value: AppSettings[K]
  ) {
    await updateSettings({ [key]: value } as Partial<AppSettings>)
  }

  // 常规设置相关
  async function updateGeneralSettings(generalSettings: Partial<AppSettings>) {
    const newSettings = {
      language: generalSettings.language ?? settings.value.language,
      theme: generalSettings.theme ?? settings.value.theme,
      refreshInterval: generalSettings.refreshInterval ?? settings.value.refreshInterval,
      autoConnect: generalSettings.autoConnect ?? settings.value.autoConnect,
      minimizeToTray: generalSettings.minimizeToTray ?? settings.value.minimizeToTray
    }

    await updateSettings(newSettings)
  }

  // Aria2 连接设置
  async function updateAria2Config(aria2Config: Partial<AppSettings['aria2']>) {
    await updateSettings({
      aria2: { ...settings.value.aria2, ...aria2Config }
    })
  }

  // UI 设置
  async function updateUIConfig(uiConfig: Partial<AppSettings['ui']>) {
    await updateSettings({
      ui: { ...settings.value.ui, ...uiConfig }
    })
  }

  // 下载设置
  async function updateDownloadConfig(downloadConfig: Partial<AppSettings['download']>) {
    await updateSettings({
      download: { ...settings.value.download, ...downloadConfig }
    })
  }

  // 重置设置
  async function resetSettings() {
    isLoading.value = true
    error.value = null
    
    try {
      await settingsService.resetSettings()
      settings.value = settingsService.getSettings()
    } catch (err) {
      error.value = err instanceof Error ? err.message : '重置设置失败'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  // 导出设置
  function exportSettings(): string {
    return settingsService.exportSettings()
  }

  // 导入设置
  async function importSettings(settingsJson: string) {
    isLoading.value = true
    error.value = null
    
    try {
      await settingsService.importSettings(settingsJson)
      settings.value = settingsService.getSettings()
    } catch (err) {
      error.value = err instanceof Error ? err.message : '导入设置失败'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  // 应用主题
  function applyTheme() {
    const theme = settings.value.theme
    const isDark = theme === 'dark' || 
      (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    
    document.documentElement.classList.toggle('dark', isDark)
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light')
  }

  // 获取特定设置值
  function getSetting<K extends keyof AppSettings>(key: K): AppSettings[K] {
    return settings.value[key]
  }

  return {
    // 状态
    settings,
    isLoading,
    error,
    
    // 计算属性
    aria2Config,
    uiConfig,
    downloadConfig,
    theme,
    language,
    
    // 方法
    initialize,
    updateSettings,
    updateSetting,
    updateGeneralSettings,
    updateAria2Config,
    updateUIConfig,
    updateDownloadConfig,
    resetSettings,
    exportSettings,
    importSettings,
    applyTheme,
    getSetting
  }
})
