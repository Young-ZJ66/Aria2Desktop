import { describe, expect, it } from 'vitest'
import {
  ffmpegBuildDate,
  formatDateStamp,
  isNewerVersion,
  isoToDateStamp,
  parseDottedVersion
} from './componentUpdate'

describe('媒体工具版本比较', () => {
  it('解析 yt-dlp 日期版本', () => {
    expect(parseDottedVersion('2026.10.26')).toEqual([2026, 10, 26])
    expect(parseDottedVersion('v2026.10.26')).toEqual([2026, 10, 26])
    expect(parseDottedVersion('')).toBeNull()
  })

  it('判断 yt-dlp 新版本', () => {
    expect(isNewerVersion('2026.10.26', '2026.10.20')).toBe(true)
    expect(isNewerVersion('2026.10.20', '2026.10.26')).toBe(false)
    expect(isNewerVersion('2026.10.26', '2026.10.26')).toBe(false)
    // 段数不同时按 0 补齐
    expect(isNewerVersion('2026.10', '2026.9.30')).toBe(true)
    // 无法解析时不做升级判断
    expect(isNewerVersion('nightly', '2026.10.20')).toBe(false)
  })

  it('提取 ffmpeg 构建日期', () => {
    expect(ffmpegBuildDate('N-128251-g6d1bfd7609-20261031')).toBe('20261031')
    expect(ffmpegBuildDate('7.1-essentials_build-www.gyan.dev')).toBeNull()
  })

  it('ISO 时间转构建日期并按 UTC 口径', () => {
    expect(isoToDateStamp('2026-11-01T02:15:00Z')).toBe('20261101')
    expect(isoToDateStamp('not-a-date')).toBeNull()
  })

  it('构建日期展示格式', () => {
    expect(formatDateStamp('20261031')).toBe('2026-10-31')
    expect(formatDateStamp('latest')).toBe('latest')
  })
})
