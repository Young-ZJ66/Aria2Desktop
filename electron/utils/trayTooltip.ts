/**
 * 托盘 tooltip 文案（纯函数，便于单测）。
 *
 * 为什么需要它：托盘 tooltip 原先固定写死 "Aria2 Desktop"，窗口隐藏/最小化到托盘时
 * 用户唯一的进度反馈就是这个 tooltip——它却什么都不显示（D-10 一期）。
 * 这里把 aria2 的速度/任务数与流媒体（yt-dlp）任务合并成一行摘要：
 * 两类任务都不进同一个队列，但用户关心的是"现在还在下东西吗"。
 */

/** 托盘 tooltip 的数据来源：aria2 全局统计 + 流媒体任务（主进程内存快照） */
export interface TrayTooltipInput {
  /** aria2 当前下载速度（字节/秒） */
  downloadSpeed: number
  /** aria2 活动任务数 */
  activeCount: number
  /** 流媒体进行中任务数 */
  streamCount: number
  /** 流媒体合计速度（字节/秒） */
  streamSpeed: number
  /** 是否使用中文文案（跟随系统语言） */
  zh: boolean
}

/** 字节/秒 → 紧凑展示（B/s / KB/s / MB/s）；0 显示 0 B/s */
export function formatTraySpeed(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B/s'
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB/s`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB/s`
  return `${Math.round(bytes)} B/s`
}

/**
 * 构造 tooltip 文案。
 *
 * 没有任何任务时返回应用名（与旧行为一致，避免托盘出现 "0 B/s · 0 个任务" 的噪音）；
 * 有任务时给出"速度 · 任务数"，用户把窗口收进托盘后仍能判断是否还在下载。
 */
export function buildTrayTooltip(input: TrayTooltipInput): string {
  const totalSpeed = (input.downloadSpeed || 0) + (input.streamSpeed || 0)
  const totalCount = (input.activeCount || 0) + (input.streamCount || 0)
  if (totalCount <= 0 && totalSpeed <= 0) return 'Aria2 Desktop'
  const speed = formatTraySpeed(totalSpeed)
  return input.zh
    ? `Aria2 Desktop — ${speed} · ${totalCount} 个任务`
    : `Aria2 Desktop — ${speed} · ${totalCount} active`
}
