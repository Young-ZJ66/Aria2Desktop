/**
 * 统一 Aria2 全局配置设置页的加载/保存/重置骨架：
 * - 在 setup 阶段用 statsStore 缓存的配置同步初始化表单，避免首次渲染显示默认值导致的闪烁
 * - 加载配置时有缓存时不显示加载态，避免无意义的刷新闪烁
 * - 统一保存/重置对话框交互
 */
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { message, dialog } from '@/utils/feedback'
import { useConnectionStore } from '@/stores/connectionStore'
import { useStatsStore } from '@/stores/statsStore'
import type { Aria2Option } from '@/types/aria2'

export interface UseGlobalSettingsFormOptions<T extends object> {
  /** Aria2 配置选项 → 表单 映射 */
  applyOptions: (options: Aria2Option) => void
  /** 表单 → Aria2 配置选项 映射（保存时使用） */
  toOptions: (form: T) => Record<string, string>
  /** 重置时的默认表单值 */
  defaults: () => T
  /** 保存前校验（返回 false 中止保存），如表单校验 */
  validate?: () => Promise<boolean> | boolean
  /** 加载失败提示的 i18n key（默认 settings.loadFailed） */
  loadErrorKey?: string
}

export function useGlobalSettingsForm<T extends object>(
  form: T,
  options: UseGlobalSettingsFormOptions<T>
) {
  const { t } = useI18n()
  const connectionStore = useConnectionStore()
  const statsStore = useStatsStore()

  const loading = ref(false)
  const saving = ref(false)

  // 用已缓存的服务端配置初始化表单，首次渲染直接显示真实值，避免异步加载闪烁
  const cached = statsStore.globalOptions
  if (Object.keys(cached).length > 0) {
    options.applyOptions(cached)
  }

  // 加载配置（有缓存时不显示加载态，避免无意义的刷新闪烁）
  async function loadSettings(): Promise<void> {
    if (!connectionStore.isConnected) {
      message.warning(t('settings.connectFirst'))
      return
    }
    const hasCache = Object.keys(statsStore.globalOptions).length > 0
    if (!hasCache) loading.value = true
    try {
      const opts = await statsStore.getGlobalOptions()
      if (opts) options.applyOptions(opts)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('settings.unknownError')
      message.error(t(options.loadErrorKey || 'settings.loadFailed', { error: errorMessage }))
      console.error('Failed to load settings:', error)
    } finally {
      loading.value = false
    }
  }

  // 保存配置
  async function handleSave(): Promise<void> {
    if (!connectionStore.isConnected) {
      message.warning(t('settings.connectFirst'))
      return
    }
    if (options.validate) {
      const valid = await options.validate()
      if (!valid) return
    }
    saving.value = true
    try {
      await statsStore.changeGlobalOptions(options.toOptions(form))
      message.success(t('settings.saved'))
    } catch (error) {
      message.error(t('settings.saveFailedShort'))
      console.error('Failed to save settings:', error)
    } finally {
      saving.value = false
    }
  }

  // 重置为默认值（统一确认对话框）
  function handleReset(): void {
    dialog.warning({
      title: t('settings.restoreConfirmTitle'),
      content: t('settings.restoreConfirm'),
      positiveText: t('common.ok'),
      negativeText: t('common.cancel'),
      onPositiveClick: () => {
        Object.assign(form, options.defaults())
        message.success(t('settings.restored'))
      }
    })
  }

  onMounted(() => {
    if (connectionStore.isConnected) {
      loadSettings()
    }
  })

  return { loading, saving, loadSettings, handleSave, handleReset }
}
