import { ref, type Ref } from 'vue'
import { useStatsStore } from '@/stores/statsStore'

export interface SpeedPoint {
  /** 格式化的时间字符串，如 "10:31:00" */
  time: string
  /** 下载速度（字节/秒） */
  speed: number
}

/** 失败任务自动重试的标记点（叠加在速度曲线顶部，便于对照重试时刻的速率） */
export interface RetryMarker {
  time: string
  speed: number
  label: string
}

/** 模块级单例状态，不依赖任何组件挂载，连接后即开始采集 */
const speedHistory: Ref<SpeedPoint[]> = ref([])
const retryMarkers: Ref<RetryMarker[]> = ref([])
// 每秒一个点，保留 10 分钟历史，让横坐标尽可能多地容纳分钟大节点
const MAX_HISTORY = 600
const MAX_RETRY_MARKERS = 50

// 模块级缓存 store 实例（惰性初始化：首次采集时 pinia 已安装），避免每秒采集都重新创建
let statsStore: ReturnType<typeof useStatsStore> | null = null

let intervalId: ReturnType<typeof setInterval> | null = null
let timeoutId: ReturnType<typeof setTimeout> | null = null

/** 采集一个数据点 */
function collectPoint() {
  // 惰性获取并缓存 store 实例：模块加载时 pinia 尚未安装，不能在此处直接调用 useStatsStore()
  if (!statsStore) statsStore = useStatsStore()
  const now = new Date()
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')

  const point: SpeedPoint = {
    time: `${hh}:${mm}:${ss}`,
    // globalStat 已在 statsStore 转为数值型，无需再 parseInt
    speed: statsStore.globalStat.downloadSpeed || 0
  }

  // 每次生成新数组引用，保证浅层 watch 也能感知更新，图表据此刷新
  speedHistory.value = [...speedHistory.value.slice(-(MAX_HISTORY - 1)), point]
}

/** 对齐到下一个整秒开始采集 */
function startMonitor() {
  if (timeoutId !== null || intervalId !== null) return // 已在运行

  // 对齐到下一个 0ms 边界
  const now = Date.now()
  const delay = 1000 - (now % 1000)
  timeoutId = setTimeout(() => {
    // 先清空 timeoutId 再进入 interval 模式，避免 startMonitor 误判仍在运行
    timeoutId = null
    collectPoint()
    intervalId = setInterval(collectPoint, 1000)
  }, delay)
}

function stopMonitor() {
  if (timeoutId !== null) {
    clearTimeout(timeoutId)
    timeoutId = null
  }
  if (intervalId !== null) {
    clearInterval(intervalId)
    intervalId = null
  }
}

/** 清空历史曲线：切换连接或断开时调用，避免把上一个引擎的速度画到新连接上 */
function resetHistory() {
  speedHistory.value = []
  retryMarkers.value = []
}

function timeLabel(date = new Date()): string {
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  const ss = String(date.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

/** 记录一次失败任务重试：在速度曲线上画一个标记点（由任务自动重试策略调用） */
function recordRetryMarker(label: string) {
  if (!statsStore) statsStore = useStatsStore()
  retryMarkers.value = [
    ...retryMarkers.value.slice(-(MAX_RETRY_MARKERS - 1)),
    { time: timeLabel(), speed: statsStore.globalStat.downloadSpeed || 0, label }
  ]
}

export function useTrafficMonitor() {
  return {
    speedHistory,
    retryMarkers,
    startMonitor,
    stopMonitor,
    resetHistory,
    recordRetryMarker
  }
}
