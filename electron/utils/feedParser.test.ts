import { describe, expect, it } from 'vitest'
import { parseFeed } from './feedParser'

/**
 * feedParser 单测：只测纯函数行为（无网络、无 IPC）。
 * 覆盖：RSS 2.0 / Atom / 磁力条目、CDATA 与实体解码、200 条上限、
 * 控制字符剔除、坏输入容错。
 */

/** 标准 RSS 2.0 样例：CDATA 标题、实体转义链接、enclosure 附件 */
const RSS_SAMPLE = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<rss version="2.0">',
  '  <channel>',
  '    <title>My Channel &amp; Co</title>',
  '    <link>https://example.com/feed</link>',
  '    <description>测试频道</description>',
  '    <item>',
  '      <title><![CDATA[第一集 <1080p>]]></title>',
  '      <link>https://example.com/items/1?ref=a&amp;b=1</link>',
  '      <guid isPermaLink="false">item-1</guid>',
  '      <pubDate>Tue, 11 Nov 2026 08:00:00 GMT</pubDate>',
  '      <enclosure url="https://example.com/torrents/1.torrent" type="application/x-bittorrent" length="12345" />',
  '    </item>',
  '    <item>',
  '      <title>第二集 &quot;好片&quot;</title>',
  '      <link>https://example.com/items/2</link>',
  '      <guid>item-2</guid>',
  '    </item>',
  '  </channel>',
  '</rss>'
].join('\n')

/** Atom 样例：alternate 链接 + enclosure 链接并存 */
const ATOM_SAMPLE = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<feed xmlns="http://www.w3.org/2005/Atom">',
  '  <title>Atom 源</title>',
  '  <entry>',
  '    <title type="html">&lt;b&gt;加粗&lt;/b&gt;标题</title>',
  '    <link rel="alternate" href="https://example.com/entries/1" />',
  '    <link rel="enclosure" href="https://example.com/files/1.torrent" type="application/x-bittorrent" length="999" />',
  '    <id>urn:entry:1</id>',
  '    <updated>2026-11-12T10:00:00Z</updated>',
  '  </entry>',
  '</feed>'
].join('\n')

describe('parseFeed', () => {
  it('解析 RSS 2.0：标题/链接/guid/pubDate/enclosure', () => {
    const feed = parseFeed(RSS_SAMPLE)
    expect(feed.title).toBe('My Channel & Co')
    expect(feed.items).toHaveLength(2)
    const [first, second] = feed.items
    expect(first.title).toBe('第一集 <1080p>')
    expect(first.link).toBe('https://example.com/items/1?ref=a&b=1')
    expect(first.guid).toBe('item-1')
    expect(first.publishedAt).toBe('Tue, 11 Nov 2026 08:00:00 GMT')
    expect(first.enclosureUrl).toBe('https://example.com/torrents/1.torrent')
    expect(first.enclosureType).toBe('application/x-bittorrent')
    expect(second.title).toBe('第二集 "好片"')
    expect(second.enclosureUrl).toBeUndefined()
  })

  it('解析 Atom：alternate 链接与 enclosure 链接并存', () => {
    const feed = parseFeed(ATOM_SAMPLE)
    expect(feed.title).toBe('Atom 源')
    expect(feed.items).toHaveLength(1)
    const entry = feed.items[0]
    expect(entry.title).toBe('<b>加粗</b>标题')
    expect(entry.link).toBe('https://example.com/entries/1')
    expect(entry.guid).toBe('urn:entry:1')
    expect(entry.publishedAt).toBe('2026-11-12T10:00:00Z')
    expect(entry.enclosureUrl).toBe('https://example.com/files/1.torrent')
    expect(entry.enclosureType).toBe('application/x-bittorrent')
  })

  it('解析磁力链接条目（link 为 magnet: 协议）', () => {
    const xml = '<rss><channel><title>t</title><item><title>磁力</title><link>magnet:?xt=urn:btih:abc</link><guid>m-1</guid></item></channel></rss>'
    const feed = parseFeed(xml)
    expect(feed.items[0].link).toBe('magnet:?xt=urn:btih:abc')
  })

  it('条目数超过上限 200 时截断', () => {
    const items = Array.from({ length: 350 }, (_, i) => '<item><title>t' + i + '</title><link>https://e.com/' + i + '</link></item>').join('')
    const feed = parseFeed('<rss><channel><title>big</title>' + items + '</channel></rss>')
    expect(feed.items).toHaveLength(200)
    expect(feed.items[0].title).toBe('t0')
    expect(feed.items[199].title).toBe('t199')
  })

  it('剔除 XML 非法控制字符', () => {
    const xml = '<rss><channel><title>t</title><item><title>脏标题</title><link>https://e.com</link></item></channel></rss>'
    const feed = parseFeed(xml.replace('脏', '脏' + String.fromCharCode(3)))
    expect(feed.items).toHaveLength(1)
    expect(feed.items[0].title).toBe('脏标题')
  })

  it('空/非字符串/坏 XML 一律返回空 items 而不抛异常', () => {
    expect(parseFeed('')).toEqual({ items: [] })
    expect(parseFeed('not xml at all')).toEqual({ items: [] })
    expect(parseFeed('<rss><channel><title>never closed')).toEqual({ items: [] })
    expect(parseFeed(null as unknown as string)).toEqual({ items: [] })
    expect(parseFeed(undefined as unknown as string)).toEqual({ items: [] })
  })

  it('数字实体与十六进制实体解码', () => {
    const xml = '<rss><channel><title>&#x4F60;&#22909;</title><item><title>&#65;</title><link>https://e.com</link></item></channel></rss>'
    const feed = parseFeed(xml)
    expect(feed.title).toBe('你好')
    expect(feed.items[0].title).toBe('A')
  })

  it('非法数字实体（代理区）保留原文', () => {
    const xml = '<rss><channel><item><title>&#xD800;</title><link>https://e.com</link></item></channel></rss>'
    const feed = parseFeed(xml)
    expect(feed.items[0].title).toBe('&#xD800;')
  })

  it('同名属性取首个；rel=self 链接不进 link 也不进 enclosure', () => {
    const xml = [
      '<feed>',
      '  <entry>',
      '    <title>e</title>',
      '    <link rel="self" href="https://example.com/self" />',
      '    <id>e1</id>',
      '  </entry>',
      '</feed>'
    ].join('')
    const feed = parseFeed(xml)
    expect(feed.items[0].link).toBe('')
    expect(feed.items[0].enclosureUrl).toBeUndefined()
  })

  it('条目内出现的 <title> 不冒充频道标题', () => {
    const xml = '<rss><channel><title>channel-title</title><item><title>item-title</title><link>https://e.com</link></item></channel></rss>'
    const feed = parseFeed(xml)
    expect(feed.title).toBe('channel-title')
    expect(feed.items[0].title).toBe('item-title')
  })

  it('多属性 enclosure：单引号属性值同样解析', () => {
    const xml = "<rss><channel><item><title>t</title><link>https://e.com</link><enclosure url='https://e.com/f.torrent' type='application/x-bittorrent'/></item></channel></rss>"
    const feed = parseFeed(xml)
    expect(feed.items[0].enclosureUrl).toBe('https://e.com/f.torrent')
    expect(feed.items[0].enclosureType).toBe('application/x-bittorrent')
  })
})
