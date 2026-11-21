import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Aria2Client } from './aria2Client'
import type { Aria2Config } from '@/types/aria2'

const h = vi.hoisted(() => ({
  post: vi.fn(),
  created: [] as Array<{ baseURL?: string, timeout?: number }>
}))

vi.mock('axios', () => {
  const axios = {
    create: (options: { baseURL?: string, timeout?: number }) => {
      h.created.push(options)
      return { post: h.post }
    },
    isAxiosError: (error: unknown) => Boolean(error && (error as { isAxiosError?: boolean }).isAxiosError)
  }
  return { default: axios }
})

class FakeWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static instances: FakeWebSocket[] = []

  url: string
  readyState = 0
  sent: string[] = []
  closeCalls = 0
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: ((error: unknown) => void) | null = null

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.closeCalls += 1
    this.readyState = FakeWebSocket.CLOSED
  }

  open() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }

  deliver(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) })
  }

  deliverRaw(data: string) {
    this.onmessage?.({ data })
  }

  serverClose() {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.()
  }

  fail(error: unknown = new Error('boom')) {
    this.onerror?.(error)
  }
}

function sockets(): FakeWebSocket[] {
  return FakeWebSocket.instances
}

function lastSocket(): FakeWebSocket {
  return FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
}

const BASE_CONFIG = { host: '127.0.0.1', port: 6800, protocol: 'http' as const }

/** 建客户端并完成一次 WS 握手，返回已连上的 socket */
async function connectedClient(config: Partial<Aria2Config> = {}) {
  const client = new Aria2Client({ ...BASE_CONFIG, ...config })
  const pending = client.connectWebSocket()
  const socket = lastSocket()
  socket.open()
  await pending
  return { client, socket }
}

beforeEach(() => {
  vi.useFakeTimers()
  h.created.length = 0
  h.post.mockReset()
  h.post.mockResolvedValue({ data: { result: 'ok' } })
  FakeWebSocket.instances.length = 0
  vi.stubGlobal('WebSocket', FakeWebSocket)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('HTTP 调用与请求构造', () => {
  it('默认把 /jsonrpc 拼到 baseURL 后，超时 10 秒', () => {
    new Aria2Client({ ...BASE_CONFIG })
    expect(h.created).toHaveLength(1)
    expect(h.created[0].baseURL).toBe('http://127.0.0.1:6800/jsonrpc')
    expect(h.created[0].timeout).toBe(10000)
  })

  it('自定义 path 生效', () => {
    new Aria2Client({ ...BASE_CONFIG, path: '/custom' })
    expect(h.created[0].baseURL).toBe('http://127.0.0.1:6800/custom')
  })

  it('请求体是 JSON-RPC 2.0 且 id 递增', async () => {
    const client = new Aria2Client({ ...BASE_CONFIG })
    await client.callHttp('aria2.getVersion')
    await client.callHttp('aria2.getVersion')
    const first = h.post.mock.calls[0][1]
    const second = h.post.mock.calls[1][1]
    expect(first.jsonrpc).toBe('2.0')
    expect(first.method).toBe('aria2.getVersion')
    expect(first.params).toEqual([])
    expect(second.id).toBe(first.id + 1)
  })

  it('有 secret 时插到 params 首位', async () => {
    const client = new Aria2Client({ ...BASE_CONFIG, secret: 's3cret' })
    await client.callHttp('aria2.addUri', [['http://a/1.zip']])
    expect(h.post.mock.calls[0][1].params).toEqual(['token:s3cret', ['http://a/1.zip']])
  })

  it('http + 远程主机时告警明文传输', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const client = new Aria2Client({ ...BASE_CONFIG, host: 'nas.example.com', secret: 's3cret' })
    await client.callHttp('aria2.getVersion')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('plain text')
  })

  it('本机地址不告警', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const host of ['localhost', '127.0.0.1', '::1']) {
      const client = new Aria2Client({ ...BASE_CONFIG, host, secret: 's3cret' })
      await client.callHttp('aria2.getVersion')
    }
    expect(warn).not.toHaveBeenCalled()
  })

  it('https 远程主机不告警', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const client = new Aria2Client({ ...BASE_CONFIG, host: 'nas.example.com', protocol: 'https', secret: 's3cret' })
    await client.callHttp('aria2.getVersion')
    expect(warn).not.toHaveBeenCalled()
  })

  it('返回 result 字段', async () => {
    h.post.mockResolvedValue({ data: { result: { version: '1.37.0' } } })
    const client = new Aria2Client({ ...BASE_CONFIG })
    await expect(client.callHttp('aria2.getVersion')).resolves.toEqual({ version: '1.37.0' })
  })

  it('RPC error 抛成带错误码的异常', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    h.post.mockResolvedValue({ data: { error: { code: 1, message: 'Unauthorized' } } })
    const client = new Aria2Client({ ...BASE_CONFIG })
    await expect(client.callHttp('aria2.getVersion')).rejects.toThrow('Aria2 RPC Error (1): Unauthorized')
  })

  it('非对象响应按无效响应拒绝', async () => {
    h.post.mockResolvedValue({ data: '<html>502</html>' })
    const client = new Aria2Client({ ...BASE_CONFIG })
    await expect(client.callHttp('aria2.getVersion')).rejects.toThrow('Invalid RPC response')
  })

  it('axios 错误包成 HTTP Error', async () => {
    h.post.mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { isAxiosError: true }))
    const client = new Aria2Client({ ...BASE_CONFIG })
    await expect(client.callHttp('aria2.getVersion')).rejects.toThrow('HTTP Error: connect ECONNREFUSED')
  })

  it('非 axios 错误原样抛出，不套 HTTP Error 前缀', async () => {
    h.post.mockRejectedValue(new Error('boom'))
    const client = new Aria2Client({ ...BASE_CONFIG })
    await expect(client.callHttp('aria2.getVersion')).rejects.toThrow('boom')
  })
})

describe('WebSocket 连接', () => {
  it('http 用 ws 协议，默认路径 /jsonrpc', async () => {
    const { socket } = await connectedClient()
    expect(socket.url).toBe('ws://127.0.0.1:6800/jsonrpc')
  })

  it('https 与 wss 都走 wss 协议', async () => {
    const first = await connectedClient({ protocol: 'https' })
    expect(first.socket.url).toBe('wss://127.0.0.1:6800/jsonrpc')
    const second = await connectedClient({ protocol: 'wss' })
    expect(second.socket.url).toBe('wss://127.0.0.1:6800/jsonrpc')
  })

  it('连上后触发 connected 并置为已连接', async () => {
    const onConnected = vi.fn()
    const client = new Aria2Client({ ...BASE_CONFIG })
    client.on('connected', onConnected)
    const pending = client.connectWebSocket()
    const socket = lastSocket()
    socket.open()
    await pending
    expect(onConnected).toHaveBeenCalledTimes(1)
    expect(client.isConnected()).toBe(true)
  })

  it('10 秒未连上按超时拒绝并关掉 socket', async () => {
    const client = new Aria2Client({ ...BASE_CONFIG })
    const pending = client.connectWebSocket()
    const assertion = expect(pending).rejects.toThrow('WebSocket connection timeout')
    const socket = lastSocket()
    await vi.advanceTimersByTimeAsync(10000)
    await assertion
    expect(socket.closeCalls).toBe(1)
  })

  it('连接阶段 onerror 按错误拒绝并冒泡 error 事件', async () => {
    const onError = vi.fn()
    const client = new Aria2Client({ ...BASE_CONFIG })
    client.on('error', onError)
    const pending = client.connectWebSocket()
    const assertion = expect(pending).rejects.toThrow('WebSocket connection error')
    const socket = lastSocket()
    socket.fail(new Error('refused'))
    await assertion
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('从未连上就关闭时不自动重连（首次失败交给 HTTP 回退）', async () => {
    const onDisconnected = vi.fn()
    const client = new Aria2Client({ ...BASE_CONFIG })
    client.on('disconnected', onDisconnected)
    const pending = client.connectWebSocket()
    const assertion = expect(pending).rejects.toThrow('WebSocket connection closed')
    lastSocket().serverClose()
    await assertion
    expect(onDisconnected).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(30000)
    expect(sockets()).toHaveLength(1)
  })

  it('连接中调用 disconnect 让挂起的 connect 立刻失败', async () => {
    const client = new Aria2Client({ ...BASE_CONFIG })
    const pending = client.connectWebSocket()
    const assertion = expect(pending).rejects.toThrow('Client disconnected')
    client.disconnect()
    await assertion
    expect(client.isConnected()).toBe(false)
  })

  it('disconnect 摘掉 onclose/onerror，避免 close 时重复触发 disconnected', async () => {
    const { client, socket } = await connectedClient()
    client.disconnect()
    expect(socket.onclose).toBeNull()
    expect(socket.onerror).toBeNull()
    expect(socket.closeCalls).toBe(1)
    expect(client.isConnected()).toBe(false)
  })
})

describe('RPC 调用路由与超时', () => {
  it('WS 已连上时走 WebSocket，不发 HTTP', async () => {
    const { client, socket } = await connectedClient()
    const pending = client.call('aria2.getVersion')
    expect(socket.sent).toHaveLength(1)
    const request = JSON.parse(socket.sent[0])
    socket.deliver({ id: request.id, result: 'ws-result' })
    await expect(pending).resolves.toBe('ws-result')
    expect(h.post).not.toHaveBeenCalled()
  })

  it('未连上 WS 时回退到 HTTP', async () => {
    const client = new Aria2Client({ ...BASE_CONFIG })
    await expect(client.call('aria2.getVersion')).resolves.toBe('ok')
    expect(h.post).toHaveBeenCalledTimes(1)
  })

  it('callWebSocket 在未连接时直接抛错', async () => {
    const client = new Aria2Client({ ...BASE_CONFIG })
    await expect(client.callWebSocket('aria2.getVersion')).rejects.toThrow('WebSocket is not connected')
  })

  it('按 id 匹配响应，未知 id 忽略', async () => {
    const { client, socket } = await connectedClient()
    const pending = client.call('aria2.getVersion')
    const request = JSON.parse(socket.sent[0])
    socket.deliver({ id: request.id + 99, result: 'wrong' })
    socket.deliver({ id: request.id, result: 'right' })
    await expect(pending).resolves.toBe('right')
  })

  it('响应带 error 时拒绝', async () => {
    const { client, socket } = await connectedClient()
    const pending = client.call('aria2.getVersion')
    const assertion = expect(pending).rejects.toThrow('Aria2 RPC Error: boom')
    const request = JSON.parse(socket.sent[0])
    socket.deliver({ id: request.id, error: { code: 1, message: 'boom' } })
    await assertion
  })

  it('WS 请求 10 秒无响应按超时拒绝', async () => {
    const { client } = await connectedClient()
    const pending = client.call('aria2.getVersion')
    const assertion = expect(pending).rejects.toThrow('Request timeout')
    await vi.advanceTimersByTimeAsync(10000)
    await assertion
  })

  it('send 同步抛错时清理在途请求并拒绝', async () => {
    const { client, socket } = await connectedClient()
    socket.send = () => {
      throw new Error('socket gone')
    }
    await expect(client.call('aria2.getVersion')).rejects.toThrow('socket gone')
  })

  it('连接断开时在途请求被拒，不会永久挂起', async () => {
    const { client, socket } = await connectedClient()
    const pending = client.call('aria2.getVersion')
    const assertion = expect(pending).rejects.toThrow('WebSocket connection closed')
    socket.serverClose()
    await assertion
  })
})

describe('通知分派', () => {
  const NOTIFICATIONS: Array<[string, string]> = [
    ['aria2.onDownloadStart', 'downloadStart'],
    ['aria2.onDownloadPause', 'downloadPause'],
    ['aria2.onDownloadStop', 'downloadStop'],
    ['aria2.onDownloadComplete', 'downloadComplete'],
    ['aria2.onDownloadError', 'downloadError'],
    ['aria2.onBtDownloadComplete', 'btDownloadComplete']
  ]

  it.each(NOTIFICATIONS)('%s 分派到 %s 并带上 gid', async (method, event) => {
    const { client, socket } = await connectedClient()
    const listener = vi.fn()
    client.on(event as never, listener)
    socket.deliver({ method, params: [{ gid: 'g1' }] })
    expect(listener).toHaveBeenCalledWith({ gid: 'g1' })
    // 通知不应被当成 RPC 请求发出去
    expect(socket.sent).toEqual([])
  })

  it('所有通知都先冒泡成 notification', async () => {
    const { client, socket } = await connectedClient()
    const listener = vi.fn()
    client.on('notification', listener)
    socket.deliver({ method: 'aria2.onDownloadStart', params: [{ gid: 'g1' }] })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0]).toMatchObject({ method: 'aria2.onDownloadStart' })
  })

  it('未知通知方法只冒泡 notification', async () => {
    const { client, socket } = await connectedClient()
    const notification = vi.fn()
    const downloadStart = vi.fn()
    client.on('notification', notification)
    client.on('downloadStart', downloadStart)
    socket.deliver({ method: 'aria2.onBtDownloadComplete', params: [] })
    expect(notification).toHaveBeenCalledTimes(1)
    expect(downloadStart).not.toHaveBeenCalled()
  })

  it('params 缺失时不抛错', async () => {
    const { client, socket } = await connectedClient()
    const listener = vi.fn()
    client.on('downloadStart', listener)
    socket.deliver({ method: 'aria2.onDownloadStart' })
    expect(listener).toHaveBeenCalledWith(undefined)
  })

  it('坏 JSON 只记日志，不影响后续消息', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client, socket } = await connectedClient()
    const listener = vi.fn()
    client.on('downloadStart', listener)
    socket.deliverRaw('{not json')
    socket.deliver({ method: 'aria2.onDownloadStart', params: [{ gid: 'g1' }] })
    expect(error).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('事件订阅', () => {
  it('on 注册多个监听器，off 只摘掉指定的那个', async () => {
    const { client, socket } = await connectedClient()
    const first = vi.fn()
    const second = vi.fn()
    client.on('notification', first)
    client.on('notification', second)
    socket.deliver({ method: 'aria2.onDownloadStart', params: [] })
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    client.off('notification', first)
    socket.deliver({ method: 'aria2.onDownloadStart', params: [] })
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(2)
  })

  it('off 未注册的监听器不抛错', () => {
    const client = new Aria2Client({ ...BASE_CONFIG })
    expect(() => client.off('connected', vi.fn())).not.toThrow()
  })
})

describe('自动重连', () => {
  it('连接建立后断开按 1 秒起步退避重连', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { socket } = await connectedClient()
    socket.serverClose()
    expect(sockets()).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(999)
    expect(sockets()).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(sockets()).toHaveLength(2)
  })

  it('重连失败后按 2 秒、4 秒退避', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { socket } = await connectedClient()
    socket.serverClose()
    await vi.advanceTimersByTimeAsync(1000)
    const second = lastSocket()
    second.serverClose()
    await vi.advanceTimersByTimeAsync(1999)
    expect(sockets()).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(sockets()).toHaveLength(3)
  })

  it('重连成功后退避计数归零', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { socket } = await connectedClient()
    socket.serverClose()
    await vi.advanceTimersByTimeAsync(1000)
    lastSocket().open()
    lastSocket().serverClose()
    await vi.advanceTimersByTimeAsync(1000)
    expect(sockets()).toHaveLength(3)
  })

  it('disconnect 取消已排队的重连', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { client, socket } = await connectedClient()
    socket.serverClose()
    client.disconnect()
    await vi.advanceTimersByTimeAsync(30000)
    expect(sockets()).toHaveLength(1)
  })

  it('定时器触发前手动 disconnect 则不再建新连接', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { client, socket } = await connectedClient()
    socket.serverClose()
    await vi.advanceTimersByTimeAsync(1000)
    expect(sockets()).toHaveLength(2)
    client.disconnect()
    expect(client.isConnected()).toBe(false)
  })

  it('已有排队中的重连时再次触发不会叠加定时器', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { client, socket } = await connectedClient()
    socket.serverClose()
    // onclose 已排了一个 1s 定时器，再直接触发一次应被早退守卫拦下
    ;(client as unknown as { scheduleReconnect: () => void }).scheduleReconnect()
    expect(console.warn).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(sockets()).toHaveLength(2)
  })

  it('定时器到期时若已手动断开则不再建新连接', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { client, socket } = await connectedClient()
    socket.serverClose()
    // disconnect 里的 clearTimeout 被屏蔽，模拟定时器回调仍被排到队列上
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout').mockImplementation(() => {})
    try {
      client.disconnect()
      await vi.advanceTimersByTimeAsync(1000)
    } finally {
      clearSpy.mockRestore()
    }
    expect(sockets()).toHaveLength(1)
  })
})

describe('updateConfig', () => {
  it('重建 HTTP 客户端并指向新地址', () => {
    const client = new Aria2Client({ ...BASE_CONFIG })
    client.updateConfig({ host: 'nas', port: 6900 })
    expect(h.created).toHaveLength(2)
    expect(h.created[1].baseURL).toBe('http://nas:6900/jsonrpc')
  })

  it('改地址时断开已连上的 WS', async () => {
    const { client, socket } = await connectedClient()
    client.updateConfig({ port: 6900 })
    expect(socket.closeCalls).toBe(1)
    expect(client.isConnected()).toBe(false)
  })

  it('只改 secret 不打断现有连接', async () => {
    const { client, socket } = await connectedClient()
    client.updateConfig({ secret: 'next' })
    expect(socket.closeCalls).toBe(0)
    expect(client.isConnected()).toBe(true)
  })
})
