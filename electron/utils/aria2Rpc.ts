import * as http from 'http'

/**
 * aria2 JSON-RPC（HTTP）统一调用工具。
 * 主进程各服务（Aria2Controller / PluginManager / SpeedScheduler / Aria2ProcessManager）
 * 共用同一实现，避免超时、错误处理策略分叉。
 */

/** RPC 请求参数 */
export interface Aria2RpcOptions {
  /** aria2 RPC 端口 */
  port: number
  /** RPC 密钥（空串表示无密钥） */
  secret?: string
  /** JSON-RPC 方法名，如 aria2.getVersion */
  method: string
  /** 方法参数（token 会自动前置） */
  params?: unknown[]
  /** 超时（毫秒），默认 5000 */
  timeoutMs?: number
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
 * 通过本机 HTTP 调用 aria2 JSON-RPC。
 * - 成功：resolve 结果字段
 * - RPC 返回 error / 网络错误 / 超时 / 响应非 JSON-RPC 结构：reject Error
 */
export function callAria2Rpc(options: Aria2RpcOptions): Promise<unknown> {
  const { port, secret, method, params = [], timeoutMs = 5000 } = options

  return new Promise((resolve, reject) => {
    const rpcParams = secret ? [`token:${secret}`, ...params] : params
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: (++requestSeq).toString(36),
      method,
      params: rpcParams
    })

    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/jsonrpc',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
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
