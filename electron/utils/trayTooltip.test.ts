import { describe, expect, it } from 'vitest'
import { buildTrayTooltip, formatTraySpeed } from './trayTooltip'

describe('formatTraySpeed', () => {
  it('按量级切换单位', () => {
    expect(formatTraySpeed(0)).toBe('0 B/s')
    expect(formatTraySpeed(512)).toBe('512 B/s')
    expect(formatTraySpeed(2048)).toBe('2 KB/s')
    expect(formatTraySpeed(3 * 1048576)).toBe('3.0 MB/s')
  })

  it('非法值按 0 处理', () => {
    expect(formatTraySpeed(Number.NaN)).toBe('0 B/s')
    expect(formatTraySpeed(-1)).toBe('0 B/s')
  })
})

describe('buildTrayTooltip', () => {
  it('没有任务时只显示应用名', () => {
    expect(buildTrayTooltip({ downloadSpeed: 0, activeCount: 0, streamCount: 0, streamSpeed: 0, zh: true }))
      .toBe('Aria2 Desktop')
  })

  it('合并 aria2 与流媒体的速度/任务数', () => {
    expect(buildTrayTooltip({ downloadSpeed: 1048576, activeCount: 1, streamCount: 2, streamSpeed: 1048576, zh: true }))
      .toBe('Aria2 Desktop — 2.0 MB/s · 3 个任务')
    expect(buildTrayTooltip({ downloadSpeed: 1024, activeCount: 1, streamCount: 0, streamSpeed: 0, zh: false }))
      .toBe('Aria2 Desktop — 1 KB/s · 1 active')
  })

  it('只有流媒体任务时也显示进度', () => {
    expect(buildTrayTooltip({ downloadSpeed: 0, activeCount: 0, streamCount: 1, streamSpeed: 2048, zh: true }))
      .toBe('Aria2 Desktop — 2 KB/s · 1 个任务')
  })
})
