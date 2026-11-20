import { describe, expect, it } from 'vitest'
import {
  TASK_STATUS_FILTERS,
  availableStatusFilters,
  isFailedTask,
  matchesStatusFilter
} from './taskStatusFilter'

describe('availableStatusFilters', () => {
  it('下载页（active-and-waiting）给出全部状态，含失败', () => {
    expect(availableStatusFilters('active-and-waiting')).toEqual([
      'active',
      'waiting',
      'paused',
      'error',
      'complete'
    ])
  })

  it('完成页不提供「失败」：完成列表已把 error 任务排除，给出只会是空列表', () => {
    expect(availableStatusFilters('stopped')).toEqual(['complete'])
  })

  it('等待页只有等待状态', () => {
    expect(availableStatusFilters('waiting')).toEqual(['waiting'])
  })

  it('纯下载中页面不提供完成 / 失败选项', () => {
    const options = availableStatusFilters('active')
    expect(options).toContain('active')
    expect(options).not.toContain('complete')
    expect(options).not.toContain('error')
  })
})

describe('matchesStatusFilter', () => {
  it("'all' 匹配任何状态，包括 removed", () => {
    expect(matchesStatusFilter('active', 'all')).toBe(true)
    expect(matchesStatusFilter('removed', 'all')).toBe(true)
    expect(matchesStatusFilter(undefined, 'all')).toBe(true)
  })

  it('具体状态精确匹配', () => {
    expect(matchesStatusFilter('error', 'error')).toBe(true)
    expect(matchesStatusFilter('active', 'error')).toBe(false)
  })

  it('状态缺失时只有 all 命中', () => {
    expect(matchesStatusFilter(undefined, 'complete')).toBe(false)
  })
})

describe('isFailedTask', () => {
  it('只有 aria2 的 error 状态算失败', () => {
    expect(isFailedTask('error')).toBe(true)
    expect(isFailedTask('removed')).toBe(false)
    expect(isFailedTask(undefined)).toBe(false)
  })
})

describe('TASK_STATUS_FILTERS', () => {
  it('包含验收要求的六种状态', () => {
    expect([...TASK_STATUS_FILTERS]).toEqual([
      'all',
      'active',
      'waiting',
      'paused',
      'error',
      'complete'
    ])
  })
})
