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
  const dayAllowed = (day: number): boolean =>
    rule.days.length === 0 || rule.days.includes(day)

  // 检查时间段（支持跨午夜，如 22:00 - 06:00）
  const { startTime, endTime } = rule
  if (startTime === endTime) {
    // 空区间：用于临时禁用某条规则
    return false
  }
  if (startTime < endTime) {
    // 不跨午夜：currentTime 在 [startTime, endTime) 范围内，星期按当天判断
    return dayAllowed(currentDay) && currentTime >= startTime && currentTime < endTime
  }

  // 跨午夜：区间为 [startTime, 23:59] ∪ [00:00, endTime)。
  // 关键点：午夜后的那一段在日历上已经是"第二天"，但它属于前一天开始的那次
  // 时段。例如规则"周一 22:00-06:00"，周二 02:00 应命中，因此星期要按前一天判断。
  if (currentTime >= startTime) return dayAllowed(currentDay)
  if (currentTime < endTime) return dayAllowed((currentDay + 6) % 7)
  return false
}

/** 将 Date 格式化为规则匹配所需的 HH:mm */
export function formatClockTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** aria2 全局选项里表示"不限速"的取值 */
export const LIMIT_UNLIMITED = '0'

/** 生成限速指令所需的规则字段（只取数值，便于单测构造） */
export interface SpeedRuleLimits {
  downloadLimit: number
  /** 可缺省：时段表里没有上传限速输入框，历史数据也没有这项 */
  uploadLimit?: number
}

/** 把任意数值规整为「非负整数」，NaN / 负数 / 小数都收敛到安全值 */
function normalizeLimit(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.trunc(value))
}

/**
 * 生成「应用限速」的 aria2 全局选项。
 *
 * 上传限速只在规则显式指定（> 0）时才下发——这是刻意的：
 * 本调度器的规则来自「下载设置 → 速度调度」的时段表，那里只填下载限速；
 * 若照旧无条件写 `max-overall-upload-limit: '0'`，用户在别处单独配置的
 * 最大上传速度会在规则生效的瞬间被静默清零，且窗口结束后也不会恢复。
 */
export function buildSpeedLimitOptions(rule: SpeedRuleLimits): Record<string, string> {
  const options: Record<string, string> = {
    'max-overall-download-limit': String(normalizeLimit(rule.downloadLimit))
  }

  const uploadLimit = normalizeLimit(rule.uploadLimit)
  if (uploadLimit > 0) {
    options['max-overall-upload-limit'] = String(uploadLimit)
  }

  return options
}

/**
 * 生成「清除限速」的 aria2 全局选项（恢复为无限制）。
 *
 * 同样只回滚本调度器真正改过的项：`appliedUploadLimit` 为 0 说明从没下发过上传限速，
 * 此时去写上传限制等于把用户的独立配置也算作"调度器施加的限速"。
 */
export function buildSpeedRestoreOptions(appliedUploadLimit: number): Record<string, string> {
  const options: Record<string, string> = {
    'max-overall-download-limit': LIMIT_UNLIMITED
  }

  if (normalizeLimit(appliedUploadLimit) > 0) {
    options['max-overall-upload-limit'] = LIMIT_UNLIMITED
  }

  return options
}
