import { useConnectionStore } from '@/stores/connectionStore'
import { useStatsStore } from '@/stores/statsStore'
import { useTaskStore } from '@/stores/taskStore'

/**
 * 自动刷新定时器管理：连接成功后启动高频/低频轮询，断开后停止。
 * - 高频刷新（默认 1s）：实时速度 / 活动任务进度（不含 stopped 列表，降低大任务列表开销）
 * - 低频全量刷新（30s）：补齐 stopped 列表与已完成任务持久化
 */
export function useAutoRefresh() {
  const connectionStore = useConnectionStore()
  const statsStore = useStatsStore()
  const taskStore = useTaskStore()

  let updateInterval: ReturnType<typeof setInterval> | null = null
  let slowInterval: ReturnType<typeof setInterval> | null = null

  function startAutoUpdate(interval = 1000) {
    stopAutoUpdate()
    updateInterval = setInterval(() => {
      if (connectionStore.isConnected) {
        statsStore.loadGlobalStat()
        taskStore.loadLightTasks()
      }
    }, interval)
  }

  function startSlowUpdate() {
    stopSlowUpdate()
    slowInterval = setInterval(() => {
      if (connectionStore.isConnected) {
        taskStore.loadAllTasks()
      }
    }, 30000)
  }

  function stopAutoUpdate() {
    if (updateInterval) {
      clearInterval(updateInterval)
      updateInterval = null
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
