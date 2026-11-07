import * as http from 'http'
import * as https from 'https'

/**
 * aria2 JSON-RPC（HTTP）统一调用工具。
 * 主进程各服务（Aria2Controller / PluginManager / SpeedScheduler / Aria2ProcessManager）
 * 共用同一实现，避免超时、错误处理策略分叉。
 */

/** RPC 请求参数 */
export interface Aria2RpcOptions {
  /** aria2 RPC 主机，默认 127.0.0.1（远程连接预设会传远端地址） */
  host?: string
  /** RPC 端口 */
  port: number
  /** http 或 https（wss/ws 在 HTTP JSON-RPC 调用中分别映射为 https/http） */
  protocol?: 'http' | 'https'
  /** JSON-RPC 路径，默认 /jsonrpc */
  path?: string
  /** RPC 密钥（空串表示无密钥） */
  secret?: string
  /** JSON-RPC 方法名，如 aria2.getVersion */
  method: string
  /** 方法参数（token 会自动前置） */
  params?: unknown[]
  /** 超时（毫秒），默认 5000 */
  timeoutMs?: number
  /** 自定义 CA 证书（PEM），用于自签名/私有 CA 的 HTTPS RPC */
  ca?: string
  /** 是否允许自签名证书；仅对 https 生效，默认 false */
  allowSelfSigned?: boolean
}

/** 请求序号（仅用于 JSON-RPC id，单进程内递增即可） */
let requestSeq = 0

/**
 * RPC 协议层错误（aria2 正常返回了 JSON-RPC 响应，但 error 字段非空，如密钥不匹配、方法不存在）。
 * 与传输层错误（连不上 / 超时 / 端口被非 aria2 服务占用）区分开，
 * 供就绪探测判断"RPC 服务是否已起来"：协议层有响应即视为服务已就绪。
 */
export class Aria2RpcError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'Aria2RpcError'
  }
}

/**
 * 启动前探测 RPC 端口得到的占用情况。
 *
 * 用途：把"端口上已经有别的引擎"这件事说清楚。否则现场只是一串
 * "新引擎异常退出 → 3 秒后重启"，随后还会出现看不懂的
 * "保存会话 Unauthorized / 请求关闭失败"（2026-09-30 的日志就是这么留下来的）。
 */
export type PortOccupancy =
  /** 端口空闲——正常启动路径 */
  | 'free'
  /** 有 aria2 且认我们的密钥：多半是上次没退干净的残留实例 */
  | 'aria2-with-our-secret'
  /** 有 aria2 但不认我们的密钥：外来实例 / 别的 aria2 客户端 */
  | 'aria2-with-other-secret'
  /** 有服务在监听但不是 aria2（响应不是 JSON-RPC）：端口被别的程序占用 */
  | 'non-aria2-service'
  /** 超时等无法下结论的情况 */
  | 'unknown'

/**
 * 把一次端口探测的结果分类（纯函数，便于单测）。
 *
 * @param error 探测调用抛出的错误；**调用成功时传 null/undefined**（= 有 aria2 且在认我们的密钥）
 */
export function classifyRpcPortProbe(error?: unknown): PortOccupancy {
  if (error === null || error === undefined) return 'aria2-with-our-secret'

  const message = error instanceof Error ? error.message : String(error)

  if (/Aria2 RPC Error:.*Unauthorized/i.test(message)) return 'aria2-with-other-secret'
  // 协议层有响应（哪怕它嫌参数不对）说明对端确实是 aria2，且已通过 token 校验
  if (error instanceof Aria2RpcError) return 'aria2-with-our-secret'
  if (/Invalid JSON-RPC response/i.test(message)) return 'non-aria2-service'
  if (/ECONNREFUSED|ECONNRESET|EPIPE/i.test(message)) return 'free'
  return 'unknown'
}

/**
 * 通过本机 HTTP 调用 aria2 JSON-RPC。
 * - 成功：resolve 结果字段
 * - RPC 返回 error / 网络错误 / 超时 / 响应非 JSON-RPC 结构：reject Error
 */
export function callAria2Rpc(options: Aria2RpcOptions): Promise<unknown> {
  const {
    host = '127.0.0.1',
    port,
    protocol = 'http',
    path = '/jsonrpc',
    secret,
    method,
    params = [],
    timeoutMs = 5000,
    ca,
    allowSelfSigned = false
  } = options

  return new Promise((resolve, reject) => {
    const rpcParams = secret ? [`token:${secret}`, ...params] : params
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: (++requestSeq).toString(36),
      method,
      params: rpcParams
    })

    const isHttps = protocol === 'https'
    const requestOptions: https.RequestOptions = {
      hostname: host,
      port,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      ...(isHttps
        ? {
          ...(ca ? { ca } : {}),
          ...(allowSelfSigned ? { rejectUnauthorized: false } : {})
        }
        : {})
    }
    const transport = isHttps ? https : http
    const req = transport.request(requestOptions, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        /**
         * 统一把"响应体不是 JSON-RPC"归为同一类错误：
         * 端口被其它进程占用时常见 HTML 错误页，JSON.parse 会抛语法错误，
         * 而该错误信息（`Unexpected token '<'…`）对用户/日志没有意义，
         * 因此这里统一成可读的 'Invalid JSON-RPC response'。
         * 注：TS lib 为 ES2020，不使用 Error 的 cause 选项。
         */
        let parsed: unknown
        try {
          parsed = JSON.parse(data)
        } catch {
          reject(new Error('Invalid JSON-RPC response'))
          return
        }

        if (parsed && typeof parsed === 'object' && 'jsonrpc' in parsed) {
          const response = parsed as { error?: { message?: string }; result?: unknown }
          if (response.error) {
            reject(new Aria2RpcError(`Aria2 RPC Error: ${response.error.message}`))
          } else {
            resolve(response.result)
          }
        } else {
          reject(new Error('Invalid JSON-RPC response'))
        }
      })
      res.on('error', reject)
    })

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('Aria2 RPC request timeout'))
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}
