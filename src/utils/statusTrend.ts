/**
 * 下载趋势横轴标签。
 *
 * 7 天视图用完整的 MM/DD，30 天视图只显示日号，避免 30 个完整日期在窄窗口里挤成一片；
 * 30 天视图的第一根柱和每月 1 日额外带上月份，跨月时仍能读出月份。
 */
export function formatTrendAxisLabel(dateKey: string, index: number, totalDays: number): string {
  const parts = dateKey.split('-')
  const month = Number(parts[1])
  const day = Number(parts[2])
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > 31) {
    return dateKey
  }
  const paddedMonth = String(month).padStart(2, '0')
  const paddedDay = String(day).padStart(2, '0')
  if (totalDays <= 7) return `${paddedMonth}/${paddedDay}`
  return index === 0 || day === 1 ? `${month}/${day}` : String(day)
}
