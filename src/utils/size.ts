// aria2 SIZE 值解析与格式化工具
// aria2 的 getGlobalOption 返回的大小类选项（piece-length、rpc-max-request-size、
// disk-cache、速度限制等）一律是字节数（如 "2097152"），也可能带单位后缀（如 "2M"）。
// 这里统一转换为目标单位下的数值，避免把原始字节数直接显示/回写。

const UNIT_BYTES = { K: 1024, M: 1048576, G: 1073741824, T: 1099511627776 } as const

export type SizeUnit = keyof typeof UNIT_BYTES

/**
 * 将 aria2 的 SIZE 字符串（字节数或带 K/M/G/T 后缀）解析为目标单位下的数值。
 * 例：parseSizeToUnit('2097152', 'M') => 2；parseSizeToUnit('2M', 'M') => 2；
 *     parseSizeToUnit('1048576', 'K') => 1024；parseSizeToUnit('0', 'M') => 0
 */
export function parseSizeToUnit(value: string | number | null | undefined, unit: SizeUnit): number {
  if (value === null || value === undefined || value === '') return 0
  const str = String(value).trim().toUpperCase()
  if (!str || str === '0') return 0
  const matched = str.match(/^(\d+(?:\.\d+)?)([KMGT]?)$/)
  if (!matched) return 0
  const num = parseFloat(matched[1])
  const sourceUnit = matched[2] as SizeUnit | ''
  const bytes = sourceUnit ? num * UNIT_BYTES[sourceUnit] : num
  return Math.round(bytes / UNIT_BYTES[unit])
}

/**
 * 将目标单位下的数值格式化为 aria2 的 SIZE 字符串。
 * 0 表示无限制，直接返回 "0"；其余值附加单位后缀。
 */
export function formatSizeWithUnit(value: number, unit: SizeUnit): string {
  return value === 0 ? '0' : `${value}${unit}`
}
