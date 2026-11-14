/**
 * Headless Web 控制台
 *
 * 在浏览器/手机上访问下载任务、队列、统计与操作审计。默认只监听 127.0.0.1，
 * 必须携带 Bearer 令牌；配置 allowedIps 后会监听 0.0.0.0，并按 IP/CIDR 白名单过滤。
 * 不引入前端构建依赖，页面为内嵌单文件，离线可用；同时提供 PWA 资源与 OpenAPI 文档。
 *
 * 鉴权模型：主令牌（webConsole.token）等价 admin；webConsole.tokens 里的条目按各自
 * scopes 授权（tasks:read / tasks:write / tasks:control / audit:read / admin）。
 * 鉴权与路由权限映射见 utils/webConsoleAuth（纯函数，可穷举测试）。
 */

import http from 'node:http'
import crypto from 'node:crypto'
import os from 'node:os'
import { app } from 'electron'
import { callAria2Rpc } from '../utils/aria2Rpc'
import { activeRpcOptions } from '../utils/activeRpcConfig'
import { getSettingsFresh, saveSettings } from '../utils/settingsAccessor'
import { WEB_CONSOLE_HTML } from '../webConsolePage'
import { ICON_192_PNG_B64, ICON_512_PNG_B64, MASKABLE_192_PNG_B64, MASKABLE_512_PNG_B64, WEB_CONSOLE_MANIFEST, WEB_CONSOLE_SW } from '../webConsoleAssets'
import { buildOpenApiDocument } from '../webConsoleOpenApi'
import { isPublicPath, resolveAuthFromSettings, routeScope, scopeAllows } from '../utils/webConsoleAuth'
import logger from 'electron-log'

interface AuditEntry {
  time: string
  ip: string
  action: string
  detail: string
  success: boolean
}

interface TaskSummary {
  gid: string
  status: string
  name: string
  totalLength: string
  completedLength: string
  downloadSpeed: string
}

const MAX_AUDIT = 500
const MAX_BODY = 1024 * 1024

/** PWA 图标路由 → base64 数据 */
const ICON_ROUTES: Record<string, string> = {
  '/icon-192.png': ICON_192_PNG_B64,
  '/icon-512.png': ICON_512_PNG_B64,
  '/maskable-192.png': MASKABLE_192_PNG_B64,
  '/maskable-512.png': MASKABLE_512_PNG_B64
}

/** lastUsedAt 的写回节流：同一令牌 60 秒内只写一次盘 */
const LAST_USED_WRITE_INTERVAL_MS = 60_000

function nowTime(): string {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

function normalizeIp(ip: string): string {
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    const n = Number(part)
    if (!Number.isInteger(n) || n < 0 || n > 255) return null
    value = (value * 256) + n
  }
  return value
}

function ipMatchesRule(ip: string, rule: string): boolean {
  const normalized = normalizeIp(ip)
  const trimmed = rule.trim()
  if (!trimmed) return false
  if (trimmed === '*') return true
  if (trimmed === normalized) return true
  const [base, bitsRaw] = trimmed.split('/')
  const bits = Number(bitsRaw)
  if (base && Number.isInteger(bits) && bits >= 0 && bits <= 32) {
    const baseInt = ipv4ToInt(base)
    const ipInt = ipv4ToInt(normalized)
    if (baseInt === null || ipInt === null) return false
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
    return (baseInt & mask) === (ipInt & mask)
  }
  return false
}

export class WebConsoleServer {
  private server: http.Server | null = null
  private auditLog: AuditEntry[] = []
  private lastError = ''
  private actualPort = 0
  private token = ''
  private bindHost = '127.0.0.1'
  /** 上次为各令牌写 lastUsedAt 的时间（节流用） */
  private lastUsedWrites = new Map<string, number>()

  /** 启动/重启（设置变更时调用；未启用则停止） */
  async apply(): Promise<{ running: boolean; port: number; token: string; error?: string }> {
    await this.stop()
    const settings = getSettingsFresh()
    const config = settings.webConsole ?? {}
    if (!config.enabled) {
      this.token = ''
      this.bindHost = '127.0.0.1'
      return { running: false, port: 0, token: '' }
    }

    const port = Number(config.port) || 6802
    if (port < 1024 || port > 65535) {
      this.lastError = 'Web 控制台端口必须在 1024-65535 之间'
      return { running: false, port: 0, token: '', error: this.lastError }
    }

    let token = String(config.token || '').trim()
    if (!token) {
      token = crypto.randomBytes(18).toString('hex')
      // 自动生成的令牌写回 settings，用户才能在设置页看到
      saveSettings({ ...settings, webConsole: { ...config, token } })
    } else if (token.length < 16) {
      this.lastError = 'Web 控制台令牌至少需要 16 个字符'
      return { running: false, port: 0, token: '', error: this.lastError }
    }
    this.token = token

    const allowed = (config.allowedIps ?? []).map(item => item.trim()).filter(Boolean)
    const loopbackOnly = allowed.length === 0 || allowed.every(rule => rule === '127.0.0.1' || rule === '::1' || rule === 'localhost')
    const bindHost = loopbackOnly ? '127.0.0.1' : '0.0.0.0'
    this.bindHost = bindHost

    return await new Promise((resolve) => {
      const server = http.createServer((req, res) => {
        this.handle(req, res, allowed).catch((error) => {
          logger.error('[WebConsole] Request failed:', error)
          this.sendJson(res, 500, { ok: false, error: 'Internal server error' })
        })
      })
      server.on('error', (error) => {
        this.lastError = String(error)
        this.server = null
        this.bindHost = '127.0.0.1'
        logger.error('[WebConsole] Failed to listen:', error)
        resolve({ running: false, port: 0, token: '', error: this.lastError })
      })
      server.listen(port, bindHost, () => {
        this.server = server
        this.actualPort = port
        this.lastError = ''
        logger.info(`[WebConsole] Listening on ${bindHost}:${port}`)
        resolve({ running: true, port, token })
      })
    })
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    this.actualPort = 0
    this.bindHost = '127.0.0.1'
    if (!server) return
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  getStatus() {
    const settings = getSettingsFresh()
    const config = settings.webConsole ?? {}
    const port = this.actualPort || Number(config.port) || 6802
    const tokens = Array.isArray(config.tokens) ? config.tokens : []
    return {
      running: this.server !== null,
      port,
      url: this.server ? `http://${this.publicHost()}:${port}` : '',
      token: this.token || String(config.token || ''),
      /** 细粒度令牌数量（不含主令牌） */
      tokensCount: tokens.length,
      error: this.lastError,
      audit: this.auditLog.slice(-100)
    }
  }

  /** 远端可访问时展示本机局域网 IPv4，而不是只给回环地址（手机无法访问 127.0.0.1） */
  private publicHost(): string {
    if (this.bindHost === '127.0.0.1') return '127.0.0.1'
    const interfaces = os.networkInterfaces()
    for (const entries of Object.values(interfaces)) {
      for (const entry of entries || []) {
        if (entry.family === 'IPv4' && !entry.internal) return entry.address
      }
    }
    return '127.0.0.1'
  }

  private record(ip: string, action: string, detail: string, success: boolean) {
    this.auditLog.push({ time: nowTime(), ip: normalizeIp(ip), action, detail, success })
    if (this.auditLog.length > MAX_AUDIT) this.auditLog.splice(0, this.auditLog.length - MAX_AUDIT)
  }

  private sendJson(res: http.ServerResponse, status: number, body: unknown) {
    const data = JSON.stringify(body)
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    })
    res.end(data)
  }

  /** 从请求头取 Bearer 值 */
  private presentedToken(req: http.IncomingMessage): string {
    const header = String(req.headers.authorization || '')
    return header.startsWith('Bearer ') ? header.slice(7) : ''
  }

  /**
   * 记录令牌最近使用时间（节流写盘）。
   * 只改 tokens 里对应条目的 lastUsedAt，不动其他字段。
   */
  private touchToken(tokenId: string) {
    const now = Date.now()
    const last = this.lastUsedWrites.get(tokenId) ?? 0
    if (now - last < LAST_USED_WRITE_INTERVAL_MS) return
    this.lastUsedWrites.set(tokenId, now)
    try {
      const settings = getSettingsFresh()
      const config = settings.webConsole ?? {}
      const tokens = Array.isArray(config.tokens) ? config.tokens : []
      const index = tokens.findIndex(entry => entry.id === tokenId)
      if (index < 0) return
      const nextTokens = tokens.map((entry, i) => i === index ? { ...entry, lastUsedAt: new Date(now).toISOString() } : entry)
      saveSettings({ ...settings, webConsole: { ...config, tokens: nextTokens } })
    } catch (error) {
      logger.warn('[WebConsole] Failed to update token lastUsedAt:', error)
    }
  }

  private async readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    return await new Promise((resolve, reject) => {
      let size = 0
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_BODY) {
          reject(new Error('Request body too large'))
          req.destroy()
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf-8')
          resolve(raw ? JSON.parse(raw) as Record<string, unknown> : {})
        } catch {
          reject(new Error('Invalid JSON body'))
        }
      })
      req.on('error', reject)
    })
  }

  /** 静态资源与文档（免鉴权） */
  private servePublic(pathname: string, res: http.ServerResponse): boolean {
    if (pathname === '/' || pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Frame-Options': 'DENY' })
      res.end(WEB_CONSOLE_HTML)
      return true
    }
    if (pathname === '/manifest.webmanifest') {
      res.writeHead(200, {
        'Content-Type': 'application/manifest+json; charset=utf-8',
        'Cache-Control': 'public, max-age=3600'
      })
      res.end(WEB_CONSOLE_MANIFEST)
      return true
    }
    if (pathname === '/sw.js') {
      res.writeHead(200, {
        'Content-Type': 'text/javascript; charset=utf-8',
        // 允许 SW 控制根作用域（脚本位于 /sw.js，默认作用域已经是 /，这行是显式声明）
        'Service-Worker-Allowed': '/',
        'Cache-Control': 'no-cache'
      })
      res.end(WEB_CONSOLE_SW)
      return true
    }
    const icon = ICON_ROUTES[pathname]
    if (icon) {
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400'
      })
      res.end(Buffer.from(icon, 'base64'))
      return true
    }
    if (pathname === '/openapi.json') {
      this.sendJson(res, 200, buildOpenApiDocument(app.getVersion()))
      return true
    }
    return false
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse, allowed: string[]) {
    const ip = normalizeIp(req.socket.remoteAddress || '')
    if (allowed.length > 0 && !allowed.some(rule => ipMatchesRule(ip, rule))) {
      this.record(ip, 'deny', 'IP 不在白名单', false)
      this.sendJson(res, 403, { ok: false, error: 'Forbidden' })
      return
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    const pathname = url.pathname

    // 静态资源与文档：免鉴权（登录页必须能打开，否则无法输入令牌）
    if (req.method === 'GET' && isPublicPath(pathname) && this.servePublic(pathname, res)) return

    const required = routeScope(req.method || 'GET', pathname)
    if (!required) {
      this.sendJson(res, 404, { ok: false, error: 'Not found' })
      return
    }

    const auth = resolveAuthFromSettings(getSettingsFresh(), this.presentedToken(req))
    if (!auth) {
      this.record(ip, 'auth', pathname, false)
      this.sendJson(res, 401, { ok: false, error: 'Unauthorized' })
      return
    }
    if (!scopeAllows(auth.scopes, required)) {
      this.record(ip, 'scope', `${pathname} 需要 ${required}`, false)
      this.sendJson(res, 403, { ok: false, error: 'insufficient_scope', required })
      return
    }
    if (auth.tokenId) this.touchToken(auth.tokenId)

    try {
      if (req.method === 'GET' && pathname === '/api/status') {
        const [globalStat, active, waiting, stopped] = await Promise.all([
          callAria2Rpc({ ...activeRpcOptions(), method: 'aria2.getGlobalStat' }),
          callAria2Rpc({ ...activeRpcOptions(), method: 'aria2.tellActive', params: [['gid', 'status', 'files', 'totalLength', 'completedLength', 'downloadSpeed']] }),
          callAria2Rpc({ ...activeRpcOptions(), method: 'aria2.tellWaiting', params: [0, 100, ['gid', 'status', 'files', 'totalLength', 'completedLength', 'downloadSpeed']] }),
          callAria2Rpc({ ...activeRpcOptions(), method: 'aria2.tellStopped', params: [0, 100, ['gid', 'status', 'files', 'totalLength', 'completedLength', 'downloadSpeed']] })
        ])
        const mapTask = (task: Record<string, unknown>): TaskSummary => {
          const files = Array.isArray(task.files) ? task.files as { path?: string; uris?: { uri?: string }[] }[] : []
          const name = files[0]?.path?.split(/[\\/]/).pop() || files[0]?.uris?.[0]?.uri || String(task.gid)
          return {
            gid: String(task.gid),
            status: String(task.status),
            name,
            totalLength: String(task.totalLength ?? '0'),
            completedLength: String(task.completedLength ?? '0'),
            downloadSpeed: String(task.downloadSpeed ?? '0')
          }
        }
        this.sendJson(res, 200, {
          ok: true,
          globalStat,
          active: (active as Record<string, unknown>[]).map(mapTask),
          waiting: (waiting as Record<string, unknown>[]).map(mapTask),
          stopped: (stopped as Record<string, unknown>[]).map(mapTask)
        })
        return
      }

      if (req.method === 'GET' && pathname === '/api/audit') {
        this.sendJson(res, 200, { ok: true, items: this.auditLog.slice(-100).reverse() })
        return
      }

      if (req.method === 'POST' && pathname === '/api/tasks') {
        const body = await this.readBody(req)
        const uris = Array.isArray(body.uris) ? body.uris.map(String).filter(Boolean) : []
        if (uris.length === 0) {
          this.sendJson(res, 400, { ok: false, error: 'uris is required' })
          return
        }
        const options = body.dir ? { dir: String(body.dir) } : {}
        const gid = await callAria2Rpc({ ...activeRpcOptions(), method: 'aria2.addUri', params: [uris, options] })
        this.record(ip, 'add', uris.join(' '), true)
        this.sendJson(res, 200, { ok: true, gid })
        return
      }

      const taskAction = pathname.match(/^\/api\/tasks\/([^/]+)\/(pause|resume|remove)$/)
      if (req.method === 'POST' && taskAction) {
        const gid = decodeURIComponent(taskAction[1])
        const action = taskAction[2]
        const method = action === 'pause' ? 'aria2.pause' : action === 'resume' ? 'aria2.unpause' : 'aria2.forceRemove'
        await callAria2Rpc({ ...activeRpcOptions(), method, params: [gid] })
        this.record(ip, action, gid, true)
        this.sendJson(res, 200, { ok: true })
        return
      }

      this.sendJson(res, 404, { ok: false, error: 'Not found' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const status = message === 'Request body too large' ? 413 : message === 'Invalid JSON body' ? 400 : 500
      this.record(ip, 'error', message, false)
      this.sendJson(res, status, { ok: false, error: message })
    }
  }
}

export const webConsoleServer = new WebConsoleServer()
