/**
 * 官方 `SHA2-256SUMS` / `checksums.sha256` 的解析（yt-dlp 与 ffmpeg 共用）。
 *
 * 独立成纯函数：不依赖 Electron，便于单测。
 */

/**
 * 从校验文件中取出指定文件的 SHA-256。
 *
 * 行格式为 `<64 位 hex>  <文件名>`（也可能带 `*` 前缀，如 GNU coreutils 的二进制模式）。
 * 找不到或格式异常返回 null——调用方应据此拒绝安装，绝不"校验缺失就放行"。
 */
export function findSha256ForFile(sumsText: string, fileName: string): string | null {
  for (const rawLine of sumsText.split(/\r?\n/)) {
    const match = /^([0-9a-f]{64})\s+\*?(.+?)\s*$/i.exec(rawLine.trim())
    if (match && match[2] === fileName) {
      return match[1].toLowerCase()
    }
  }
  return null
}
