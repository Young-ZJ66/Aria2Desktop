/**
 * 定时下载调度的时间窗口匹配（纯函数，独立于 store / RPC，便于单测）。
 *
 * 复用 matchesSpeedRule 的窗口语义（days 空 = 每天；跨午夜支持；
 * start === end 视为禁用），但动作不同：
 * - 窗口内：恢复全部任务（unpause-all）
 * - 窗口外：暂停全部任务（pause-all）
 * 触发只在"窗口状态翻转"时发生（调度器记忆上一次状态），不打扰用户手动暂停/恢复。
 */

import { formatClockTime, matchesSpeedRule, type SpeedRuleTimeWindow } from './speedRule'

export interface DownloadScheduleRule extends SpeedRuleTimeWindow {
  /** 规则名（日志与设置页展示用） */
  name: string
  enabled: boolean
}

export interface DownloadScheduleConfig {
  enabled: boolean
  rules: DownloadScheduleRule[]
}

/**
 * 计算当前时刻应处的调度状态。
 * @returns 'in-window' 命中任一启用规则的窗口；'out-window' 不命中任何窗口
 */
export function resolveDownloadScheduleState(
  config: DownloadScheduleConfig,
  currentDay: number,
  currentTime: string
): 'in-window' | 'out-window' {
  if (!config.enabled) return 'out-window'
  const hit = config.rules.some(
    rule => rule.enabled !== false && matchesSpeedRule(rule, currentDay, currentTime)
  )
  return hit ? 'in-window' : 'out-window'
}

/**
 * 由前一次状态与当前状态决定要执行的动作。
 * 只在翻转时动作：in→out 暂停全部，out→in 恢复全部，相同状态不动。
 * 首次运行（previous 为 null）不动作——应用启动时不宜突然暂停/唤醒全部任务，
 * 下一个翻转点自然接管。
 */
export function resolveScheduleAction(
  previous: 'in-window' | 'out-window' | null,
  current: 'in-window' | 'out-window'
): 'pause-all' | 'unpause-all' | null {
  if (previous === null || previous === current) return null
  return current === 'in-window' ? 'unpause-all' : 'pause-all'
}

export { formatClockTime }
