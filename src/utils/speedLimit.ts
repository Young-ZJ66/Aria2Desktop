/**
 * 限速值的单位换算。
 *
 * aria2 的 max-overall-download-limit 只认字节/秒，界面上让用户按 KB/s 或 MB/s 填，
 * 来回换算放在这里，组件里只负责显示。
 */

export const SPEED_LIMIT_UNITS = ['KB', 'MB'] as const

export type SpeedLimitUnit = (typeof SPEED_LIMIT_UNITS)[number]

export const SPEED_LIMIT_UNIT_BYTES: Record<SpeedLimitUnit, number> = {
  KB: 1024,
  MB: 1024 * 1024
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** 用户填的数值 + 单位 → aria2 需要的字节/秒；空值或非正数一律当作「不限制」(0) */
export function toSpeedLimitBytes(value: number | null | undefined, unit: SpeedLimitUnit): number {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return 0
  return Math.max(1, Math.round(value * SPEED_LIMIT_UNIT_BYTES[unit]))
}

/**
 * 面板输入框的文本 → 字节/秒。
 * 返回 null 表示输入非法（调用方据此提示），0 表示「不限制」（留空或填 0）。
 * 逗号当小数点用：中文输入法下用户常敲「1,5」。
 */
export function parseSpeedLimitInput(text: string, unit: SpeedLimitUnit): number | null {
  const raw = text.trim().replace(',', '.')
  if (raw === '') return 0
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return toSpeedLimitBytes(parsed, unit)
}

/** 字节/秒 → 「1.5 MB/s」这样的展示文本；不限制时返回空串 */
export function formatSpeedLimit(bytes: number): string {
  const { value, unit } = fromSpeedLimitBytes(bytes)
  if (value === null) return ''
  return `${value} ${unit}/s`
}

/** 当前字节/秒 → 面板回填的数值与单位；≥1MB/s 用 MB 显示（2 而不是 2048） */
export function fromSpeedLimitBytes(bytes: number): { value: number | null; unit: SpeedLimitUnit } {
  if (!Number.isFinite(bytes) || bytes <= 0) return { value: null, unit: 'MB' }
  if (bytes >= SPEED_LIMIT_UNIT_BYTES.MB) {
    return { value: round2(bytes / SPEED_LIMIT_UNIT_BYTES.MB), unit: 'MB' }
  }
  // KB 档取整：没人需要 292.97 KB 这种回填值
  return { value: Math.round(bytes / SPEED_LIMIT_UNIT_BYTES.KB), unit: 'KB' }
}
