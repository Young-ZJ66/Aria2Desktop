import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Aria2Task } from '@/types/aria2'
import { getLocale, setLocale } from '@/i18n'
import {
  formatCompleteTime,
  formatDateTime,
  formatRemainingTime,
  formatShortDateTime,
  formatSize,
  formatSpeed,
  getFileName,
  getProgress,
  getProgressStatus,
  getStatusType,
  getTaskDisplayName
} from './taskFormatters'

function task(overrides: Record<string, unknown> = {}): Aria2Task {
  return {
    gid: 'gid-1',
    status: 'active',
    totalLength: '0',
    completedLength: '0',
    downloadSpeed: '0',
    uploadSpeed: '0',
    uploadLength: '0',
    ...overrides
  } as unknown as Aria2Task
}

describe('formatSize / formatSpeed', () => {
  it('按 1024 进位，保留一位小数', () => {
    expect(formatSize(0)).toBe('0 B')
    expect(formatSize(1023)).toBe('1023 B')
    expect(formatSize(1024)).toBe('1 KB')
    expect(formatSize(1536)).toBe('1.5 KB')
    expect(formatSize(1024 * 1024 * 3)).toBe('3 MB')
  })

  it('负数、非数字、空串一律显示 0 B（RPC 字段缺失时不会漏出 NaN）', () => {
    expect(formatSize(-1)).toBe('0 B')
    expect(formatSize('')).toBe('0 B')
    expect(formatSize('abc')).toBe('0 B')
    expect(formatSize(Number.NaN)).toBe('0 B')
  })

  it('速度带 /s 后缀', () => {
    expect(formatSpeed(0)).toBe('0 B/s')
    expect(formatSpeed(2048)).toBe('2 KB/s')
  })
})

describe('getProgress', () => {
  it('常规百分比四舍五入', () => {
    expect(getProgress(task({ totalLength: '1000', completedLength: '333' }))).toBe(33)
    expect(getProgress(task({ totalLength: '1000', completedLength: '1000' }))).toBe(100)
  })

  it('总长度为 0（元数据阶段）返回 0', () => {
    expect(getProgress(task({ totalLength: '0', completedLength: '0' }))).toBe(0)
  })

  it('completed 超过 total 时封顶 100', () => {
    expect(getProgress(task({ totalLength: '10', completedLength: '99' }))).toBe(100)
  })

  it('字段缺失或非数字时返回 0，不会算出 NaN / 负数', () => {
    expect(getProgress(task({ totalLength: '', completedLength: '10' }))).toBe(0)
    expect(getProgress(task({ totalLength: 'abc', completedLength: '10' }))).toBe(0)
    expect(getProgress(task({ totalLength: '100', completedLength: 'abc' }))).toBe(0)
    expect(getProgress(task({ totalLength: '100', completedLength: '-50' }))).toBe(0)
  })
})

describe('状态映射', () => {
  it('进度条状态按 aria2 状态映射', () => {
    expect(getProgressStatus(task({ status: 'complete' }))).toBe('success')
    expect(getProgressStatus(task({ status: 'error' }))).toBe('exception')
    expect(getProgressStatus(task({ status: 'active' }))).toBe('')
    expect(getProgressStatus(task({ status: 'paused' }))).toBe('')
  })

  it('状态标签类型按 aria2 状态映射', () => {
    expect(getStatusType('active')).toBe('primary')
    expect(getStatusType('waiting')).toBe('warning')
    expect(getStatusType('paused')).toBe('info')
    expect(getStatusType('complete')).toBe('success')
    expect(getStatusType('error')).toBe('error')
    expect(getStatusType('removed')).toBe('default')
  })
})

describe('getFileName', () => {
  it('取路径最后一段，兼容两种分隔符', () => {
    expect(getFileName('D:/Downloads/a.zip')).toBe('a.zip')
    expect(getFileName('D:\\Downloads\\b.zip')).toBe('b.zip')
    expect(getFileName('c.zip')).toBe('c.zip')
  })
})

describe('getTaskDisplayName', () => {
  it('BT 任务用种子名，普通任务用文件名', () => {
    expect(
      getTaskDisplayName(
        task({
          bittorrent: { info: { name: 'linux.iso.torrent' } },
          files: [{ index: '1', path: 'D:/Downloads/linux.iso', length: '0', completedLength: '0', selected: 'true', uris: [] }]
        })
      )
    ).toBe('linux.iso.torrent')
    expect(
      getTaskDisplayName(
        task({
          files: [{ index: '1', path: 'D:/Downloads/linux.iso', length: '0', completedLength: '0', selected: 'true', uris: [] }]
        })
      )
    ).toBe('linux.iso')
  })
})

describe('formatRemainingTime', () => {
  it('速度为 0 或已完成时返回 --', () => {
    expect(formatRemainingTime(task({ totalLength: '1000', completedLength: '0', downloadSpeed: '0' }))).toBe('--')
    expect(formatRemainingTime(task({ totalLength: '1000', completedLength: '1000', downloadSpeed: '10' }))).toBe('--')
  })

  it('按剩余量除以速度换算成时间', () => {
    // 剩 3600 字节、速度 1 B/s → 3600 秒
    expect(formatRemainingTime(task({ totalLength: '3600', completedLength: '0', downloadSpeed: '1' }))).toBe('1:00:00')
  })

  it('暂停任务即使残留速度也显示 --，不给出假读数', () => {
    expect(formatRemainingTime(task({ status: 'paused', totalLength: '3600', completedLength: '0', downloadSpeed: '1' }))).toBe('--')
  })
})

describe('formatCompleteTime', () => {
  it('无效时间戳返回 --', () => {
    expect(formatCompleteTime(Number.NaN)).toBe('--')
    expect(formatCompleteTime(Number.POSITIVE_INFINITY)).toBe('--')
  })

  it('今天的完成时间只显示时分秒', () => {
    const now = new Date()
    const formatted = formatCompleteTime(now.getTime())
    expect(formatted).not.toBe('--')
    // 12/24 小时制与日期分隔符都随 locale 变（en-US 会带 "PM"，长度 11），所以只断言形状
    expect(formatted).toMatch(/^\d{1,2}:\d{2}:\d{2}(\s?[AP]M)?$/i)
  })
})

describe('formatDateTime', () => {
  it('接受 Date、毫秒时间戳与可解析字符串，产出同一时刻的文本', () => {
    const stamp = Date.UTC(2026, 0, 2, 3, 4, 5)
    const fromDate = formatDateTime(new Date(stamp))
    expect(formatDateTime(stamp)).toBe(fromDate)
    expect(formatDateTime(new Date(stamp).toISOString())).toBe(fromDate)
    expect(fromDate).not.toBe('--')
    expect(fromDate).toMatch(/\d/)
  })

  it('空值与无法解析的输入返回 --（不会渲染 Invalid Date）', () => {
    expect(formatDateTime(null)).toBe('--')
    expect(formatDateTime(undefined)).toBe('--')
    expect(formatDateTime('')).toBe('--')
    expect(formatDateTime('not a date')).toBe('--')
    expect(formatDateTime(Number.NaN)).toBe('--')
  })
})

describe('formatShortDateTime', () => {
  it('只保留月日与时分，不带年份和秒', () => {
    const formatted = formatShortDateTime(Date.UTC(2026, 4, 6, 7, 8, 9))
    expect(formatted).not.toBe('--')
    expect(formatted).not.toMatch(/2026/)
    expect(formatted).toMatch(/\d{1,2}[^\d]+\d{1,2}/)
    expect(formatted.split(':').length).toBeGreaterThanOrEqual(2)
  })

  it('无效输入返回 --', () => {
    expect(formatShortDateTime(null)).toBe('--')
    expect(formatShortDateTime('nope')).toBe('--')
    expect(formatShortDateTime(Number.POSITIVE_INFINITY)).toBe('--')
  })
})
describe('formatCompleteTime 的日期分段', () => {
  // 「昨天」走 i18n，而默认语言按系统语言猜：CI 是 en-US、本机是 zh-CN，
  // 不锁语言的话这组断言在两种环境里结论相反。这里显式钉成中文。
  let originalLocale: ReturnType<typeof getLocale>
  beforeEach(() => {
    originalLocale = getLocale()
    setLocale('zh-CN')
  })
  afterEach(() => {
    vi.useRealTimers()
    setLocale(originalLocale)
  })

  function fixNow(y: number, m: number, d: number) {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(y, m - 1, d, 10, 0, 0))
  }

  it('昨天的任务显示「昨天」加时分，不再带日期', () => {
    fixNow(2026, 5, 20)
    const text = formatCompleteTime(new Date(2026, 4, 19, 8, 30, 0).getTime())
    expect(text).toContain('昨天')
    expect(text).not.toContain('2026')
    expect(text).toMatch(/\d{1,2}:\d{2}/)
  })

  it('今年的旧任务显示月日与时分，不带年份与秒', () => {
    fixNow(2026, 5, 20)
    const text = formatCompleteTime(new Date(2026, 0, 2, 3, 4, 5).getTime())
    expect(text).not.toContain('2026')
    expect(text).not.toContain('昨天')
    // 月日与时分都出现，秒不出现（分段比较避免依赖 locale 分隔符）
    expect(text).toMatch(/\d{1,2}[^\d]+\d{1,2}/)
    expect(text.split(':').length).toBe(2)
  })

  it('往年的任务显示完整日期', () => {
    fixNow(2026, 5, 20)
    const text = formatCompleteTime(new Date(2024, 2, 4, 3, 4, 5).getTime())
    expect(text).toContain('2024')
    expect(text).toMatch(/\d{1,2}:\d{2}/)
  })

  it('跨年边界：昨天恰好落在上一年时仍按「昨天」显示', () => {
    fixNow(2026, 1, 1)
    const text = formatCompleteTime(new Date(2025, 11, 31, 22, 15, 0).getTime())
    expect(text).toContain('昨天')
    expect(text).not.toContain('2025')
  })
})
