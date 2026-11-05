import { describe, expect, it } from 'vitest'
import {
  formatClockTime,
  resolveDownloadScheduleState,
  resolveScheduleAction,
  type DownloadScheduleConfig,
  type DownloadScheduleRule
} from './downloadScheduleCore'

function rule(overrides: Partial<DownloadScheduleRule> = {}): DownloadScheduleRule {
  return {
    name: '工作时段',
    enabled: true,
    days: [],
    startTime: '09:00',
    endTime: '18:00',
    ...overrides
  }
}

function config(rules: DownloadScheduleRule[], enabled = true): DownloadScheduleConfig {
  return { enabled, rules }
}

describe('resolveDownloadScheduleState', () => {
  it('窗口内 → in-window', () => {
    expect(resolveDownloadScheduleState(config([rule()]), 1, '10:00')).toBe('in-window')
  })

  it('窗口外 → out-window', () => {
    expect(resolveDownloadScheduleState(config([rule()]), 1, '08:00')).toBe('out-window')
  })

  it('总开关关闭恒为 out-window', () => {
    expect(resolveDownloadScheduleState(config([rule()], false), 1, '10:00')).toBe('out-window')
  })

  it('单条规则 disabled 则该条不参与', () => {
    const disabled = rule({ name: '夜间', startTime: '22:00', endTime: '06:00', enabled: false })
    expect(resolveDownloadScheduleState(config([disabled]), 3, '23:00')).toBe('out-window')
  })

  it('跨午夜规则在凌晨命中', () => {
    const overnight = rule({ name: '夜间', startTime: '22:00', endTime: '06:00' })
    expect(resolveDownloadScheduleState(config([overnight]), 3, '02:00')).toBe('in-window')
  })

  it('多规则任一命中即为 in-window', () => {
    const rules = [
      rule({ name: 'r1', startTime: '09:00', endTime: '10:00' }),
      rule({ name: 'r2', startTime: '14:00', endTime: '16:00' })
    ]
    expect(resolveDownloadScheduleState(config(rules), 1, '15:00')).toBe('in-window')
  })

  it('start === end 视为禁用（沿用限速规则的窗口语义）', () => {
    expect(resolveDownloadScheduleState(config([rule({ startTime: '09:00', endTime: '09:00' })]), 1, '09:00')).toBe('out-window')
  })
})

describe('resolveScheduleAction', () => {
  it('首次运行（previous=null）不动作', () => {
    expect(resolveScheduleAction(null, 'in-window')).toBeNull()
    expect(resolveScheduleAction(null, 'out-window')).toBeNull()
  })

  it('状态不变不动作', () => {
    expect(resolveScheduleAction('in-window', 'in-window')).toBeNull()
    expect(resolveScheduleAction('out-window', 'out-window')).toBeNull()
  })

  it('out→in 恢复全部；in→out 暂停全部', () => {
    expect(resolveScheduleAction('out-window', 'in-window')).toBe('unpause-all')
    expect(resolveScheduleAction('in-window', 'out-window')).toBe('pause-all')
  })
})

describe('formatClockTime', () => {
  it('补零到 HH:mm', () => {
    expect(formatClockTime(new Date(2026, 10, 5, 3, 7))).toBe('03:07')
  })
})
