/**
 * 连接失败的诊断辅助
 *
 * 背景（实测发现）：系统代理开着时，Chromium 页面里对 `127.0.0.1` 这类 IP 字面量的
 * 请求可能被代理拦截而失败，而 `localhost` 因 Chromium 的隐式绕过规则仍直连。
 * 探针实测矩阵：同一页面里 `127.0.0.1:<port>` 全部 Failed to fetch、
 * `localhost:<port>` 正常返回。用户把主机填成 IP 字面量并连接失败时，
 * 提示里追加一条"试试 localhost"能省掉一轮排查。
 */

/** 环回 IP 字面量判定（只认 127.0.0.1 与 ::1；localhost 是主机名，不在其列） */
export function isLoopbackLiteral(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  return normalized === '127.0.0.1' || normalized === '::1'
}

/** 网络层失败的特征：只有这类错误才值得怀疑代理（密钥错误等业务失败不算） */
const NETWORK_FAILURE_PATTERN = /ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|Failed to fetch|NetworkError|socket hang up|timeout/i

export function shouldSuggestProxyHint(input: { host: string; errorMessage: string }): boolean {
  return isLoopbackLiteral(input.host) && NETWORK_FAILURE_PATTERN.test(input.errorMessage)
}

/**
 * 组装连接失败的提示消息：环回 IP 字面量 + 网络层失败时，在基础消息后追加代理提示。
 * 其余情况原样返回基础消息。
 */
export function buildConnectionFailureMessage(input: {
  host: string
  error: unknown
  baseMessage: string
  proxyHint: string
}): string {
  if (!input.proxyHint) return input.baseMessage
  const rawMessage = input.error instanceof Error ? input.error.message : String(input.error || '')
  if (!shouldSuggestProxyHint({ host: input.host, errorMessage: rawMessage })) {
    return input.baseMessage
  }
  return `${input.baseMessage}\n${input.proxyHint}`
}
