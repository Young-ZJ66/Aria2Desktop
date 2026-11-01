import { describe, expect, it } from 'vitest'
import { findYtdlpChecksum, resolveYtdlpAsset } from './ytdlpAssets'

describe('resolveYtdlpAsset', () => {
  it('Windows 各架构映射到对应的单文件 exe', () => {
    expect(resolveYtdlpAsset('win32', 'x64')?.fileName).toBe('yt-dlp.exe')
    expect(resolveYtdlpAsset('win32', 'ia32')?.fileName).toBe('yt-dlp_x86.exe')
    expect(resolveYtdlpAsset('win32', 'arm64')?.fileName).toBe('yt-dlp_arm64.exe')
    // 落盘统一用 yt-dlp.exe，后续执行/替换路径不随架构变化
    expect(resolveYtdlpAsset('win32', 'ia32')?.executable).toBe('yt-dlp.exe')
  })

  it('macOS 两个架构共用通用二进制', () => {
    expect(resolveYtdlpAsset('darwin', 'x64')?.fileName).toBe('yt-dlp_macos')
    expect(resolveYtdlpAsset('darwin', 'arm64')?.fileName).toBe('yt-dlp_macos')
  })

  it('Linux 按架构选择官方单文件', () => {
    expect(resolveYtdlpAsset('linux', 'x64')?.fileName).toBe('yt-dlp_linux')
    expect(resolveYtdlpAsset('linux', 'arm64')?.fileName).toBe('yt-dlp_linux_aarch64')
  })

  it('不支持的平台返回 null（调用方回退到手动安装）', () => {
    expect(resolveYtdlpAsset('linux', 'arm')).toBeNull()
    expect(resolveYtdlpAsset('freebsd', 'x64')).toBeNull()
  })
})

describe('findYtdlpChecksum', () => {
  const sums = [
    'a'.repeat(64) + '  yt-dlp',
    'b'.repeat(64) + '  yt-dlp.exe',
    'c'.repeat(64) + '  yt-dlp_macos',
    'd'.repeat(64) + ' *yt-dlp_linux',
    ''
  ].join('\n')

  it('按文件名精确匹配', () => {
    expect(findYtdlpChecksum(sums, 'yt-dlp.exe')).toBe('b'.repeat(64))
    expect(findYtdlpChecksum(sums, 'yt-dlp_macos')).toBe('c'.repeat(64))
  })

  it('兼容二进制模式的 * 前缀', () => {
    expect(findYtdlpChecksum(sums, 'yt-dlp_linux')).toBe('d'.repeat(64))
  })

  it('不做子串匹配（yt-dlp 不能命中 yt-dlp.exe）', () => {
    expect(findYtdlpChecksum(sums, 'yt-dlp_linux_aarch64')).toBeNull()
  })

  it('格式异常的行被忽略', () => {
    expect(findYtdlpChecksum('not-a-hash  yt-dlp.exe', 'yt-dlp.exe')).toBeNull()
  })
})
