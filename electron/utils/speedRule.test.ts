import { describe, expect, it } from 'vitest'
import {
  formatClockTime,
  matchesSpeedRule,
  buildSpeedLimitOptions,
  buildSpeedRestoreOptions
} from './speedRule'

/**
 * 限速规则的时间匹配是"按星期/时段自动切换限速"的核心判定，
 * 跨午夜与边界语义容易改错，这里逐条锁死（语义与重构前完全一致）。
 */
describe('matchesSpeedRule', () => {
  const everyday = { days: [] as number[], startTime: '09:00', endTime: '18:00' }

  it('days 为空表示每天生效', () => {
    for (let day = 0; day <= 6; day++) {
      expect(matchesSpeedRule(everyday, day, '10:00')).toBe(true)
    }
  })

  it('不在指定的星期时不匹配', () => {
    const weekdayOnly = { days: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '18:00' }
    expect(matchesSpeedRule(weekdayOnly, 0, '10:00')).toBe(false) // 周日
    expect(matchesSpeedRule(weekdayOnly, 6, '10:00')).toBe(false) // 周六
    expect(matchesSpeedRule(weekdayOnly, 3, '10:00')).toBe(true)
  })

  it('非跨午夜区间为左闭右开 [start, end)', () => {
    expect(matchesSpeedRule(everyday, 1, '08:59')).toBe(false)
    expect(matchesSpeedRule(everyday, 1, '09:00')).toBe(true) // 起点含
    expect(matchesSpeedRule(everyday, 1, '17:59')).toBe(true)
    expect(matchesSpeedRule(everyday, 1, '18:00')).toBe(false) // 终点不含
  })

  it('跨午夜区间覆盖 [start, 23:59] 与 [00:00, end)', () => {
    const overnight = { days: [] as number[], startTime: '22:00', endTime: '06:00' }
    expect(matchesSpeedRule(overnight, 1, '22:00')).toBe(true)
    expect(matchesSpeedRule(overnight, 1, '23:59')).toBe(true)
    expect(matchesSpeedRule(overnight, 1, '00:00')).toBe(true)
    expect(matchesSpeedRule(overnight, 1, '05:59')).toBe(true)
    expect(matchesSpeedRule(overnight, 1, '06:00')).toBe(false)
    expect(matchesSpeedRule(overnight, 1, '12:00')).toBe(false)
  })

  it('startTime 等于 endTime 视为空区间（有意保留，可用于临时停用规则）', () => {
    const empty = { days: [] as number[], startTime: '09:00', endTime: '09:00' }
    expect(matchesSpeedRule(empty, 1, '09:00')).toBe(false)
    expect(matchesSpeedRule(empty, 1, '09:01')).toBe(false)
  })
})

describe('formatClockTime', () => {
  it('补零为 HH:mm', () => {
    expect(formatClockTime(new Date(2026, 0, 1, 9, 5))).toBe('09:05')
    expect(formatClockTime(new Date(2026, 0, 1, 0, 0))).toBe('00:00')
    expect(formatClockTime(new Date(2026, 0, 1, 23, 59))).toBe('23:59')
  })
})

/**
 * 限速指令的下发内容。
 *
 * 这里锁定的是一条用户可感知的边界：时段表的规则只填下载限速，
 * 上传限速在别的页面单独配置；调度器若在"规则没设上传限速"时也照写 '0'，
 * 用户配置的最大上传速度会在规则生效瞬间被静默清零。
 */
describe('buildSpeedLimitOptions', () => {
  it('规则只有下载限速时，不下发上传限速', () => {
    expect(buildSpeedLimitOptions({ downloadLimit: 512 * 1024, uploadLimit: 0 })).toEqual({
      'max-overall-download-limit': String(512 * 1024)
    })
  })

  it('缺少 uploadLimit 字段（旧数据）时同样不下发上传限速', () => {
    expect(buildSpeedLimitOptions({ downloadLimit: 1024 })).toEqual({
      'max-overall-download-limit': '1024'
    })
  })

  it('规则显式指定上传限速时两者都下发', () => {
    expect(buildSpeedLimitOptions({ downloadLimit: 2048, uploadLimit: 512 })).toEqual({
      'max-overall-download-limit': '2048',
      'max-overall-upload-limit': '512'
    })
  })

  it('下载限速为 0 表示不限速，依然显式下发 0', () => {
    expect(buildSpeedLimitOptions({ downloadLimit: 0 })).toEqual({
      'max-overall-download-limit': '0'
    })
  })

  it('负数、小数、NaN 都收敛为非负整数', () => {
    expect(buildSpeedLimitOptions({ downloadLimit: -5 })).toEqual({
      'max-overall-download-limit': '0'
    })
    expect(buildSpeedLimitOptions({ downloadLimit: 1536.9, uploadLimit: 99.9 })).toEqual({
      'max-overall-download-limit': '1536',
      'max-overall-upload-limit': '99'
    })
    expect(buildSpeedLimitOptions({ downloadLimit: Number.NaN })).toEqual({
      'max-overall-download-limit': '0'
    })
  })
})

describe('buildSpeedRestoreOptions', () => {
  it('从没下发过上传限速时，只回滚下载限速', () => {
    expect(buildSpeedRestoreOptions(0)).toEqual({ 'max-overall-download-limit': '0' })
  })

  it('之前下发过上传限速时，把上传限速一起恢复为不限速', () => {
    expect(buildSpeedRestoreOptions(512)).toEqual({
      'max-overall-download-limit': '0',
      'max-overall-upload-limit': '0'
    })
  })

  it('负数等异常记录按"没下发过"处理', () => {
    expect(buildSpeedRestoreOptions(-1)).toEqual({ 'max-overall-download-limit': '0' })
    expect(buildSpeedRestoreOptions(Number.NaN)).toEqual({ 'max-overall-download-limit': '0' })
  })
})
