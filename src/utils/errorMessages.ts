/**
 * 用户友好的错误消息映射
 * 将底层技术错误转换为用户可理解的提示
 */

/** 技术错误关键词到用户友好消息的映射 */
const ERROR_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  // 连接相关
  { pattern: /ECONNREFUSED/i, message: '无法连接到服务器，请检查 Aria2 是否已启动' },
  { pattern: /ECONNRESET/i, message: '连接被重置，服务器可能已关闭' },
  { pattern: /ETIMEDOUT/i, message: '连接超时，请检查网络或服务器地址' },
  { pattern: /ENOTFOUND/i, message: '找不到服务器，请检查主机地址' },
  { pattern: /EHOSTUNREACH/i, message: '无法到达服务器，请检查网络连接' },
  { pattern: /socket hang up/i, message: '连接中断，请重试' },
  { pattern: /timeout/i, message: '操作超时，请稍后重试' },
  { pattern: /WebSocket.*closed/i, message: 'WebSocket 连接已断开' },
  { pattern: /WebSocket.*error/i, message: 'WebSocket 连接失败，请检查服务器地址' },

  // RPC 相关
  { pattern: /Aria2 RPC Error/i, message: 'Aria2 服务器返回错误' },
  { pattern: /GID.*not found/i, message: '任务不存在或已被删除' },
  { pattern: /not acceptable option/i, message: '不支持的下载选项' },
  { pattern: /resource not found/i, message: '下载资源不存在' },

  // 文件相关
  { pattern: /ENOENT/i, message: '文件或目录不存在' },
  { pattern: /EACCES/i, message: '没有权限访问该文件或目录' },
  { pattern: /EPERM/i, message: '操作被拒绝，权限不足' },
  { pattern: /EBUSY/i, message: '文件正在被其他程序使用' },
  { pattern: /ENOSPC/i, message: '磁盘空间不足' },
  { pattern: /Path outside allowed/i, message: '文件路径不在允许的目录范围内' },

  // 下载相关
  { pattern: /No URIs found/i, message: '没有找到可用的下载链接' },
  { pattern: /Too many redirects/i, message: '重定向次数过多，下载地址可能无效' },
  { pattern: /Download failed/i, message: '下载失败' }
]

/**
 * 将技术错误转换为用户友好的消息
 * @param error 原始错误（Error 对象或字符串）
 * @param fallback 兜底消息
 */
export function getUserFriendlyError(error: unknown, fallback = '操作失败，请稍后重试'): string {
  const rawMessage = error instanceof Error ? error.message : String(error || '')

  for (const { pattern, message } of ERROR_PATTERNS) {
    if (pattern.test(rawMessage)) {
      return message
    }
  }

  // 如果没有匹配到已知模式，返回兜底消息而非原始错误
  return fallback
}

/**
 * 格式化操作失败消息（操作名称 + 用户友好错误）
 */
export function formatOperationError(operation: string, error: unknown): string {
  const friendlyError = getUserFriendlyError(error)
  return `${operation}：${friendlyError}`
}
