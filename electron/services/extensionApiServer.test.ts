import { EventEmitter } from 'node:events'
import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => {
  const state = {
    settings: null as unknown,
    settingsThrows: false,
    locale: 'zh',
    engineInfo: { isRunning: true, pid: 4242 } as { isRunning: boolean; pid?: number },
    serviceEnabled: true,
    servers: [] as unknown[],
    lastServer: null as unknown,
    listenError: null as unknown,
    tokens: [] as Array<Record<string, unknown>>,
    added: [] as Array<Record<string, unknown>>,
    touched: [] as string[],
    rpcCalls: [] as Array<Record<string, unknown>>,
    rpcPlan: {} as Record<string, unknown>,
    ytdlp: { available: true } as Record<string, unknown>,
    streamStart: { success: true, id: 'stream-1' } as Record<string, unknown>,
    streamInputs: [] as Array<Record<string, unknown>>,
    streamTasks: [] as unknown[],
    pauseResult: true,
    resumeResult: true,
    discarded: [] as string[],
    forgotten: [] as string[],
    probed: '' as string | null,
    conflict: { conflict: false, fileName: '' } as Record<string, unknown>,
    pairResponse: 0,
    dialogCalls: [] as unknown[],
    getPathThrows: false,
    logs: { warn: [] as string[], info: [] as string[], error: [] as string[] }
  }

  class FakeServer {
    handlers: Record<string, Array<(...args: unknown[]) => void>> = {}
    closed = false
    unrefCalls = 0
    listenArgs: unknown[] = []
    listener: (req: unknown, res: unknown) => void

    constructor(listener: (req: unknown, res: unknown) => void) {
      this.listener = listener
    }

    on(event: string, handler: (...args: unknown[]) => void): this {
      const bucket = this.handlers[event] ?? []
      bucket.push(handler)
      this.handlers[event] = bucket
      return this
    }

    emit(event: string, ...args: unknown[]): void {
      for (const handler of this.handlers[event] ?? []) handler(...args)
    }

    listen(port: number, host: string, callback: () => void): void {
      this.listenArgs = [port, host]
      if (state.listenError) {
        setImmediate(() => this.emit('error', state.listenError))
        return
      }
      setImmediate(callback)
    }

    close(): void {
      this.closed = true
    }

    unref(): void {
      this.unrefCalls++
    }
  }

  return { state, FakeServer }
})

vi.mock('http', () => ({
  createServer: (listener: (req: unknown, res: unknown) => void) => {
    const server = new h.FakeServer(listener)
    h.state.servers.push(server)
    h.state.lastServer = server
    return server
  }
}))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (h.state.getPathThrows) throw new Error('app is not ready')
      return name === 'userData' ? 'C:/userData' : 'C:/tmp'
    },
    getLocale: () => 'zh-CN'
  },
  dialog: {
    showMessageBox: async (options: unknown) => {
      h.state.dialogCalls.push(options)
      return { response: h.state.pairResponse }
    }
  }
}))

vi.mock('../utils/logger', () => ({
  createLogger: () => ({
    info: (message: string) => h.state.logs.info.push(message),
    warn: (message: string) => h.state.logs.warn.push(message),
    error: (message: string) => h.state.logs.error.push(message),
    debug: () => {}
  })
}))

vi.mock('../utils/mainLocale', () => ({
  mainLocaleFrom: () => h.state.locale
}))

vi.mock('../utils/mainLocaleRuntime', () => ({
  runtimeMainLocale: () => h.state.locale
}))

vi.mock('../utils/mainErrorCopy', () => ({
  mainError: (locale: string, key: string) => locale + ':' + key,
  defaultExtensionName: () => '浏览器扩展',
  extensionPairingCopy: () => ({
    title: '允许配对',
    message: '是否允许该扩展连接',
    allow: '允许',
    deny: '拒绝',
    labelName: '名称',
    labelExtensionId: '扩展 ID',
    labelOrigin: '来源',
    labelVersion: '版本',
    unknown: '未知',
    canDo: '可以：新建下载',
    cannotDo: '不可以：删除文件'
  })
}))

vi.mock('../utils/settingsAccessor', () => ({
  getSettingsFresh: () => {
    if (h.state.settingsThrows) throw new Error('settings boom')
    return h.state.settings
  }
}))

vi.mock('../utils/activeRpcConfig', () => ({
  activeRpcOptions: (settings: Record<string, unknown> | undefined) => ({
    host: '127.0.0.1',
    port: 6800,
    secret: ((settings as { aria2?: { secret?: string } } | undefined)?.aria2?.secret) ?? ''
  })
}))

vi.mock('../utils/extensionTokenStore', () => ({
  TOKEN_FILE_NAME: 'extension-tokens.json',
  ExtensionTokenStore: class {
    list(): Array<Record<string, unknown>> {
      return h.state.tokens.slice()
    }

    add(record: Record<string, unknown>): void {
      h.state.tokens.unshift(record)
      h.state.added.push(record)
    }

    revoke(token: string): boolean {
      const index = h.state.tokens.findIndex((row) => row.token === token)
      if (index < 0) return false
      h.state.tokens.splice(index, 1)
      return true
    }

    revokeExtension(extensionId: string): number {
      const before = h.state.tokens.length
      h.state.tokens = h.state.tokens.filter((row) => row.extensionId !== extensionId)
      return before - h.state.tokens.length
    }

    touch(token: string): void {
      h.state.touched.push(token)
    }
  }
}))

vi.mock('../utils/aria2Rpc', () => ({
  callAria2Rpc: async (options: Record<string, unknown>) => {
    h.state.rpcCalls.push(options)
    const plan = h.state.rpcPlan[String(options.method)]
    if (plan instanceof Error) throw plan
    return plan
  }
}))

vi.mock('./ytdlpService', () => ({
  checkYtdlpAvailable: async () => h.state.ytdlp
}))

vi.mock('./streamDownloadService', () => ({
  startStreamDownload: async (input: Record<string, unknown>) => {
    h.state.streamInputs.push(input)
    return h.state.streamStart
  },
  listStreamTasks: () => h.state.streamTasks,
  pauseStreamDownload: () => h.state.pauseResult,
  resumeStreamDownload: () => h.state.resumeResult,
  discardStreamDownload: async (id: string) => {
    h.state.discarded.push(id)
  },
  forgetStreamTask: (id: string) => {
    h.state.forgotten.push(id)
  }
}))

vi.mock('../utils/downloadNameProbe', () => ({
  probeDownloadFileName: async () => h.state.probed,
  resolveConflictingFileName: () => h.state.conflict
}))

const SECRET = 's3cret'
const EXTENSION_ID = 'a'.repeat(32)
const EXTENSION_ORIGIN = 'chrome-extension://' + EXTENSION_ID
const TOKEN = 'ext_' + 'b'.repeat(43)

type FakeRes = {
  status: number
  headers: Record<string, string>
  body: string
  ended: boolean
  headersSent: boolean
  writeHead: (status: number, headers?: Record<string, string>) => FakeRes
  end: (body?: string) => void
  destroy: () => void
}

type FakeReq = EventEmitter & {
  url: string
  method: string
  headers: Record<string, string>
  destroy: () => void
}

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function makeRes(): FakeRes {
  const res: FakeRes = {
    status: 0,
    headers: {},
    body: '',
    ended: false,
    headersSent: false,
    writeHead(status: number, headers?: Record<string, string>) {
      res.status = status
      res.headers = headers ?? {}
      res.headersSent = true
      return res
    },
    end(body?: string) {
      res.body = body ?? ''
      res.ended = true
    },
    destroy() {
      res.ended = true
    }
  }
  return res
}

function makeReq(options: { method?: string; url?: string; headers?: Record<string, string> }): FakeReq {
  const req = new EventEmitter() as FakeReq
  req.url = options.url ?? '/api/status'
  req.method = options.method ?? 'GET'
  req.headers = options.headers ?? {}
  req.destroy = () => {}
  return req
}

async function waitEnd(res: FakeRes): Promise<void> {
  for (let i = 0; i < 200 && !res.ended; i++) await tick()
}

async function call(
  options: { method?: string; url?: string; headers?: Record<string, string> },
  body?: unknown
): Promise<FakeRes> {
  const server = h.state.lastServer as { listener: (req: unknown, res: unknown) => void }
  const req = makeReq(options)
  const res = makeRes()
  server.listener(req, res)
  await tick()
  if (body !== undefined) req.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)))
  req.emit('end')
  await waitEnd(res)
  return res
}

function json(res: FakeRes): Record<string, unknown> {
  return JSON.parse(res.body) as Record<string, unknown>
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return { authorization: 'Bearer ' + SECRET, origin: EXTENSION_ORIGIN, ...extra }
}

function tokenHeaders(token: string): Record<string, string> {
  return { authorization: 'Bearer ' + token, origin: EXTENSION_ORIGIN }
}

function baseSettings(): Record<string, unknown> {
  return {
    aria2: { secret: SECRET, port: 6800, downloadDir: 'C:/Downloads' },
    download: { defaultDir: 'C:/Downloads', maxConnectionPerServer: 5, minSplitSize: '1M', autoStart: true },
    category: {
      autoClassify: true,
      categories: [
        { id: 'general', dir: '', extensions: [] },
        { id: 'video', dir: 'Video', extensions: ['mp4'] }
      ]
    }
  }
}

function makeTokenRecord(scopes: string[]): Record<string, unknown> {
  return {
    token: TOKEN,
    scopes,
    extensionId: EXTENSION_ID,
    extensionName: '测试扩展',
    origin: EXTENSION_ORIGIN,
    createdAt: 1
  }
}

async function makeServer(): Promise<{
  start: (port?: number) => void
  stop: () => void
  apply: () => void
  isListening: () => boolean
  listPairedExtensions: () => Array<Record<string, unknown>>
  revokeExtension: (id: string) => number
  revokeToken: (token: string) => boolean
  getExtensionConnection: () => Record<string, unknown>
}> {
  const { ExtensionApiServer } = await import('./extensionApiServer')
  const server = new ExtensionApiServer({
    getAppVersion: () => '1.5.0',
    getEngineProcessInfo: () => h.state.engineInfo,
    confirmPairing: async () => true,
    sendStreamEvent: () => {},
    getServiceEnabled: () => h.state.serviceEnabled
  })
  server.start(6801)
  await tick()
  return server as unknown as {
    start: (port?: number) => void
    stop: () => void
    apply: () => void
    isListening: () => boolean
    listPairedExtensions: () => Array<Record<string, unknown>>
    revokeExtension: (id: string) => number
    revokeToken: (token: string) => boolean
    getExtensionConnection: () => Record<string, unknown>
  }
}

beforeEach(() => {
  vi.resetModules()
  h.state.settings = baseSettings()
  h.state.settingsThrows = false
  h.state.locale = 'zh'
  h.state.engineInfo = { isRunning: true, pid: 4242 }
  h.state.serviceEnabled = true
  h.state.servers = []
  h.state.lastServer = null
  h.state.listenError = null
  h.state.tokens = []
  h.state.added = []
  h.state.touched = []
  h.state.rpcCalls = []
  h.state.rpcPlan = {}
  h.state.ytdlp = { available: true }
  h.state.streamStart = { success: true, id: 'stream-1' }
  h.state.streamInputs = []
  h.state.streamTasks = []
  h.state.pauseResult = true
  h.state.resumeResult = true
  h.state.discarded = []
  h.state.forgotten = []
  h.state.probed = ''
  h.state.conflict = { conflict: false, fileName: '' }
  h.state.pairResponse = 0
  h.state.dialogCalls = []
  h.state.getPathThrows = false
  h.state.logs = { warn: [], info: [], error: [] }
})

describe('监听条件（D-06）', () => {
  it('配置了 RPC 密钥时开始监听 127.0.0.1 的指定端口', async () => {
    const server = await makeServer()
    expect(h.state.servers).toHaveLength(1)
    const created = h.state.servers[0] as { listenArgs: unknown[]; unrefCalls: number }
    expect(created.listenArgs).toEqual([6801, '127.0.0.1'])
    expect(created.unrefCalls).toBe(1)
    expect(server.isListening()).toBe(true)
  })

  it('既没有密钥也没有已配对 token 时完全不占端口', async () => {
    h.state.settings = { aria2: { secret: '' } }
    const server = await makeServer()
    expect(h.state.servers).toHaveLength(0)
    expect(server.isListening()).toBe(false)
  })

  it('没有密钥但有已配对 token 时仍然监听（凭 token 鉴权）', async () => {
    h.state.settings = { aria2: { secret: '' } }
    h.state.tokens = [makeTokenRecord(['tasks:read'])]
    const server = await makeServer()
    expect(h.state.servers).toHaveLength(1)
    expect(server.isListening()).toBe(true)
  })

  it('用户在设置里关掉扩展服务时不监听', async () => {
    h.state.serviceEnabled = false
    const server = await makeServer()
    expect(h.state.servers).toHaveLength(0)
    expect(server.isListening()).toBe(false)
  })

  it('重复 start 不会起第二个 server', async () => {
    const server = await makeServer()
    server.start(6801)
    server.start(6802)
    await tick()
    expect(h.state.servers).toHaveLength(1)
  })

  it('凭据被撤销后 apply 会停止监听', async () => {
    const server = await makeServer()
    expect(server.isListening()).toBe(true)
    h.state.settings = { aria2: { secret: '' } }
    h.state.tokens = []
    server.apply()
    const created = h.state.servers[0] as { closed: boolean }
    expect(created.closed).toBe(true)
    expect(server.isListening()).toBe(false)
  })

  it('stop 之后 isListening 为 false', async () => {
    const server = await makeServer()
    server.stop()
    expect(server.isListening()).toBe(false)
  })

  it('端口被占用时只记 warn，条件恢复后可以重试监听', async () => {
    h.state.listenError = { code: 'EADDRINUSE' }
    const server = await makeServer()
    await tick()
    expect(server.isListening()).toBe(false)
    expect(h.state.logs.warn.some((line) => line.includes('已被占用'))).toBe(true)

    h.state.listenError = null
    server.apply()
    await tick()
    expect(h.state.servers).toHaveLength(2)
    expect(server.isListening()).toBe(true)
  })

  it('clientError 直接断开连接', async () => {
    await makeServer()
    const created = h.state.servers[0] as { emit: (event: string, ...args: unknown[]) => void }
    const socket = { destroy: vi.fn() }
    created.emit('clientError', new Error('bad request'), socket)
    expect(socket.destroy).toHaveBeenCalledTimes(1)
  })
})

describe('鉴权闸门', () => {
  it('没有 Authorization 头时回 401', async () => {
    await makeServer()
    const res = await call({ url: '/api/status' })
    expect(res.status).toBe(401)
    expect(json(res)).toMatchObject({ ok: false, code: 'unauthorized' })
  })

  it('网页来源即使带着正确密钥也回 401', async () => {
    await makeServer()
    const res = await call({
      url: '/api/status',
      headers: { authorization: 'Bearer ' + SECRET, origin: 'https://evil.example.com' }
    })
    expect(res.status).toBe(401)
  })

  it('密钥鉴权通过时视为全权（scopes 为 null）', async () => {
    await makeServer()
    const res = await call({ url: '/api/status', headers: authHeaders() })
    expect(res.status).toBe(200)
  })

  it('token 鉴权通过后刷新 lastSeenAt', async () => {
    h.state.tokens = [makeTokenRecord(['tasks:read'])]
    await makeServer()
    const res = await call({ url: '/api/status', headers: tokenHeaders(TOKEN) })
    expect(res.status).toBe(200)
    expect(h.state.touched).toEqual([TOKEN])
  })

  it('未授权请求不记录扩展版本', async () => {
    const server = await makeServer()
    await call({ url: '/api/status', headers: { 'x-extension-version': '9.9.9' } })
    expect(server.getExtensionConnection().version).toBeNull()
  })

  it('鉴权通过后记录扩展版本与最近活动时间', async () => {
    const server = await makeServer()
    await call({ url: '/api/status', headers: authHeaders({ 'x-extension-version': '1.6.0' }) })
    const connection = server.getExtensionConnection()
    expect(connection.version).toBe('1.6.0')
    expect(typeof connection.lastSeenAt).toBe('number')
    expect(Number(connection.lastSeenAt)).toBeGreaterThan(0)
  })

  it('方法不在 GET/POST 白名单时回 405', async () => {
    await makeServer()
    const res = await call({ method: 'PUT', url: '/api/status', headers: authHeaders() })
    expect(res.status).toBe(405)
    expect(json(res)).toMatchObject({ code: 'method_not_allowed' })
  })

  it('畸形请求目标回 400 而不是把主进程打崩', async () => {
    await makeServer()
    const res = await call({ url: 'http://[', headers: authHeaders() })
    expect(res.status).toBe(400)
    expect(json(res)).toMatchObject({ ok: false, code: 'bad_request' })
  })

  it('处理过程中的异常就地转成 500', async () => {
    await makeServer()
    h.state.settingsThrows = true
    const res = await call({ url: '/api/status', headers: authHeaders() })
    expect(res.status).toBe(500)
    expect(json(res)).toMatchObject({ ok: false, code: 'internal' })
  })

  it('未知路由回 404', async () => {
    await makeServer()
    const res = await call({ url: '/api/nope', headers: authHeaders() })
    expect(res.status).toBe(404)
    expect(json(res)).toMatchObject({ code: 'not_found' })
  })
})

describe('/api/status 与任务端点', () => {
  it('返回应用版本、引擎状态与下载目录', async () => {
    h.state.rpcPlan = { 'aria2.getVersion': { version: '1.37.0' } }
    await makeServer()
    const res = await call({ url: '/api/status', headers: authHeaders() })
    expect(res.status).toBe(200)
    expect(json(res)).toEqual({
      ok: true,
      appVersion: '1.5.0',
      engine: { running: true, pid: 4242, version: '1.37.0' },
      downloadDir: 'C:/Downloads'
    })
  })

  it('引擎没在跑时不发 RPC 查版本', async () => {
    h.state.engineInfo = { isRunning: false }
    await makeServer()
    const res = await call({ url: '/api/status', headers: authHeaders() })
    expect(json(res)).toMatchObject({ engine: { running: false, pid: null, version: '' } })
    expect(h.state.rpcCalls).toHaveLength(0)
  })

  it('缺 tasks:read scope 的 token 读任务列表被拒', async () => {
    h.state.tokens = [makeTokenRecord(['download:add'])]
    await makeServer()
    const res = await call({ url: '/api/tasks', headers: tokenHeaders(TOKEN) })
    expect(res.status).toBe(403)
    expect(json(res)).toMatchObject({ code: 'insufficient_scope' })
  })

  it('GET /api/tasks 汇总三类任务与全局统计', async () => {
    h.state.rpcPlan = {
      'aria2.tellActive': [{ gid: 'g1', status: 'active', totalLength: '100', completedLength: '50', downloadSpeed: '10', files: [{ path: 'C:/a.bin' }], bittorrent: {} }],
      'aria2.tellWaiting': [],
      'aria2.tellStopped': [],
      'aria2.getGlobalStat': { downloadSpeed: '100', uploadSpeed: '5', numActive: '1', numWaiting: '0', numStopped: '0' }
    }
    await makeServer()
    const res = await call({ url: '/api/tasks', headers: authHeaders() })
    const body = json(res) as { ok: boolean; tasks: Array<Record<string, unknown>>; stats: Record<string, unknown> }
    expect(body.ok).toBe(true)
    expect(body.tasks).toHaveLength(1)
    expect(body.tasks[0]).toMatchObject({ gid: 'g1', status: 'active' })
    expect(typeof body.tasks[0]?.name).toBe('string')
    expect(body.stats).toMatchObject({ downloadSpeed: '100', numActive: '1' })
  })

  it('引擎不可用时任务列表回 ok:false 而不是抛错', async () => {
    h.state.rpcPlan = { 'aria2.tellActive': new Error('ECONNREFUSED') }
    await makeServer()
    const res = await call({ url: '/api/tasks', headers: authHeaders() })
    expect(res.status).toBe(200)
    expect(json(res)).toMatchObject({ ok: false, code: 'engine_unavailable' })
  })

  it('POST /api/tasks 方法不对回 405', async () => {
    await makeServer()
    const res = await call({ method: 'POST', url: '/api/tasks', headers: authHeaders() })
    expect(res.status).toBe(405)
  })

  it('/api/task 缺 gid 回 400', async () => {
    await makeServer()
    const res = await call({ method: 'POST', url: '/api/task', headers: authHeaders() }, { action: 'pause' })
    expect(res.status).toBe(400)
    expect(json(res)).toMatchObject({ code: 'invalid_gid' })
  })

  it('/api/task 不支持的动作回 400', async () => {
    await makeServer()
    const res = await call({ method: 'POST', url: '/api/task', headers: authHeaders() }, { action: 'explode', gid: 'g1' })
    expect(res.status).toBe(400)
    expect(json(res)).toMatchObject({ code: 'invalid_action' })
  })

  it('remove 会顺带清掉结果记录', async () => {
    h.state.rpcPlan = { 'aria2.remove': 'OK', 'aria2.removeDownloadResult': 'OK' }
    await makeServer()
    const res = await call({ method: 'POST', url: '/api/task', headers: authHeaders() }, { action: 'remove', gid: 'g1' })
    expect(json(res)).toEqual({ ok: true })
    expect(h.state.rpcCalls.map((row) => row.method)).toEqual(['aria2.remove', 'aria2.removeDownloadResult'])
  })

  it('任务操作失败时回 engine_unavailable 而不是 500', async () => {
    h.state.rpcPlan = { 'aria2.pause': new Error('Unauthorized') }
    await makeServer()
    const res = await call({ method: 'POST', url: '/api/task', headers: authHeaders() }, { action: 'pause', gid: 'g1' })
    expect(res.status).toBe(200)
    expect(json(res)).toMatchObject({ ok: false, code: 'engine_unavailable' })
  })

  it('用密钥调 /api/unpair 时明确告知没有可撤销的 token', async () => {
    await makeServer()
    const res = await call({ method: 'POST', url: '/api/unpair', headers: authHeaders() })
    expect(json(res)).toMatchObject({ ok: true, revoked: false, code: 'not_a_token' })
  })

  it('token 调 /api/unpair 只撤销自己那一枚', async () => {
    h.state.tokens = [makeTokenRecord(['tasks:read'])]
    await makeServer()
    const res = await call({ method: 'POST', url: '/api/unpair', headers: tokenHeaders(TOKEN) })
    expect(json(res)).toMatchObject({ ok: true, revoked: true })
    expect(h.state.tokens).toHaveLength(0)
  })
})

describe('/api/resolve 与 /api/add', () => {
  it('缺 url 时回 400', async () => {
    await makeServer()
    const res = await call({ method: 'POST', url: '/api/resolve', headers: authHeaders() }, {})
    expect(res.status).toBe(400)
    expect(json(res)).toMatchObject({ code: 'invalid_url' })
  })

  it('非白名单协议回 400', async () => {
    await makeServer()
    const res = await call({ method: 'POST', url: '/api/add', headers: authHeaders() }, { url: 'javascript:alert(1)' })
    expect(res.status).toBe(400)
    expect(json(res)).toMatchObject({ code: 'invalid_url' })
  })

  it('按 App 的分类规则算出目录、子目录与文件名', async () => {
    await makeServer()
    const res = await call(
      { method: 'POST', url: '/api/resolve', headers: authHeaders() },
      { url: 'http://example.com/movie.mp4' }
    )
    expect(res.status).toBe(200)
    expect(json(res)).toEqual({
      ok: true,
      resolved: {
        url: 'http://example.com/movie.mp4',
        fileName: 'movie.mp4',
        dir: 'C:/Downloads/Video',
        subdir: 'Video',
        category: 'video',
        conflict: false,
        out: ''
      }
    })
  })

  it('建任务时把净化后的文件名与请求头下发，危险头被剔除', async () => {
    h.state.rpcPlan = { 'aria2.addUri': 'gid-1' }
    await makeServer()
    const res = await call(
      { method: 'POST', url: '/api/add', headers: authHeaders() },
      {
        url: 'http://example.com/movie.mp4',
        fileName: '../../escape.mp4',
        headers: ['Cookie: a=b', 'Host: evil.example.com', 'Referer: https://site.example/x', 'User-Agent: UA/1']
      }
    )
    expect(res.status).toBe(200)
    expect(json(res)).toMatchObject({ ok: true, gid: 'gid-1', fileName: 'escape.mp4' })

    const lastCall = h.state.rpcCalls[h.state.rpcCalls.length - 1] as { params: unknown[] }
    const options = lastCall.params[1] as Record<string, unknown>
    expect(options.dir).toBe('C:/Downloads/Video')
    expect(options.out).toBe('escape.mp4')
    expect(options.header).toEqual(['cookie: a=b'])
    expect(options.referer).toBe('https://site.example/x')
    expect(options['user-agent']).toBe('UA/1')
    expect(options['max-connection-per-server']).toBe('5')
    expect(options.pause).toBeUndefined()
  })

  it('自动开始关闭时给 aria2 下发 pause', async () => {
    h.state.settings = {
      ...baseSettings(),
      download: { defaultDir: 'C:/Downloads', autoStart: false }
    }
    h.state.rpcPlan = { 'aria2.addUri': 'gid-2' }
    await makeServer()
    await call({ method: 'POST', url: '/api/add', headers: authHeaders() }, { url: 'http://example.com/movie.mp4' })
    const lastCall = h.state.rpcCalls[h.state.rpcCalls.length - 1] as { params: unknown[] }
    expect((lastCall.params[1] as Record<string, unknown>).pause).toBe('true')
  })

  it('RPC 失败时回 502 engine_unavailable', async () => {
    h.state.rpcPlan = { 'aria2.addUri': new Error('engine down') }
    await makeServer()
    const res = await call({ method: 'POST', url: '/api/add', headers: authHeaders() }, { url: 'http://example.com/movie.mp4' })
    expect(res.status).toBe(502)
    expect(json(res)).toMatchObject({ ok: false, code: 'engine_unavailable' })
  })

  it('重名时用带序号的新名字', async () => {
    h.state.conflict = { conflict: true, fileName: 'movie (1).mp4' }
    h.state.rpcPlan = { 'aria2.addUri': 'gid-3' }
    await makeServer()
    const res = await call({ method: 'POST', url: '/api/add', headers: authHeaders() }, { url: 'http://example.com/movie.mp4' })
    expect(json(res)).toMatchObject({ conflict: true, renamed: 'movie (1).mp4' })
  })
})

describe('/api/stream* 流媒体端点', () => {
  it('yt-dlp 不可用时回 ok:false', async () => {
    h.state.ytdlp = { available: false }
    await makeServer()
    const res = await call({ method: 'POST', url: '/api/stream', headers: authHeaders() }, { url: 'https://example.com/v' })
    expect(res.status).toBe(200)
    expect(json(res)).toMatchObject({ ok: false, code: 'ytdlp_missing' })
    expect(h.state.streamInputs).toHaveLength(0)
  })

  it('可用时交给流媒体服务并回任务 id', async () => {
    await makeServer()
    const res = await call({ method: 'POST', url: '/api/stream', headers: authHeaders() }, { url: 'https://example.com/v', title: 'x' })
    expect(json(res)).toEqual({ ok: true, id: 'stream-1' })
    expect(h.state.streamInputs[0]).toMatchObject({ url: 'https://example.com/v', outputDir: 'C:/Downloads' })
  })

  it('非法 URL 回 400', async () => {
    await makeServer()
    const res = await call({ method: 'POST', url: '/api/stream', headers: authHeaders() }, { url: 'file:///etc/passwd' })
    expect(res.status).toBe(400)
    expect(json(res)).toMatchObject({ code: 'invalid_url' })
  })

  it('GET /api/stream-tasks 返回任务快照', async () => {
    h.state.streamTasks = [{ id: 's1' }]
    await makeServer()
    const res = await call({ url: '/api/stream-tasks', headers: authHeaders() })
    expect(json(res)).toEqual({ ok: true, tasks: [{ id: 's1' }] })
  })

  it('暂停已结束的任务如实报错', async () => {
    h.state.pauseResult = false
    await makeServer()
    const res = await call({ method: 'POST', url: '/api/stream-task', headers: authHeaders() }, { action: 'pause', id: 's1' })
    expect(json(res)).toMatchObject({ ok: false, code: 'not_running' })
  })

  it('remove 只清列表与临时目录，不动已下载文件', async () => {
    await makeServer()
    const res = await call({ method: 'POST', url: '/api/stream-task', headers: authHeaders() }, { action: 'remove', id: 's1' })
    expect(json(res)).toEqual({ ok: true })
    expect(h.state.discarded).toEqual(['s1'])
    expect(h.state.forgotten).toEqual(['s1'])
  })

  it('/api/stream-task 缺 id 回 400', async () => {
    await makeServer()
    const res = await call({ method: 'POST', url: '/api/stream-task', headers: authHeaders() }, { action: 'pause' })
    expect(json(res)).toMatchObject({ code: 'invalid_id' })
  })
})

describe('/api/mcp JSON-RPC', () => {
  it('通知（无 id）回 202 且无响应体', async () => {
    await makeServer()
    const res = await call({ method: 'POST', url: '/api/mcp', headers: authHeaders() }, { jsonrpc: '2.0', method: 'notifications/initialized' })
    expect(res.status).toBe(202)
    expect(res.body).toBe('')
  })

  it('initialize 返回协议版本与服务信息', async () => {
    await makeServer()
    const res = await call({ method: 'POST', url: '/api/mcp', headers: authHeaders() }, { jsonrpc: '2.0', id: 1, method: 'initialize' })
    const body = json(res) as { jsonrpc: string; id: number; result: Record<string, unknown> }
    expect(body.jsonrpc).toBe('2.0')
    expect(body.id).toBe(1)
    expect(typeof body.result.protocolVersion).toBe('string')
    expect(body.result.serverInfo).toMatchObject({ version: '1.5.0' })
  })

  it('tools/list 与工具 scope 表一一对应（不允许有工具没有声明 scope）', async () => {
    await makeServer()
    const res = await call({ method: 'POST', url: '/api/mcp', headers: authHeaders() }, { jsonrpc: '2.0', id: 2, method: 'tools/list' })
    const result = json(res).result as { tools: Array<{ name: string }> }
    const { MCP_TOOL_SCOPES } = await import('../utils/mcpCore')
    const names = result.tools.map((tool) => tool.name).sort()
    expect(names).toEqual(Object.keys(MCP_TOOL_SCOPES).sort())
  })

  it('tools/call 走真实 RPC 并返回文本结果', async () => {
    h.state.rpcPlan = { 'aria2.getVersion': { version: '1.37.0' } }
    await makeServer()
    const res = await call(
      { method: 'POST', url: '/api/mcp', headers: authHeaders() },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_version', arguments: {} } }
    )
    const result = json(res).result as { content: Array<{ text: string }>; isError?: boolean }
    expect(result.isError).toBeUndefined()
    expect(result.content[0]?.text).toContain('1.37.0')
  })

  it('未知工具返回 isError 而不是协议错误', async () => {
    await makeServer()
    const res = await call(
      { method: 'POST', url: '/api/mcp', headers: authHeaders() },
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nuke_everything', arguments: {} } }
    )
    const result = json(res).result as { content: Array<{ text: string }>; isError?: boolean }
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('Unknown tool')
  })

  it('破坏性工具缺 confirm 时拒绝执行并提示先问用户', async () => {
    await makeServer()
    const res = await call(
      { method: 'POST', url: '/api/mcp', headers: authHeaders() },
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'remove_task', arguments: { gid: 'g1' } } }
    )
    const result = json(res).result as { content: Array<{ text: string }>; isError?: boolean }
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('confirm=true')
    expect(h.state.rpcCalls).toHaveLength(0)
  })

  it('带 confirm 的 remove_task 才真的下发', async () => {
    h.state.rpcPlan = { 'aria2.remove': 'OK', 'aria2.removeDownloadResult': 'OK' }
    await makeServer()
    const res = await call(
      { method: 'POST', url: '/api/mcp', headers: authHeaders() },
      { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'remove_task', arguments: { gid: 'g1', confirm: true } } }
    )
    expect((json(res).result as { isError?: boolean }).isError).toBeUndefined()
    expect(h.state.rpcCalls.map((row) => row.method)).toEqual(['aria2.remove', 'aria2.removeDownloadResult'])
  })

  it('只读 token 调控制类工具被 403 拦住（工具级 scope）', async () => {
    h.state.tokens = [makeTokenRecord(['tasks:read'])]
    await makeServer()
    const res = await call(
      { method: 'POST', url: '/api/mcp', headers: tokenHeaders(TOKEN) },
      { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'remove_task', arguments: { gid: 'g1', confirm: true } } }
    )
    expect(res.status).toBe(403)
    expect(json(res)).toMatchObject({ code: 'insufficient_scope' })
    expect(h.state.rpcCalls).toHaveLength(0)
  })

  it('未知方法回 -32601', async () => {
    await makeServer()
    const res = await call({ method: 'POST', url: '/api/mcp', headers: authHeaders() }, { jsonrpc: '2.0', id: 8, method: 'tools/destroy' })
    expect((json(res).error as { code: number }).code).toBe(-32601)
  })

  it('payload 不是对象时回 invalidRequest', async () => {
    await makeServer()
    const res = await call({ method: 'POST', url: '/api/mcp', headers: authHeaders() }, '[]')
    expect((json(res).error as { code: number }).code).toBe(-32600)
  })

  it('resources/read 未知 URI 回 invalidParams', async () => {
    await makeServer()
    const res = await call(
      { method: 'POST', url: '/api/mcp', headers: authHeaders() },
      { jsonrpc: '2.0', id: 9, method: 'resources/read', params: { uri: 'aria2://nope' } }
    )
    expect((json(res).error as { code: number }).code).toBe(-32602)
  })

  it('resources/read 已知 URI 走 RPC 并包成 JSON 文本', async () => {
    h.state.rpcPlan = { 'aria2.getGlobalStat': { downloadSpeed: '9' } }
    await makeServer()
    const res = await call(
      { method: 'POST', url: '/api/mcp', headers: authHeaders() },
      { jsonrpc: '2.0', id: 10, method: 'resources/read', params: { uri: 'aria2://status/global' } }
    )
    const result = json(res).result as { contents: Array<{ uri: string; mimeType: string; text: string }> }
    expect(result.contents[0]?.uri).toBe('aria2://status/global')
    expect(result.contents[0]?.mimeType).toBe('application/json')
    expect(result.contents[0]?.text).toContain('downloadSpeed')
  })

  it('prompts/get 未知名称回 invalidParams', async () => {
    await makeServer()
    const res = await call(
      { method: 'POST', url: '/api/mcp', headers: authHeaders() },
      { jsonrpc: '2.0', id: 11, method: 'prompts/get', params: { name: 'nope' } }
    )
    expect((json(res).error as { code: number }).code).toBe(-32602)
  })
})

describe('/api/pair 配对', () => {
  it('非扩展来源一律拒绝（网页/curl 触发不了）', async () => {
    await makeServer()
    const res = await call({ method: 'POST', url: '/api/pair', headers: { origin: 'https://evil.example.com' } }, {})
    expect(res.status).toBe(403)
    expect(json(res)).toMatchObject({ code: 'pairing_forbidden' })
    expect(h.state.dialogCalls).toHaveLength(0)
  })

  it('没有 RPC 密钥时明确失败而不是返回空密钥', async () => {
    h.state.settings = { aria2: { secret: '' } }
    // 没有密钥但有已配对 token：接口仍在监听，配对端点必须明确回 409
    h.state.tokens = [makeTokenRecord(['tasks:read'])]
    await makeServer()
    const res = await call({ method: 'POST', url: '/api/pair', headers: { origin: EXTENSION_ORIGIN } }, {})
    expect(res.status).toBe(409)
    expect(json(res)).toMatchObject({ code: 'secret_required' })
  })

  it('用户点拒绝时不签发 token', async () => {
    h.state.pairResponse = 1
    await makeServer()
    const res = await call({ method: 'POST', url: '/api/pair', headers: { origin: EXTENSION_ORIGIN } }, { name: '测试扩展' })
    expect(res.status).toBe(403)
    expect(json(res)).toMatchObject({ code: 'pairing_denied' })
    expect(h.state.added).toHaveLength(0)
  })

  it('用户允许后签发受限 token，绝不返回 RPC 密钥', async () => {
    await makeServer()
    const res = await call({ method: 'POST', url: '/api/pair', headers: { origin: EXTENSION_ORIGIN } }, { name: '测试扩展' })
    expect(res.status).toBe(200)
    const body = json(res) as Record<string, unknown>
    expect(String(body.token)).toMatch(/^ext_[A-Za-z0-9_-]{43}$/)
    expect(body.secret).toBeUndefined()
    expect(body.scopes).toEqual(['download:add', 'tasks:read', 'tasks:control', 'stream:control'])
    expect(body.port).toBe(6800)
    expect(body.extensionId).toBe(EXTENSION_ID)
    expect(h.state.added[0]).toMatchObject({ extensionId: EXTENSION_ID, extensionName: '测试扩展' })
  })

  it('确认框展示的是净化后的扩展信息，不夹带来源原文以外的东西', async () => {
    await makeServer()
    await call(
      { method: 'POST', url: '/api/pair', headers: { origin: EXTENSION_ORIGIN, 'x-extension-version': '2.1.0' } },
      { name: 'badname' }
    )
    const options = h.state.dialogCalls[0] as { detail: string }
    expect(options.detail).toContain('bad name')
    expect(options.detail).toContain(EXTENSION_ID)
    expect(options.detail).toContain('2.1.0')
  })

  it('GET /api/pair 回 405', async () => {
    await makeServer()
    const res = await call({ url: '/api/pair', headers: { origin: EXTENSION_ORIGIN } })
    expect(res.status).toBe(405)
  })

  it('请求体解析失败不影响配对（名称回落固定文案）', async () => {
    await makeServer()
    const res = await call({ method: 'POST', url: '/api/pair', headers: { origin: EXTENSION_ORIGIN } }, 'not-json')
    expect(res.status).toBe(200)
    const { defaultExtensionName } = await import('../utils/mainProcessCopy')
    expect(h.state.added[0]?.extensionName).toBe(defaultExtensionName('zh'))
  })
})

describe('已配对扩展管理', () => {
  it('列表只给 token 前 8 位，不泄露完整凭据', async () => {
    h.state.tokens = [makeTokenRecord(['tasks:read'])]
    const server = await makeServer()
    const rows = server.listPairedExtensions()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.tokenPreview).toBe(TOKEN.slice(0, 8))
    expect(rows[0]?.token).toBeUndefined()
  })

  it('按扩展撤销返回撤销条数', async () => {
    h.state.tokens = [makeTokenRecord(['tasks:read']), { ...makeTokenRecord(['tasks:read']), token: 'ext_' + 'c'.repeat(43), extensionId: 'b'.repeat(32) }]
    const server = await makeServer()
    expect(server.revokeExtension(EXTENSION_ID)).toBe(1)
    expect(h.state.tokens).toHaveLength(1)
  })

  it('按 token 撤销成功返回 true，不存在返回 false', async () => {
    h.state.tokens = [makeTokenRecord(['tasks:read'])]
    const server = await makeServer()
    expect(server.revokeToken(TOKEN)).toBe(true)
    expect(server.revokeToken(TOKEN)).toBe(false)
  })

  it('userData 不可用时退化为内存存储而不是抛错', async () => {
    h.state.getPathThrows = true
    const server = await makeServer()
    expect(server.isListening()).toBe(true)
    expect(server.listPairedExtensions()).toEqual([])
    expect(h.state.logs.warn.some((line) => line.includes('userData'))).toBe(true)
  })
})

describe('请求体限制', () => {
  it('超过 16KB 的请求体回 400 而不是把内存吃满', async () => {
    await makeServer()
    const big = 'x'.repeat(20000)
    const res = await call({ method: 'POST', url: '/api/add', headers: authHeaders() }, JSON.stringify({ url: 'http://a/b', fileName: big }))
    expect(res.status).toBe(400)
    expect(json(res)).toMatchObject({ code: 'bad_request' })
  })

  it('非法 JSON 回 400', async () => {
    await makeServer()
    const res = await call({ method: 'POST', url: '/api/add', headers: authHeaders() }, '{oops')
    expect(res.status).toBe(400)
    expect(json(res)).toMatchObject({ code: 'bad_request' })
  })
})

async function callTool(
  name: string,
  args: Record<string, unknown> = {}
): Promise<{ text: string; isError: boolean }> {
  const res = await call(
    { method: 'POST', url: '/api/mcp', headers: authHeaders() },
    { jsonrpc: '2.0', id: 42, method: 'tools/call', params: { name, arguments: args } }
  )
  const result = json(res).result as { content: Array<{ text: string }>; isError?: boolean }
  return { text: result.content[0]?.text ?? '', isError: result.isError === true }
}

function lastRpc(): { method?: unknown; params?: unknown[] } {
  return h.state.rpcCalls[h.state.rpcCalls.length - 1] as { method?: unknown; params?: unknown[] }
}

describe('MCP 工具：参数校验与 RPC 映射', () => {
  it('add_download 缺 url 时直接报错，不碰引擎', async () => {
    await makeServer()
    const result = await callTool('add_download')
    expect(result.isError).toBe(true)
    expect(result.text).toBe('url is required')
    expect(h.state.rpcCalls).toHaveLength(0)
  })

  it('add_download 的 url 不是字符串时明确区分「缺失」与「类型错」', async () => {
    await makeServer()
    const result = await callTool('add_download', { url: 42 })
    expect(result.text).toBe('url must be a string')
    expect(h.state.rpcCalls).toHaveLength(0)
  })

  it('add_download 拒绝白名单以外的协议', async () => {
    await makeServer()
    const result = await callTool('add_download', { url: 'file:///etc/passwd' })
    expect(result.isError).toBe(true)
    expect(result.text).toContain('URL is not allowed')
    expect(h.state.rpcCalls).toHaveLength(0)
  })

  it('add_download 的 fileName 非字符串时报错', async () => {
    await makeServer()
    const result = await callTool('add_download', { url: 'http://a/b.zip', fileName: 7 })
    expect(result.text).toBe('fileName must be a string')
  })

  it('add_download 把净化后的文件名放进 out，并回带 gid', async () => {
    h.state.rpcPlan = { 'aria2.addUri': 'gid-9' }
    await makeServer()
    const result = await callTool('add_download', { url: 'http://a/b.zip', fileName: '../../evil.zip' })
    expect(result.isError).toBe(false)
    expect(result.text).toBe('Download added. gid=gid-9')
    const params = lastRpc().params as unknown[]
    expect(params[0]).toEqual(['http://a/b.zip'])
    expect((params[1] as Record<string, unknown>).out).toBe('evil.zip')
  })

  it('add_download 的 fileName 只有空白时不带 out（不让空名盖掉服务器给的名字）', async () => {
    h.state.rpcPlan = { 'aria2.addUri': 'gid-10' }
    await makeServer()
    await callTool('add_download', { url: 'http://a/b.zip', fileName: '   ' })
    const options = (lastRpc().params as unknown[])[1] as Record<string, unknown>
    expect(options.out).toBeUndefined()
  })

  it('list_tasks 默认查 active + waiting，并把任务映射成精简字段', async () => {
    h.state.rpcPlan = {
      'aria2.tellActive': [
        { gid: 'g1', status: 'active', totalLength: '100', completedLength: '50', downloadSpeed: '10', bittorrent: { info: { name: 'a.zip' } } }
      ],
      'aria2.tellWaiting': []
    }
    await makeServer()
    const result = await callTool('list_tasks')
    const parsed = JSON.parse(result.text) as { count: number; tasks: Array<Record<string, unknown>> }
    expect(parsed.count).toBe(1)
    expect(parsed.tasks[0]).toEqual({ gid: 'g1', status: 'active', name: 'a.zip', size: '100', completed: '50', speed: '10' })
    expect(h.state.rpcCalls.map((row) => row.method)).toEqual(['aria2.tellActive', 'aria2.tellWaiting'])
  })

  it('list_tasks 的 limit 会把结果截断', async () => {
    h.state.rpcPlan = {
      'aria2.tellActive': [
        { gid: 'g1', status: 'active', bittorrent: { info: { name: 'a' } } },
        { gid: 'g2', status: 'active', bittorrent: { info: { name: 'b' } } }
      ],
      'aria2.tellWaiting': []
    }
    await makeServer()
    const result = await callTool('list_tasks', { limit: 1 })
    const parsed = JSON.parse(result.text) as { count: number; tasks: Array<Record<string, unknown>> }
    expect(parsed.count).toBe(1)
    expect(parsed.tasks[0]?.gid).toBe('g1')
  })

  it('list_tasks 的 limit 会被钳到 1..100', async () => {
    h.state.rpcPlan = { 'aria2.tellWaiting': [] }
    await makeServer()
    await callTool('list_tasks', { status: 'waiting', limit: 0 })
    expect((lastRpc().params as unknown[]).slice(0, 2)).toEqual([0, 1])

    h.state.rpcCalls = []
    await callTool('list_tasks', { status: 'waiting', limit: 999 })
    expect((lastRpc().params as unknown[]).slice(0, 2)).toEqual([0, 100])
  })

  it('list_tasks 的 limit 非数字时报错', async () => {
    await makeServer()
    const result = await callTool('list_tasks', { limit: 'ten' })
    expect(result.text).toBe('limit must be a number')
  })

  it('list_tasks 的 status 非字符串时报错', async () => {
    await makeServer()
    const result = await callTool('list_tasks', { status: 3 })
    expect(result.text).toBe('status must be a string')
  })

  it('list_tasks 指定 status 时只查对应的那一类', async () => {
    h.state.rpcPlan = { 'aria2.tellStopped': [] }
    await makeServer()
    await callTool('list_tasks', { status: 'stopped' })
    expect(h.state.rpcCalls.map((row) => row.method)).toEqual(['aria2.tellStopped'])
  })

  it('list_tasks 的 all 三路并发后整体截断到 limit', async () => {
    h.state.rpcPlan = {
      'aria2.tellActive': [
        { gid: 'a1', status: 'active' },
        { gid: 'a2', status: 'active' }
      ],
      'aria2.tellWaiting': [{ gid: 'w1', status: 'waiting' }],
      'aria2.tellStopped': [{ gid: 's1', status: 'complete' }]
    }
    await makeServer()
    const result = await callTool('list_tasks', { status: 'all', limit: 2 })
    const parsed = JSON.parse(result.text) as { count: number; tasks: Array<Record<string, unknown>> }
    expect(parsed.count).toBe(2)
    expect(parsed.tasks.map((task) => task.gid)).toEqual(['a1', 'a2'])
  })

  it('get_download_status 不带 gid 时只回五项全局统计', async () => {
    h.state.rpcPlan = {
      'aria2.getGlobalStat': {
        downloadSpeed: '9',
        uploadSpeed: '1',
        numActive: '2',
        numWaiting: '3',
        numStopped: '4',
        extra: 'should be dropped'
      }
    }
    await makeServer()
    const result = await callTool('get_download_status')
    expect(JSON.parse(result.text)).toEqual({
      downloadSpeed: '9',
      uploadSpeed: '1',
      numActive: '2',
      numWaiting: '3',
      numStopped: '4'
    })
  })

  it('get_download_status 带 gid 时改查单个任务', async () => {
    h.state.rpcPlan = { 'aria2.tellStatus': { gid: 'g1', status: 'active', dir: 'C:/d' } }
    await makeServer()
    const result = await callTool('get_download_status', { gid: 'g1' })
    expect(result.text).toContain('C:/d')
    const params = lastRpc().params as unknown[]
    expect(params[0]).toBe('g1')
    expect((params[1] as string[]).length).toBe(12)
  })

  it('get_download_status 的 gid 非字符串时报错', async () => {
    await makeServer()
    expect((await callTool('get_download_status', { gid: 1 })).text).toBe('gid must be a string')
  })

  it('get_task_status 缺 gid 与 gid 类型错的文案不同', async () => {
    await makeServer()
    expect((await callTool('get_task_status')).text).toBe('gid is required')
    expect((await callTool('get_task_status', { gid: null })).text).toBe('gid is required')
    expect((await callTool('get_task_status', { gid: 5 })).text).toBe('gid must be a string')
  })

  it('get_task_status 查询时多要一个 bittorrent 字段', async () => {
    h.state.rpcPlan = { 'aria2.tellStatus': { gid: 'g1', bittorrent: { info: { name: 'x' } } } }
    await makeServer()
    const result = await callTool('get_task_status', { gid: 'g1' })
    expect(result.text).toContain('"name": "x"')
    const keys = (lastRpc().params as unknown[])[1] as string[]
    expect(keys).toContain('bittorrent')
    expect(keys.length).toBe(13)
  })

  it('pause_task 与 resume_task 分别下发 pause / unpause', async () => {
    h.state.rpcPlan = { 'aria2.pause': 'OK', 'aria2.unpause': 'OK' }
    await makeServer()
    const paused = await callTool('pause_task', { gid: 'g1' })
    expect(paused.text).toBe('Paused task g1')
    const resumed = await callTool('resume_task', { gid: 'g1' })
    expect(resumed.text).toBe('Resumed task g1')
    expect(h.state.rpcCalls.map((row) => row.method)).toEqual(['aria2.pause', 'aria2.unpause'])
  })

  it('pause_task 缺 gid 时报错且不下发', async () => {
    await makeServer()
    expect((await callTool('pause_task')).text).toBe('gid is required')
    expect(h.state.rpcCalls).toHaveLength(0)
  })

  it('remove_task 先 remove 再清结果，remove 失败也继续', async () => {
    h.state.rpcPlan = { 'aria2.remove': new Error('already stopped'), 'aria2.removeDownloadResult': 'OK' }
    await makeServer()
    const result = await callTool('remove_task', { gid: 'g1', confirm: true })
    expect(result.isError).toBe(false)
    expect(result.text).toBe('Removed task g1 (downloaded files were kept)')
    expect(h.state.rpcCalls.map((row) => row.method)).toEqual(['aria2.remove', 'aria2.removeDownloadResult'])
  })

  it('pause_all 与 resume_all 各发一条全局命令', async () => {
    h.state.rpcPlan = { 'aria2.pauseAll': 'OK', 'aria2.unpauseAll': 'OK' }
    await makeServer()
    expect((await callTool('pause_all', { confirm: true })).text).toBe('All active tasks paused')
    expect((await callTool('resume_all')).text).toBe('All paused tasks resumed')
    expect(h.state.rpcCalls.map((row) => row.method)).toEqual(['aria2.pauseAll', 'aria2.unpauseAll'])
  })

  it('set_speed_limit 只给下载时不动上传限速', async () => {
    h.state.rpcPlan = { 'aria2.changeGlobalOption': 'OK' }
    await makeServer()
    const result = await callTool('set_speed_limit', { download: 1048576 })
    expect(result.text).toBe('Speed limit set: download=1048576 B/s')
    expect((lastRpc().params as unknown[])[0]).toEqual({ 'max-overall-download-limit': '1048576' })
  })

  it('set_speed_limit 同时给上传时两项都下发', async () => {
    h.state.rpcPlan = { 'aria2.changeGlobalOption': 'OK' }
    await makeServer()
    const result = await callTool('set_speed_limit', { download: 0, upload: 2048 })
    expect(result.text).toBe('Speed limit set: download=0 B/s, upload=2048 B/s')
    expect((lastRpc().params as unknown[])[0]).toEqual({
      'max-overall-download-limit': '0',
      'max-overall-upload-limit': '2048'
    })
  })

  it('set_speed_limit 拒绝负值与非数字', async () => {
    await makeServer()
    expect((await callTool('set_speed_limit', { download: -1 })).text).toBe('download must be a non-negative number')
    expect((await callTool('set_speed_limit', { download: 1, upload: -2 })).text).toBe('upload must be a non-negative number')
    expect((await callTool('set_speed_limit', { download: 'fast' })).text).toBe('download must be a non-negative number')
    expect(h.state.rpcCalls).toHaveLength(0)
  })

  it('只读统计类工具各发一条对应 RPC 并原样回 JSON', async () => {
    h.state.rpcPlan = {
      'aria2.getGlobalStat': { numActive: '1' },
      'aria2.getVersion': { version: '1.37.0' },
      'aria2.getSessionInfo': { sessionId: 'abc' },
      'aria2.getGlobalOption': { dir: 'C:/d' }
    }
    await makeServer()
    expect((await callTool('get_global_stats')).text).toContain('numActive')
    expect((await callTool('get_version')).text).toContain('1.37.0')
    expect((await callTool('get_session_info')).text).toContain('abc')
    expect((await callTool('get_global_options')).text).toContain('C:/d')
    expect(h.state.rpcCalls.map((row) => row.method)).toEqual([
      'aria2.getGlobalStat',
      'aria2.getVersion',
      'aria2.getSessionInfo',
      'aria2.getGlobalOption'
    ])
  })

  it('get_task_peers / servers / files 三个查询各自映射到对应 RPC', async () => {
    h.state.rpcPlan = {
      'aria2.getPeers': [{ peerId: 'p1' }],
      'aria2.getServers': [{ index: '1' }],
      'aria2.tellStatus': { gid: 'g1', files: [{ path: 'C:/d/a.bin' }] }
    }
    await makeServer()
    expect((await callTool('get_task_peers', { gid: 'g1' })).text).toContain('p1')
    expect((await callTool('get_task_servers', { gid: 'g1' })).text).toContain('"index": "1"')
    expect((await callTool('get_task_files', { gid: 'g1' })).text).toContain('a.bin')
    expect(h.state.rpcCalls.map((row) => row.method)).toEqual([
      'aria2.getPeers',
      'aria2.getServers',
      'aria2.tellStatus'
    ])
  })

  it('change_task_position 默认用 POS_SET 并回新位置', async () => {
    h.state.rpcPlan = { 'aria2.changePosition': 3 }
    await makeServer()
    const result = await callTool('change_task_position', { gid: 'g1', position: 2 })
    expect(result.text).toBe('Task g1 moved; new position=3')
    expect(lastRpc().params).toEqual(['g1', 2, 'POS_SET'])
  })

  it('change_task_position 的 how 与 position 都有校验', async () => {
    await makeServer()
    expect((await callTool('change_task_position', { gid: 'g1', position: 0, how: 'END' })).text).toBe(
      'how must be POS_SET, POS_CUR or POS_END'
    )
    expect((await callTool('change_task_position', { gid: 'g1', position: -1 })).text).toBe(
      'position must be a non-negative number'
    )
    expect(h.state.rpcCalls).toHaveLength(0)
  })

  it('set_task_speed_limit 只给下载时只写 max-download-limit', async () => {
    h.state.rpcPlan = { 'aria2.changeOption': 'OK' }
    await makeServer()
    const result = await callTool('set_task_speed_limit', { gid: 'g1', download: 1024 })
    expect(result.text).toContain('"max-download-limit":"1024"')
    expect(lastRpc().params).toEqual(['g1', { 'max-download-limit': '1024' }])
  })

  it('set_task_speed_limit 两项都给时都写进去', async () => {
    h.state.rpcPlan = { 'aria2.changeOption': 'OK' }
    await makeServer()
    await callTool('set_task_speed_limit', { gid: 'g1', download: 0, upload: 0 })
    expect(lastRpc().params).toEqual(['g1', { 'max-download-limit': '0', 'max-upload-limit': '0' }])
  })

  it('set_task_speed_limit 既不传下载也不传上传时报错', async () => {
    await makeServer()
    expect((await callTool('set_task_speed_limit', { gid: 'g1' })).text).toBe('download or upload is required')
    expect(h.state.rpcCalls).toHaveLength(0)
  })

  it('set_task_speed_limit 的上传不接受负数（与全局 -1 语义不同）', async () => {
    await makeServer()
    expect((await callTool('set_task_speed_limit', { gid: 'g1', upload: -1 })).text).toBe(
      'upload must be a non-negative number'
    )
  })

  it('set_max_concurrent 写入全局选项，越界则报错', async () => {
    h.state.rpcPlan = { 'aria2.changeGlobalOption': 'OK' }
    await makeServer()
    const result = await callTool('set_max_concurrent', { value: 5 })
    expect(result.text).toBe('Maximum concurrent downloads set to 5')
    expect((lastRpc().params as unknown[])[0]).toEqual({ 'max-concurrent-downloads': '5' })
    expect((await callTool('set_max_concurrent', { value: 0 })).text).toBe('value must be between 1 and 50')
    expect((await callTool('set_max_concurrent', { value: 51 })).text).toBe('value must be between 1 and 50')
  })

  it('purge_download_result 带 confirm 才清结果记录', async () => {
    h.state.rpcPlan = { 'aria2.removeDownloadResult': 'OK' }
    await makeServer()
    const result = await callTool('purge_download_result', { gid: 'g1', confirm: true })
    expect(result.text).toBe('Removed result entry for g1')
    expect(h.state.rpcCalls.map((row) => row.method)).toEqual(['aria2.removeDownloadResult'])
  })

  it('resolve_and_download 走分类规则并把 gid 与最终路径带回', async () => {
    h.state.rpcPlan = { 'aria2.addUri': 'gid-r1' }
    await makeServer()
    const result = await callTool('resolve_and_download', { url: 'http://example.com/movie.mp4', fileName: '../../escape.mp4' })
    expect(result.isError).toBe(false)
    const parsed = JSON.parse(result.text) as Record<string, unknown>
    expect(parsed).toMatchObject({ ok: true, gid: 'gid-r1', dir: 'C:/Downloads/Video', fileName: 'escape.mp4', category: 'video' })
    const options = (lastRpc().params as unknown[])[1] as Record<string, unknown>
    expect(options.out).toBe('escape.mp4')
    expect(options.dir).toBe('C:/Downloads/Video')
  })

  it('resolve_and_download 缺 url 与非法协议都直接报错', async () => {
    await makeServer()
    expect((await callTool('resolve_and_download')).text).toBe('url is required')
    const bad = await callTool('resolve_and_download', { url: 'file:///etc/passwd' })
    expect(bad.isError).toBe(true)
    expect(bad.text).toBe('Unsupported url')
    expect(h.state.rpcCalls).toHaveLength(0)
  })

  it('get_download_overview 一次并发聚合全局统计与三类任务', async () => {
    h.state.rpcPlan = {
      'aria2.getGlobalStat': { downloadSpeed: '9', uploadSpeed: '1', numActive: '1', numWaiting: '1', numStopped: '1' },
      'aria2.tellActive': [{ gid: 'a1', status: 'active', totalLength: '100', completedLength: '40', downloadSpeed: '9', files: [{ path: '/d/a.bin' }] }],
      'aria2.tellWaiting': [{ gid: 'w1', status: 'waiting' }],
      'aria2.tellStopped': [{ gid: 's1', status: 'error', errorCode: '2', errorMessage: 'No URI available.' }]
    }
    await makeServer()
    const result = await callTool('get_download_overview')
    const parsed = JSON.parse(result.text) as { global: Record<string, unknown>; active: Array<Record<string, unknown>>; waiting: Array<Record<string, unknown>>; stopped: Array<Record<string, unknown>> }
    expect(parsed.global).toEqual({ downloadSpeed: '9', uploadSpeed: '1', numActive: '1', numWaiting: '1', numStopped: '1' })
    expect(parsed.active[0]).toMatchObject({ gid: 'a1', name: 'a.bin', size: '100', completed: '40', speed: '9' })
    expect(parsed.waiting[0]?.gid).toBe('w1')
    expect(parsed.stopped[0]).toMatchObject({ gid: 's1', errorCode: '2', errorMessage: 'No URI available.' })
    expect(h.state.rpcCalls.map((row) => row.method)).toEqual(['aria2.getGlobalStat', 'aria2.tellActive', 'aria2.tellWaiting', 'aria2.tellStopped'])
  })

  it('diagnose_task 汇总状态、服务器与 peer，并对错误给出建议', async () => {
    h.state.rpcPlan = {
      'aria2.tellStatus': { gid: 'g1', status: 'error', totalLength: '1000', completedLength: '500', downloadSpeed: '0', connections: '0', errorCode: '2', errorMessage: 'No URI available.', files: [{ path: '/d/x.bin' }] },
      'aria2.getServers': [],
      'aria2.getPeers': new Error('not a torrent')
    }
    await makeServer()
    const result = await callTool('diagnose_task', { gid: 'g1' })
    expect(result.isError).toBe(false)
    const parsed = JSON.parse(result.text) as { status: string; progress: number; name: string; serversCount: number; peersCount: number; suggestions: string[] }
    expect(parsed).toMatchObject({ status: 'error', progress: 50, name: 'x.bin', serversCount: 0, peersCount: 0 })
    expect(parsed.suggestions[0]).toContain('errorCode=2')
    expect(parsed.suggestions[1]).toContain('retry')
  })

  it('diagnose_task 缺 gid 时报错，状态查询失败时把原因带回', async () => {
    await makeServer()
    expect((await callTool('diagnose_task')).text).toBe('gid is required')
    h.state.rpcPlan = { 'aria2.tellStatus': new Error('gid not found') }
    const failed = await callTool('diagnose_task', { gid: 'missing' })
    expect(failed.isError).toBe(true)
    expect(failed.text).toBe('gid not found')
  })

  it('save_session 落盘会话', async () => {
    h.state.rpcPlan = { 'aria2.saveSession': 'OK' }
    await makeServer()
    expect((await callTool('save_session')).text).toBe('Download session saved')
  })

  it('RPC 抛错被包成 isError 而不是 500', async () => {
    h.state.rpcPlan = { 'aria2.getVersion': new Error('engine down') }
    await makeServer()
    const result = await callTool('get_version')
    expect(result.isError).toBe(true)
    expect(result.text).toBe('engine down')
  })

  it('tools/call 缺 params 时回 invalidParams 而不是执行空工具', async () => {
    await makeServer()
    const res = await call({ method: 'POST', url: '/api/mcp', headers: authHeaders() }, { jsonrpc: '2.0', id: 43, method: 'tools/call' })
    expect((json(res).error as { code: number }).code).toBe(-32602)
    expect(h.state.rpcCalls).toHaveLength(0)
  })

  it('resources/read 三类任务 URI 各自带上分页与字段清单', async () => {
    h.state.rpcPlan = {
      'aria2.tellActive': [{ gid: 'a' }],
      'aria2.tellWaiting': [{ gid: 'w' }],
      'aria2.tellStopped': [{ gid: 's' }]
    }
    await makeServer()
    for (const uri of ['aria2://tasks/active', 'aria2://tasks/waiting', 'aria2://tasks/stopped']) {
      const res = await call(
        { method: 'POST', url: '/api/mcp', headers: authHeaders() },
        { jsonrpc: '2.0', id: 44, method: 'resources/read', params: { uri } }
      )
      const contents = (json(res).result as { contents: Array<{ uri: string }> }).contents
      expect(contents[0]?.uri).toBe(uri)
    }
    const stoppedKeys = (h.state.rpcCalls[2]?.params as unknown[])[2] as string[]
    expect(stoppedKeys).toContain('errorMessage')
    expect(stoppedKeys.length).toBe(9)
  })

  it('prompts/get 两个模板分别带出过滤条件与 gid', async () => {
    await makeServer()
    const summary = await call(
      { method: 'POST', url: '/api/mcp', headers: authHeaders() },
      { jsonrpc: '2.0', id: 45, method: 'prompts/get', params: { name: 'download_summary', arguments: { status: 'active' } } }
    )
    const summaryResult = json(summary).result as { messages: Array<{ content: { text: string } }> }
    expect(summaryResult.messages[0]?.content.text).toContain('"active"')

    const diagnose = await call(
      { method: 'POST', url: '/api/mcp', headers: authHeaders() },
      { jsonrpc: '2.0', id: 46, method: 'prompts/get', params: { name: 'diagnose_downloads', arguments: { gid: 'g1' } } }
    )
    const diagnoseText = (json(diagnose).result as { messages: Array<{ content: { text: string } }> }).messages[0]
      ?.content.text
    expect(diagnoseText).toContain('gid g1')
    expect(diagnoseText).toContain('get_task_peers')
  })

  it('prompts/get 不带参数时回落到通用文案', async () => {
    await makeServer()
    const summary = await call(
      { method: 'POST', url: '/api/mcp', headers: authHeaders() },
      { jsonrpc: '2.0', id: 47, method: 'prompts/get', params: { name: 'download_summary' } }
    )
    expect((json(summary).result as { messages: Array<{ content: { text: string } }> }).messages[0]?.content.text).toContain(
      '"all"'
    )
    const diagnose = await call(
      { method: 'POST', url: '/api/mcp', headers: authHeaders() },
      { jsonrpc: '2.0', id: 48, method: 'prompts/get', params: { name: 'diagnose_downloads' } }
    )
    expect((json(diagnose).result as { messages: Array<{ content: { text: string } }> }).messages[0]?.content.text).toContain(
      'List current downloads'
    )
  })
})

describe('/api/stream* 补充分支', () => {
  it('GET /api/stream 回 405', async () => {
    await makeServer()
    const res = await call({ url: '/api/stream', headers: authHeaders() })
    expect(res.status).toBe(405)
  })

  it('没有 stream:control 的 token 被 403 拦住', async () => {
    h.state.tokens = [makeTokenRecord(['download:add'])]
    await makeServer()
    const res = await call({ method: 'POST', url: '/api/stream', headers: tokenHeaders(TOKEN) }, { url: 'https://a/b' })
    expect(res.status).toBe(403)
    expect(json(res)).toMatchObject({ code: 'insufficient_scope' })
    expect(h.state.streamInputs).toHaveLength(0)
  })

  it('流媒体服务启动失败时把 code 与 error 原样带回', async () => {
    h.state.streamStart = { success: false, code: 'ffmpeg_missing', error: 'ffmpeg not found' }
    await makeServer()
    const res = await call({ method: 'POST', url: '/api/stream', headers: authHeaders() }, { url: 'https://a/b' })
    expect(json(res)).toEqual({ ok: false, code: 'ffmpeg_missing', error: 'ffmpeg not found' })
  })

  it('POST /api/stream-tasks 回 405', async () => {
    await makeServer()
    const res = await call({ method: 'POST', url: '/api/stream-tasks', headers: authHeaders() }, {})
    expect(res.status).toBe(405)
  })

  it('resume 与 pause 一样按任务 id 下发', async () => {
    h.state.resumeResult = true
    await makeServer()
    const res = await call({ method: 'POST', url: '/api/stream-task', headers: authHeaders() }, { action: 'resume', id: 's1' })
    expect(json(res)).toEqual({ ok: true })
  })

  it('未知 action 回 invalid_action', async () => {
    await makeServer()
    const res = await call({ method: 'POST', url: '/api/stream-task', headers: authHeaders() }, { action: 'explode', id: 's1' })
    expect(json(res)).toMatchObject({ code: 'invalid_action' })
  })

  it('/api/stream-task 的非法 JSON 回 bad_request', async () => {
    await makeServer()
    const res = await call({ method: 'POST', url: '/api/stream-task', headers: authHeaders() }, '{oops')
    expect(res.status).toBe(400)
    expect(json(res)).toMatchObject({ code: 'bad_request' })
  })
})
