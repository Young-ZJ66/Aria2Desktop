import { describe, expect, it } from 'vitest'
import {
  SUPPORTED_URI_SCHEMES,
  extractSupportedUris,
  isSupportedDownloadUri,
  isValidStreamUrl
} from './downloadUri'

describe('isSupportedDownloadUri', () => {
  it('接受 http/https/ftp/sftp 与磁力链接', () => {
    expect(isSupportedDownloadUri('https://example.com/a.zip')).toBe(true)
    expect(isSupportedDownloadUri('http://example.com/a.zip')).toBe(true)
    expect(isSupportedDownloadUri('ftp://example.com/a.zip')).toBe(true)
    expect(isSupportedDownloadUri('sftp://example.com/a.zip')).toBe(true)
    expect(isSupportedDownloadUri('magnet:?xt=urn:btih:abc')).toBe(true)
  })

  it('拒绝未收录协议与非法链接', () => {
    expect(isSupportedDownloadUri('file:///c:/a.zip')).toBe(false)
    expect(isSupportedDownloadUri('javascript:alert(1)')).toBe(false)
    expect(isSupportedDownloadUri('example.com/a.zip')).toBe(false)
    expect(isSupportedDownloadUri('   ')).toBe(false)
  })

  it('协议白名单包含 sftp', () => {
    expect(SUPPORTED_URI_SCHEMES).toContain('sftp:')
  })
})

describe('extractSupportedUris', () => {
  it('从多行文本中按顺序挑出受支持的链接', () => {
    const text = 'https://example.com/a.zip\nmagnet:?xt=urn:btih:abc\nfile:///c:/b.zip\n'
    expect(extractSupportedUris(text)).toEqual([
      'https://example.com/a.zip',
      'magnet:?xt=urn:btih:abc'
    ])
  })

  it('同一行用空白分隔的多个链接也能拆开', () => {
    expect(extractSupportedUris('https://a.com/1.zip  sftp://b.com/2.zip')).toEqual([
      'https://a.com/1.zip',
      'sftp://b.com/2.zip'
    ])
  })

  it('没有受支持链接时返回空数组', () => {
    expect(extractSupportedUris('随便一段文字')).toEqual([])
  })
})

describe('isValidStreamUrl', () => {
  it('接受带主机名的 http/https 链接', () => {
    expect(isValidStreamUrl('https://www.bilibili.com/video/BV1xx')).toBe(true)
    expect(isValidStreamUrl('  http://example.com/v/1  ')).toBe(true)
  })

  it('拒绝空值、非 http(s) 协议与缺少主机名的链接', () => {
    expect(isValidStreamUrl('')).toBe(false)
    expect(isValidStreamUrl('   ')).toBe(false)
    expect(isValidStreamUrl('ftp://example.com/a.mp4')).toBe(false)
    expect(isValidStreamUrl('magnet:?xt=urn:btih:abc')).toBe(false)
    expect(isValidStreamUrl('https://')).toBe(false)
    expect(isValidStreamUrl('bilibili.com/video/BV1xx')).toBe(false)
  })
})
