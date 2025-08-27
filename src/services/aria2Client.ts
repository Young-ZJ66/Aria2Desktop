import axios, { AxiosInstance } from 'axios'
import type {
  Aria2Config,
  Aria2RpcRequest,
  Aria2RpcResponse,
  Aria2RpcNotification,
  Aria2Task,
  Aria2GlobalStat,
  Aria2Version,
  Aria2Option,
  Aria2Methods
} from '@/types/aria2'

export class Aria2Client {
  private config: Aria2Config
  private httpClient: AxiosInstance
  private wsClient: WebSocket | null = null
  private requestId = 0
  private pendingRequests = new Map<string | number, {
    resolve: (value: any) => void
    reject: (reason: any) => void
  }>()
  private eventListeners = new Map<string, Function[]>()

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

  private buildRpcRequest(method: string, params: any[] = []): Aria2RpcRequest {
    // 如果有secret，添加到参数开头
    if (this.config.secret) {
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
  async callHttp<T = any>(method: string, params: any[] = []): Promise<T> {
    const request = this.buildRpcRequest(method, params)

    console.log('Aria2 RPC Request:', {
      method,
      params,
      url: this.httpClient.defaults.baseURL
    })

    try {
      const response = await this.httpClient.post('', request)
      const rpcResponse: Aria2RpcResponse<T> = response.data

      console.log('Aria2 RPC Response:', rpcResponse)

      if (rpcResponse.error) {
        console.error('Aria2 RPC Error:', rpcResponse.error)
        throw new Error(`Aria2 RPC Error (${rpcResponse.error.code}): ${rpcResponse.error.message}`)
      }

      return rpcResponse.result as T
    } catch (error) {
      console.error('Aria2 HTTP Error:', error)
      if (axios.isAxiosError(error)) {
        throw new Error(`HTTP Error: ${error.message}`)
      }
      throw error
    }
  }

  // WebSocket连接
  async connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = `${this.config.protocol === 'https' ? 'wss' : 'ws'}://${this.config.host}:${this.config.port}${this.config.path || '/jsonrpc'}`
      
      this.wsClient = new WebSocket(wsUrl)

      this.wsClient.onopen = () => {
        this.emit('connected')
        resolve()
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
      }

      this.wsClient.onerror = (error) => {
        this.emit('error', error)
        reject(error)
      }
    })
  }

  private handleWebSocketMessage(data: Aria2RpcResponse | Aria2RpcNotification) {
    // 处理RPC响应
    if ('id' in data && data.id !== undefined) {
      const pending = this.pendingRequests.get(data.id)
      if (pending) {
        this.pendingRequests.delete(data.id)
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
      
      // 处理特定的通知事件
      switch (data.method) {
        case 'aria2.onDownloadStart':
          this.emit('downloadStart', data.params[0])
          break
        case 'aria2.onDownloadPause':
          this.emit('downloadPause', data.params[0])
          break
        case 'aria2.onDownloadStop':
          this.emit('downloadStop', data.params[0])
          break
        case 'aria2.onDownloadComplete':
          this.emit('downloadComplete', data.params[0])
          break
        case 'aria2.onDownloadError':
          this.emit('downloadError', data.params[0])
          break
        case 'aria2.onBtDownloadComplete':
          this.emit('btDownloadComplete', data.params[0])
          break
      }
    }
  }

  // WebSocket RPC调用
  async callWebSocket<T = any>(method: string, params: any[] = []): Promise<T> {
    if (!this.wsClient || this.wsClient.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected')
    }

    return new Promise((resolve, reject) => {
      const request = this.buildRpcRequest(method, params)
      this.pendingRequests.set(request.id, { resolve, reject })
      
      this.wsClient!.send(JSON.stringify(request))
      
      // 设置超时
      setTimeout(() => {
        if (this.pendingRequests.has(request.id)) {
          this.pendingRequests.delete(request.id)
          reject(new Error('Request timeout'))
        }
      }, 10000)
    })
  }

  // 统一的RPC调用方法
  async call<T = any>(method: string, params: any[] = []): Promise<T> {
    if (this.wsClient && this.wsClient.readyState === WebSocket.OPEN) {
      return this.callWebSocket<T>(method, params)
    } else {
      return this.callHttp<T>(method, params)
    }
  }

  // 事件监听
  on(event: string, listener: Function) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, [])
    }
    this.eventListeners.get(event)!.push(listener)
  }

  off(event: string, listener: Function) {
    const listeners = this.eventListeners.get(event)
    if (listeners) {
      const index = listeners.indexOf(listener)
      if (index > -1) {
        listeners.splice(index, 1)
      }
    }
  }

  private emit(event: string, ...args: any[]) {
    const listeners = this.eventListeners.get(event)
    if (listeners) {
      listeners.forEach(listener => listener(...args))
    }
  }

  // 断开连接
  disconnect() {
    if (this.wsClient) {
      this.wsClient.close()
      this.wsClient = null
    }
    this.pendingRequests.clear()
  }

  // 检查连接状态
  isConnected(): boolean {
    return this.wsClient?.readyState === WebSocket.OPEN
  }

  // 更新配置
  updateConfig(config: Partial<Aria2Config>) {
    this.config = { ...this.config, ...config }
    this.httpClient = this.createHttpClient()
  }
}
