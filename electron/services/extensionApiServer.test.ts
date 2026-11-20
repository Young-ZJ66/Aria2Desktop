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
