import { describe, expect, it } from 'vitest'
import { resolveFfmpegAsset } from './ffmpegAssets'

describe('resolveFfmpegAsset', () => {
  it('Windows 各架构使用共享库构建（体积比静态版小一半）', () => {
    expect(resolveFfmpegAsset('win32', 'x64')?.fileName).toBe('ffmpeg-master-latest-win64-gpl-shared.zip')
    expect(resolveFfmpegAsset('win32', 'ia32')?.fileName).toBe('ffmpeg-master-latest-win32-gpl-shared.zip')
    expect(resolveFfmpegAsset('win32', 'arm64')?.fileName).toBe('ffmpeg-master-latest-winarm64-gpl-shared.zip')
    expect(resolveFfmpegAsset('win32', 'x64')?.archive).toBe('zip')
  })

  it('Linux 按架构使用 tar.xz', () => {
    expect(resolveFfmpegAsset('linux', 'x64')?.archive).toBe('tar.xz')
    expect(resolveFfmpegAsset('linux', 'arm64')?.fileName).toBe('ffmpeg-master-latest-linuxarm64-gpl.tar.xz')
  })

  it('macOS 不做自动安装（官方无自动构建，走 PATH/Homebrew）', () => {
    expect(resolveFfmpegAsset('darwin', 'x64')).toBeNull()
    expect(resolveFfmpegAsset('darwin', 'arm64')).toBeNull()
  })
})
