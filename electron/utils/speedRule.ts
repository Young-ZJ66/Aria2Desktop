/**
 * 限速调度规则的时间匹配（纯函数，独立于 electron-store / RPC，便于单测）。
 */

/** 时间匹配所需的最小规则形状 */
export interface SpeedRuleTimeWindow {
  /** 星期几生效（0=周日…6=周六），空数组表示每天 */
  days: number[]
  /** 开始时间（HH:mm），如 "09:00" */
  startTime: string
  /** 结束时间（HH:mm），endTime < startTime 表示跨午夜 */
  endTime: string
}

/**
 * 检查规则是否匹配当前时间。
 *
 * 语义（与原实现保持一致，勿改）：
 * - days 为空视为每天生效
 * - startTime <= endTime：区间为 [startTime, endTime)
 * - startTime > endTime：跨午夜，区间为 [startTime, 23:59] ∪ [00:00, endTime)
 * - startTime === endTime：空区间，恒不匹配（有意保留，用于临时禁用某条规则）
 *
 * @param currentDay 0=周日…6=周六
 * @param currentTime 已格式化为 HH:mm 的当前时间
 */
export function matchesSpeedRule(
  rule: SpeedRuleTimeWindow,
  currentDay: number,
  currentTime: string
): boolean {
  // 检查星期几
  if (rule.days.length > 0 && !rule.days.includes(currentDay)) return false

  // 检查时间段（支持跨午夜，如 22:00 - 06:00）
  const { startTime, endTime } = rule
  if (startTime <= endTime) {
    // 不跨午夜：currentTime 在 [startTime, endTime) 范围内
    return currentTime >= startTime && currentTime < endTime
  }
  // 跨午夜：currentTime 在 [startTime, 23:59] 或 [00:00, endTime) 范围内
  return currentTime >= startTime || currentTime < endTime
}

/** 将 Date 格式化为规则匹配所需的 HH:mm */
export function formatClockTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
