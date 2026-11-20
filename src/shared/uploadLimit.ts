// 种子上传大小上限：把 aria2 的 rpc-max-request-size 折算成「原始文件字节上限」。
//
// 为什么要折算：.torrent/.metalink 经 aria2 RPC 上传时先转成 base64 塞进 JSON 请求体，
// base64 会把体积放大到约 4/3，再叠加 JSON 包裹的开销。原先固定按 1MiB 判文件大小，
// 既与实际配置不符（默认 rpc-max-request-size 是 2M），也会让接近上限的文件在提交时才失败。

import { parseSizeToUnit } from '@/utils/size'

/** aria2 的 rpc-max-request-size 默认值（2M） */
export const DEFAULT_RPC_MAX_REQUEST_BYTES = 2 * 1024 * 1024

/** JSON 请求体除 base64 内容外的固定开销预留（字段名、引号、其它选项） */
export const RPC_BODY_OVERHEAD_BYTES = 4096

/**
 * 解析引擎的 rpc-max-request-size（aria2 返回字节数，也可能带 K/M/G 后缀）。
 * 非法值/0 回退默认值：该选项为 0 表示不限制，但 RPC 仍受 HTTP 层限制，
 * 这里按默认 2M 处理更稳妥。
 */
export function parseRpcMaxRequestBytes(
  raw: string | string[] | number | null | undefined,
  fallback: number = DEFAULT_RPC_MAX_REQUEST_BYTES
): number {
  // Aria2Option 的值类型是 string | string[]（header 这类可重复选项才是数组）。
  // rpc-max-request-size 只会是单值，数组时取首项，避免整个上限判断失效。
  const value = Array.isArray(raw) ? raw[0] : raw
  const bytes = parseSizeToUnit(value, 'M') * 1024 * 1024
  if (!Number.isFinite(bytes) || bytes <= 0) return fallback
  return Math.round(bytes)
}

/**
 * 由 RPC 请求体上限推导可上传的原始文件上限。
 * base64 编码后长度 = 4 * ceil(n / 3)，即 n 约等于 limit * 3 / 4；
 * 再减去请求体其它字段的开销，保证编码后的整个请求体不超限。
 */
export function maxUploadFileBytes(
  rpcMaxRequestBytes: number,
  overheadBytes: number = RPC_BODY_OVERHEAD_BYTES
): number {
  if (!Number.isFinite(rpcMaxRequestBytes) || rpcMaxRequestBytes <= 0) return 0
  const budget = rpcMaxRequestBytes - Math.max(0, overheadBytes)
  if (budget <= 0) return 0
  // 向下取整到 3 的倍数，避免 base64 末尾补位把请求体顶到上限之外
  return Math.floor((budget * 3) / 4 / 3) * 3
}
