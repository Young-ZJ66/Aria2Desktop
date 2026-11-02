import { describe, expect, it } from 'vitest'
import type { Aria2Task } from '@/types/aria2'
import {
  formatCompleteTime,
  formatRemainingTime,
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
