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
    streamCallback: null as null | ((event: unknown) => void),
    streamEvents: [] as unknown[],
    streamTasks: [] as unknown[],
    pauseResult: true,
    resumeResult: true,
    discarded: [] as string[],
    forgotten: [] as string[],
    probed: '' as string | null,
    conflict: { conflict: false, fileName: '' } as Record<string, unknown>,
    pairResponse: 0,
    dialogCalls: [] as unknown[],
    dialogMissing: false,
    dialogThrows: false,
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
    get showMessageBox() {
      if (h.state.dialogMissing) return undefined
      return async (options: unknown) => {
        h.state.dialogCalls.push(options)
        if (h.state.dialogThrows) throw new Error('dialog unavailable')
        return { response: h.state.pairResponse }
      }
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
  // 真实实现会调用传入的取语言回调（惰性），mock 也要调用一次，否则那段回调永远不被执行
  mainLocaleFrom: (getLocale?: () => string) => {
    if (typeof getLocale === 'function') getLocale()
    return h.state.locale
  }
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
  startStreamDownload: async (input: Record<string, unknown>, onEvent?: (event: unknown) => void) => {
    h.state.streamInputs.push(input)
    h.state.streamCallback = onEvent ?? null
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
  destroyed: boolean
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
  req.destroyed = false
  req.destroy = () => {
    req.destroyed = true
  }
  return req
}

async function waitEnd(res: FakeRes): Promise<void> {
  for (let i = 0; i < 200 && !res.ended; i++) await tick()
}

async function callRaw(
  options: { method?: string; url?: string; headers?: Record<string, string> },
  body?: unknown,
  mutate?: (res: FakeRes) => void
): Promise<{ req: FakeReq; res: FakeRes }> {
  const server = h.state.lastServer as { listener: (req: unknown, res: unknown) => void }
  const req = makeReq(options)
  const res = makeRes()
  if (mutate) mutate(res)
  server.listener(req, res)
  await tick()
  if (body !== undefined) req.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)))
  req.emit('end')
  await waitEnd(res)
  return { req, res }
}

async function call(
  options: { method?: string; url?: string; headers?: Record<string, string> },
  body?: unknown
): Promise<FakeRes> {
  const result = await callRaw(options, body)
  return result.res
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

type ServerHandle = {
  start: (port?: number) => void
  stop: () => void
  apply: () => void
  isListening: () => boolean
}

async function makeServer(overrides: Record<string, unknown> = {}): Promise<ServerHandle> {
  const { ExtensionApiServer } = await import('./extensionApiServer')
  const deps = {
    getAppVersion: () => '1.5.0',
    getEngineProcessInfo: () => h.state.engineInfo,
    confirmPairing: async () => true,
    sendStreamEvent: (event: unknown) => {
      h.state.streamEvents.push(event)
    },
    getServiceEnabled: () => h.state.serviceEnabled,
    ...overrides
  }
  const server = new ExtensionApiServer(deps as never)
  server.start(6801)
  await tick()
  return server as unknown as ServerHandle
}

async function callMcpTool(name: string, args: Record<string, unknown>): Promise<string> {
  const res = await call(
    { method: 'POST', url: '/api/mcp', headers: authHeaders() },
    { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name, arguments: args } }
  )
  const result = json(res).result as { content: Array<{ text: string }> }
  return result.content[0].text
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
  h.state.streamCallback = null
  h.state.streamEvents = []
  h.state.streamTasks = []
  h.state.pauseResult = true
  h.state.resumeResult = true
  h.state.discarded = []
  h.state.forgotten = []
  h.state.probed = ''
  h.state.conflict = { conflict: false, fileName: '' }
  h.state.pairResponse = 0
  h.state.dialogCalls = []
  h.state.dialogMissing = false
  h.state.dialogThrows = false
  h.state.getPathThrows = false
  h.state.logs = { warn: [], info: [], error: [] }
})

describe('监听与请求兜底', () => {
  it('重复 start 不会重复创建服务', async () => {
    const server = await makeServer()
    server.start(6801)
    server.start(6802)
    await tick()
    expect(h.state.servers).toHaveLength(1)
  })

  it('未监听时再次 stop 安全返回', async () => {
    const server = await makeServer()
    server.stop()
    expect(() => server.stop()).not.toThrow()
    expect(server.isListening()).toBe(false)
  })

  it('端口被非 EADDRINUSE 错误占住时只记日志', async () => {
    h.state.listenError = { code: 'EACCES' }
    await makeServer()
    await tick()
    expect(h.state.logs.warn).toContain('浏览器扩展本地接口启动失败:')
  })

  it('处理异常且响应头已发出时只结束响应', async () => {
    await makeServer()
    h.state.settingsThrows = true
    const { res } = await callRaw(
      { method: 'GET', url: '/api/status', headers: authHeaders() },
      undefined,
      (target) => {
        target.headersSent = true
      }
    )
    expect(res.ended).toBe(true)
    expect(res.body).toBe('')
  })

  it('处理异常且响应未发出时回 500 internal', async () => {
    await makeServer()
    h.state.settingsThrows = true
    const res = await call({ method: 'GET', url: '/api/status', headers: authHeaders() })
    expect(res.status).toBe(500)
    expect(json(res)).toEqual({ ok: false, code: 'internal', error: 'Internal Error' })
  })

  it('发送响应本身失败时销毁连接', async () => {
    await makeServer()
    h.state.settingsThrows = true
    const { res } = await callRaw(
      { method: 'GET', url: '/api/status', headers: authHeaders() },
      undefined,
      (target) => {
        target.writeHead = () => {
          throw new Error('write failed')
        }
      }
    )
    expect(res.ended).toBe(true)
    expect(res.body).toBe('')
  })
})

describe('各端点的方法与参数校验', () => {
  it('POST /api/status 回 405', async () => {
    await makeServer()
    const res = await call({ method: 'POST', url: '/api/status', headers: authHeaders() }, {})
    expect(res.status).toBe(405)
    expect(json(res)).toMatchObject({ code: 'method_not_allowed' })
  })

  it('GET /api/task 回 405', async () => {
    await makeServer()
    const res = await call({ method: 'GET', url: '/api/task', headers: authHeaders() })
    expect(res.status).toBe(405)
  })

  it('POST /api/task 的非法 JSON 回 bad_request', async () => {
    await makeServer()
    const res = await call({ method: 'POST', url: '/api/task', headers: authHeaders() }, '{oops')
    expect(res.status).toBe(400)
    expect(json(res)).toEqual({ ok: false, code: 'bad_request', error: 'Invalid JSON' })
  })

  it('GET /api/unpair 回 405', async () => {
    await makeServer()
    const res = await call({ method: 'GET', url: '/api/unpair', headers: authHeaders() })
    expect(res.status).toBe(405)
  })

  it('GET /api/resolve 回 405', async () => {
    await makeServer()
    const res = await call({ method: 'GET', url: '/api/resolve', headers: authHeaders() })
    expect(res.status).toBe(405)
  })

  it('POST /api/resolve 对不支持的协议回 invalid_url', async () => {
    await makeServer()
    const res = await call(
      { method: 'POST', url: '/api/resolve', headers: authHeaders() },
      { url: 'file:///C:/secret.txt' }
    )
    expect(res.status).toBe(400)
    expect(json(res)).toMatchObject({ code: 'invalid_url' })
  })

  it('GET /api/add 回 405', async () => {
    await makeServer()
    const res = await call({ method: 'GET', url: '/api/add', headers: authHeaders() })
    expect(res.status).toBe(405)
  })

  it('POST /api/stream 的非法 JSON 回 bad_request', async () => {
    await makeServer()
    const res = await call({ method: 'POST', url: '/api/stream', headers: authHeaders() }, '{oops')
    expect(res.status).toBe(400)
    expect(json(res)).toMatchObject({ code: 'bad_request' })
  })

  it('POST /api/stream 对不支持的协议回 invalid_url', async () => {
    await makeServer()
    const res = await call(
      { method: 'POST', url: '/api/stream', headers: authHeaders() },
      { url: 'file:///C:/secret.txt' }
    )
    expect(res.status).toBe(400)
    expect(json(res)).toMatchObject({ code: 'invalid_url' })
  })

  it('GET /api/stream-task 回 405', async () => {
    await makeServer()
    const res = await call({ method: 'GET', url: '/api/stream-task', headers: authHeaders() })
    expect(res.status).toBe(405)
  })

  it('GET /api/mcp 回 405', async () => {
    await makeServer()
    const res = await call({ method: 'GET', url: '/api/mcp', headers: authHeaders() })
    expect(res.status).toBe(405)
  })

  it('POST /api/mcp 的非法 JSON 回 bad_request', async () => {
    await makeServer()
    const res = await call({ method: 'POST', url: '/api/mcp', headers: authHeaders() }, '{oops')
    expect(res.status).toBe(400)
    expect(json(res)).toMatchObject({ code: 'bad_request' })
  })
})

describe('MCP 协议子集', () => {
  it('ping 回空对象结果', async () => {
    await makeServer()
    const res = await call(
      { method: 'POST', url: '/api/mcp', headers: authHeaders() },
      { jsonrpc: '2.0', id: 2, method: 'ping' }
    )
    expect(json(res)).toEqual({ jsonrpc: '2.0', id: 2, result: {} })
  })

  it('resources/list 回资源清单', async () => {
    await makeServer()
    const res = await call(
      { method: 'POST', url: '/api/mcp', headers: authHeaders() },
      { jsonrpc: '2.0', id: 3, method: 'resources/list' }
    )
    const result = json(res).result as { resources: unknown[] }
    expect(result.resources.length).toBeGreaterThan(0)
  })

  it('prompts/list 回提示模板', async () => {
    await makeServer()
    const res = await call(
      { method: 'POST', url: '/api/mcp', headers: authHeaders() },
      { jsonrpc: '2.0', id: 4, method: 'prompts/list' }
    )
    const result = json(res).result as { prompts: Array<{ name: string }> }
    expect(result.prompts.map((prompt) => prompt.name)).toContain('download_summary')
  })

  it('缺少 method 时回 invalidRequest', async () => {
    await makeServer()
    const res = await call(
      { method: 'POST', url: '/api/mcp', headers: authHeaders() },
      { jsonrpc: '2.0', id: 5 }
    )
    const payload = json(res) as { error: { code: number; message: string } }
    expect(payload.error.code).toBe(-32600)
    expect(payload.error.message).toBe('Missing method')
  })

  it('未知 method 回 methodNotFound', async () => {
    await makeServer()
    const res = await call(
      { method: 'POST', url: '/api/mcp', headers: authHeaders() },
      { jsonrpc: '2.0', id: 6, method: 'tools/nope' }
    )
    const payload = json(res) as { error: { code: number; message: string } }
    expect(payload.error.code).toBe(-32601)
    expect(payload.error.message).toBe('Unknown method: tools/nope')
  })
})

describe('MCP 工具参数类型校验', () => {
  const gidTools = [
    'pause_task',
    'resume_task',
    'remove_task',
    'get_task_peers',
    'get_task_servers',
    'get_task_files',
    'change_task_position',
    'set_task_speed_limit',
    'purge_download_result'
  ]

  for (const toolName of gidTools) {
    it(toolName + ' 的 gid 类型非法时拒绝执行', async () => {
      await makeServer()
      const text = await callMcpTool(toolName, { gid: 123, confirm: true, position: 1 })
      expect(text).toBe('gid must be a string')
      expect(h.state.rpcCalls).toHaveLength(0)
    })
  }

  it('change_task_position 的 how 类型非法时拒绝执行', async () => {
    await makeServer()
    const text = await callMcpTool('change_task_position', { gid: 'g1', position: 1, how: 5 })
    expect(text).toBe('how must be POS_SET, POS_CUR or POS_END')
  })

  it('set_task_speed_limit 的 download 为负数时拒绝执行', async () => {
    await makeServer()
    const text = await callMcpTool('set_task_speed_limit', { gid: 'g1', download: -1 })
    expect(text).toBe('download must be a non-negative number')
  })

  it('list_tasks 指定 active 时只查活动任务', async () => {
    h.state.rpcPlan = { 'aria2.tellActive': [] }
    await makeServer()
    const text = await callMcpTool('list_tasks', { status: 'active' })
    expect(JSON.parse(text)).toEqual({ count: 0, tasks: [] })
    expect(h.state.rpcCalls.map((call) => call.method)).toEqual(['aria2.tellActive'])
  })
})

describe('配对确认链', () => {
  it('未提供名称时用默认名并走内置对话框', async () => {
    await makeServer()
    const res = await call({ method: 'POST', url: '/api/pair', headers: { origin: EXTENSION_ORIGIN } })
    expect(res.status).toBe(200)
    expect(json(res)).toMatchObject({ ok: true })
    expect(h.state.added).toHaveLength(1)
    const options = h.state.dialogCalls[0] as { detail: string }
    expect(options.detail).toContain('扩展名称：Aria2 下载扩展')
  })

  it('宿主没有对话框时回落到旧确认回调', async () => {
    h.state.dialogMissing = true
    await makeServer()
    const res = await call({ method: 'POST', url: '/api/pair', headers: { origin: EXTENSION_ORIGIN } })
    expect(res.status).toBe(200)
    expect(h.state.dialogCalls).toHaveLength(0)
  })

  it('对话框抛错时回落旧确认并记日志', async () => {
    h.state.dialogThrows = true
    await makeServer()
    const res = await call({ method: 'POST', url: '/api/pair', headers: { origin: EXTENSION_ORIGIN } })
    expect(res.status).toBe(200)
    expect(h.state.logs.warn).toContain('扩展配对确认框不可用，回落到旧确认流程:')
  })

  it('注入的带信息确认优先于内置对话框', async () => {
    const seen: Array<{ name: string }> = []
    await makeServer({
      confirmPairingWithInfo: async (info: { name: string }) => {
        seen.push(info)
        return false
      }
    })
    const res = await call({ method: 'POST', url: '/api/pair', headers: { origin: EXTENSION_ORIGIN } })
    expect(res.status).toBe(403)
    expect(json(res)).toMatchObject({ code: 'pairing_denied' })
    expect(seen[0].name).toBe('Aria2 下载扩展')
    expect(h.state.dialogCalls).toHaveLength(0)
  })

  it('扩展自报的名称经净化后进入确认框', async () => {
    await makeServer()
    const res = await call(
      { method: 'POST', url: '/api/pair', headers: { origin: EXTENSION_ORIGIN } },
      { name: '  My\tExt\nName  ' }
    )
    expect(res.status).toBe(200)
    const options = h.state.dialogCalls[0] as { detail: string }
    // 控制字符被压成空格、连续空白收敛：名称落在单独一行里，不会额外撑出多行
    const nameLine = options.detail.split('\n')[0]
    expect(nameLine).toBe('扩展名称：My Ext Name')
  })

  it('自报名称不是字符串时回落到默认名', async () => {
    await makeServer()
    const res = await call(
      { method: 'POST', url: '/api/pair', headers: { origin: EXTENSION_ORIGIN } },
      { name: 42 }
    )
    expect(res.status).toBe(200)
    const options = h.state.dialogCalls[0] as { detail: string }
    expect(options.detail).toContain('名称：Aria2 下载扩展')
  })

  it('两条确认链都失败时按拒绝处理', async () => {
    h.state.dialogThrows = true
    await makeServer({
      confirmPairing: async () => {
        throw new Error('no gui')
      }
    })
    const res = await call({ method: 'POST', url: '/api/pair', headers: { origin: EXTENSION_ORIGIN } })
    expect(res.status).toBe(403)
    expect(h.state.added).toHaveLength(0)
  })
})

describe('scope 与下载细节', () => {
  it('带 tasks:read 的 token 可以读任务快照', async () => {
    h.state.tokens = [makeTokenRecord(['tasks:read'])]
    h.state.rpcPlan = {
      'aria2.tellActive': [],
      'aria2.tellWaiting': [],
      'aria2.tellStopped': [],
      'aria2.getGlobalStat': { downloadSpeed: '10' }
    }
    await makeServer()
    const res = await call({ method: 'GET', url: '/api/tasks', headers: tokenHeaders(TOKEN) })
    expect(res.status).toBe(200)
    expect(json(res)).toMatchObject({ ok: true, tasks: [] })
  })

  it('缺 stream:control 的 token 读流媒体列表被拒', async () => {
    h.state.tokens = [makeTokenRecord(['tasks:read'])]
    await makeServer()
    const res = await call({ method: 'GET', url: '/api/stream-tasks', headers: tokenHeaders(TOKEN) })
    expect(res.status).toBe(403)
    expect(json(res)).toMatchObject({ code: 'insufficient_scope' })
  })

  it('/api/stream 把下载事件回调转给依赖', async () => {
    await makeServer()
    const res = await call(
      { method: 'POST', url: '/api/stream', headers: authHeaders() },
      { url: 'https://www.example.com/video' }
    )
    expect(json(res)).toEqual({ ok: true, id: 'stream-1' })
    h.state.streamCallback?.({ type: 'started', id: 'stream-1' })
    expect(h.state.streamEvents).toEqual([{ type: 'started', id: 'stream-1' }])
  })

  it('探测到的文件名会用于解析结果', async () => {
    h.state.probed = 'movie.mkv'
    await makeServer()
    const res = await call(
      { method: 'POST', url: '/api/resolve', headers: authHeaders() },
      { url: 'https://www.example.com/download' }
    )
    const resolved = json(res).resolved as { fileName: string }
    expect(resolved.fileName).toBe('movie.mkv')
  })

  it('不安全的 out 值被丢弃并记日志', async () => {
    h.state.conflict = { conflict: true, fileName: '../evil.sh' }
    h.state.rpcPlan = { 'aria2.addUri': 'gid-1' }
    await makeServer()
    const res = await call(
      { method: 'POST', url: '/api/add', headers: authHeaders() },
      { url: 'https://www.example.com/file' }
    )
    expect(res.status).toBe(200)
    expect(h.state.logs.warn).toContain('丢弃不安全的 out 值，改由 aria2 按 URL 自行命名')
    const addCall = h.state.rpcCalls.find((entry) => entry.method === 'aria2.addUri')
    const options = (addCall?.params as unknown[])[1] as Record<string, unknown>
    expect(options.out).toBeUndefined()
  })

  it('resume 动作走 aria2.unpause', async () => {
    await makeServer()
    const res = await call(
      { method: 'POST', url: '/api/task', headers: authHeaders() },
      { action: 'resume', gid: 'g1' }
    )
    expect(json(res)).toEqual({ ok: true })
    expect(h.state.rpcCalls[0]).toMatchObject({ method: 'aria2.unpause', params: ['g1'] })
  })

  it('超过丢弃上限的请求体直接断开连接', async () => {
    await makeServer()
    const { req, res } = await callRaw(
      { method: 'POST', url: '/api/mcp', headers: authHeaders() },
      Buffer.alloc(1024 * 1024 + 10)
    )
    expect(res.status).toBe(400)
    expect(json(res)).toMatchObject({ error: 'Payload too large' })
    expect(req.destroyed).toBe(true)
  })

  it('请求体流出错时转成 bad_request', async () => {
    await makeServer()
    const server = h.state.lastServer as { listener: (req: unknown, res: unknown) => void }
    const req = makeReq({ method: 'POST', url: '/api/mcp', headers: authHeaders() })
    const res = makeRes()
    server.listener(req, res)
    await tick()
    req.emit('error', new Error('socket hang up'))
    await waitEnd(res)
    expect(res.status).toBe(400)
    expect(json(res)).toMatchObject({ code: 'bad_request', error: 'socket hang up' })
  })
})
