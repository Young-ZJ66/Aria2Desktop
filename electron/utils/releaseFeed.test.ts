import { describe, expect, it } from 'vitest'
import { decodeHtmlEntities, extractReleaseNotes, parseStableTagFromLocation } from './releaseFeed'

/**
 * 更新检查里两个纯字符串判定直接决定"是否向用户推送新版本"：
 * 302 Location 解析（稳定版 tag）与 atom 日志匹配（不能取错条目）。
 */
describe('parseStableTagFromLocation', () => {
  it('解析标准 tag 跳转', () => {
    expect(parseStableTagFromLocation('https://github.com/Young-ZJ66/Aria2Desktop/releases/tag/v1.1.0'))
      .toBe('v1.1.0')
  })

  it('带 query 或尾随斜杠时仍只取 tag', () => {
    expect(parseStableTagFromLocation('https://github.com/o/r/releases/tag/v1.1.0?x=1')).toBe('v1.1.0')
    expect(parseStableTagFromLocation('https://github.com/o/r/releases/tag/v1.1.0/')).toBe('v1.1.0')
  })

  it('百分号编码的 tag 会解码', () => {
    expect(parseStableTagFromLocation('https://github.com/o/r/releases/tag/v1.1.0%2Dbeta.1')).toBe('v1.1.0-beta.1')
  })

  it('不是 tag 跳转时返回 null（调用方应报错而不是猜版本）', () => {
    expect(parseStableTagFromLocation('https://github.com/login')).toBeNull()
    expect(parseStableTagFromLocation('https://github.com/o/r/releases')).toBeNull()
    expect(parseStableTagFromLocation('')).toBeNull()
  })
})

describe('extractReleaseNotes', () => {
  const atom = `<feed>
    <entry><link href="https://github.com/o/r/releases/tag/v1.1.0-beta.1"/><content type="html">beta notes</content></entry>
    <entry><link href="https://github.com/o/r/releases/tag/v1.1.0"/><content type="html">&lt;b&gt;stable&lt;/b&gt; &amp;amp; notes</content></entry>
  </feed>`

  it('跳过排在前面的 pre-release，取匹配 tag 的那一条', () => {
    expect(extractReleaseNotes(atom, 'v1.1.0')).toBe('<b>stable</b> &amp; notes')
  })

  it('tag 前缀相同但不同版本时不误取', () => {
    const onlyBeta = `<feed><entry><link href="https://github.com/o/r/releases/tag/v1.1.0-beta.1"/><content>pre</content></entry></feed>`
    expect(extractReleaseNotes(onlyBeta, 'v1.1.0')).toBe('')
  })

  it('没有匹配条目时返回空串（调用方按日志缺失降级）', () => {
    expect(extractReleaseNotes(atom, 'v9.9.9')).toBe('')
    expect(extractReleaseNotes('<feed></feed>', 'v1.1.0')).toBe('')
  })
})

describe('decodeHtmlEntities', () => {
  it('按顺序反转义且 &amp; 只解一层', () => {
    expect(decodeHtmlEntities('&lt;b&gt;A&amp;B&lt;/b&gt;')).toBe('<b>A&B</b>')
    expect(decodeHtmlEntities('&amp;amp;')).toBe('&amp;')
  })
})
