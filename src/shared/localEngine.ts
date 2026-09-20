/**
 * 本机 aria2 引擎地址判定（主进程与渲染层共用）。
 *
 * 为什么要共享：连接预设的密钥需要与引擎密钥对齐，判定"某个连接预设是否指向本机引擎"
 * 在主进程（同步预设）与渲染层（补齐预设）各用一次。两端口径必须一致，
 * 否则会出现"引擎要求 token、前端不发 token"式的连接失败。
 *
 * 注意：本文件不得 import electron，否则会污染渲染层打包。
 */

/** 默认 RPC 端口（与 aria2 默认值一致） */
export const DEFAULT_RPC_PORT = 6800

/** 视为"本机"的主机名 */
export const LOCAL_ENGINE_HOSTS: ReadonlySet<string> = new Set([
  'localhost',
  '127.0.0.1',
  '::1'
])

/**
 * 判断给定地址是否指向本机引擎。
 * @param host 待判定主机名
 * @param port 待判定端口
 * @param enginePort 当前本机引擎端口（缺省按默认端口处理）
 */
export function isLocalEngineAddress(
  host: string | undefined,
  port: number | string | undefined,
  enginePort: number | undefined
): boolean {
  if (!LOCAL_ENGINE_HOSTS.has(String(host || '').toLowerCase())) return false
  return Number(port) === (Number(enginePort) || DEFAULT_RPC_PORT)
}
