import { describe, expect, it } from 'vitest'
import { resolveYtdlpAsset } from './ytdlpAssets'

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
