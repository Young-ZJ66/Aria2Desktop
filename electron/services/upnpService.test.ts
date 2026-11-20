/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * upnpService 单测。
 *
 * 只替换网络原语（dgram / http / os）与设置来源，upnpCore 的报文构造与响应解析
 * 保持真实实现 —— 断言的是真实协议形状，而不是自造的替身。
 *
 * 重点覆盖状态机：代数计数（stop 后在途结果作废并撤掉已建映射）、续租失败不清定时器、
 * 端口变化时删除旧映射、inFlight 单飞、reconcile 的 5 秒免重打洞。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  locale: 'zh' as 'zh' | 'en',
  settings: { bt: { upnpEnabled: true } } as any,
  settingsThrows: false,
  isLocal: true,
  globalOption: { 'bt-listen-port': '6881', 'dht-listen-port': '6881' } as any,
  globalOptionError: false,
  deviceXml:
    '<root><device><service><serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType><controlURL>/ctl/IPConn</controlURL></service></device></root>' as string | null,
  deviceXmlError: false,
  soapPlan: 'ok' as 'ok' | 'reject' | 'partial' | 'already',
  lanIps: ['192.168.1.20'] as string[],
  socket: null as any,
  socketCreations: 0,
  httpCalls: [] as Array<{ kind: string; action: string }>,
  intervals: [] as Array<{ cb: () => void; ms: number }>,
  clearedIntervals: 0
}))

vi.mock('electron', () => ({ app: { getLocale: () => (state.locale === 'zh' ? 'zh-CN' : 'en-US') } }))

vi.mock('../utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
}))

vi.mock('../utils/mainProcessCopy', () => ({
  upnpFailureMessage: (locale: string, reason: string) => locale + ':' + reason
}))

vi.mock('../utils/settingsAccessor', () => ({
  getSettingsFresh: () => {
    if (state.settingsThrows) throw new Error('settings unavailable')
    return state.settings
  }
}))

vi.mock('../utils/activeRpcConfig', () => ({
  getActiveRpcConfig: () => ({ isLocal: state.isLocal }),
  activeRpcOptions: () => ({ host: '127.0.0.1', port: 6800, protocol: 'http', path: '/jsonrpc', secret: '' })
}))

vi.mock('../utils/aria2Rpc', () => ({
  callAria2Rpc: async () => {
    if (state.globalOptionError) throw new Error('rpc down')
    return state.globalOption
  }
}))

vi.mock('dgram', () => ({
  default: {
    createSocket: () => {
      const handlers: Record<string, (arg?: any) => void> = {}
      const sent: Array<{ msg: string; port: number; addr: string }> = []
      const sock: any = {
        handlers,
        sent,
        closed: false,
        on(event: string, cb: (arg?: any) => void) {
          handlers[event] = cb
          return sock
        },
        bind(cb: () => void) {
          cb()
          return sock
        },
        send(msg: string, port: number, addr: string) {
          sent.push({ msg, port, addr })
        },
        close() {
          sock.closed = true
        }
      }
      state.socketCreations += 1
      state.socket = sock
      return sock
    }
  }
}))

vi.mock('http', () => ({
  default: {
    get(url: string, _options: any, callback: (res: any) => void) {
      const handlers: Record<string, (arg?: any) => void> = {}
      const req: any = {
        on(event: string, cb: (arg?: any) => void) {
          handlers[event] = cb
          return req
        },
        destroy() {}
      }
      setTimeout(() => {
        if (state.deviceXmlError) {
          handlers.error?.(new Error('connection refused'))
          return
        }
        const body = state.deviceXml ?? ''
        const res: any = {
          statusCode: 200,
          _data: null as null | ((chunk: Buffer) => void),
          on(event: string, cb: (arg?: any) => void) {
            if (event === 'end') {
              queueMicrotask(() => {
                res._data?.(Buffer.from(body))
                cb()
              })
            } else if (event === 'data') {
              res._data = cb
            }
            return res
          }
        }
        callback(res)
      }, 0)
      return req
    },
    request(url: string, options: any, callback: (res: any) => void) {
      let body = ''
      const req: any = {
        on() {
          return req
        },
        destroy() {},
        write(chunk: string) {
          body += chunk
        },
        end() {
          let kind = 'ip'
          if (body.includes('AddPortMapping')) kind = 'add'
          else if (body.includes('DeletePortMapping')) kind = 'delete'
          const action = String(options?.headers?.SOAPAction ?? '')
          state.httpCalls.push({ kind, action })
          let status = 200
          let responseBody = ''
          if (kind === 'ip') {
            responseBody = '<NewExternalIPAddress>203.0.113.7</NewExternalIPAddress>'
          } else if (kind === 'add') {
            const isUdp = body.includes('<NewProtocol>UDP</NewProtocol>')
            const fault = '<SOAP-ENV:Fault><errorCode>714</errorCode></SOAP-ENV:Fault>'
            if (state.soapPlan === 'reject') {
              status = 500
              responseBody = fault
            } else if (state.soapPlan === 'partial' && isUdp) {
              status = 500
              responseBody = fault
            } else if (state.soapPlan === 'already') {
              status = 500
              responseBody = '<SOAP-ENV:Fault><errorCode>718</errorCode></SOAP-ENV:Fault>'
            }
          }
          const res: any = {
            statusCode: status,
            _data: null as null | ((chunk: Buffer) => void),
            on(event: string, cb: (arg?: any) => void) {
              if (event === 'end') {
                queueMicrotask(() => {
                  res._data?.(Buffer.from(responseBody))
                  cb()
                })
              } else if (event === 'data') {
                res._data = cb
              }
              return res
            }
          }
          callback(res)
        }
      }
      return req
    }
  }
}))

vi.mock('os', () => ({
  networkInterfaces: () => ({
    eth0: state.lanIps.map(address => ({ address, family: 'IPv4', internal: false })),
    lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }]
  })
}))

const { UpnpService } = await import('./upnpService')

const GATEWAY_LOCATION = 'http://192.168.1.1:5000/rootDesc.xml'
const DEVICE_XML =
  '<root><device><service><serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType><controlURL>/ctl/IPConn</controlURL></service></device></root>'

function resetState(): void {
  state.locale = 'zh'
  state.settings = { bt: { upnpEnabled: true } }
  state.settingsThrows = false
  state.isLocal = true
  state.globalOption = { 'bt-listen-port': '6881', 'dht-listen-port': '6881' }
  state.globalOptionError = false
  state.deviceXml = DEVICE_XML
  state.deviceXmlError = false
  state.soapPlan = 'ok'
  state.lanIps = ['192.168.1.20']
  state.socket = null
  state.socketCreations = 0
  state.httpCalls = []
  state.intervals = []
  state.clearedIntervals = 0
}

async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}

function feedGateway(location = GATEWAY_LOCATION): void {
  state.socket.handlers.message?.(Buffer.from('HTTP/1.1 200 OK\r\nLOCATION: ' + location + '\r\n\r\n'))
}

/** 发起一次映射并把 SSDP 响应喂给假 socket */
async function mapWithGateway(service: any, location = GATEWAY_LOCATION): Promise<any> {
  const pending = service.mapNow()
  expect(state.socket).not.toBeNull()
  feedGateway(location)
  return pending
}

function addCount(): number {
  return state.httpCalls.filter(call => call.kind === 'add').length
}

function deleteCount(): number {
  return state.httpCalls.filter(call => call.kind === 'delete').length
}

let realSetInterval: typeof setInterval
let realClearInterval: typeof clearInterval

beforeEach(() => {
  resetState()
  realSetInterval = globalThis.setInterval
  realClearInterval = globalThis.clearInterval
  vi.spyOn(globalThis, 'setInterval').mockImplementation(((cb: any, ms?: number) => {
    state.intervals.push({ cb, ms: ms ?? 0 })
    const handle = realSetInterval(cb, ms)
    handle.unref?.()
    return handle
  }) as any)
  vi.spyOn(globalThis, 'clearInterval').mockImplementation(((handle: any) => {
    state.clearedIntervals += 1
    realClearInterval(handle)
  }) as any)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('初始状态与状态拷贝', () => {
  it('未做过任何映射时状态为 idle', () => {
    const service = new UpnpService()
    expect(service.getStatus()).toEqual({ state: 'idle' })
  })

  it('getStatus 返回副本，外部改动不影响内部状态', async () => {
    const service = new UpnpService()
    await mapWithGateway(service)
    const snapshot = service.getStatus()
    snapshot.state = 'idle'
    snapshot.ports = [1]
    expect(service.getStatus().state).toBe('ok')
    expect(service.getStatus().ports).toEqual([6881])
  })
})

describe('reconcile 与设置联动', () => {
  it('设置关闭且从未映射时不发 SSDP', async () => {
    const service = new UpnpService()
    state.settings = { bt: { upnpEnabled: false } }
    await service.reconcile()
    expect(state.socketCreations).toBe(0)
    expect(service.getStatus()).toEqual({ state: 'idle' })
  })

  it('设置关闭时撤掉已有映射并删除路由器上的条目', async () => {
    const service = new UpnpService()
    await mapWithGateway(service)
    expect(service.getStatus().state).toBe('ok')
    state.httpCalls = []
    state.settings = { bt: { upnpEnabled: false } }
    await service.reconcile()
    expect(service.getStatus()).toEqual({ state: 'idle' })
    expect(deleteCount()).toBe(2)
    expect(state.clearedIntervals).toBeGreaterThan(0)
  })

  it('5 秒内重复 reconcile 不会重复打洞', async () => {
    const service = new UpnpService()
    await mapWithGateway(service)
    const creations = state.socketCreations
    await service.reconcile()
    expect(state.socketCreations).toBe(creations)
  })

  it('超过 5 秒的 reconcile 允许强制重建（端口被改过）', async () => {
    const service = new UpnpService()
    await mapWithGateway(service)
    const creations = state.socketCreations
    const svc = service as any
    svc.lastMappingAt = Date.now() - 6000
    const pending = service.reconcile()
    feedGateway()
    await pending
    expect(state.socketCreations).toBe(creations + 1)
  })
})

describe('失败原因分类', () => {
  it('没有任何 SSDP 响应时报未发现网关', async () => {
    const service = new UpnpService()
    const pending = service.mapNow()
    state.socket.handlers.error?.(new Error('socket closed'))
    const status = await pending
    expect(status.state).toBe('unsupported')
    expect(status.message).toBe('zh:no-gateway')
  })

  it('英文界面下失败原因用英文', async () => {
    state.locale = 'en'
    const service = new UpnpService()
    const pending = service.mapNow()
    state.socket.handlers.error?.(new Error('socket closed'))
    const status = await pending
    expect(status.message).toBe('en:no-gateway')
  })

  it('SSDP 把 Location 指向回环时按无网关处理（SSRF 防护）', async () => {
    const service = new UpnpService()
    const status = await mapWithGateway(service, 'http://127.0.0.1:6801/jsonrpc')
    expect(status.state).toBe('unsupported')
    expect(status.message).toBe('zh:no-gateway')
    expect(state.httpCalls).toHaveLength(0)
  })

  it('设备描述读取失败时报设备描述不可读', async () => {
    state.deviceXmlError = true
    const service = new UpnpService()
    const status = await mapWithGateway(service)
    expect(status.state).toBe('unsupported')
    expect(status.message).toBe('zh:device-description-unreadable')
  })

  it('设备描述里没有 WANIPConnection 时报不支持', async () => {
    state.deviceXml = '<root><device></device></root>'
    const service = new UpnpService()
    const status = await mapWithGateway(service)
    expect(status.message).toBe('zh:wanipconnection-unsupported')
  })

  it('没有局域网地址时报未获取到地址', async () => {
    state.lanIps = []
    const service = new UpnpService()
    const status = await mapWithGateway(service)
    expect(status.message).toBe('zh:no-lan-address')
  })

  it('连接的是远程引擎时不做 UPnP', async () => {
    state.isLocal = false
    const service = new UpnpService()
    const status = await mapWithGateway(service)
    expect(status.state).toBe('unsupported')
    expect(status.message).toBe('zh:remote-engine')
    expect(state.httpCalls).toHaveLength(0)
  })

  it('路由器拒绝全部映射时报被拒绝', async () => {
    state.soapPlan = 'reject'
    const service = new UpnpService()
    const status = await mapWithGateway(service)
    expect(status.state).toBe('unsupported')
    expect(status.message).toBe('zh:rejected')
    expect(state.intervals).toHaveLength(0)
  })

  it('mapAll 抛错时收敛成 error 状态', async () => {
    state.settingsThrows = true
    const service = new UpnpService()
    const status = await mapWithGateway(service)
    expect(status.state).toBe('error')
    expect(status.message).toContain('settings unavailable')
  })
})

describe('成功路径', () => {
  it('映射成功后记录端口、外部 IP 并装续租定时器', async () => {
    const service = new UpnpService()
    const status = await mapWithGateway(service)
    expect(status).toEqual({ state: 'ok', externalIp: '203.0.113.7', ports: [6881] })
    expect(state.intervals).toHaveLength(1)
    expect(state.intervals[0].ms).toBe(10 * 60 * 1000)
  })

  it('SSDP 请求发到组播地址且带 IGD 搜索目标', async () => {
    const service = new UpnpService()
    await mapWithGateway(service)
    const sent = state.socket.sent[0]
    expect(sent.port).toBe(1900)
    expect(sent.addr).toBe('239.255.255.250')
    expect(sent.msg).toContain('M-SEARCH * HTTP/1.1')
    expect(sent.msg).toContain('ST: urn:schemas-upnp-org:device:InternetGatewayDevice:1')
  })

  it('引擎未运行时按默认端口 6881 建映射', async () => {
    state.globalOptionError = true
    const service = new UpnpService()
    const status = await mapWithGateway(service)
    expect(status.ports).toEqual([6881])
    expect(addCount()).toBe(2)
  })

  it('端口清单取逗号前第一个且去重（TCP+UDP 各一条）', async () => {
    state.globalOption = { 'bt-listen-port': '51413,51414', 'dht-listen-port': '51413' }
    const service = new UpnpService()
    const status = await mapWithGateway(service)
    expect(status.ports).toEqual([51413])
    expect(addCount()).toBe(2)
  })

  it('errorCode 718（映射已存在）也算成功', async () => {
    state.soapPlan = 'already'
    const service = new UpnpService()
    const status = await mapWithGateway(service)
    expect(status.state).toBe('ok')
  })

  it('部分协议失败时仍列出已成功端口', async () => {
    state.soapPlan = 'partial'
    state.globalOption = { 'bt-listen-port': '6881', 'dht-listen-port': '6882' }
    const service = new UpnpService()
    const status = await mapWithGateway(service)
    expect(status.state).toBe('ok')
    expect(status.ports).toEqual([6881, 6882])
  })
})

describe('续租与清理', () => {
  it('续租失败但旧映射仍在时保留定时器并置 error', async () => {
    const service = new UpnpService()
    await mapWithGateway(service)
    const intervals = state.intervals.length
    state.soapPlan = 'reject'
    const status = await mapWithGateway(service)
    expect(status.state).toBe('error')
    expect(status.message).toBe('zh:rejected')
    expect(status.ports).toEqual([6881])
    expect(state.intervals).toHaveLength(intervals)
  })

  it('端口变化时删除不再需要的旧映射', async () => {
    const service = new UpnpService()
    await mapWithGateway(service)
    state.httpCalls = []
    state.globalOption = { 'bt-listen-port': '7000', 'dht-listen-port': '7000' }
    await mapWithGateway(service)
    expect(deleteCount()).toBe(2)
  })

  it('stop() 删除全部映射并清掉定时器', async () => {
    const service = new UpnpService()
    await mapWithGateway(service)
    state.httpCalls = []
    service.stop()
    expect(service.getStatus()).toEqual({ state: 'idle' })
    expect(deleteCount()).toBe(2)
    expect(state.clearedIntervals).toBeGreaterThan(0)
  })

  it('stop() 发生在途映射之后时丢弃结果并撤掉已建映射', async () => {
    const service = new UpnpService()
    const pending = service.mapNow()
    service.stop()
    feedGateway()
    const status = await pending
    expect(status).toEqual({ state: 'idle' })
    expect(state.intervals).toHaveLength(0)
    expect(deleteCount()).toBe(2)
  })

  it('inFlight 期间重复调用直接返回当前状态', async () => {
    const service = new UpnpService()
    const pending = service.mapNow()
    const creations = state.socketCreations
    const second = await service.mapNow()
    expect(second.state).toBe('mapping')
    expect(state.socketCreations).toBe(creations)
    feedGateway()
    await pending
  })

  it('续租定时器到期会重新映射', async () => {
    const service = new UpnpService()
    await mapWithGateway(service)
    const creations = state.socketCreations
    state.intervals[0].cb()
    await flush(2)
    expect(state.socketCreations).toBe(creations + 1)
    feedGateway()
    await flush()
    expect(service.getStatus().state).toBe('ok')
  })
})
