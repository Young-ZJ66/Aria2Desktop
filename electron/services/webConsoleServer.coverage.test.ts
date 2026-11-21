import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { PassThrough } from 'node:stream'
import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

const h = vi.hoisted(() => ({
  state: {
    settings: {} as Record<string, unknown>,
    throwSettings: false,
    saveThrows: false,
    userData: '',
    saves: [] as unknown[],
    rpc: vi.fn(),
    logError: vi.fn(),
    logWarn: vi.fn(),
    getPathThrows: false,
    networks: null as null | Record<string, { family: string; internal: boolean; address: string }[]>,
    settingsSeq: [] as Record<string, unknown>[]
  }
}))
const { state } = h

vi.mock('electron', () => ({
  app: {
    getVersion: () => '1.3.7',
    getPath: (name: string) => {
      if (state.getPathThrows) throw new Error('app path unavailable')
      return name === 'userData' ? state.userData : process.cwd()
    },
    getLocale: () => 'zh-CN'
  }
}))
vi.mock('electron-log', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: state.logWarn, error: state.logError }
}))
vi.mock('../utils/aria2Rpc', () => ({ callAria2Rpc: state.rpc }))
vi.mock('../utils/activeRpcConfig', () => ({ activeRpcOptions: () => ({ host: '127.0.0.1', port: 6800 }) }))
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  const networkInterfaces = () => state.networks ?? actual.networkInterfaces()
  return { ...actual, default: { ...actual, networkInterfaces }, networkInterfaces }
})
vi.mock('../utils/settingsAccessor', () => ({
  getSettingsFresh: () => {
    if (state.throwSettings) throw new Error('settings boom')
    if (state.settingsSeq.length > 0) return state.settingsSeq.shift()
    return state.settings
  },
  saveSettings: (next: unknown) => {
    if (state.saveThrows) throw new Error('disk full')
    state.saves.push(next)
  }
}))

const { WebConsoleServer } = await import('./webConsoleServer')

const MASTER = 'master-token-0123456789'
const RO_TOKEN = 'readonly-token-abcdef'

type AuditEntry = { time: string; ip: string; action: string; detail: string; success: boolean }

type Internals = {
  handle: (req: IncomingMessage, res: ServerResponse, allowed: string[]) => Promise<void>
  servePublic: (pathname: string, res: ServerResponse) => boolean
  apply: () => Promise<{ running: boolean; port: number; token: string; error?: string }>
  stop: () => Promise<void>
  getStatus: () => {
    running: boolean
    port: number
    url: string
    tls: boolean
    token: string
    tokensCount: number
    error: string
    audit: AuditEntry[]
  }
  pushStatusFrame: () => Promise<void>
  publicHost: () => string
  flushAuditSync: () => void
  record: (ip: string, action: string, detail: string, success: boolean) => void
  bindHost: string
  token: string
  auditLog: AuditEntry[]
  sseClients: Map<unknown, { token: string; ip: string }>
  sseTimer: unknown
  sseLastBeat: number
  sseLastAuthCheck: number
  sseLastPayload: string
  auditFlushTimer: unknown
  recheckStreamAuth: () => void
}

function makeRes() {
  const out: { status?: number; headers?: Record<string, string>; body?: string } = {}
  const res = {
    writeHead(status: number, headers?: Record<string, string>) {
      out.status = status
      out.headers = headers || {}
      return res
    },
    end(body?: string | Buffer) {
      out.body = Buffer.isBuffer(body) ? body.toString('binary') : String(body ?? '')
      return res
    }
  }
  return { res: res as unknown as ServerResponse, out }
}

type StreamHandle = {
  res: ServerResponse
  chunks: string[]
  ended: boolean
  emit: (event: string) => void
  throwOn: string
}

function makeStreamRes(throwOn = ''): StreamHandle {
  const chunks: string[] = []
  const handlers = new Map<string, (() => void)[]>()
  const handle: StreamHandle = {
    res: undefined as unknown as ServerResponse,
    chunks,
    ended: false,
    throwOn,
    emit(event: string) {
      for (const fn of handlers.get(event) || []) fn()
    }
  }
  const res = {
    writeHead() { return res },
    write(chunk: string) {
      if (throwOn && String(chunk).includes(throwOn)) throw new Error('socket hang up')
      chunks.push(String(chunk))
      return true
    },
    end() { handle.ended = true; return res },
    on(event: string, fn: () => void) {
      const list = handlers.get(event) || []
      list.push(fn)
      handlers.set(event, list)
      return res
    }
  }
  handle.res = res as unknown as ServerResponse
  return handle
}

function makeReq(method: string, url: string, headers: Record<string, string> = {}, body?: string, ip = '127.0.0.1') {
  const stream = new PassThrough() as unknown as IncomingMessage & { end: (chunk?: string) => void }
  Object.assign(stream, {
    method,
    url,
    headers: { host: '127.0.0.1:6802', ...headers },
    socket: { remoteAddress: ip }
  })
  if (body !== undefined) stream.end(body)
  return stream
}

function makeServer(settings: Record<string, unknown>): Internals {
  state.settings = settings
  const server = new WebConsoleServer() as unknown as Internals
  const config = (settings.webConsole ?? {}) as { token?: string }
  server.token = String(config.token || '')
  server.bindHost = '127.0.0.1'
  return server
}

const auth = (token = MASTER) => ({ authorization: 'Bearer ' + token })

beforeEach(() => {
  state.settings = {}
  state.throwSettings = false
  state.saveThrows = false
  state.userData = ''
  state.saves = []
  state.getPathThrows = false
  state.networks = null
  state.settingsSeq = []
  state.rpc.mockReset()
  state.rpc.mockResolvedValue([])
  state.logError.mockReset()
  state.logWarn.mockReset()
})

describe('apply 的拒绝与自愈分支', () => {
  it('未启用时停止服务并清空令牌', async () => {
    const server = makeServer({ webConsole: { enabled: false, token: MASTER } })
    const result = await server.apply()
    expect(result).toEqual({ running: false, port: 0, token: '' })
    expect(server.getStatus().running).toBe(false)
  })

  it('端口越界时拒绝启动并给出可读原因', async () => {
    const server = makeServer({ webConsole: { enabled: true, port: 80, token: MASTER, allowedIps: [] } })
    const result = await server.apply()
    expect(result.running).toBe(false)
    expect(result.error).toContain('1024-65535')
    expect(server.getStatus().error).toContain('1024-65535')
  })

  it('没有令牌时自动生成并写回设置', async () => {
    const server = makeServer({ webConsole: { enabled: true, port: 39741, token: '', allowedIps: [] } })
    const result = await server.apply()
    try {
      expect(result.running).toBe(true)
      expect(result.token).toMatch(/^[0-9a-f]{36}$/)
      expect(state.saves).toHaveLength(1)
      const saved = state.saves[0] as { webConsole: { token: string } }
      expect(saved.webConsole.token).toBe(result.token)
      expect(server.getStatus().token).toBe(result.token)
    } finally {
      await server.stop()
    }
  })

  it('令牌过短时拒绝启动', async () => {
    const server = makeServer({ webConsole: { enabled: true, port: 39742, token: 'short', allowedIps: [] } })
    const result = await server.apply()
    expect(result.running).toBe(false)
    expect(result.error).toContain('至少需要 16 个字符')
  })

  it('端口被占用时返回 running:false 而不是抛出', async () => {
    const port = 39743
    const blocker = net.createServer()
    await new Promise<void>(resolve => blocker.listen(port, '127.0.0.1', () => resolve()))
    try {
      const server = makeServer({ webConsole: { enabled: true, port, token: MASTER, allowedIps: [] } })
      const result = await server.apply()
      expect(result.running).toBe(false)
      expect(result.error).toBeTruthy()
      expect(state.logError).toHaveBeenCalled()
      expect(server.getStatus().running).toBe(false)
    } finally {
      await new Promise<void>(resolve => blocker.close(() => resolve()))
    }
  })

  it('监听回调把错误交给 handle 兜底成 500', async () => {
    const port = 39744
    const server = makeServer({ webConsole: { enabled: true, port, token: MASTER, allowedIps: [] } })
    const started = await server.apply()
    try {
      expect(started.running).toBe(true)
      state.throwSettings = true
      const response = await fetch('http://127.0.0.1:' + port + '/api/status', { headers: auth() })
      expect(response.status).toBe(500)
      const body = await response.json() as { ok: boolean; error: string }
      expect(body).toEqual({ ok: false, error: 'Internal server error' })
      expect(state.logError).toHaveBeenCalledWith('[WebConsole] Request failed:', expect.any(Error))
    } finally {
      state.throwSettings = false
      await server.stop()
    }
  })
})

describe('审计日志的载入、裁剪与落盘', () => {
  let tmpDir = ''

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aria2-webconsole-audit-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('超过上限时丢弃最旧记录，状态里只回最近 100 条', () => {
    const server = makeServer({ webConsole: { token: MASTER } })
    for (let i = 0; i < 501; i += 1) server.record('127.0.0.1', 'add', 'd' + i, true)
    expect(server.auditLog).toHaveLength(500)
    expect(server.auditLog[0].detail).toBe('d1')
    expect(server.getStatus().audit).toHaveLength(100)
    expect(server.getStatus().audit[99].detail).toBe('d500')
  })

  it('落盘走临时文件 + rename，读回结构与内存一致', () => {
    state.userData = tmpDir
    const server = makeServer({ webConsole: { token: MASTER } })
    server.record('1.2.3.4', 'add', 'https://example.com/a.bin', true)
    server.flushAuditSync()
    const file = path.join(tmpDir, 'web-console-audit.json')
    expect(fs.existsSync(file)).toBe(true)
    expect(fs.existsSync(file + '.tmp')).toBe(false)
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as AuditEntry[]
    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toMatchObject({ ip: '1.2.3.4', action: 'add', success: true })
  })

  it('载入时过滤掉字段缺失的条目', () => {
    state.userData = tmpDir
    fs.writeFileSync(path.join(tmpDir, 'web-console-audit.json'), JSON.stringify([
      { time: '2026-01-01 00:00:00', ip: '127.0.0.1', action: 'add', detail: 'ok', success: true },
      { time: 1, ip: '127.0.0.1', action: 'add', detail: 'bad', success: true },
      { time: 'x', ip: '127.0.0.1', action: 'add' },
      null,
      'nope'
    ]))
    const server = makeServer({ webConsole: { token: MASTER } })
    expect(server.getStatus().audit).toHaveLength(1)
    expect(server.getStatus().audit[0]).toMatchObject({ action: 'add', detail: 'ok' })
  })

  it('审计文件损坏时按空日志处理而不是崩掉', () => {
    state.userData = tmpDir
    fs.writeFileSync(path.join(tmpDir, 'web-console-audit.json'), '{oops')
    const server = makeServer({ webConsole: { token: MASTER } })
    expect(server.getStatus().audit).toEqual([])
    expect(state.logWarn).toHaveBeenCalled()
  })

  it('userData 退化成当前目录时放弃持久化，避免写进仓库', () => {
    state.userData = process.cwd()
    const server = makeServer({ webConsole: { token: MASTER } })
    server.record('127.0.0.1', 'add', 'x', true)
    server.flushAuditSync()
    expect(fs.existsSync(path.join(process.cwd(), 'web-console-audit.json'))).toBe(false)
    expect(server.getStatus().audit).toHaveLength(1)
  })

  it('落盘失败只记日志，不影响请求', () => {
    state.userData = path.join(tmpDir, 'not-a-dir')
    fs.writeFileSync(path.join(tmpDir, 'not-a-dir'), 'blocked')
    const server = makeServer({ webConsole: { token: MASTER } })
    server.record('127.0.0.1', 'add', 'x', true)
    expect(() => server.flushAuditSync()).not.toThrow()
    expect(state.logWarn).toHaveBeenCalled()
  })
})

describe('SSE 订阅的边界', () => {
  it('超过 8 个订阅者时直接 503，不再建流', async () => {
    const server = makeServer({ webConsole: { token: MASTER } })
    const streams: StreamHandle[] = []
    for (let i = 0; i < 8; i += 1) {
      const stream = makeStreamRes()
      streams.push(stream)
      await server.handle(makeReq('GET', '/api/events', auth()), stream.res, [])
      expect(stream.chunks[0]).toBe('retry: 3000\n\n')
    }
    const denied = makeRes()
    await server.handle(makeReq('GET', '/api/events', auth()), denied.res, [])
    expect(denied.out.status).toBe(503)
    expect(JSON.parse(denied.out.body || '{}').error).toBe('too_many_streams')
    await server.stop()
  })

  it('订阅者断开后清理连接并停掉定时器', async () => {
    const server = makeServer({ webConsole: { token: MASTER } })
    const stream = makeStreamRes()
    await server.handle(makeReq('GET', '/api/events', auth()), stream.res, [])
    expect(server.sseClients.size).toBe(1)
    expect(server.sseTimer).not.toBeNull()
    stream.emit('close')
    expect(server.sseClients.size).toBe(0)
    expect(server.sseTimer).toBeNull()
  })

  it('没有订阅者时推送会顺手停表', async () => {
    const server = makeServer({ webConsole: { token: MASTER } })
    const timer = setInterval(() => {}, 60_000)
    server.sseTimer = timer
    await server.pushStatusFrame()
    expect(server.sseTimer).toBeNull()
    clearInterval(timer)
  })

  it('距上次心跳超过 25 秒时补一条 ping 注释', async () => {
    const server = makeServer({ webConsole: { token: MASTER } })
    const stream = makeStreamRes()
    await server.handle(makeReq('GET', '/api/events', auth()), stream.res, [])
    server.sseLastBeat = Date.now() - 30_000
    await server.pushStatusFrame()
    expect(stream.chunks.join('')).toContain(': ping')
    await server.stop()
  })

  it('状态拉取失败时推 error 帧，且同一帧不重复推', async () => {
    state.rpc.mockRejectedValue(new Error('connect ECONNREFUSED'))
    const server = makeServer({ webConsole: { token: MASTER } })
    const stream = makeStreamRes()
    await server.handle(makeReq('GET', '/api/events', auth()), stream.res, [])
    await server.pushStatusFrame()
    const first = stream.chunks.join('')
    expect(first).toContain('event: error')
    expect(first).toContain('ECONNREFUSED')
    const before = stream.chunks.length
    await server.pushStatusFrame()
    expect(stream.chunks.length).toBe(before)
    await server.stop()
  })

  it('写失败（连接已断）的订阅者被移除', async () => {
    const server = makeServer({ webConsole: { token: MASTER } })
    const stream = makeStreamRes('event: status')
    await server.handle(makeReq('GET', '/api/events', auth()), stream.res, [])
    expect(server.sseClients.size).toBe(1)
    await server.pushStatusFrame()
    expect(server.sseClients.size).toBe(0)
    // 写失败只是丢掉这个订阅者；定时器要等下一帧发现没人订阅才停
    await server.pushStatusFrame()
    expect(server.sseTimer).toBeNull()
  })

  it('令牌被撤销后下一次复检断开连接并记审计', async () => {
    const settings = { webConsole: { token: MASTER, tokens: [{ id: 'ro', name: '只读', token: RO_TOKEN, scopes: ['tasks:read'] }] } }
    const server = makeServer(settings)
    const stream = makeStreamRes()
    await server.handle(makeReq('GET', '/api/events', auth(RO_TOKEN)), stream.res, [])
    expect(server.sseClients.size).toBe(1)
    state.settings = { webConsole: { token: MASTER } }
    server.sseLastAuthCheck = 0
    await server.pushStatusFrame()
    expect(server.sseClients.size).toBe(0)
    expect(stream.ended).toBe(true)
    const joined = stream.chunks.join('')
    expect(joined).toContain('event: unauthorized')
    expect(joined).toContain('token_revoked')
    expect(server.auditLog.some(entry => entry.detail === 'SSE 令牌已失效，连接已断开')).toBe(true)
  })

  it('复检有 30 秒节流，不会每次推送都重算', async () => {
    const settings = { webConsole: { token: MASTER, tokens: [{ id: 'ro', name: '只读', token: RO_TOKEN, scopes: ['tasks:read'] }] } }
    const server = makeServer(settings)
    const stream = makeStreamRes()
    await server.handle(makeReq('GET', '/api/events', auth(RO_TOKEN)), stream.res, [])
    state.settings = { webConsole: { token: MASTER } }
    server.sseLastAuthCheck = Date.now()
    await server.pushStatusFrame()
    expect(server.sseClients.size).toBe(1)
    expect(stream.ended).toBe(false)
    await server.stop()
  })
})

describe('handle 的剩余分支', () => {
  it('/api/audit 返回倒序的最近记录', async () => {
    const server = makeServer({ webConsole: { token: MASTER } })
    server.record('127.0.0.1', 'add', 'first', true)
    server.record('127.0.0.1', 'add', 'second', true)
    const { res, out } = makeRes()
    await server.handle(makeReq('GET', '/api/audit', auth()), res, [])
    expect(out.status).toBe(200)
    const body = JSON.parse(out.body || '{}') as { ok: boolean; items: AuditEntry[] }
    expect(body.ok).toBe(true)
    expect(body.items[0].detail).toBe('second')
    expect(body.items[1].detail).toBe('first')
  })

  it('一次提交超过 200 个 URI 时拒绝', async () => {
    const server = makeServer({ webConsole: { token: MASTER } })
    const uris = Array.from({ length: 201 }, (_, i) => 'https://example.com/' + i + '.bin')
    const { res, out } = makeRes()
    await server.handle(makeReq('POST', '/api/tasks', auth(), JSON.stringify({ uris })), res, [])
    expect(out.status).toBe(400)
    const body = JSON.parse(out.body || '{}') as { error: string; max: number }
    expect(body.error).toBe('too_many_uris')
    expect(body.max).toBe(200)
    expect(state.rpc).not.toHaveBeenCalled()
  })

  it('dir 类型非法时返回 invalid_dir', async () => {
    const server = makeServer({ webConsole: { token: MASTER } })
    const { res, out } = makeRes()
    await server.handle(makeReq('POST', '/api/tasks', auth(), JSON.stringify({ uris: ['https://example.com/a.bin'], dir: 5 })), res, [])
    expect(out.status).toBe(400)
    expect(JSON.parse(out.body || '{}').error).toBe('invalid_dir')
  })

  it('已鉴权但未匹配任何路由的写请求返回 404', async () => {
    const server = makeServer({ webConsole: { token: MASTER } })
    const { res, out } = makeRes()
    await server.handle(makeReq('POST', '/api/tasks/g1/unknown', auth()), res, [])
    expect(out.status).toBe(404)
    expect(state.rpc).not.toHaveBeenCalled()
  })

  it('请求体超过 1MB 时返回 413', async () => {
    const server = makeServer({ webConsole: { token: MASTER } })
    const { res, out } = makeRes()
    const huge = 'x'.repeat(1024 * 1024 + 10)
    await server.handle(makeReq('POST', '/api/tasks', auth(), JSON.stringify({ uris: ['https://example.com/a.bin'], pad: huge })), res, [])
    expect(out.status).toBe(413)
    expect(JSON.parse(out.body || '{}').error).toBe('Request body too large')
  })

  it('通配符与 0 位掩码都能放行', async () => {
    const server = makeServer({ webConsole: { token: MASTER } })
    const star = makeRes()
    await server.handle(makeReq('GET', '/api/status', auth(), undefined, '10.1.2.3'), star.res, ['*'])
    expect(star.out.status).toBe(200)
    const zeroMask = makeRes()
    await server.handle(makeReq('GET', '/api/status', auth(), undefined, '203.0.113.9'), zeroMask.res, ['0.0.0.0/0'])
    expect(zeroMask.out.status).toBe(200)
    // 空白规则不是通配符：列表非空就必须命中，否则按拒绝处理
    const blank = makeRes()
    await server.handle(makeReq('GET', '/api/status', auth(), undefined, '203.0.113.9'), blank.res, ['   '])
    expect(blank.out.status).toBe(403)
  })

  it('白名单里无法解析的网段一律不放行', async () => {
    const server = makeServer({ webConsole: { token: MASTER } })
    const { res, out } = makeRes()
    await server.handle(makeReq('GET', '/api/status', auth(), undefined, '10.1.2.3'), res, ['not-an-ip/24'])
    expect(out.status).toBe(403)
  })

  it('任务缺 files 时名称回退到 gid', async () => {
    state.rpc.mockImplementation(async (options: { method: string }) => {
      if (options.method === 'aria2.tellActive') return [{ gid: 'g9', status: 'active' }]
      return []
    })
    const server = makeServer({ webConsole: { token: MASTER } })
    const { res, out } = makeRes()
    await server.handle(makeReq('GET', '/api/status', auth()), res, [])
    const body = JSON.parse(out.body || '{}') as { active: { name: string; totalLength: string }[] }
    expect(body.active[0]).toMatchObject({ name: 'g9', totalLength: '0' })
  })

  it('servePublic 对非公开路径返回 false', () => {
    const server = makeServer({ webConsole: { token: MASTER } })
    const { res } = makeRes()
    expect(server.servePublic('/api/status', res)).toBe(false)
  })

  it('publicHost 在回环时直接给 127.0.0.1，在局域网模式给字符串', () => {
    const server = makeServer({ webConsole: { token: MASTER } })
    expect(server.publicHost()).toBe('127.0.0.1')
    server.bindHost = '0.0.0.0'
    expect(typeof server.publicHost()).toBe('string')
  })
})

describe('令牌最近使用时间的写回', () => {
  it('主令牌没有 id，不写盘', async () => {
    const server = makeServer({ webConsole: { token: MASTER } })
    const { res } = makeRes()
    await server.handle(makeReq('GET', '/api/status', auth()), res, [])
    expect(state.saves).toHaveLength(0)
  })

  it('副令牌首次访问写回 lastUsedAt，60 秒内不重复写', async () => {
    const settings = { webConsole: { token: MASTER, tokens: [{ id: 'ro', name: '只读', token: RO_TOKEN, scopes: ['tasks:read'] }] } }
    const server = makeServer(settings)
    for (let i = 0; i < 3; i += 1) {
      const { res } = makeRes()
      await server.handle(makeReq('GET', '/api/status', auth(RO_TOKEN)), res, [])
    }
    expect(state.saves).toHaveLength(1)
    const saved = state.saves[0] as { webConsole: { tokens: { id: string; lastUsedAt?: string }[] } }
    expect(saved.webConsole.tokens[0].id).toBe('ro')
    expect(typeof saved.webConsole.tokens[0].lastUsedAt).toBe('string')
  })

  it('写回失败只记日志，不影响请求', async () => {
    const settings = { webConsole: { token: MASTER, tokens: [{ id: 'ro', name: '只读', token: RO_TOKEN, scopes: ['tasks:read'] }] } }
    const server = makeServer(settings)
    state.saveThrows = true
    const { res, out } = makeRes()
    await server.handle(makeReq('GET', '/api/status', auth(RO_TOKEN)), res, [])
    expect(out.status).toBe(200)
    expect(state.saves).toHaveLength(0)
    expect(state.logWarn).toHaveBeenCalledWith('[WebConsole] Failed to update token lastUsedAt:', expect.any(Error))
    state.saveThrows = false
  })
})

describe('网段解析、审计兜底与状态映射的细节', () => {
  it('网段里出现非法地址段时判为不匹配', async () => {
    const server = makeServer({ webConsole: { token: MASTER } })
    const { res, out } = makeRes()
    await server.handle(makeReq('GET', '/api/status', auth(), undefined, '10.1.2.3'), res, ['10.1.2.300/24'])
    expect(out.status).toBe(403)
  })

  it('精确地址放行，掩码超出范围时拒绝', async () => {
    const server = makeServer({ webConsole: { token: MASTER } })
    const exact = makeRes()
    await server.handle(makeReq('GET', '/api/status', auth(), undefined, '10.9.9.9'), exact.res, ['10.9.9.9'])
    expect(exact.out.status).toBe(200)
    const badMask = makeRes()
    await server.handle(makeReq('GET', '/api/status', auth(), undefined, '10.9.9.9'), badMask.res, ['10.9.9.0/40'])
    expect(badMask.out.status).toBe(403)
  })

  it('取不到非回环的 IPv4 时回落到回环地址', () => {
    state.networks = { lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }] }
    const server = makeServer({ webConsole: { token: MASTER } })
    server.bindHost = '0.0.0.0'
    expect(server.publicHost()).toBe('127.0.0.1')
  })

  it('读取 userData 抛错时放弃审计持久化', () => {
    state.getPathThrows = true
    const server = makeServer({ webConsole: { token: MASTER } })
    server.record('127.0.0.1', 'add', 'x', true)
    expect(() => server.flushAuditSync()).not.toThrow()
    expect(server.getStatus().audit).toHaveLength(1)
  })

  it('审计文件内容不是数组时按空日志处理', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aria2-webconsole-shape-'))
    try {
      state.userData = dir
      fs.writeFileSync(path.join(dir, 'web-console-audit.json'), JSON.stringify({ entries: [] }))
      const server = makeServer({ webConsole: { token: MASTER } })
      expect(server.getStatus().audit).toEqual([])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('落盘定时器到点后自动写盘并清空句柄', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aria2-webconsole-flush-'))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      state.userData = dir
      const server = makeServer({ webConsole: { token: MASTER } })
      server.record('127.0.0.1', 'add', 'auto', true)
      expect(server.auditFlushTimer).not.toBeNull()
      await vi.advanceTimersByTimeAsync(1000)
      expect(server.auditFlushTimer).toBeNull()
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, 'web-console-audit.json'), 'utf8')) as AuditEntry[]
      expect(parsed[0]).toMatchObject({ detail: 'auto', success: true })
    } finally {
      vi.useRealTimers()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('等待与已停止队列也映射成精简结构', async () => {
    state.rpc.mockImplementation(async (options: { method: string }) => {
      if (options.method === 'aria2.tellWaiting') return [{ gid: 'w1', status: 'waiting', files: [{ path: '/dl/w1.bin' }] }]
      if (options.method === 'aria2.tellStopped') return [{ gid: 's1', status: 'complete', files: [{ path: '/dl/s1.bin' }] }]
      return []
    })
    const server = makeServer({ webConsole: { token: MASTER } })
    const { res, out } = makeRes()
    await server.handle(makeReq('GET', '/api/status', auth()), res, [])
    const body = JSON.parse(out.body || '{}') as { waiting: { name: string }[]; stopped: { name: string }[] }
    expect(body.waiting[0].name).toBe('w1.bin')
    expect(body.stopped[0].name).toBe('s1.bin')
  })

  it('SSE 定时器到点自动推送一帧', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    try {
      const server = makeServer({ webConsole: { token: MASTER } })
      const stream = makeStreamRes()
      await server.handle(makeReq('GET', '/api/events', auth()), stream.res, [])
      const before = stream.chunks.length
      await vi.advanceTimersByTimeAsync(2000)
      expect(stream.chunks.length).toBeGreaterThan(before)
      expect(stream.chunks.join('')).toContain('event: status')
      await server.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('没有订阅者时鉴权复检直接返回', () => {
    const server = makeServer({ webConsole: { token: MASTER } })
    server.sseLastAuthCheck = 0
    expect(() => server.recheckStreamAuth()).not.toThrow()
  })

  it('复检时令牌已不在配置里就跳过写回', async () => {
    const withToken = { webConsole: { token: MASTER, tokens: [{ id: 'ro', name: '只读', token: RO_TOKEN, scopes: ['tasks:read'] }] } }
    state.settings = withToken
    state.settingsSeq = [withToken, { webConsole: { token: MASTER, tokens: [] } }]
    const server = makeServer(withToken)
    const { res, out } = makeRes()
    await server.handle(makeReq('GET', '/api/status', auth(RO_TOKEN)), res, [])
    expect(out.status).toBe(200)
    expect(state.saves).toHaveLength(0)
  })

  it('方法大小写与路由不一致时落到 404', async () => {
    const server = makeServer({ webConsole: { token: MASTER } })
    const { res, out } = makeRes()
    await server.handle(makeReq('post', '/api/tasks/g1/pause', auth()), res, [])
    expect(out.status).toBe(404)
    expect(JSON.parse(out.body || '{}').error).toBe('Not found')
  })
})

