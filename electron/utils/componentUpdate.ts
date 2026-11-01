/**
 * 媒体工具（yt-dlp / ffmpeg）版本比较的纯逻辑。
 * 独立成文件便于单测：服务层 import electron，vitest 里无法直接加载。
 */

/** 把 yt-dlp 版本（如 `2026.10.26`）拆成数字段；无法解析返回 null */
export function parseDottedVersion(version: string): number[] | null {
  const parts = String(version || '')
    .trim()
    .replace(/^v/i, '')
    .split(/[^0-9]+/)
    .filter(Boolean)
  if (parts.length === 0) return null
  const nums = parts.map((part) => Number(part))
  return nums.every((num) => Number.isFinite(num)) ? nums : null
}

/** latest 是否比 current 新（按数字段逐位比较，缺失段按 0 处理） */
export function isNewerVersion(latest: string, current: string): boolean {
  const next = parseDottedVersion(latest)
  const prev = parseDottedVersion(current)
  if (!next || !prev) return false
  const length = Math.max(next.length, prev.length)
  for (let i = 0; i < length; i++) {
    const a = next[i] ?? 0
    const b = prev[i] ?? 0
    if (a !== b) return a > b
  }
  return false
}

/**
 * 从 ffmpeg 版本串提取构建日期（`N-128251-g6d1bfd7609-20261031` → `20261031`）。
 * FFmpeg-Builds 每日滚动构建，日期就是最有意义的版本标识。
 */
export function ffmpegBuildDate(version: string): string | null {
  const match = /(20\d{6})/.exec(String(version || ''))
  return match?.[1] ?? null
}

/** ISO 时间戳 → `YYYYMMDD`（取 UTC 日期，与构建日期同口径） */
export function isoToDateStamp(iso: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''))
  if (!match?.[1] || !match[2] || !match[3]) return null
  return `${match[1]}${match[2]}${match[3]}`
}

/** `YYYYMMDD` → `YYYY-MM-DD`（界面展示用）；格式不对时原样返回 */
export function formatDateStamp(stamp: string): string {
  return /^\d{8}$/.test(stamp) ? `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}` : stamp
}
