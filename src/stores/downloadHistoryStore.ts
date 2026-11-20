/**
 * 下载量历史（今日 / 累计），用于状态页摘要。
 *
 * 只记录本应用运行期间收到「下载完成」事件的字节数；不读取 aria2 的历史，
 * 因此升级前完成的旧任务不计入（避免首次启动时把全盘历史算进来）。
 */

import { defineStore } from 'pinia'
import { computed, onScopeDispose, ref } from 'vue'

interface DownloadHistory {
  totalBytes: number
  daily: Record<string, number>
}

const STORAGE_KEY = 'aria2-desktop-download-history'
/** 只保留最近 90 天的按日记录，避免 localStorage 无限增长 */
const KEEP_DAYS = 90
/** 跨零点检查间隔：托盘常驻用户可能几天不关应用 */
const DAY_ROLLOVER_CHECK_MS = 60 * 1000

function localDateKey(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function loadHistory(): DownloadHistory {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { totalBytes: 0, daily: {} }
    const parsed = JSON.parse(raw) as Partial<DownloadHistory>
    const daily: Record<string, number> = {}
    for (const [key, value] of Object.entries(parsed.daily ?? {})) {
      if (typeof value === 'number' && value > 0) daily[key] = value
    }
    return { totalBytes: Number(parsed.totalBytes) || 0, daily }
  } catch {
    return { totalBytes: 0, daily: {} }
  }
}

export interface DailyDownloadPoint {
  dateKey: string
  bytes: number
}

/**
 * 纯函数：按日期键生成最近 N 天的下载量序列（缺失日期补 0）。
 * 用于状态页的 7/30 天下载趋势，不改变原有存储结构。
 */
export function buildDailySeries(
  daily: Record<string, number>,
  days: number,
  endDateKey = localDateKey()
): DailyDownloadPoint[] {
  const [year, month, day] = endDateKey.split('-').map(Number)
  const end = new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1, 12)
  const points: DailyDownloadPoint[] = []
  for (let offset = days - 1; offset >= 0; offset--) {
    const date = new Date(end)
    date.setDate(end.getDate() - offset)
    const key = localDateKey(date)
    points.push({ dateKey: key, bytes: daily[key] ?? 0 })
  }
  return points
}

/** 纯函数：累加一次下载并裁剪过期日期（便于单测） */
export function addDownloadToHistory(history: DownloadHistory, bytes: number, dateKey: string): DownloadHistory {
  if (!Number.isFinite(bytes) || bytes <= 0) return history
  const daily = { ...history.daily, [dateKey]: (history.daily[dateKey] ?? 0) + bytes }
  const keys = Object.keys(daily).sort()
  for (const key of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) {
    delete daily[key]
  }
  return { totalBytes: history.totalBytes + bytes, daily }
}

export const useDownloadHistoryStore = defineStore('downloadHistory', () => {
  const history = ref<DownloadHistory>(loadHistory())

  // 「今日」的口径必须自己知道"今天变了"：localDateKey() 读的是 Date，不是响应式数据。
  // 直接把它写进 computed 的话，跨零点后页面会一直显示昨天的数字，直到下一次下载完成
  // 才顺带刷新一次 —— 而托盘常驻用户恰恰可能整天没有下载。
  const todayKey = ref(localDateKey())
  const rolloverTimer = setInterval(() => {
    const current = localDateKey()
    if (current !== todayKey.value) todayKey.value = current
  }, DAY_ROLLOVER_CHECK_MS)
  onScopeDispose(() => clearInterval(rolloverTimer))

  const todayBytes = computed(() => history.value.daily[todayKey.value] ?? 0)
  const totalBytes = computed(() => history.value.totalBytes)

  function record(bytes: number) {
    // 跨零点后的第一次下载同样要落到新日期上
    todayKey.value = localDateKey()
    const next = addDownloadToHistory(history.value, bytes, todayKey.value)
    if (next === history.value) return
    history.value = next
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // 存储不可用时仅本会话有效
    }
  }

  /** 清空今日/累计统计（只影响本应用的下载量历史，不动 aria2 任务） */
  function reset() {
    history.value = { totalBytes: 0, daily: {} }
    todayKey.value = localDateKey()
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // 存储不可用时仅本会话生效
    }
  }

  return { history, todayBytes, totalBytes, record, reset }
})
