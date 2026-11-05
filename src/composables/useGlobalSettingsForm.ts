/**
 * 统一 Aria2 全局配置设置页的加载/保存/重置骨架：
 * - 在 setup 阶段用 statsStore 缓存的配置同步初始化表单，避免首次渲染显示默认值导致的闪烁
 * - 加载配置时有缓存时不显示加载态，避免无意义的刷新闪烁
 * - 统一保存/重置对话框交互
 */
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { message, confirm } from '@/utils/feedback'
import { useConnectionStore } from '@/stores/connectionStore'
import { useStatsStore } from '@/stores/statsStore'
import { hasRestartRequiredOption } from '@/utils/aria2RestartOptions'
import type { Aria2Option } from '@/types/aria2'

/**
 * 未保存修改注册表：设置弹窗关闭前逐一询问（见 SettingsDialog）。
 * key 用页面 id（与 SettingsDialog 的 tab name 一致），value 为该页 dirty 状态。
 * 模块级 Map：设置页与弹窗分离挂载，靠全局注册表通信。
 */
const dirtyPages = new Map<string, () => boolean>()
/** 页面 id → 保存函数（「保存并关闭」时逐页调用；resolve(true)=保存成功可关闭） */
const dirtyPageSavers = new Map<string, () => Promise<boolean>>()


export function getDirtyPages(): string[] {
  const dirty: string[] = []
  for (const [id, isDirty] of dirtyPages) {
    try {
      if (isDirty()) dirty.push(id)
    } catch { /* 页面已卸载等异常视为不脏 */ }
  }
  return dirty
}

/** 供 SettingsDialog 的「保存并关闭」逐页执行保存；未注册的页返回 null */
export async function saveDirtyPage(pageId: string): Promise<boolean | null> {
  const saver = dirtyPageSavers.get(pageId)
  if (!saver) return null
  return await saver()
}

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
  /** 设置弹窗的未保存离开确认用：页面 id（= SettingsDialog 的 tab name）+ 表单字段名清单 */
  dirtyTracking?: { pageId: string; fields: Array<keyof T & string> }
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
  // 最近一次保存是否真的落地（供下面的快照逻辑与弹窗关闭确认判断）
  let lastSaveOk = true

  // 用已缓存的服务端配置初始化表单，首次渲染直接显示真实值，避免异步加载闪烁
  const cached = statsStore.globalOptions
  if (Object.keys(cached).length > 0) {
    options.applyOptions(cached)
  }

  /**
   * 加载配置。
   * @param force 是否绕过缓存强制拉取——「重载」按钮必须传 true，
   *              否则只是重复读缓存（外部客户端改过引擎配置时用户点了没反应）。
   */
  async function loadSettings(force = false): Promise<void> {
    if (!connectionStore.isConnected) {
      message.warning(t('settings.connectFirst'))
      return
    }
    const hasCache = Object.keys(statsStore.globalOptions).length > 0
    if (!hasCache || force) loading.value = true
    try {
      const opts = await statsStore.getGlobalOptions(force)
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
  //
  // 返回"这次保存是否真的落地"：未连接、校验未通过、以及配置与 RPC 双双失败都返回 false。
  // 调用方（设置弹窗的关闭确认、脏标记快照）据此决定要不要清脏状态——否则用户看到
  // "已保存"的提示、关掉弹窗，实际什么都没写进去。
  async function handleSave(): Promise<boolean> {
    if (!connectionStore.isConnected) {
      message.warning(t('settings.connectFirst'))
      lastSaveOk = false
      return false
    }
    if (options.validate) {
      const valid = await options.validate()
      if (!valid) {
        lastSaveOk = false
        return false
      }
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
      if (!persisted && !rpcOk) {
        // 既无法写入配置文件（如连接外部 Aria2）又 RPC 失败，展示具体原因
        lastSaveOk = false
        message.error(t('settings.saveFailed', { error: rpcErrorMsg || t('settings.unknownError') }))
      } else if (persisted) {
        // 已写入配置文件：包含需重启选项或 RPC 未全部生效时，提示重启 Aria2 后生效
        lastSaveOk = true
        message.success(rpcOk && !needsRestart ? t('settings.saved') : t('settings.savedRestartAria2'))
      } else {
        // 未写配置文件但 RPC 已生效
        lastSaveOk = true
        message.success(needsRestart ? t('settings.savedRestartAria2') : t('settings.saved'))
      }
      return lastSaveOk
    } catch (error) {
      // 展示具体失败原因（如 aria2 拒绝某选项），便于用户定位问题
      const errorMessage = error instanceof Error ? error.message : t('settings.unknownError')
      lastSaveOk = false
      message.error(t('settings.saveFailed', { error: errorMessage }))
      console.error('Failed to save settings:', error)
      return false
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

  // 未保存修改追踪：快照最近一次加载/保存完成时的字段值，当前值与之不同即 dirty。
  // 深比较不需要——这些表单全是原始值字段（数字/字符串/布尔）。
  if (options.dirtyTracking) {
    const { pageId, fields } = options.dirtyTracking
    const serialize = () => JSON.stringify(pickFields(form, fields))
    let snapshot = serialize()
    dirtyPages.set(pageId, () => serialize() !== snapshot)
    dirtyPageSavers.set(pageId, async () => {
      try {
        return await handleSave()
      } catch {
        return false
      }
    })
    // 保存完成 / 重新加载完成——把快照对齐当前值（handleSave/handleReset 内部改动经此收敛）。
    // 只有**保存成功**才对齐：保存失败（未连接、校验没过、RPC 与配置双失败）时若也对齐，
    // 脏标记就被清掉了——用户接着关弹窗不再被提醒，改动就这么丢了。
    watch(saving, (s, was) => {
      if (was && !s && lastSaveOk) snapshot = serialize()
    })
    watch(loading, (l, was) => {
      if (was && !l) snapshot = serialize()
    })
    onBeforeUnmount(() => {
      dirtyPages.delete(pageId)
      dirtyPageSavers.delete(pageId)
    })
  }

  return { loading, saving, loadSettings, handleSave, handleReset }
}

function pickFields<T extends object>(form: T, fields: Array<keyof T & string>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) out[f] = (form as Record<string, unknown>)[f]
  return out
}
