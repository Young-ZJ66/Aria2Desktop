import { ref, type Ref } from 'vue'
import { useStatsStore } from '@/stores/statsStore'

export interface SpeedPoint {
  /** 格式化的时间字符串，如 "10:31:00" */
  time: string
  /** 下载速度（字节/秒） */
  speed: number
}

/** 模块级单例状态，不依赖任何组件挂载，连接后即开始采集 */
const speedHistory: Ref<SpeedPoint[]> = ref([])
// 每秒一个点，保留 10 分钟历史，让横坐标尽可能多地容纳分钟大节点
const MAX_HISTORY = 600

let intervalId: ReturnType<typeof setInterval> | null = null
let timeoutId: ReturnType<typeof setTimeout> | null = null

/** 采集一个数据点 */
function collectPoint() {
  const statsStore = useStatsStore()
  const now = new Date()
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')

  const point: SpeedPoint = {
    time: `${hh}:${mm}:${ss}`,
    speed: parseInt(statsStore.globalStat.downloadSpeed) || 0
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

export function useTrafficMonitor() {
  return {
    speedHistory,
    startMonitor,
    stopMonitor
  }
}