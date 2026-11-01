import { describe, expect, it } from 'vitest'
import { findSha256ForFile } from './sha256Sums'

describe('findSha256ForFile', () => {
  const sums = [
    'a'.repeat(64) + '  aria2c',
    'b'.repeat(64) + '  yt-dlp.exe',
    'c'.repeat(64) + '  yt-dlp_macos',
    'd'.repeat(64) + ' *yt-dlp_linux',
    ''
  ].join('\n')

  it('按文件名精确匹配', () => {
    expect(findSha256ForFile(sums, 'yt-dlp.exe')).toBe('b'.repeat(64))
    expect(findSha256ForFile(sums, 'yt-dlp_macos')).toBe('c'.repeat(64))
  })

  it('兼容二进制模式的 * 前缀', () => {
    expect(findSha256ForFile(sums, 'yt-dlp_linux')).toBe('d'.repeat(64))
  })

  it('不做子串匹配', () => {
    expect(findSha256ForFile(sums, 'yt-dlp')).toBeNull()
    expect(findSha256ForFile(sums, 'yt-dlp_linux_aarch64')).toBeNull()
  })

  it('格式异常的行被忽略', () => {
    expect(findSha256ForFile('not-a-hash  yt-dlp.exe', 'yt-dlp.exe')).toBeNull()
  })
})
