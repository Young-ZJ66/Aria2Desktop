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
