import { useConnectionStore } from '@/stores/connectionStore'
import { useStatsStore } from '@/stores/statsStore'
import { useTaskStore } from '@/stores/taskStore'

/**
 * 自动刷新定时器管理：连接成功后启动高频/低频轮询，断开后停止。
 * - 高频刷新（默认 1s）：实时速度 / 活动任务进度（不含 stopped 列表，降低大任务列表开销）
 * - 低频全量刷新（30s）：补齐 stopped 列表与已完成任务持久化
 * - 窗口不可见（托盘驻留/切后台）时暂停 RPC 轮询，回到前台立即补刷一次，避免空转耗电
 */
export function useAutoRefresh() {
  const connectionStore = useConnectionStore()
  const statsStore = useStatsStore()
  const taskStore = useTaskStore()

  let updateInterval: ReturnType<typeof setInterval> | null = null
  let slowInterval: ReturnType<typeof setInterval> | null = null
  let visibilityHandler: (() => void) | null = null

  /** 窗口可见时才执行回调（隐藏时跳过，回到前台由 visibilitychange 补刷） */
  function runIfVisible(fn: () => void): void {
    if (typeof document === 'undefined' || document.visibilityState === 'visible') {
      fn()
    }
  }

  function startAutoUpdate(interval = 1000) {
    stopAutoUpdate()
    updateInterval = setInterval(() => {
      runIfVisible(() => {
        if (connectionStore.isConnected) {
          statsStore.loadGlobalStat()
          taskStore.loadLightTasks()
        }
      })
    }, interval)
    // 后台期间跳过轮询，回到可见状态时立即补一次刷新，避免界面数据长时间陈旧
    visibilityHandler = () => {
      if (document.visibilityState === 'visible' && connectionStore.isConnected) {
        statsStore.loadGlobalStat()
        taskStore.loadLightTasks()
      }
    }
    document.addEventListener('visibilitychange', visibilityHandler)
  }

  function startSlowUpdate() {
    stopSlowUpdate()
    slowInterval = setInterval(() => {
      runIfVisible(() => {
        if (connectionStore.isConnected) {
          taskStore.loadAllTasks()
        }
      })
    }, 30000)
  }

  function stopAutoUpdate() {
    if (updateInterval) {
      clearInterval(updateInterval)
      updateInterval = null
    }
    if (visibilityHandler) {
      document.removeEventListener('visibilitychange', visibilityHandler)
      visibilityHandler = null
    }
  }

  function stopSlowUpdate() {
    if (slowInterval) {
      clearInterval(slowInterval)
      slowInterval = null
    }
  }

  return {
    startAutoUpdate,
    startSlowUpdate,
    stopAutoUpdate,
    stopSlowUpdate
  }
}
