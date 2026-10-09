/**
 * 渲染层请求主进程打开外部链接时的判定（纯逻辑，可单测）。
 *
 * 为什么不只判协议：`shell.openExternal` 会把 URL 交给系统处理程序。只放行 http/https
 * 仍然等于给渲染层一个"打开任意站点"的能力——渲染层里会出现取自远端的字符串
 * （下载文件名、插件注入的界面等）。因此收紧为 **https + 站点白名单**：
 * 目前只有浏览器扩展商店一个站点，将来确实需要第二个时再往白名单里加。
 *
 * 与 `WindowController` 里 `setWindowOpenHandler` 的协议白名单是两件事：那条管
 * 页面自己发起的 `window.open`，这条管"渲染层明确请求主进程打开"的通道。
 */

/** 允许由渲染层请求打开的站点（只写主机名，不含协议与路径） */
export const ALLOWED_EXTERNAL_HOSTS = ['microsoftedge.microsoft.com']

/**
 * 该 URL 是否允许交给系统浏览器打开。
 *
 * 主机名按"完全相等或子域"匹配——注意 `endsWith('.host')` 而非 `endsWith(name)`，
 * 否则 `microsoftedge.microsoft.com.evil.com` 这类仿冒域名会被误放行。
 */
export function isAllowedExternalUrl(raw: unknown): boolean {
  if (typeof raw !== 'string' || !raw) return false
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:') return false
    const host = url.hostname.toLowerCase()
    return ALLOWED_EXTERNAL_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
  } catch {
    return false
  }
}
