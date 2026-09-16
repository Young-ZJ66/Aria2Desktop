import { onMounted, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { setLocale, type AppLocale } from '@/i18n'
import { useConnectionStore } from '@/stores/connectionStore'
import { useStatsStore } from '@/stores/statsStore'
import { useTaskStore } from '@/stores/taskStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'
import { useTrafficMonitor } from '@/composables/useTrafficMonitor'
import { initLocalService, stopStatusCheck } from '@/composables/useAria2LocalService'
import { useAutoRefresh } from '@/composables/useAutoRefresh'
import { useClipboardMonitor } from '@/composables/useClipboardMonitor'
import { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts'
import { stopCleanupTimer } from '@/services/taskPersistenceService'
import { stopTimeCleanupTimer } from '@/services/taskTimeService'
import type { useThemeManager } from '@/composables/useThemeManager'

/**
 * App 生命周期编排：统一管理 onMounted/onUnmounted 中跨领域的初始化与清理
 * （设置初始化、主题应用、更新检查、本地引擎预加载、配置热重载、自动连接），
 * 以及连接状态对自动刷新 / 流量采集 / 连接对话框的统一管理。
 * @param themeManager useThemeManager 返回值（主题监听器由本编排统一注册/销毁）
 */
export function useAppLifecycle(themeManager: ReturnType<typeof useThemeManager>) {
  const connectionStore = useConnectionStore()
  const statsStore = useStatsStore()
  const taskStore = useTaskStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()
  const uiStore = useUiStore()
  const trafficMonitor = useTrafficMonitor()
  const autoRefresh = useAutoRefresh()
  const clipboardMonitor = useClipboardMonitor()
  const keyboardShortcuts = useKeyboardShortcuts()
  const { startAutoUpdate, startSlowUpdate, stopAutoUpdate, stopAll: stopAllRefresh } = autoRefresh

  // 本会话是否已成功连接过一次：用于区分"首次连接"与"自动重连"，
  // 避免重连时把用户正在编辑的连接对话框关掉
  let hasConnectedOnce = false

  let unsubscribeConfig: (() => void) | null = null
  let unsubscribeDownloadComplete: (() => void) | null = null
  let unsubscribePendingUrl: (() => void) | null = null
  let unsubscribeClipboardUrl: (() => void) | null = null

  // Windows 任务栏进度条：活动任务数 > 0 时显示整体进度
  function updateTaskbarProgress() {
    if (!window.electronAPI?.setTaskbarProgress) return
    const tasks = taskStore.activeTasks
    if (tasks.length === 0) {
      window.electronAPI.setTaskbarProgress(-1) // 清除
      return
    }
    // 计算所有活动任务的整体进度
    let totalSize = 0
    let completedSize = 0
    for (const task of tasks) {
      totalSize += parseInt(task.totalLength, 10) || 0
      completedSize += parseInt(task.completedLength, 10) || 0
    }
    const progress = totalSize > 0 ? completedSize / totalSize : 0
    window.electronAPI.setTaskbarProgress(progress)
  }
  // 监听活动任务列表变化（引用变化时触发，每次轮询都会替换数组）
  watch(() => taskStore.activeTasks, updateTaskbarProgress)

  // 下载完成系统通知：通过主进程 Electron Notification API 发送（比 Web API 可靠）
  function showDownloadNotification(gid: string) {

    const task = taskStore.allTasks.find(t => t.gid === gid)
    const taskName = task?.bittorrent?.info?.name ||
      task?.files?.[0]?.path?.split(/[\\/]/).pop() || gid
    const size = task ? Math.round(parseInt(task.totalLength || '0', 10) / 1024 / 1024) : 0
    const sizeText = size > 0 ? ` (${size} MB)` : ''

    if (window.electronAPI?.sendNotification) {
      window.electronAPI.sendNotification(t('notification.downloadComplete'), `${taskName}${sizeText}`)
    }
  }

  // 下载全部完成后执行配置的操作（关机/休眠/关闭应用）
  let hadActiveTasks = false
  let downloadCompleteActionPending = false
  watch(() => taskStore.activeTasks.length, (count) => {
    if (count > 0) {
      hadActiveTasks = true
      downloadCompleteActionPending = false
    } else if (hadActiveTasks && count === 0) {
      // 曾经有活动任务，现在全部完成
      hadActiveTasks = false
      const action = settingsStore.getSetting('downloadCompleteAction') || 'none'
      if (action === 'none') return
      // 延迟 3 秒执行，给用户时间看到完成状态
      downloadCompleteActionPending = true
      setTimeout(() => {
        if (!downloadCompleteActionPending) return
        downloadCompleteActionPending = false
        if (action === 'shutdown') {
          window.electronAPI?.systemShutdown?.()
        } else if (action === 'hibernate') {
          window.electronAPI?.systemHibernate?.()
        } else if (action === 'close') {
          window.electronAPI?.close?.()
        }
      }, 3000)
    }
  })

  // 连接状态统一管理自动刷新：连接成功即启动刷新；仅在首次连接时关闭残留对话框，
  // 自动重连成功（已连过一次）不触碰对话框，避免打断用户编辑另一个配置
  watch(() => connectionStore.isConnected, (connected) => {
    if (connected) {
      // refreshInterval 可能为 undefined（设置未初始化完成），避免 setInterval(fn, undefined) 以 0ms 循环占满 CPU
      startAutoUpdate(settingsStore.getSetting('refreshInterval') || 1000)
      startSlowUpdate()
      // 连接成功后立即加载一次数据
      statsStore.loadGlobalStat()
      statsStore.loadVersion()
      // 全局配置缓存由 connectionStore.connect 连接成功后预热，设置页直接使用缓存，避免切换页面时重复请求闪烁
      taskStore.loadAllTasks()
      // 后台持续采集流量数据（不依赖状态页是否打开）
      trafficMonitor.startMonitor()
      // 启动剪贴板下载链接检测（渲染层 visibilitychange/focus + 主进程窗口焦点推送双重保障）
      clipboardMonitor.start()
      if (window.electronAPI?.onClipboardUrlDetected) {
        unsubscribeClipboardUrl = window.electronAPI.onClipboardUrlDetected((url: string) => {
          clipboardMonitor.handleDetectedUrl(url)
        })
      }
      // 注册下载完成系统通知
      unsubscribeDownloadComplete = taskStore.onDownloadComplete(showDownloadNotification)
      if (!hasConnectedOnce) {
        hasConnectedOnce = true
        // 自动关闭对话框（处理启动时竞态导致的对话框未关闭问题）
        connectionStore.showConnectionDialog = false
      }
    } else {
      stopAllRefresh()
      trafficMonitor.stopMonitor()
      clipboardMonitor.stop()
      unsubscribeClipboardUrl?.()
      unsubscribeClipboardUrl = null
      unsubscribeDownloadComplete?.()
      unsubscribeDownloadComplete = null
    }
  })

  // 启动时的后台更新检查：检查失败视为已是最新版本（不弹窗打扰）；
  // 仅在每次真实启动（onMounted，含退出后重开）时触发一次；
  // 托盘驻留期间再次打开 exe（second-instance）或托盘图标打开窗口都不触发
  async function runStartupUpdateCheck(): Promise<void> {
    if (!window.electronAPI?.checkUpdatesOnStartup) return
    // 更新弹窗已打开（用户正在查看/下载更新）时不重复检查，避免打断进行中的流程
    if (uiStore.showUpdateDialog) return
    try {
      const result = await window.electronAPI.checkUpdatesOnStartup()
      if (result?.success && result.hasUpdate) {
        uiStore.openUpdateDialog({
          version: result.version || '',
          notes: result.notes,
          state: result.alreadyDownloaded ? 'downloaded' : 'prompt'
        })
      }
    } catch (error) {
      console.warn('Startup update check failed:', error)
    }
  }

  onMounted(async () => {
    // 初始化设置
    await settingsStore.initialize()

    // 同步语言设置到 i18n
    const savedLang = settingsStore.getSetting('language') as string
    if (savedLang === 'zh-CN' || savedLang === 'en-US') {
      setLocale(savedLang as AppLocale)
    }

    // 应用主题
    themeManager.initSystemThemeListener()
    settingsStore.applyTheme()

    // 尽早通知主进程渲染进程已就绪，窗口显示不再依赖后续耗时操作（连接、更新检查）
    window.electronAPI?.notifyAppReady()

    // 注册全局键盘快捷键
    keyboardShortcuts.start()

    // 监听主进程推送的协议链接（magnet: 等），自动打开新建下载弹窗
    if (window.electronAPI?.onPendingDownloadUrl) {
      unsubscribePendingUrl = window.electronAPI.onPendingDownloadUrl((url: string) => {
        if (url && (url.startsWith('magnet:') || url.startsWith('http'))) {
          uiStore.openNewTaskWithUrl(url)
        }
      })
    }

    // 启动时后台检查更新：放在自动连接之前执行，确保真实启动（含退出后重开）时
    // 立即触发、不被后续可能耗时的连接流程阻塞（有意不 await，后台静默执行）
    runStartupUpdateCheck()

    // 后台预加载本地引擎状态（让设置页直接渲染最新状态，避免闪烁）
    initLocalService()

    // 加载多连接配置预设（在自动连接之前）
    connectionStore.loadProfiles()

    // Listen for config changes from main process (hot-reload)
    if (window.electronAPI) {
      unsubscribeConfig = window.electronAPI.onConfigChanged((data: { key: string; value: unknown }) => {
        if (data.key === 'theme') {
          // Update theme setting and apply
          settingsStore.updateSetting('theme', data.value as 'light' | 'dark' | 'auto').then(() => {
            settingsStore.applyTheme()
          })
        } else if (data.key === 'refreshInterval') {
          // Update refresh interval
          stopAutoUpdate()
          if (connectionStore.isConnected) {
            startAutoUpdate(Number(data.value))
          }
        }
      })
    }

    // 断开连接后重置"首次连接"标记，使下次真实重连时仍可关闭残留对话框
    watch(() => connectionStore.isConnected, (connected, old) => {
      if (old && !connected) {
        hasConnectedOnce = false
      }
    })

    // 如果启用了自动连接，尝试连接（使用当前激活的配置预设）
    if (settingsStore.getSetting('autoConnect')) {
      try {
        await connectionStore.connect()
      } catch (error) {
        console.error('Auto connection failed:', error)
        connectionStore.showConnectionDialog = true
      }
    }
  })

  onUnmounted(() => {
    stopAllRefresh()
    stopStatusCheck()
    stopCleanupTimer()
    stopTimeCleanupTimer()
    keyboardShortcuts.stop()
    unsubscribeConfig?.()
    unsubscribeDownloadComplete?.()
    unsubscribeClipboardUrl?.()
    unsubscribePendingUrl?.()
    themeManager.disposeSystemThemeListener()
    connectionStore.disconnect()
  })
}
