import { describe, expect, it } from 'vitest'
import { countryCodeToFlag, getPeerClientName } from './peerClient'

/**
 * Peer ID 解析的回归测试。
 *
 * aria2 的 `peerId` 可能是 percent-encoded，也可能不是 Azureus 风格（`-XX1234-`）。
 * 解析失败要原样回显而不是显示空白，否则 BT 详情页的「连接用户」列表会出现无名行。
 */
describe('getPeerClientName：从 Peer ID 解析客户端名', () => {
  it('识别 Azureus 风格的常见客户端代码', () => {
    expect(getPeerClientName('-qB4456-abcdefghijkl')).toBe('qBittorrent')
    expect(getPeerClientName('-TR3000-abcdefghijkl')).toBe('Transmission')
    expect(getPeerClientName('-UT3530-abcdefghijkl')).toBe('µTorrent')
    expect(getPeerClientName('-DE2000-abcdefghijkl')).toBe('Deluge')
    expect(getPeerClientName('-LT0D80-abcdefghijkl')).toBe('libtorrent')
    expect(getPeerClientName('-AZ2500-abcdefghijkl')).toBe('Azureus/Vuze')
  })

  it('先做 percent-decode 再匹配（aria2 会转义非 ASCII 与特殊字符）', () => {
    expect(getPeerClientName('-%71B4456-abcdefghijkl')).toBe('qBittorrent')
  })

  it('未知客户端代码回显代码本身', () => {
    expect(getPeerClientName('-ZZ1234-abcdefghijkl')).toBe('ZZ')
  })

  it('非 Azureus 风格的 ID 原样回显（便于排障）', () => {
    expect(getPeerClientName('Xunlei 1.0')).toBe('Xunlei 1.0')
    expect(getPeerClientName('  Xunlei 1.0  ')).toBe('Xunlei 1.0')
  })

  it('空值与纯空白返回空串', () => {
    expect(getPeerClientName('')).toBe('')
    expect(getPeerClientName('   ')).toBe('')
    expect(getPeerClientName(null)).toBe('')
    expect(getPeerClientName(undefined)).toBe('')
  })

  it('非法 percent 序列不抛错，保留原值', () => {
    expect(getPeerClientName('bad%E0%A4%A')).toBe('bad%E0%A4%A')
  })
})

describe('countryCodeToFlag：国家代码转旗帜 emoji', () => {
  it('两位字母代码转成对应区域指示符号', () => {
    expect(countryCodeToFlag('CN')).toBe('\u{1F1E8}\u{1F1F3}')
    expect(countryCodeToFlag('us')).toBe('\u{1F1FA}\u{1F1F8}')
    expect(countryCodeToFlag('DE')).toBe('\u{1F1E9}\u{1F1EA}')
  })

  it('非法输入返回空串（表格里不出现乱码方块）', () => {
    expect(countryCodeToFlag('USA')).toBe('')
    expect(countryCodeToFlag('C')).toBe('')
    expect(countryCodeToFlag('12')).toBe('')
    expect(countryCodeToFlag('')).toBe('')
    expect(countryCodeToFlag(null)).toBe('')
    expect(countryCodeToFlag(undefined)).toBe('')
  })
})
