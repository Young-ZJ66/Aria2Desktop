import { describe, expect, it } from 'vitest'
import { MAIN_ERROR_KEYS, mainError } from './mainErrorCopy'
import { runtimeMainLocale } from './mainLocaleRuntime'

const CJK = /[\u4e00-\u9fff]/

describe('主进程错误文案表', () => {
  it('每个键都有中英两份且非空', () => {
    expect(MAIN_ERROR_KEYS.length).toBeGreaterThan(50)
    for (const key of MAIN_ERROR_KEYS) {
      expect(mainError('zh', key).length, key).toBeGreaterThan(0)
      expect(mainError('en', key).length, key).toBeGreaterThan(0)
    }
  })

  it('英文侧不残留中文，中文侧确实是中文', () => {
    for (const key of MAIN_ERROR_KEYS) {
      expect(mainError('en', key), key).not.toMatch(CJK)
    }
    expect(mainError('zh', 'rss.notFound')).toMatch(CJK)
  })

  it('占位符按参数替换，未提供的保持原样', () => {
    expect(mainError('zh', 'engine.executableMissing', { path: '/opt/aria2c' }))
      .toBe('Aria2 可执行文件不存在: /opt/aria2c')
    expect(mainError('en', 'engine.rpcNotReady', { port: 6800 }))
      .toContain('port 6800')
    expect(mainError('zh', 'rss.filterRegex', { pattern: '[' })).toBe('过滤正则无效: [')
    expect(mainError('zh', 'rss.filterRegex')).toBe('过滤正则无效: {pattern}')
  })

  it('多行文案保留换行', () => {
    const text = mainError('zh', 'engine.startFailedWithOutput', { detail: 'boom' })
    expect(text.split('\n').length).toBeGreaterThan(1)
    expect(text).toContain('boom')
  })

  it('未知键原样返回，便于定位写错的调用点', () => {
    expect(mainError('zh', 'nope.not-a-key' as never)).toBe('nope.not-a-key')
  })
})

describe('runtimeMainLocale', () => {
  it('单测环境没有 mock electron 时退回中文而不是抛错', () => {
    expect(runtimeMainLocale()).toBe('zh')
  })
})
