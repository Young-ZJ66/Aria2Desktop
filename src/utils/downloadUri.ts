/**
 * 下载链接的协议白名单与校验。
 *
 * 与 UriPane 里那份实现保持一致（http/https/ftp/sftp/magnet），
 * 抽出来供全局拖拽与流媒体页复用：正则各写一套时最容易漏掉 sftp，
 * 漏掉的结果是用户拖入的 sftp 链接被静默忽略。
 */

/** aria2 支持的下载协议白名单 */
export const SUPPORTED_URI_SCHEMES: readonly string[] = ['http:', 'https:', 'ftp:', 'sftp:', 'magnet:']

/** 流媒体（yt-dlp）只吃 http/https，magnet/ftp 不在支持范围内 */
export const STREAM_URL_SCHEMES: readonly string[] = ['http:', 'https:']

/**
 * 校验单个下载 URI：协议在白名单内，且（除 magnet 外）能被 URL 解析。
 * magnet 是特殊格式，URL 解析器认不出来，只能按前缀判断。
 */
export function isSupportedDownloadUri(uri: string): boolean {
  const value = uri.trim()
  if (!value) return false
  if (value.startsWith('magnet:')) return true
  try {
    const { protocol } = new URL(value)
    return SUPPORTED_URI_SCHEMES.includes(protocol)
  } catch {
    return false
  }
}

/**
 * 从任意文本里挑出受支持的链接。
 * 拖入的文本可能包含多行（每行一个链接）或被空白分隔的多个链接，
 * 这里统一按空白切分，再逐个校验，顺序保持不变。
 */
export function extractSupportedUris(text: string): string[] {
  return text
    .split(/\s+/)
    .map(item => item.trim())
    .filter(item => isSupportedDownloadUri(item))
}

/**
 * 流媒体链接校验：非空、协议为 http/https、且带主机名。
 * yt-dlp 遇到 ftp/magnet 或缺少主机的链接会直接失败，提前拦下能给出更清楚的提示。
 */
export function isValidStreamUrl(url: string): boolean {
  const value = url.trim()
  if (!value) return false
  try {
    const { protocol, hostname } = new URL(value)
    return STREAM_URL_SCHEMES.includes(protocol) && hostname.length > 0
  } catch {
    return false
  }
}
