import axios, { AxiosInstance } from 'axios'
import type {
  Aria2Config,
  Aria2RpcRequest,
  Aria2RpcResponse,
  Aria2RpcNotification
} from '@/types/aria2'

/** 客户端事件类型 */
export type Aria2ClientEvent =
  | 'connected'
  | 'disconnected'
  | 'error'
  | 'notification'
  | 'downloadStart'
  | 'downloadPause'
  | 'downloadStop'
  | 'downloadComplete'
  | 'downloadError'
  | 'btDownloadComplete'

export type Aria2EventListener = (...args: unknown[]) => void

export class Aria2Client {
  private config: Aria2Config
  private httpClient: AxiosInstance
  private wsClient: WebSocket | null = null
  private requestId = 0
  private pendingRequests = new Map<number, {
    resolve: (value: unknown) => void
    reject: (reason: unknown) => void
    timer: ReturnType<typeof setTimeout>
  }>()
  private eventListeners = new Map<string, Aria2EventListener[]>()
  /** 连接阶段未完成的 settle 函数，disconnect 时用于立即结束挂起的 connect() */
  private pendingConnectSettle: ((err?: Error) => void) | null = null
  /** 是否允许断线自动重连（connect 置 true，手动 disconnect 置 false） */
  private shouldReconnect = false
  /** 本次会话是否成功建立过 WS 连接（首次失败交给 HTTP 回退，不自动重连） */
  private everConnected = false
  /** 自动重连尝试次数（用于指数退避） */
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  constructor(config: Aria2Config) {
    this.config = config
    this.httpClient = this.createHttpClient()
  }

  private createHttpClient(): AxiosInstance {
    const baseURL = `${this.config.protocol}://${this.config.host}:${this.config.port}${this.config.path || '/jsonrpc'}`

    return axios.create({
      baseURL,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json'
      }
    })
  }

  private getNextRequestId(): number {
    return ++this.requestId
  }

  private buildRpcRequest(method: string, params: unknown[] = []): Aria2RpcRequest {
    // 如果有secret，添加到参数开头
    if (this.config.secret) {
      // 安全提示：HTTP 协议 + 非本机地址时 secret 明文走线，存在泄露风险
      const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(this.config.host)
      if (this.config.protocol === 'http' && !isLocalHost) {
        console.warn(
          'Aria2 secret will be transmitted in plain text over HTTP to a non-local host. ' +
          'Consider using HTTPS/WSS or a local connection.'
        )
      }
      params = [`token:${this.config.secret}`, ...params]
    }

    return {
      jsonrpc: '2.0',
      id: this.getNextRequestId(),
      method,
      params
    }
  }

  // HTTP RPC调用
  async callHttp<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
    const request = this.buildRpcRequest(method, params)

    try {
      const response = await this.httpClient.post('', request)
      const rpcResponse: Aria2RpcResponse<T> = response.data

      // 校验响应结构，避免非 JSON-RPC 响应（如 HTML 错误页）进入后续逻辑
      if (!rpcResponse || typeof rpcResponse !== 'object') {
        throw new Error('Invalid RPC response')
      }

      if (rpcResponse.error) {
        console.error('Aria2 RPC Error:', rpcResponse.error)
        throw new Error(`Aria2 RPC Error (${rpcResponse.error.code}): ${rpcResponse.error.message}`)
      }

      return rpcResponse.result as T
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`HTTP Error: ${error.message}`)
      }
      throw error
    }
  }

  // WebSocket连接
  async connectWebSocket(): Promise<void> {
    // wss 用于 https/wss 协议，其余用 ws
    const wsProto = this.config.protocol === 'https' || this.config.protocol === 'wss' ? 'wss' : 'ws'
    const wsUrl = `${wsProto}://${this.config.host}:${this.config.port}${this.config.path || '/jsonrpc'}`

    // 标记允许断线自动重连（手动 disconnect 时取消）
    this.shouldReconnect = true

    return new Promise((resolve, reject) => {
      const connectTimeout = setTimeout(() => {
        this.wsClient?.close()
        reject(new Error('WebSocket connection timeout'))
      }, 10000)

      let settled = false
      const settle = (err?: Error) => {
        if (settled) return
        settled = true
        this.pendingConnectSettle = null
        clearTimeout(connectTimeout)
        if (err) reject(err)
        else resolve()
      }

      // 记录 settle，供连接过程中 disconnect() 立即结束挂起的 Promise
      this.pendingConnectSettle = settle

      this.createSocket(wsUrl, settle)
    })
  }

  /** 创建 WebSocket 并挂载事件处理；settle 用于结束首次连接的 Promise（重连时传 noop） */
  private createSocket(wsUrl: string, settle: (err?: Error) => void): void {
    this.wsClient = new WebSocket(wsUrl)

    this.wsClient.onopen = () => {
      this.everConnected = true
      this.reconnectAttempts = 0
      this.emit('connected')
      settle()
    }

    this.wsClient.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        this.handleWebSocketMessage(data)
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error)
      }
    }

    this.wsClient.onclose = () => {
      this.emit('disconnected')
      this.wsClient = null
      // 连接建立后断开：reject 所有在途请求，避免调用方挂起
      this.rejectAllPending('WebSocket connection closed')
      // 连接阶段断开（未触发 onerror 的场景），确保 Promise settle
      settle(new Error('WebSocket connection closed'))
      // 曾成功连接过且未被手动断开：自动重连（aria2 重启等瞬时断开场景自愈）
      if (this.shouldReconnect && this.everConnected) {
        this.scheduleReconnect()
      }
    }

    this.wsClient.onerror = (error) => {
      this.emit('error', error)
      settle(new Error('WebSocket connection error'))
    }
  }

  /** 指数退避自动重连（1s 起步，最长 30s；重连成功后由 onopen 重置计数） */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000)
    this.reconnectAttempts++
    console.warn(`WebSocket disconnected, auto reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`)

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.shouldReconnect) return
      const wsProto = this.config.protocol === 'https' || this.config.protocol === 'wss' ? 'wss' : 'ws'
      const wsUrl = `${wsProto}://${this.config.host}:${this.config.port}${this.config.path || '/jsonrpc'}`
      this.createSocket(wsUrl, () => { /* 重连结果由事件驱动，无需结束任何 Promise */ })
    }, delay)
  }

  /** 拒绝并清理所有在途请求 */
  private rejectAllPending(reason: string) {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer)
      this.pendingRequests.delete(id)
      pending.reject(new Error(reason))
    }
  }

  private handleWebSocketMessage(data: Aria2RpcResponse | Aria2RpcNotification) {
    // 处理RPC响应
    if ('id' in data && data.id !== undefined) {
      const pending = this.pendingRequests.get(Number(data.id))
      if (pending) {
        clearTimeout(pending.timer)
        this.pendingRequests.delete(Number(data.id))
        if (data.error) {
          pending.reject(new Error(`Aria2 RPC Error: ${data.error.message}`))
        } else {
          pending.resolve(data.result)
        }
      }
    }
    // 处理通知
    else if ('method' in data) {
      this.emit('notification', data)

      // 处理特定的通知事件（params 可能缺失，使用可选链避免取下标抛错）
      switch (data.method) {
        case 'aria2.onDownloadStart':
          this.emit('downloadStart', data.params?.[0])
          break
        case 'aria2.onDownloadPause':
          this.emit('downloadPause', data.params?.[0])
          break
        case 'aria2.onDownloadStop':
          this.emit('downloadStop', data.params?.[0])
          break
        case 'aria2.onDownloadComplete':
          this.emit('downloadComplete', data.params?.[0])
          break
        case 'aria2.onDownloadError':
          this.emit('downloadError', data.params?.[0])
          break
        case 'aria2.onBtDownloadComplete':
          this.emit('btDownloadComplete', data.params?.[0])
          break
      }
    }
  }

  // WebSocket RPC调用
  async callWebSocket<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
    if (!this.wsClient || this.wsClient.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected')
    }

    return new Promise((resolve, reject) => {
      const request = this.buildRpcRequest(method, params)

      const timer = setTimeout(() => {
        if (this.pendingRequests.has(request.id as number)) {
          this.pendingRequests.delete(request.id as number)
          reject(new Error('Request timeout'))
        }
      }, 10000)

      this.pendingRequests.set(request.id as number, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer
      })

      // 检查通过后 socket 可能恰好关闭，send 同步抛错时清理在途请求并 reject
      try {
        this.wsClient!.send(JSON.stringify(request))
      } catch (err) {
        clearTimeout(timer)
        this.pendingRequests.delete(request.id as number)
        reject(err instanceof Error ? err : new Error('WebSocket send failed'))
      }
    })
  }

  // 统一的RPC调用方法
  async call<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
    if (this.wsClient && this.wsClient.readyState === WebSocket.OPEN) {
      return this.callWebSocket<T>(method, params)
    } else {
      return this.callHttp<T>(method, params)
    }
  }

  // 事件监听
  on(event: Aria2ClientEvent, listener: Aria2EventListener) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, [])
    }
    this.eventListeners.get(event)!.push(listener)
  }

  off(event: Aria2ClientEvent, listener: Aria2EventListener) {
    const listeners = this.eventListeners.get(event)
    if (listeners) {
      const index = listeners.indexOf(listener)
      if (index > -1) {
        listeners.splice(index, 1)
      }
    }
  }

  private emit(event: Aria2ClientEvent, ...args: unknown[]) {
    const listeners = this.eventListeners.get(event)
    if (listeners) {
      listeners.forEach(listener => listener(...args))
    }
  }

  // 断开连接
  disconnect() {
    // 取消自动重连
    this.shouldReconnect = false
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    // 连接尚未完成时，立即结束挂起的 connect() Promise（否则需等待超时才 settle）
    if (this.pendingConnectSettle) {
      this.pendingConnectSettle(new Error('Client disconnected'))
    }
    if (this.wsClient) {
      // 移除事件回调，避免 close 时重复触发 disconnected/rejectAllPending
      this.wsClient.onclose = null
      this.wsClient.onerror = null
      this.wsClient.close()
      this.wsClient = null
    }
    this.rejectAllPending('Client disconnected')
  }

  // 检查连接状态
  isConnected(): boolean {
    return this.wsClient?.readyState === WebSocket.OPEN
  }

  // 更新配置（重建 HTTP 客户端并断开旧 WS，重连由调用方决定）
  updateConfig(config: Partial<Aria2Config>) {
    const protocolChanged = config.host !== undefined || config.port !== undefined ||
      config.protocol !== undefined || config.path !== undefined

    this.config = { ...this.config, ...config }
    this.httpClient = this.createHttpClient()

    if (protocolChanged && this.wsClient) {
      this.disconnect()
    }
  }
}
