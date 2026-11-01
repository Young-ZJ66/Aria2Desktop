/**
 * ffmpeg 按需下载的纯逻辑（平台资产映射）。
 *
 * 为什么用 yt-dlp/FFmpeg-Builds：yt-dlp 官方推荐的构建来源，
 * 提供 Windows/Linux 的静态构建与官方 `checksums.sha256`。
 * macOS 没有官方自动构建，保留系统 PATH / Homebrew 安装方式。
 */

export interface FfmpegAsset {
  /** Release 资产名（下载地址的最后一段） */
  fileName: string
  /** 归档格式（决定用哪种解压参数） */
  archive: 'zip' | 'tar.xz'
  /** 下载体积（MB，整数），仅用于界面提示 */
  approxSizeMB: number
}

const ASSETS: Record<string, FfmpegAsset> = {
  'win32-x64': { fileName: 'ffmpeg-master-latest-win64-gpl-shared.zip', archive: 'zip', approxSizeMB: 91 },
  'win32-ia32': { fileName: 'ffmpeg-master-latest-win32-gpl-shared.zip', archive: 'zip', approxSizeMB: 77 },
  'win32-arm64': { fileName: 'ffmpeg-master-latest-winarm64-gpl-shared.zip', archive: 'zip', approxSizeMB: 65 },
  'linux-x64': { fileName: 'ffmpeg-master-latest-linux64-gpl.tar.xz', archive: 'tar.xz', approxSizeMB: 157 },
  'linux-arm64': { fileName: 'ffmpeg-master-latest-linuxarm64-gpl.tar.xz', archive: 'tar.xz', approxSizeMB: 133 }
}

/** 返回当前平台可自动安装的 ffmpeg 资产；不支持的平台（如 macOS）返回 null */
export function resolveFfmpegAsset(platform: NodeJS.Platform | string, arch: string): FfmpegAsset | null {
  return ASSETS[`${platform}-${arch}`] ?? null
}
