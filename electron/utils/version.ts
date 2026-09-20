/**
 * 版本号比较（纯函数，独立于 electron / 网络层，便于单测）。
 */

/**
 * 简单的语义化版本比较：a > b 返回 1，a < b 返回 -1，相等返回 0。
 *
 * 语义（与原实现一致，勿改）：
 * - 按 "." 分段做数值比较，段数不同时缺位补 0（"1.0" 与 "1.0.0" 视为相等）
 * - 非数字段解析为 NaN 时按 0 处理（因此不处理 -beta / +build 等预发布后缀：
 *   "1.0.0-beta" 等价于 "1.0.0"）
 * - **调用方需先剥离 `v` 前缀**（如 tag `v1.0.7` → `1.0.7`），
 *   否则 "v1" 段会按 0 参与比较，结果不符合预期
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0
    const nb = pb[i] || 0
    if (na > nb) return 1
    if (na < nb) return -1
  }
  return 0
}
