/**
 * yt-dlp 按需下载的纯逻辑（平台资产映射）。
 *
 * 独立成文件是为了可单测：主进程服务（ytdlpService）会 import electron，
 * 而 vitest 里没有 Electron 运行时。
 */

/** GitHub Release 上与本应用安装路径对应的一个资产 */
export interface YtdlpAsset {
  /** Release 资产名（下载地址的最后一段） */
  fileName: string
  /** 安装到 userData 后的文件名（>= 平台的可执行名） */
  executable: string
  /** 下载体积（MB，整数），仅用于界面提示，不参与逻辑判断 */
  approxSizeMB: number
}

/**
 * 平台/架构 → 官方构建产物。
 *
 * 说明：
 * - Windows 用单文件 exe（自带 Python 运行时）；
 * - macOS 的 `yt-dlp_macos` 是 x64/arm64 通用二进制；
 * - Linux 官方只提供单文件可执行（armv7l 仅有 zip，不做自动安装）。
 */
const ASSETS: Record<string, YtdlpAsset> = {
  'win32-x64': { fileName: 'yt-dlp.exe', executable: 'yt-dlp.exe', approxSizeMB: 24 },
  'win32-ia32': { fileName: 'yt-dlp_x86.exe', executable: 'yt-dlp.exe', approxSizeMB: 19 },
  'win32-arm64': { fileName: 'yt-dlp_arm64.exe', executable: 'yt-dlp.exe', approxSizeMB: 23 },
  'darwin-x64': { fileName: 'yt-dlp_macos', executable: 'yt-dlp', approxSizeMB: 38 },
  'darwin-arm64': { fileName: 'yt-dlp_macos', executable: 'yt-dlp', approxSizeMB: 38 },
  'linux-x64': { fileName: 'yt-dlp_linux', executable: 'yt-dlp', approxSizeMB: 42 },
  'linux-arm64': { fileName: 'yt-dlp_linux_aarch64', executable: 'yt-dlp', approxSizeMB: 41 }
}

/** 返回当前平台可自动安装的资产；不支持的平台返回 null（UI 回退为手动安装提示） */
export function resolveYtdlpAsset(platform: NodeJS.Platform | string, arch: string): YtdlpAsset | null {
  return ASSETS[`${platform}-${arch}`] ?? null
}
