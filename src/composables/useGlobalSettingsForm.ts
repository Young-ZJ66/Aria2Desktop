/**
 * 统一 Aria2 全局配置设置页的加载/保存/重置骨架：
 * - 在 setup 阶段用 statsStore 缓存的配置同步初始化表单，避免首次渲染显示默认值导致的闪烁
 * - 加载配置时有缓存时不显示加载态，避免无意义的刷新闪烁
 * - 统一保存/重置对话框交互
 */
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { message, confirm } from '@/utils/feedback'
import { useConnectionStore } from '@/stores/connectionStore'
import { useStatsStore } from '@/stores/statsStore'
import { hasRestartRequiredOption } from '@/utils/aria2RestartOptions'
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
  /** 恢复默认后回调（可异步），用于填充依赖运行环境的默认值（如默认下载目录） */
  onAfterReset?: (form: T) => void | Promise<void>
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
      const opts = options.toOptions(form)
      // 保存的选项集中是否包含需要重启 Aria2 生效的启动时选项（如 BT、event-poll 等）
      const needsRestart = hasRestartRequiredOption(opts)
      // 1) 持久化到 aria2 配置文件：启动时选项（如 BT 相关、event-poll 等）重启 Aria2 后生效
      let persisted = false
      if (window.electronAPI?.aria2?.saveGlobalOptions && Object.keys(opts).length > 0) {
        try {
          const res = await window.electronAPI.aria2.saveGlobalOptions(opts)
          persisted = !!res?.success
        } catch (error) {
          console.warn('Failed to persist options to aria2 config:', error)
        }
      }
      // 2) 尝试通过 RPC 立即生效；部分选项运行时不可修改，失败不代表保存失败（已写入配置文件）
      let rpcOk = false
      let rpcErrorMsg = ''
      try {
        await statsStore.changeGlobalOptions(opts)
        rpcOk = true
      } catch (error) {
        rpcErrorMsg = error instanceof Error ? error.message : t('settings.unknownError')
        console.warn('RPC changeGlobalOption failed (startup options will apply after restart):', error)
      }
      if (persisted) {
        // 包含需重启选项或 RPC 未全部生效时，提示重启 Aria2 后生效
        message.success(rpcOk && !needsRestart ? t('settings.saved') : t('settings.savedRestartAria2'))
      } else if (rpcOk) {
        message.success(needsRestart ? t('settings.savedRestartAria2') : t('settings.saved'))
      } else {
        // 既无法写入配置文件（如连接外部 Aria2）又 RPC 失败，展示具体原因
        message.error(t('settings.saveFailed', { error: rpcErrorMsg || t('settings.unknownError') }))
      }
    } catch (error) {
      // 展示具体失败原因（如 aria2 拒绝某选项），便于用户定位问题
      const errorMessage = error instanceof Error ? error.message : t('settings.unknownError')
      message.error(t('settings.saveFailed', { error: errorMessage }))
      console.error('Failed to save settings:', error)
    } finally {
      saving.value = false
    }
  }

  // 重置为默认值（统一确认对话框）
  function handleReset(): void {
    confirm({
      title: t('settings.restoreConfirmTitle'),
      content: t('settings.restoreConfirm'),
      positiveText: t('common.ok'),
      negativeText: t('common.cancel'),
      onPositiveClick: () => {
        Object.assign(form, options.defaults())
        message.success(t('settings.restored'))
        void options.onAfterReset?.(form)
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
