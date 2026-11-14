import { describe, expect, it, vi, beforeEach } from 'vitest'
import { PassThrough } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'

const { rpcMock, settingsRef, saveMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  settingsRef: { current: {} as Record<string, unknown> },
  saveMock: vi.fn()
}))

vi.mock('electron', () => ({ app: { getVersion: () => '1.3.7' } }))
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
    expect(routeScope('GET', '/api/audit')).toBe('audit:read')
    expect(routeScope('POST', '/api/tasks')).toBe('tasks:write')
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
    expect(Object.keys(doc.paths).sort()).toEqual(['/api/audit', '/api/status', '/api/tasks', '/api/tasks/{gid}/{action}', '/openapi.json'])
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
    await server.handle(makeReq('POST', '/api/tasks', { authorization: 'Bearer write-token-abcdefgh' }, JSON.stringify({ uris: ['https://example.com/a.bin'], dir: 'D:\\Downloads' })), res, [])
    expect(out.status).toBe(200)
    expect(JSON.parse(out.body || '{}').gid).toBe('newgid')
    expect(rpcMock).toHaveBeenCalledWith(expect.objectContaining({ method: 'aria2.addUri' }))
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

  it('未知路由返回 404，且未鉴权时不泄露存在性', async () => {
    const server = makeServer({ webConsole: { token: MASTER } })
    const { res, out } = makeRes()
    await server.handle(makeReq('GET', '/api/nope'), res, [])
    expect(out.status).toBe(404)
    expect(rpcMock).not.toHaveBeenCalled()
  })
})
