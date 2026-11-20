import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BT_TRACKERS,
  DEFAULT_BT_TRACKERS_CSV,
  parseTrackerText,
  TRACKER_SUBSCRIPTION_SOURCES
} from './btTrackers'

/**
 * BT Tracker 默认值与订阅解析的回归测试。
 *
 * `parseTrackerText` 处理的是外部订阅源返回的文本（ngosang/trackerslist 等），
 * 内容完全不受控：混入非 tracker 行、重复项、逗号分隔、CRLF 都可能出现。
 * 解析结果会被直接写进 aria2 的 `bt-tracker` 选项，一条非法协议就会让整个选项失效。
 */
describe('parseTrackerText：解析订阅源文本', () => {
  it('按行解析并保留顺序', () => {
    const text = ['udp://a.example:1337/announce', 'https://b.example/announce', 'wss://c.example/announce'].join('\n')
    expect(parseTrackerText(text)).toEqual([
      'udp://a.example:1337/announce',
      'https://b.example/announce',
      'wss://c.example/announce'
    ])
  })

  it('兼容逗号分隔与 CRLF（源站两种格式都出现过）', () => {
    const text = 'udp://a.example/announce,http://b.example/announce\r\nudp://c.example/announce'
    expect(parseTrackerText(text)).toEqual([
      'udp://a.example/announce',
      'http://b.example/announce',
      'udp://c.example/announce'
    ])
  })

  it('过滤非 tracker 行（注释、空行、其它协议）', () => {
    const text = [
      '# trackerslist',
      '',
      '   ',
      'ftp://not-a-tracker.example/announce',
      'magnet:?xt=urn:btih:abc',
      'udp://ok.example/announce'
    ].join('\n')
    expect(parseTrackerText(text)).toEqual(['udp://ok.example/announce'])
  })

  it('按出现顺序去重', () => {
    const text = [
      'udp://a.example/announce',
      'udp://b.example/announce',
      'udp://a.example/announce'
    ].join('\n')
    expect(parseTrackerText(text)).toEqual(['udp://a.example/announce', 'udp://b.example/announce'])
  })

  it('去除每行首尾空白后再判断协议', () => {
    expect(parseTrackerText('  udp://a.example/announce  ')).toEqual(['udp://a.example/announce'])
  })

  it('空文本返回空数组', () => {
    expect(parseTrackerText('')).toEqual([])
    expect(parseTrackerText('\n\n')).toEqual([])
  })
})

describe('内置默认 Tracker 列表', () => {
  it('每一项都是 udp/http/https/wss 协议', () => {
    expect(DEFAULT_BT_TRACKERS.length).toBeGreaterThan(0)
    for (const tracker of DEFAULT_BT_TRACKERS) {
      expect(tracker).toMatch(/^(udp|https?|wss):\/\//)
    }
  })

  it('没有重复项（重复会让 bt-tracker 选项变长却无收益）', () => {
    expect(new Set(DEFAULT_BT_TRACKERS).size).toBe(DEFAULT_BT_TRACKERS.length)
  })

  it('CSV 形式与数组逐项对应（aria2 bt-tracker 用逗号分隔）', () => {
    expect(DEFAULT_BT_TRACKERS_CSV).toBe(DEFAULT_BT_TRACKERS.join(','))
    expect(DEFAULT_BT_TRACKERS_CSV.split(',')).toEqual(DEFAULT_BT_TRACKERS)
  })

  it('订阅源都是 https（订阅内容会直接写进配置，不能明文传输）', () => {
    expect(TRACKER_SUBSCRIPTION_SOURCES.length).toBeGreaterThan(0)
    for (const source of TRACKER_SUBSCRIPTION_SOURCES) {
      expect(source.startsWith('https://')).toBe(true)
    }
  })
})
