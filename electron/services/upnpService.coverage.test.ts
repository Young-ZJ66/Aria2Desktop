/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * upnpService 网络原语的异常路径单测。
 *
 * 既有 upnpService.test.ts 覆盖的是状态机与正常协议流；这里补的是「网络不按预期回话」时
 * 服务是否还能收敛：SSDP 超时/重复结算、设备描述超大、SOAP 超时与超大响应、
 * 以及在途映射被 stop() 作废后又抛错的双重失败。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  getMode: 'ok' as 'ok' | 'huge' | 'timeout' | 'error',
  soapMode: 'ok' as 'ok' | 'huge' | 'timeout' | 'error',
  deviceXml: '<root><device><service><serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType><controlURL>/ctl/IPConn</controlURL></service></device></root>',
  settingsThrows: false,
  createSocketThrows: false,
  socket: null as any,
  socketCreations: 0,
  soapCalls: 0,
  intervals: [] as Array<() => void>
}))

vi.mock('electron', () => ({ app: { getLocale: () => 'zh-CN' } }))
vi.mock('../utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
}))
vi.mock('../utils/mainProcessCopy', () => ({ upnpFailureMessage: (locale: string, reason: string) => locale + ':' + reason }))
vi.mock('../utils/settingsAccessor', () => ({
  getSettingsFresh: () => {
    if (state.settingsThrows) throw new Error('settings unavailable')
    return { bt: { upnpEnabled: true } }
  }
}))
vi.mock('../utils/activeRpcConfig', () => ({
  getActiveRpcConfig: () => ({ isLocal: true }),
  activeRpcOptions: () => ({ host: '127.0.0.1', port: 6800, protocol: 'http', path: '/jsonrpc', secret: '' })
}))
vi.mock('../utils/aria2Rpc', () => ({ callAria2Rpc: async () => ({ 'bt-listen-port': '6881', 'dht-listen-port': '6881' }) }))

vi.mock('dgram', () => ({
  default: {
    createSocket: () => {
      if (state.createSocketThrows) throw new Error('dgram unavailable')
      const handlers: Record<string, (arg?: any) => void> = {}
      const sock: any = {
        handlers,
        closeCalls: 0,
        on(event: string, cb: (arg?: any) => void) {
          handlers[event] = cb
          return sock
        },
        bind(cb: () => void) {
          cb()
          return sock
        },
        send() {},
        close() {
          sock.closeCalls += 1
        }
      }
      state.socketCreations += 1
      state.socket = sock
      return sock
    }
  }
}))

const HUGE_CHUNK = Buffer.alloc(600 * 1024, 0x61)

vi.mock('http', () => ({
  default: {
    get(_url: string, _options: any, callback: (res: any) => void) {
      const handlers: Record<string, (arg?: any) => void> = {}
      const req: any = {
        on(event: string, cb: (arg?: any) => void) {
          handlers[event] = cb
          return req
        },
        destroy() {}
      }
      const makeRes = (body: Buffer) => {
        const res: any = {
          statusCode: 200,
          on(event: string, cb: (arg?: any) => void) {
            if (event === 'data') queueMicrotask(() => cb(body))
            if (event === 'end') queueMicrotask(() => cb())
            return res
          }
        }
        return res
      }
      setTimeout(() => {
        if (state.getMode === 'timeout') {
          handlers.timeout?.()
          return
        }
        if (state.getMode === 'error') {
          handlers.error?.(new Error('connection refused'))
          return
        }
        callback(makeRes(state.getMode === 'huge' ? HUGE_CHUNK : Buffer.from(state.deviceXml)))
      }, 0)
      return req
    },
    request(_url: string, _options: any, callback: (res: any) => void) {
      const handlers: Record<string, (arg?: any) => void> = {}
      const req: any = {
        on(event: string, cb: (arg?: any) => void) {
          handlers[event] = cb
          return req
        },
        destroy() {},
        write() {},
        end() {
          state.soapCalls += 1
          setTimeout(() => {
            if (state.soapMode === 'timeout') {
              handlers.timeout?.()
              return
            }
            if (state.soapMode === 'error') {
              handlers.error?.(new Error('soap refused'))
              return
            }
            const body =
              state.soapMode === 'huge'
                ? HUGE_CHUNK
                : Buffer.from('<NewExternalIPAddress>203.0.113.7</NewExternalIPAddress>')
            const res: any = {
              statusCode: 200,
              on(event: string, cb: (arg?: any) => void) {
                if (event === 'data') queueMicrotask(() => cb(body))
                if (event === 'end') queueMicrotask(() => cb())
                return res
              }
            }
            callback(res)
          }, 0)
        }
      }
      return req
    }
  }
}))

vi.mock('os', () => ({
  networkInterfaces: () => ({ eth0: [{ address: '192.168.1.20', family: 'IPv4', internal: false }] })
}))

const { UpnpService } = await import('./upnpService')

const LOCATION = 'http://192.168.1.1:5000/rootDesc.xml'

function resetState(): void {
  state.getMode = 'ok'
  state.soapMode = 'ok'
  state.settingsThrows = false
  state.createSocketThrows = false
  state.socket = null
  state.socketCreations = 0
  state.soapCalls = 0
  state.intervals = []
}

function feedGateway(location = LOCATION): void {
  state.socket.handlers.message?.(Buffer.from('HTTP/1.1 200 OK\r\nLOCATION: ' + location + '\r\n\r\n'))
}

let realSetInterval: typeof setInterval

beforeEach(() => {
  resetState()
  realSetInterval = globalThis.setInterval
  vi.spyOn(globalThis, 'setInterval').mockImplementation(((cb: any, ms?: number) => {
    state.intervals.push(cb)
    const handle = realSetInterval(cb, ms)
    handle.unref?.()
    return handle
  }) as any)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('upnpService 的网络异常收敛', () => {
  it('SSDP 三秒内没有任何响应时按未发现网关处理', async () => {
    vi.useFakeTimers()
    const service = new UpnpService()
    const pending = service.mapNow()
    await vi.advanceTimersByTimeAsync(3100)
    const status = await pending

    expect(status).toEqual({ state: 'unsupported', message: 'zh:no-gateway' })
    expect(state.socket.closeCalls).toBe(1)
  })

  it('SSDP 先报错又收到响应时只结算一次（不重复关闭套接字）', async () => {
    const service = new UpnpService()
    const pending = service.mapNow()
    state.socket.handlers.error?.(new Error('socket closed'))
    feedGateway()
    const status = await pending

    expect(status).toEqual({ state: 'unsupported', message: 'zh:no-gateway' })
    expect(state.socket.closeCalls).toBe(1)
  })

  it('创建组播套接字就失败时同样收敛成未发现网关', async () => {
    state.createSocketThrows = true
    const service = new UpnpService()
    const status = await service.mapNow()

    expect(status).toEqual({ state: 'unsupported', message: 'zh:no-gateway' })
  })

  it('设备描述文档超过上限时中止读取并报不可读', async () => {
    state.getMode = 'huge'
    const service = new UpnpService()
    const pending = service.mapNow()
    feedGateway()
    const status = await pending

    expect(status).toEqual({ state: 'unsupported', message: 'zh:device-description-unreadable' })
  })

  it('设备描述请求超时按不可读处理', async () => {
    state.getMode = 'timeout'
    const service = new UpnpService()
    const pending = service.mapNow()
    feedGateway()
    const status = await pending

    expect(status.message).toBe('zh:device-description-unreadable')
  })

  it('SOAP 响应超过上限时该条映射按失败跳过', async () => {
    state.soapMode = 'huge'
    const service = new UpnpService()
    const pending = service.mapNow()
    feedGateway()
    const status = await pending

    expect(status).toEqual({ state: 'unsupported', message: 'zh:rejected' })
    expect(state.soapCalls).toBeGreaterThan(0)
    expect(state.intervals).toHaveLength(0)
  })

  it('SOAP 请求超时与连接失败都只跳过该条映射，不会把整体拖成 error', async () => {
    state.soapMode = 'timeout'
    const service = new UpnpService()
    const first = service.mapNow()
    feedGateway()
    expect(await first).toEqual({ state: 'unsupported', message: 'zh:rejected' })

    state.soapMode = 'error'
    const second = service.mapNow()
    feedGateway()
    expect(await second).toEqual({ state: 'unsupported', message: 'zh:rejected' })
  })

  it('在途映射被 stop() 作废后即使随后抛错也只清理不发新状态', async () => {
    const service = new UpnpService()
    const pending = service.mapNow()
    service.stop()
    state.settingsThrows = true
    feedGateway()
    const status = await pending

    expect(status).toEqual({ state: 'idle' })
    expect(state.intervals).toHaveLength(0)
  })
})
