import { describe, expect, it, vi, beforeEach } from 'vitest'
import { PassThrough } from 'node:stream'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

const { rpcMock, settingsRef, saveMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  settingsRef: { current: {} as Record<string, unknown> },
  saveMock: vi.fn()
}))

vi.mock('electron', () => ({ app: { getVersion: () => '1.3.7', getPath: () => process.cwd() } }))
vi.mock('electron-log', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))
vi.mock('../utils/aria2Rpc', () => ({ callAria2Rpc: rpcMock }))
vi.mock('../utils/activeRpcConfig', () => ({ activeRpcOptions: () => ({ host: '127.0.0.1', port: 6800 }) }))
vi.mock('../utils/settingsAccessor', () => ({
  getSettingsFresh: () => settingsRef.current,
  saveSettings: saveMock
}))

const {
  ALL_WEB_CONSOLE_SCOPES,
  MIN_TOKEN_LENGTH,
  WEB_CONSOLE_SESSION_COOKIE,
  safeEqual,
  scopeAllows,
  resolveAuthFromSettings,
  routeScope,
  isPublicPath
} = await import('../utils/webConsoleAuth')
const { buildOpenApiDocument } = await import('../webConsoleOpenApi')
const { WEB_CONSOLE_MANIFEST, WEB_CONSOLE_SW, ICON_192_PNG_B64, ICON_512_PNG_B64 } = await import('../webConsoleAssets')
const { WEB_CONSOLE_HTML } = await import('../webConsolePage')
const { WebConsoleServer } = await import('./webConsoleServer')

type AnyServer = {
  handle: (req: IncomingMessage, res: ServerResponse, allowed: string[]) => Promise<void>
  servePublic: (pathname: string, res: ServerResponse) => boolean
  apply: () => Promise<{ running: boolean; port: number; token: string; error?: string }>
  stop: () => Promise<void>
  getStatus: () => { running: boolean; url: string; tls?: boolean }
  token: string
  bindHost: string
}

function makeRes() {
  const chunks: { status?: number; headers?: Record<string, string>; body?: string } = {}
  const res = {
    writeHead(status: number, headers?: Record<string, string>) {
      chunks.status = status
      chunks.headers = headers || {}
      return res
    },
    end(body?: string | Buffer) {
      chunks.body = Buffer.isBuffer(body) ? body.toString('binary') : String(body ?? '')
      return res
    }
  }
  return { res: res as unknown as ServerResponse, out: chunks }
}

/** SSE 用：需要 write/on('close')，不能用只记录 end 的 makeRes */
function makeStreamRes() {
  const chunks: { status?: number; headers?: Record<string, string>; chunks: string[] } = { chunks: [] }
  const res = {
    writeHead(status: number, headers?: Record<string, string>) {
      chunks.status = status
      chunks.headers = headers || {}
      return res
    },
    write(chunk: string) {
      chunks.chunks.push(String(chunk))
      return true
    },
    end() {
      return res
    },
    on() {
      return res
    }
  }
  return { res: res as unknown as ServerResponse, out: chunks }
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

function makeServer(settings: Record<string, unknown>): AnyServer {
  settingsRef.current = settings
  const server = new WebConsoleServer() as unknown as AnyServer
  const config = (settings.webConsole ?? {}) as { token?: string }
  server.token = String(config.token || '')
  server.bindHost = '127.0.0.1'
  return server
}

const MASTER = 'master-token-0123456789'

beforeEach(() => {
  rpcMock.mockReset()
  saveMock.mockReset()
  settingsRef.current = {}
})

describe('webConsoleAuth', () => {
  it('safeEqual 对长度不同的输入返回 false 而不抛错', () => {
    expect(safeEqual('abc', 'abcd')).toBe(false)
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual('', '')).toBe(true)
  })

  it('admin 通配全部权限，空权限一律拒绝', () => {
    expect(scopeAllows(['admin'], 'tasks:read')).toBe(true)
    expect(scopeAllows(['admin'], 'audit:read')).toBe(true)
    expect(scopeAllows(['tasks:read'], 'tasks:read')).toBe(true)
    expect(scopeAllows(['tasks:read'], 'tasks:write')).toBe(false)
    expect(scopeAllows([], 'tasks:read')).toBe(false)
    expect(scopeAllows(undefined, 'tasks:read')).toBe(false)
  })

  it('主令牌等价 admin，且 tokenId 为 null', () => {
    const auth = resolveAuthFromSettings({ webConsole: { token: MASTER } } as never, MASTER)
    expect(auth).toEqual({ scopes: ['admin'], tokenId: null })
  })

  it('细粒度令牌按自身 scopes 授权', () => {
    const settings = {
      webConsole: {
        token: MASTER,
        tokens: [
          { id: 'ro', name: '只读', token: 'readonly-token-abcdef', scopes: ['tasks:read'] },
          { id: 'rw', name: '写', token: 'write-token-abcdefgh', scopes: ['tasks:read', 'tasks:write'] }
        ]
      }
    }
    expect(resolveAuthFromSettings(settings as never, 'readonly-token-abcdef')).toEqual({ scopes: ['tasks:read'], tokenId: 'ro' })
    expect(resolveAuthFromSettings(settings as never, 'write-token-abcdefgh')).toEqual({ scopes: ['tasks:read', 'tasks:write'], tokenId: 'rw' })
  })

  it('过短的细粒度令牌不被接受（防止暴力枚举）', () => {
    const settings = { webConsole: { token: MASTER, tokens: [{ id: 'x', name: 'x', token: 'short', scopes: ['admin'] }] } }
    expect(MIN_TOKEN_LENGTH).toBe(16)
    expect(resolveAuthFromSettings(settings as never, 'short')).toBeNull()
  })

  it('无令牌或未知令牌返回 null', () => {
    const settings = { webConsole: { token: MASTER } }
    expect(resolveAuthFromSettings(settings as never, '')).toBeNull()
    expect(resolveAuthFromSettings(settings as never, 'nope-nope-nope-nope')).toBeNull()
    expect(resolveAuthFromSettings({} as never, MASTER)).toBeNull()
  })

  it('路由权限映射覆盖全部业务路由', () => {
    expect(routeScope('GET', '/api/status')).toBe('tasks:read')
    expect(routeScope('GET', '/api/events')).toBe('tasks:read')
    expect(routeScope('GET', '/api/audit')).toBe('audit:read')
    expect(routeScope('GET', '/api/queue')).toBe('tasks:read')
    expect(routeScope('POST', '/api/tasks')).toBe('tasks:write')
    expect(routeScope('POST', '/api/tasks/pauseAll')).toBe('tasks:control')
    expect(routeScope('POST', '/api/tasks/unpauseAll')).toBe('tasks:control')
    expect(routeScope('POST', '/api/tasks/abc123/pause')).toBe('tasks:control')
    expect(routeScope('POST', '/api/tasks/abc123/resume')).toBe('tasks:control')
    expect(routeScope('POST', '/api/tasks/abc123/remove')).toBe('tasks:control')
    expect(routeScope('GET', '/api/unknown')).toBeNull()
    expect(routeScope('DELETE', '/api/tasks')).toBeNull()
  })

  it('PWA 资源与文档免鉴权，业务接口不免', () => {
    for (const path of ['/', '/index.html', '/manifest.webmanifest', '/sw.js', '/openapi.json', '/icon-192.png', '/maskable-512.png']) {
      expect(isPublicPath(path)).toBe(true)
    }
    expect(isPublicPath('/api/status')).toBe(false)
    expect(isPublicPath('/../etc/passwd')).toBe(false)
  })

  it('权限枚举与文档保持完整', () => {
    expect(ALL_WEB_CONSOLE_SCOPES).toEqual(['tasks:read', 'tasks:write', 'tasks:control', 'audit:read', 'admin'])
  })
})

describe('OpenAPI 文档', () => {
  it('是合法 OpenAPI 3.0.3 且覆盖全部业务路由', () => {
    const doc = buildOpenApiDocument('1.3.7') as {
      openapi: string
      info: { version: string }
      paths: Record<string, unknown>
      components: { securitySchemes: Record<string, unknown> }
    }
    expect(doc.openapi).toBe('3.0.3')
    expect(doc.info.version).toBe('1.3.7')
    expect(Object.keys(doc.paths).sort()).toEqual(['/api/audit', '/api/events', '/api/queue', '/api/session', '/api/status', '/api/tasks', '/api/tasks/{action}', '/api/tasks/{gid}/{action}', '/openapi.json'])
    expect(doc.components.securitySchemes.bearerAuth).toBeTruthy()
    // 能被 JSON 序列化（无循环引用/函数）
    expect(() => JSON.stringify(doc)).not.toThrow()
  })
})

describe('PWA 资源', () => {
  it('manifest 可解析且含 4 个图标（any + maskable）', () => {
    const manifest = JSON.parse(WEB_CONSOLE_MANIFEST)
    expect(manifest.display).toBe('standalone')
    expect(manifest.start_url).toBe('/')
    expect(manifest.icons).toHaveLength(4)
    expect(manifest.icons.map((icon: { purpose: string }) => icon.purpose).sort()).toEqual(['any', 'any', 'maskable', 'maskable'])
    expect(manifest.icons.every((icon: { sizes: string }) => /^(192|512)x(192|512)$/.test(icon.sizes))).toBe(true)
  })

  it('Service Worker 缓存壳资源且不缓存 /api/', () => {
    expect(WEB_CONSOLE_SW).toContain("addEventListener('install'")
    expect(WEB_CONSOLE_SW).toContain("addEventListener('fetch'")
    expect(WEB_CONSOLE_SW).toContain("startsWith('/api/')")
    expect(WEB_CONSOLE_SW).toContain('skipWaiting')
    expect(WEB_CONSOLE_SW).toContain('clients.claim')
  })

  it('图标是 PNG 且尺寸符合声明', () => {
    for (const base64 of [ICON_192_PNG_B64, ICON_512_PNG_B64]) {
      const buffer = Buffer.from(base64, 'base64')
      expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    }
    // IHDR 宽高位于固定偏移
    expect(Buffer.from(ICON_192_PNG_B64, 'base64').readUInt32BE(16)).toBe(192)
    expect(Buffer.from(ICON_512_PNG_B64, 'base64').readUInt32BE(16)).toBe(512)
  })

  it('页面引用 manifest 与 Service Worker，并含移动端 viewport', () => {
    expect(WEB_CONSOLE_HTML).toContain('rel="manifest"')
    expect(WEB_CONSOLE_HTML).toContain('serviceWorker')
    expect(WEB_CONSOLE_HTML).toContain('viewport-fit=cover')
    expect(WEB_CONSOLE_HTML).toContain('apple-touch-icon')
  })
})

describe('WebConsoleServer.handle', () => {
  it('无令牌访问业务接口返回 401', async () => {
    const server = makeServer({ webConsole: { token: MASTER } })
    const { res, out } = makeRes()
    await server.handle(makeReq('GET', '/api/status'), res, [])
    expect(out.status).toBe(401)
    expect(JSON.parse(out.body || '{}').error).toBe('Unauthorized')
  })

  it('主令牌可读取状态并返回三类任务', async () => {
    rpcMock.mockImplementation(async (options: { method: string }) => {
      if (options.method === 'aria2.getGlobalStat') return { downloadSpeed: '100', uploadSpeed: '0', numActive: '1', numWaiting: '0', numStopped: '2' }
      if (options.method === 'aria2.tellActive') return [{ gid: 'g1', status: 'active', totalLength: '100', completedLength: '50', downloadSpeed: '10', files: [{ path: '/tmp/a.bin' }] }]
      return []
    })
    const server = makeServer({ webConsole: { token: MASTER } })
    const { res, out } = makeRes()
    await server.handle(makeReq('GET', '/api/status', { authorization: 'Bearer ' + MASTER }), res, [])
    expect(out.status).toBe(200)
    const body = JSON.parse(out.body || '{}')
    expect(body.ok).toBe(true)
    expect(body.active[0]).toMatchObject({ gid: 'g1', name: 'a.bin', status: 'active' })
    expect(body.waiting).toEqual([])
  })

  it('队列视图返回队列设置与等待中的任务', async () => {
    rpcMock.mockImplementation(async (options: { method: string }) => {
      if (options.method === 'aria2.tellWaiting') {
        return [
          { gid: 'w1', status: 'waiting', totalLength: '200', completedLength: '0', downloadSpeed: '0', files: [{ path: '/tmp/first.bin' }] },
          { gid: 'w2', status: 'paused', totalLength: '0', completedLength: '0', downloadSpeed: '0', files: [{ uris: [{ uri: 'https://example.com/second.bin' }] }] }
        ]
      }
      return []
    })
    const server = makeServer({
      webConsole: { token: MASTER },
      queue: { maxConcurrent: 3, retryEnabled: true, retryMaxAttempts: 5, retryDelaySeconds: 15 }
    })
    const { res, out } = makeRes()
    await server.handle(makeReq('GET', '/api/queue', { authorization: 'Bearer ' + MASTER }), res, [])
    expect(out.status).toBe(200)
    const body = JSON.parse(out.body || '{}')
    expect(body.ok).toBe(true)
    expect(body.settings).toEqual({ maxConcurrent: 3, retryEnabled: true, retryMaxAttempts: 5, retryDelaySeconds: 15 })
    expect(body.total).toBe(2)
    expect(body.tasks[0]).toMatchObject({ gid: 'w1', name: 'first.bin', status: 'waiting' })
    // 没有文件名时回退首个 URI，再回退 gid
    expect(body.tasks[1].name).toBe('https://example.com/second.bin')
    expect(rpcMock).toHaveBeenCalledWith(expect.objectContaining({ method: 'aria2.tellWaiting' }))
    // 只读接口，不该出现任何写方法
    for (const call of rpcMock.mock.calls) {
      const method = (call[0] as { method: string }).method
      expect(['aria2.tellWaiting']).toContain(method)
    }
  })

  it('队列设置缺失时回落到桌面端默认值', async () => {
    rpcMock.mockResolvedValue([])
    const server = makeServer({ webConsole: { token: MASTER } })
    const { res, out } = makeRes()
    await server.handle(makeReq('GET', '/api/queue', { authorization: 'Bearer ' + MASTER }), res, [])
    const body = JSON.parse(out.body || '{}')
    expect(body.settings).toEqual({ maxConcurrent: 5, retryEnabled: false, retryMaxAttempts: 3, retryDelaySeconds: 30 })
    expect(body.tasks).toEqual([])
    expect(body.total).toBe(0)
  })

  it('只读令牌可读队列，无令牌被拒', async () => {
    rpcMock.mockResolvedValue([])
    const server = makeServer({
      webConsole: {
        token: MASTER,
        tokens: [{ id: 'ro', name: '只读', token: 'readonly-token-abcdef', scopes: ['tasks:read'] }]
      }
    })
    const allowed = makeRes()
    await server.handle(makeReq('GET', '/api/queue', { authorization: 'Bearer readonly-token-abcdef' }), allowed.res, [])
    expect(allowed.out.status).toBe(200)

    const denied = makeRes()
    await server.handle(makeReq('GET', '/api/queue'), denied.res, [])
    expect(denied.out.status).toBe(401)
  })

  it('队列接口在 aria2 不可用时返回 500 而不是崩掉连接', async () => {
    rpcMock.mockRejectedValue(new Error('connect ECONNREFUSED'))
    const server = makeServer({ webConsole: { token: MASTER } })
    const { res, out } = makeRes()
    await server.handle(makeReq('GET', '/api/queue', { authorization: 'Bearer ' + MASTER }), res, [])
    expect(out.status).toBe(500)
    expect(JSON.parse(out.body || '{}').ok).toBe(false)
  })

  it('只读令牌写任务返回 403 insufficient_scope，且不调用 RPC', async () => {
    const settings = {
      webConsole: {
        token: MASTER,
        tokens: [{ id: 'ro', name: '只读', token: 'readonly-token-abcdef', scopes: ['tasks:read'] }]
      }
    }
    const server = makeServer(settings)
    const { res, out } = makeRes()
    await server.handle(makeReq('POST', '/api/tasks', { authorization: 'Bearer readonly-token-abcdef' }, JSON.stringify({ uris: ['https://example.com/a.bin'] })), res, [])
    expect(out.status).toBe(403)
    expect(JSON.parse(out.body || '{}').required).toBe('tasks:write')
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('有 tasks:write 的令牌可添加任务', async () => {
    rpcMock.mockResolvedValue('newgid')
    const settings = {
      webConsole: {
        token: MASTER,
        tokens: [{ id: 'rw', name: '写', token: 'write-token-abcdefgh', scopes: ['tasks:read', 'tasks:write'] }]
      }
    }
    const server = makeServer(settings)
    const { res, out } = makeRes()
    await server.handle(makeReq('POST', '/api/tasks', { authorization: 'Bearer write-token-abcdefgh' }, JSON.stringify({ uris: ['https://example.com/a.bin'], dir: process.cwd() })), res, [])
    expect(out.status).toBe(200)
    expect(JSON.parse(out.body || '{}').gid).toBe('newgid')
    expect(rpcMock).toHaveBeenCalledWith(expect.objectContaining({ method: 'aria2.addUri' }))
  })

  it('拒绝非白名单协议', async () => {
    const server = makeServer({ webConsole: { token: MASTER } })
    const { res, out } = makeRes()
    await server.handle(makeReq('POST', '/api/tasks', { authorization: 'Bearer ' + MASTER }, JSON.stringify({ uris: ['file:///etc/passwd'] })), res, [])
    expect(out.status).toBe(400)
    expect(JSON.parse(out.body || '{}').error).toBe('invalid_uri')
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('拒绝下载根目录之外的 dir', async () => {
    const server = makeServer({ webConsole: { token: MASTER } })
    const { res, out } = makeRes()
    await server.handle(makeReq('POST', '/api/tasks', { authorization: 'Bearer ' + MASTER }, JSON.stringify({ uris: ['https://example.com/a.bin'], dir: path.resolve(process.cwd(), '..') })), res, [])
    expect(out.status).toBe(400)
    expect(JSON.parse(out.body || '{}').error).toBe('dir_outside_download_root')
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('相对 dir 解析到下载根目录下', async () => {
    rpcMock.mockResolvedValue('newgid')
    const server = makeServer({ webConsole: { token: MASTER } })
    const { res, out } = makeRes()
    await server.handle(makeReq('POST', '/api/tasks', { authorization: 'Bearer ' + MASTER }, JSON.stringify({ uris: ['https://example.com/a.bin'], dir: 'sub' })), res, [])
    expect(out.status).toBe(200)
    expect(rpcMock).toHaveBeenCalledWith(expect.objectContaining({ method: 'aria2.addUri', params: [['https://example.com/a.bin'], { dir: path.resolve(process.cwd(), 'sub') }] }))
  })

  it('添加任务缺少 uris 返回 400', async () => {
    const server = makeServer({ webConsole: { token: MASTER } })
    const { res, out } = makeRes()
    await server.handle(makeReq('POST', '/api/tasks', { authorization: 'Bearer ' + MASTER }, '{}'), res, [])
    expect(out.status).toBe(400)
  })

  it('非法 JSON 返回 400', async () => {
    const server = makeServer({ webConsole: { token: MASTER } })
    const { res, out } = makeRes()
    await server.handle(makeReq('POST', '/api/tasks', { authorization: 'Bearer ' + MASTER }, '{oops'), res, [])
    expect(out.status).toBe(400)
  })

  it('pause / resume / remove 映射到正确 RPC 方法', async () => {
    rpcMock.mockResolvedValue('OK')
    const server = makeServer({ webConsole: { token: MASTER } })
    for (const [action, method] of [['pause', 'aria2.pause'], ['resume', 'aria2.unpause'], ['remove', 'aria2.forceRemove']] as const) {
      rpcMock.mockClear()
      const { res, out } = makeRes()
      await server.handle(makeReq('POST', '/api/tasks/g1/' + action, { authorization: 'Bearer ' + MASTER }), res, [])
      expect(out.status).toBe(200)
      expect(rpcMock).toHaveBeenCalledWith(expect.objectContaining({ method, params: ['g1'] }))
    }
  })

  it('pauseAll / unpauseAll 映射到全局 RPC 方法', async () => {
    rpcMock.mockResolvedValue('OK')
    const server = makeServer({ webConsole: { token: MASTER } })
    for (const [action, method] of [['pauseAll', 'aria2.pauseAll'], ['unpauseAll', 'aria2.unpauseAll']] as const) {
      rpcMock.mockClear()
      const { res, out } = makeRes()
      await server.handle(makeReq('POST', '/api/tasks/' + action, { authorization: 'Bearer ' + MASTER }), res, [])
      expect(out.status).toBe(200)
      expect(rpcMock).toHaveBeenCalledWith(expect.objectContaining({ method, params: [] }))
    }
  })

  it('IP 白名单外返回 403（含 CIDR）', async () => {
    rpcMock.mockImplementation(async (options: { method: string }) => {
      if (options.method === 'aria2.getGlobalStat') return {}
      return []
    })
    const server = makeServer({ webConsole: { token: MASTER } })
    const denied = makeRes()
    await server.handle(makeReq('GET', '/api/status', { authorization: 'Bearer ' + MASTER }, undefined, '10.0.0.9'), denied.res, ['192.168.1.0/24'])
    expect(denied.out.status).toBe(403)

    const allowed = makeRes()
    await server.handle(makeReq('GET', '/api/status', { authorization: 'Bearer ' + MASTER }, undefined, '192.168.1.42'), allowed.res, ['192.168.1.0/24'])
    expect(allowed.out.status).toBe(200)
  })

  it('公开路径免鉴权返回页面/资源', async () => {
    const server = makeServer({ webConsole: { token: MASTER } })
    const page = makeRes()
    await server.handle(makeReq('GET', '/'), page.res, [])
    expect(page.out.status).toBe(200)
    expect(page.out.headers?.['Content-Type']).toContain('text/html')

    const manifest = makeRes()
    await server.handle(makeReq('GET', '/manifest.webmanifest'), manifest.res, [])
    expect(manifest.out.headers?.['Content-Type']).toContain('application/manifest+json')

    const sw = makeRes()
    await server.handle(makeReq('GET', '/sw.js'), sw.res, [])
    expect(sw.out.headers?.['Service-Worker-Allowed']).toBe('/')

    const icon = makeRes()
    await server.handle(makeReq('GET', '/icon-192.png'), icon.res, [])
    expect(icon.out.headers?.['Content-Type']).toBe('image/png')

    const doc = makeRes()
    await server.handle(makeReq('GET', '/openapi.json'), doc.res, [])
    expect(JSON.parse(doc.out.body || '{}').openapi).toBe('3.0.3')
  })

  it('SSE 订阅返回事件流并立即推送一帧状态', async () => {
    rpcMock.mockImplementation(async (options: { method: string }) => {
      if (options.method === 'aria2.getGlobalStat') return { downloadSpeed: '0', numActive: '0', numWaiting: '0', numStopped: '0' }
      return []
    })
    const server = makeServer({ webConsole: { token: MASTER } }) as unknown as AnyServer & { stop: () => Promise<void> }
    const stream = makeStreamRes()
    await server.handle(makeReq('GET', '/api/events', { authorization: 'Bearer ' + MASTER }), stream.res, [])
    expect(stream.out.status).toBe(200)
    expect(stream.out.headers?.['Content-Type']).toContain('text/event-stream')
    // 首帧由后台任务异步计算，等一轮宏任务
    await new Promise(resolve => setTimeout(resolve, 0))
    const body = stream.out.chunks.join('')
    expect(body).toContain('retry: 3000')
    expect(body).toContain('event: status')
    expect(body).toContain('"globalStat"')
    await server.stop()
  })

  it('无令牌订阅事件流返回 401', async () => {
    const server = makeServer({ webConsole: { token: MASTER } })
    const { res, out } = makeRes()
    await server.handle(makeReq('GET', '/api/events'), res, [])
    expect(out.status).toBe(401)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('未知路由返回 404，且未鉴权时不泄露存在性', async () => {
    const server = makeServer({ webConsole: { token: MASTER } })
    const { res, out } = makeRes()
    await server.handle(makeReq('GET', '/api/nope'), res, [])
    expect(out.status).toBe(404)
    expect(rpcMock).not.toHaveBeenCalled()
  })
})

describe('WebConsoleServer 会话 Cookie', () => {
  function cookieFrom(out: { headers?: Record<string, string> }): string {
    const raw = String((out.headers || {})['Set-Cookie'] || '')
    return raw.split(';')[0]
  }

  it('用令牌换取 HttpOnly 会话 Cookie，之后不带 Bearer 也能读接口', async () => {
    rpcMock.mockImplementation(async (options: { method: string }) => {
      if (options.method === 'aria2.getGlobalStat') return { downloadSpeed: '0', uploadSpeed: '0', numActive: '0', numWaiting: '0', numStopped: '0' }
      return []
    })
    const server = makeServer({ webConsole: { token: MASTER } })
    const login = makeRes()
    await server.handle(makeReq('POST', '/api/session', {}, JSON.stringify({ token: MASTER })), login.res, [])
    expect(login.out.status).toBe(200)
    expect(JSON.parse(login.out.body || '{}')).toEqual({ ok: true, scopes: ['admin'] })
    const setCookie = String((login.out.headers || {})['Set-Cookie'] || '')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Strict')
    expect(setCookie).toContain('Path=/')
    expect(setCookie).toContain('Max-Age=')
    expect(setCookie).not.toContain(MASTER)

    const status = makeRes()
    await server.handle(makeReq('GET', '/api/status', { cookie: cookieFrom(login.out) }), status.res, [])
    expect(status.out.status).toBe(200)
    expect(JSON.parse(status.out.body || '{}').ok).toBe(true)
  })

  it('错误令牌换不到 Cookie，且记一条失败审计', async () => {
    const server = makeServer({ webConsole: { token: MASTER } })
    const { res, out } = makeRes()
    await server.handle(makeReq('POST', '/api/session', {}, JSON.stringify({ token: 'wrong-token-0123456789' })), res, [])
    expect(out.status).toBe(401)
    expect((out.headers || {})['Set-Cookie']).toBeUndefined()
    const audit = makeRes()
    await server.handle(makeReq('GET', '/api/audit', { authorization: 'Bearer ' + MASTER }), audit.res, [])
    const items = JSON.parse(audit.out.body || '{}').items || []
    expect(items.some((entry: { action: string; detail: string; success: boolean }) => entry.action === 'auth' && entry.detail === '/api/session' && entry.success === false)).toBe(true)
  })

  it('伪造或过期的 Cookie 换不来权限', async () => {
    const server = makeServer({ webConsole: { token: MASTER } })
    const { res, out } = makeRes()
    await server.handle(makeReq('GET', '/api/status', { cookie: WEB_CONSOLE_SESSION_COOKIE + '=forged-value' }), res, [])
    expect(out.status).toBe(401)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('退出登录清掉 Cookie，之后的请求重新变成未登录', async () => {
    rpcMock.mockResolvedValue([])
    const server = makeServer({ webConsole: { token: MASTER } })
    const login = makeRes()
    await server.handle(makeReq('POST', '/api/session', {}, JSON.stringify({ token: MASTER })), login.res, [])
    const cookie = cookieFrom(login.out)

    const logout = makeRes()
    await server.handle(makeReq('DELETE', '/api/session', { cookie }), logout.res, [])
    expect(logout.out.status).toBe(200)
    expect(String((logout.out.headers || {})['Set-Cookie'] || '')).toContain('Max-Age=0')

    const after = makeRes()
    await server.handle(makeReq('GET', '/api/status', { cookie }), after.res, [])
    expect(after.out.status).toBe(401)
  })

  it('会话接口的请求体非法时返回 400，而不是 500', async () => {
    const server = makeServer({ webConsole: { token: MASTER } })
    const { res, out } = makeRes()
    await server.handle(makeReq('POST', '/api/session', {}, '{oops'), res, [])
    expect(out.status).toBe(400)
    expect(JSON.parse(out.body || '{}').error).toBe('Invalid JSON body')
  })

  it('令牌字段缺失或类型不对时按未授权处理', async () => {
    const server = makeServer({ webConsole: { token: MASTER } })
    const missing = makeRes()
    await server.handle(makeReq('POST', '/api/session', {}, '{}'), missing.res, [])
    expect(missing.out.status).toBe(401)
    const wrongType = makeRes()
    await server.handle(makeReq('POST', '/api/session', {}, JSON.stringify({ token: 123 })), wrongType.res, [])
    expect(wrongType.out.status).toBe(401)
  })

  it('只读令牌换到的会话也只有只读权限', async () => {
    const server = makeServer({
      webConsole: { token: MASTER, tokens: [{ id: 'ro', name: '只读', token: 'readonly-token-abcdef', scopes: ['tasks:read'] }] }
    })
    const login = makeRes()
    await server.handle(makeReq('POST', '/api/session', {}, JSON.stringify({ token: 'readonly-token-abcdef' })), login.res, [])
    expect(login.out.status).toBe(200)
    expect(JSON.parse(login.out.body || '{}').scopes).toEqual(['tasks:read'])
    const write = makeRes()
    await server.handle(makeReq('POST', '/api/tasks', { cookie: cookieFrom(login.out) }, JSON.stringify({ uris: ['https://example.com/a.bin'] })), write.res, [])
    expect(write.out.status).toBe(403)
    expect(JSON.parse(write.out.body || '{}').required).toBe('tasks:write')
  })
})
describe('会话 Cookie 的 HTTP 往返', () => {
  it('POST /api/session 拿到的 Set-Cookie 能直接用来读接口，DELETE 之后失效', async () => {
    rpcMock.mockImplementation(async (options: { method: string }) => {
      if (options.method === 'aria2.getGlobalStat') return { downloadSpeed: '0', uploadSpeed: '0', numActive: '0', numWaiting: '0', numStopped: '0' }
      return []
    })
    const port = 39736
    const server = makeServer({ webConsole: { enabled: true, port, token: MASTER, allowedIps: [] } })
    const started = await server.apply()
    expect(started.running).toBe(true)
    const base = 'http://127.0.0.1:' + String(port)
    try {
      const login = await fetch(base + '/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: MASTER })
      })
      expect(login.status).toBe(200)
      const setCookie = String(login.headers.get('set-cookie') || '')
      expect(setCookie).toContain('HttpOnly')
      expect(setCookie).toContain('SameSite=Strict')
      const cookie = setCookie.split(';')[0]

      const status = await fetch(base + '/api/status', { headers: { cookie } })
      expect(status.status).toBe(200)
      expect(((await status.json()) as { ok: boolean }).ok).toBe(true)

      const anonymous = await fetch(base + '/api/status')
      expect(anonymous.status).toBe(401)

      const logout = await fetch(base + '/api/session', { method: 'DELETE', headers: { cookie } })
      expect(logout.status).toBe(200)

      const after = await fetch(base + '/api/status', { headers: { cookie } })
      expect(after.status).toBe(401)
    } finally {
      await server.stop()
    }
  })
})
describe('WebConsoleServer.apply LAN 加密约束', () => {
  it('允许局域网但未配置 TLS 时拒绝启动（避免明文 HTTP 泄露令牌）', async () => {
    const server = makeServer({
      webConsole: { enabled: true, port: 39731, token: MASTER, allowedIps: ['192.168.1.0/24'] }
    })
    const result = await server.apply()
    expect(result.running).toBe(false)
    expect(result.error).toContain('HTTPS')
    expect(server.getStatus().running).toBe(false)
  })

  it('只配置证书未配置私钥时拒绝启动', async () => {
    const server = makeServer({
      webConsole: { enabled: true, port: 39732, token: MASTER, allowedIps: [], tlsCertPath: 'C:/certs/a.pem' }
    })
    const result = await server.apply()
    expect(result.running).toBe(false)
    expect(result.error).toContain('证书与私钥')
  })

  it('相对路径的证书被拒绝（解析基准随 cwd 变化）', async () => {
    const server = makeServer({
      webConsole: {
        enabled: true,
        port: 39733,
        token: MASTER,
        allowedIps: [],
        tlsCertPath: 'certs/a.pem',
        tlsKeyPath: 'certs/a.key'
      }
    })
    const result = await server.apply()
    expect(result.running).toBe(false)
    expect(result.error).toContain('绝对路径')
  })

  it('证书内容非法时拒绝启动而不是静默降级到 HTTP', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aria2-webconsole-'))
    const certPath = path.join(dir, 'bad.pem')
    fs.writeFileSync(certPath, 'not a certificate')
    try {
      const server = makeServer({
        webConsole: {
          enabled: true,
          port: 39734,
          token: MASTER,
          allowedIps: [],
          tlsCertPath: certPath,
          tlsKeyPath: certPath
        }
      })
      const result = await server.apply()
      expect(result.running).toBe(false)
      expect(result.error).toContain('证书加载失败')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('仅回环地址且无 TLS 时正常以 HTTP 监听', async () => {
    const port = 39735
    const server = makeServer({ webConsole: { enabled: true, port, token: MASTER, allowedIps: [] } })
    const result = await server.apply()
    try {
      expect(result.running).toBe(true)
      expect(server.getStatus().url.startsWith('http://127.0.0.1:')).toBe(true)
      expect(server.getStatus().tls).toBe(false)
    } finally {
      await server.stop()
    }
  })
})
