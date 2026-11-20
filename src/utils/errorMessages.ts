/**
 * 用户友好的错误消息映射
 *
 * 把底层技术错误转换为**当前语言**下的提示：映射表里存的是 i18n key（`errors.*`），
 * 取值时才经 `i18n.global.t` 求值。此前这里写死中文，导致英文界面下所有错误提示
 * 仍是中文（连接失败、磁盘满、权限不足等都走这条路径）。
 *
 * 依赖 `@/i18n` 而不是组件的 `useI18n()`：本模块被 store / composable 在任意上下文调用，
 * 拿不到组件实例；`i18n.global` 始终反映当前 locale，语言切换后立即生效。
 */
import i18n from '@/i18n'

/** 技术错误关键词到 i18n key 的映射（顺序即优先级） */
const ERROR_PATTERNS: Array<{ pattern: RegExp; key: string }> = [
  // TLS/代理相关放最前：握手失败常伴随 ECONNRESET/timeout 字样（远端强制关闭连接），
  // 具体原因必须优先于泛化文案命中。实测原文："SSL/TLS handshake failure: Error:
  // 远程主机强迫关闭了一个现有的连接。 (2746)"
  { pattern: /SSL?[/ ]?TLS handshake|handshake failure|TLS handshake/i, key: 'errors.tlsHandshake' },
  { pattern: /ERR_PROXY|proxy/i, key: 'errors.proxy' },
  // Chromium 网络栈的 net::ERR_* 码（D-45）：渲染进程里 fetch/下载失败只能拿到这种码，
  // 没有 errno 可用。必须排在 /certificate|CERT_/ 之前——ERR_CERT_* 会被 CERT_ 的泛化
  // 规则抢先命中，用户看到的就变成笼统的"证书"而不是更准确的分类。
  { pattern: /ERR_CERT_|ERR_BAD_SSL_CLIENT_AUTH_CERT/i, key: 'errors.errCertInvalid' },
  { pattern: /ERR_SSL_|ERR_BAD_SSL/i, key: 'errors.errSslProtocol' },
  { pattern: /ERR_CONNECTION_REFUSED/i, key: 'errors.errConnectionRefused' },
  { pattern: /ERR_CONNECTION_TIMED_OUT|ERR_TIMED_OUT/i, key: 'errors.errConnectionTimedOut' },
  { pattern: /ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_CONNECTION_ABORTED/i, key: 'errors.errConnectionReset' },
  { pattern: /ERR_NAME_NOT_RESOLVED|ERR_NAME_RESOLUTION_FAILED|ERR_DNS_/i, key: 'errors.errNameNotResolved' },
  { pattern: /ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED/i, key: 'errors.errInternetDisconnected' },
  { pattern: /ERR_ADDRESS_UNREACHABLE|ERR_ADDRESS_INVALID|ERR_NETWORK_ACCESS_DENIED/i, key: 'errors.errAddressUnreachable' },
  { pattern: /certificate|CERT_|self.signed/i, key: 'errors.certificate' },

  // 连接相关
  { pattern: /ECONNREFUSED/i, key: 'errors.econnrefused' },
  { pattern: /ECONNRESET/i, key: 'errors.econnreset' },
  { pattern: /ETIMEDOUT/i, key: 'errors.etimedout' },
  { pattern: /ENOTFOUND/i, key: 'errors.enotfound' },
  { pattern: /EHOSTUNREACH/i, key: 'errors.ehostunreach' },
  { pattern: /socket hang up/i, key: 'errors.socketHangUp' },
  { pattern: /timeout/i, key: 'errors.timeout' },
  { pattern: /WebSocket.*closed/i, key: 'errors.wsClosed' },
  { pattern: /WebSocket.*error/i, key: 'errors.wsError' },

  // RPC 相关
  { pattern: /Aria2 RPC Error/i, key: 'errors.rpcError' },
  { pattern: /GID.*not found/i, key: 'errors.gidNotFound' },
  { pattern: /not acceptable option/i, key: 'errors.unsupportedOption' },
  { pattern: /resource not found/i, key: 'errors.resourceNotFound' },

  // 文件相关
  { pattern: /ENOENT/i, key: 'errors.enoent' },
  { pattern: /EACCES/i, key: 'errors.eacces' },
  { pattern: /EPERM/i, key: 'errors.eperm' },
  { pattern: /EBUSY/i, key: 'errors.ebusy' },
  { pattern: /ENOSPC/i, key: 'errors.enospc' },
  { pattern: /Path outside allowed/i, key: 'errors.pathOutsideAllowed' },

  // 下载相关
  { pattern: /No URIs found/i, key: 'errors.noUris' },
  { pattern: /Too many redirects/i, key: 'errors.tooManyRedirects' },
  { pattern: /Download failed/i, key: 'errors.downloadFailed' }
]

/**
 * 将技术错误转换为用户友好的消息。
 * @param error 原始错误（Error 对象或字符串）
 * @param fallback 已翻译的兜底消息；省略时使用 `errors.unknown`
 */
export function getUserFriendlyError(error: unknown, fallback?: string): string {
  const rawMessage = error instanceof Error ? error.message : String(error || '')

  for (const { pattern, key } of ERROR_PATTERNS) {
    if (pattern.test(rawMessage)) {
      return i18n.global.t(key)
    }
  }

  // 未命中已知模式：返回兜底消息而非原始错误（原始错误可能含技术细节）
  return fallback ?? i18n.global.t('errors.unknown')
}
