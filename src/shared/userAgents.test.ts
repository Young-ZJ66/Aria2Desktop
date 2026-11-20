import { describe, expect, it } from 'vitest'
import { aria2DefaultUserAgent, USER_AGENT_PRESETS } from './userAgents'

/**
 * UA 预设的回归测试。
 *
 * 预设值会被原样写进 aria2 的 `user-agent` 选项，写错（缺空格、版本号被替换成
 * 占位符）会让部分站点直接返回 403，因此这里对结构和不变量逐项锁死，
 * 不逐字比对整串 UA——浏览器版本会随预设更新而变。
 */
describe('USER_AGENT_PRESETS：浏览器 UA 预设', () => {
  it('提供 6 个预设且 key 互不重复', () => {
    expect(USER_AGENT_PRESETS).toHaveLength(6)
    const keys = USER_AGENT_PRESETS.map(preset => preset.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('每个预设的 value 都是一条完整的 Mozilla/5.0 UA', () => {
    for (const preset of USER_AGENT_PRESETS) {
      expect(preset.value.startsWith('Mozilla/5.0 (')).toBe(true)
      expect(preset.value.trim()).toBe(preset.value)
      expect(preset.label.trim().length).toBeGreaterThan(0)
    }
    const values = USER_AGENT_PRESETS.map(preset => preset.value)
    expect(new Set(values).size).toBe(values.length)
  })

  it('桌面浏览器 UA 带平台标记，Android 预设带 Mobile', () => {
    const byKey = new Map(USER_AGENT_PRESETS.map(preset => [preset.key, preset.value]))
    expect(byKey.get('chrome-windows')).toContain('Windows NT 10.0; Win64; x64')
    expect(byKey.get('chrome-macos')).toContain('Macintosh; Intel Mac OS X')
    expect(byKey.get('edge-windows')).toContain('Edg/')
    expect(byKey.get('firefox-windows')).toContain('Gecko/20100101 Firefox/')
    expect(byKey.get('safari-macos')).toContain('Safari/605.1.15')
    expect(byKey.get('chrome-android')).toContain('Android')
    expect(byKey.get('chrome-android')).toContain('Mobile Safari')
  })
})

describe('aria2DefaultUserAgent：aria2 自身 UA', () => {
  it('有版本号时拼成 aria2/<版本>', () => {
    expect(aria2DefaultUserAgent('1.37.0')).toBe('aria2/1.37.0')
  })

  it('拿不到版本时退回 aria2（不能出现 aria2/undefined）', () => {
    expect(aria2DefaultUserAgent()).toBe('aria2')
    expect(aria2DefaultUserAgent(null)).toBe('aria2')
    expect(aria2DefaultUserAgent('')).toBe('aria2')
  })
})
