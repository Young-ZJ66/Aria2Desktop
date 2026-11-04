import { describe, expect, it } from 'vitest'
import { ARIA2_ERROR_MESSAGE_KEYS, classifyAria2Error } from './aria2Error'

describe('把 aria2 退出码翻译成分类', () => {
  it('常见的可行动错误各有分类', () => {
    expect(classifyAria2Error(1)).toBe('network')
    expect(classifyAria2Error(2)).toBe('timeout')
    expect(classifyAria2Error('3')).toBe('notFound')
    expect(classifyAria2Error(6)).toBe('network')
    expect(classifyAria2Error('9')).toBe('diskFull')
    expect(classifyAria2Error(18)).toBe('cannotCreateDir')
    expect(classifyAria2Error(19)).toBe('dns')
    expect(classifyAria2Error(24)).toBe('authFailed')
    expect(classifyAria2Error(32)).toBe('checksum')
  })

  it('未收录的码归到 other（界面回落引擎原话，不臆造原因）', () => {
    expect(classifyAria2Error(5)).toBe('other')
    expect(classifyAria2Error(30)).toBe('other')
    expect(classifyAria2Error(99)).toBe('other')
  })

  it('没有错误码或码为 0 时是 unknown', () => {
    expect(classifyAria2Error(undefined)).toBe('unknown')
    expect(classifyAria2Error(null)).toBe('unknown')
    expect(classifyAria2Error(0)).toBe('unknown')
    expect(classifyAria2Error('0')).toBe('unknown')
  })

  it('非数字输入不会被当成某个错误码', () => {
    expect(classifyAria2Error('')).toBe('unknown')
    expect(classifyAria2Error('  ')).toBe('unknown')
    expect(classifyAria2Error('abc')).toBe('unknown')
    expect(classifyAria2Error('-1')).toBe('unknown')
    expect(classifyAria2Error('18abc')).toBe('unknown')
  })

  it('数字与字符串两种写法结果一致', () => {
    expect(classifyAria2Error('18')).toBe(classifyAria2Error(18))
    expect(classifyAria2Error(' 19 ')).toBe(classifyAria2Error(19))
  })

  it('每个非 unknown 分类都有对应的文案键', () => {
    const kinds = Object.keys(ARIA2_ERROR_MESSAGE_KEYS)
    expect(kinds.length).toBe(15)
    for (const kind of kinds) {
      expect(ARIA2_ERROR_MESSAGE_KEYS[kind as keyof typeof ARIA2_ERROR_MESSAGE_KEYS]).toBe(kind)
    }
  })
})
