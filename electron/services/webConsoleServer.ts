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
import https from 'node:https'
import tls from 'node:tls'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import * as path from 'node:path'
import { app } from 'electron'
import { callAria2Rpc } from '../utils/aria2Rpc'
import { isAllowedDownloadUri } from '../utils/extensionApiCore'
import { isPathInside } from '../utils/pathContainment'
import { resolveBaseDownloadDir } from '../../src/shared/fileCategories'
import { activeRpcOptions } from '../utils/activeRpcConfig'
import { getSettingsFresh, saveSettings } from '../utils/settingsAccessor'
import { WEB_CONSOLE_CSP, WEB_CONSOLE_HTML } from '../webConsolePage'
import { ICON_192_PNG_B64, ICON_512_PNG_B64, MASKABLE_192_PNG_B64, MASKABLE_512_PNG_B64, WEB_CONSOLE_MANIFEST, WEB_CONSOLE_SW } from '../webConsoleAssets'
import { buildOpenApiDocument } from '../webConsoleOpenApi'
import {
  buildClearSessionCookie,
  buildSessionCookie,
  createSessionSecret,
  isPublicPath,
  readSessionCookie,
  resolveAuthFromSettings,
  routeScope,
  scopeAllows,
  signSessionToken,
  verifySessionToken
} from '../utils/webConsoleAuth'
import { mainLocaleFrom } from '../utils/mainLocale'
import { webConsoleTlsError } from '../utils/mainProcessCopy'
import type { WebConsoleSettings } from '../../src/shared/appSettings'
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
/** SSE 状态推送节拍：有订阅者时按此间隔重算一帧，无变化不发送 */
const SSE_TICK_MS = 2000
/** 心跳注释行：防止中间设备把长时间静默的连接掐掉 */
const SSE_HEARTBEAT_MS = 25_000
/** 同时订阅的 SSE 连接上限：每个连接每秒都会拿到一帧，防止误开一堆标签页拖垮 aria2 */
const MAX_SSE_CLIENTS = 8

/** PWA 图标路由 → base64 数据 */
const ICON_ROUTES: Record<string, string> = {
  '/icon-192.png': ICON_192_PNG_B64,
  '/icon-512.png': ICON_512_PNG_B64,
  '/maskable-192.png': MASKABLE_192_PNG_B64,
  '/maskable-512.png': MASKABLE_512_PNG_B64
}

/** lastUsedAt 的写回节流：同一令牌 60 秒内只写一次盘 */
const LAST_USED_WRITE_INTERVAL_MS = 60_000

/** 审计日志落盘文件名：放在 userData 下，重启后仍能看到历史操作 */
const AUDIT_FILE_NAME = 'web-console-audit.json'
/** 审计落盘防抖：连续操作合并成一次写入，避免每个请求都碰磁盘 */
const AUDIT_FLUSH_DELAY_MS = 1000
/** SSE 连接的令牌复检间隔：令牌被撤销/删除后最迟这么久断开推送 */
const SSE_AUTH_CHECK_MS = 30_000

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
  /** 当前是否以 HTTPS 监听（决定 getStatus 返回的 URL 协议） */
  private tlsEnabled = false
  /** 上次为各令牌写 lastUsedAt 的时间（节流用） */
  private lastUsedWrites = new Map<string, number>()
  /** /api/events 的订阅者（SSE 长连接）→ 建连时的令牌与来源 IP，用于定期复检撤销 */
  private sseClients = new Map<http.ServerResponse, { token: string; ip: string }>()
  private sseTimer: ReturnType<typeof setInterval> | null = null
  private sseLastBeat = 0
  /** 上次复检 SSE 令牌的时间（节流用） */
  private sseLastAuthCheck = 0
  /** 上一帧推送内容，用于抑制无变化的重发 */
  private sseLastPayload = ''
  /** 审计日志是否已尝试从磁盘载入 */
  private auditLoaded = false
  /** 审计落盘防抖定时器 */
  private auditFlushTimer: ReturnType<typeof setTimeout> | null = null
  /**
   * 会话 Cookie 的签名密钥（D-14）。
   *
   * 进程内随机生成、不落盘：重启后旧 Cookie 全部失效，用户重新登录一次即可；
   * 换来的是浏览器侧永远拿不到令牌原文，localStorage 里也不再有可偷的凭据。
   */
  private readonly sessionSecret: Buffer = createSessionSecret()
  /** 当前会话 Cookie 对应的令牌（用于 SSE 复检；只有一条活动会话，够用） */
  private sessionToken = ''

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

    // LAN 模式必须加密：明文 HTTP 下同网段任何设备都能抓到 Bearer 令牌（等价 admin）。
    // 两条合规路径：① 配置证书/私钥走 HTTPS；② 只监听 127.0.0.1，由反向代理终止 TLS。
    const tls = this.loadTlsCredentials(config)
    if (tls.error) {
      this.lastError = tls.error
      this.bindHost = '127.0.0.1'
      return { running: false, port: 0, token: '', error: this.lastError }
    }
    if (!loopbackOnly && !tls.options) {
      this.lastError =
        webConsoleTlsError(mainLocaleFrom(() => app.getLocale()), 'lan-requires-tls')
      this.bindHost = '127.0.0.1'
      return { running: false, port: 0, token: '', error: this.lastError }
    }
    this.bindHost = bindHost
    this.tlsEnabled = Boolean(tls.options)

    return await new Promise((resolve) => {
      const handler = (req: http.IncomingMessage, res: http.ServerResponse) => {
        this.handle(req, res, allowed).catch((error) => {
          logger.error('[WebConsole] Request failed:', error)
          this.sendJson(res, 500, { ok: false, error: 'Internal server error' })
        })
      }
      const server = tls.options ? https.createServer(tls.options, handler) : http.createServer(handler)
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
    this.closeEventStreams()
    this.flushAuditSync()
    const server = this.server
    this.server = null
    this.actualPort = 0
    this.bindHost = '127.0.0.1'
    this.tlsEnabled = false
    if (!server) return
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
      // server.close() 只是停止接受新连接，已建立的 keep-alive 空闲连接会让回调迟迟不触发
      // （浏览器默认保活约 5 秒），先关空闲连接、再兜底断开全部连接，重启监听才不会卡顿。
      server.closeIdleConnections?.()
      server.closeAllConnections?.()
    })
  }

  getStatus() {
    this.ensureAuditLoaded()
    const settings = getSettingsFresh()
    const config = settings.webConsole ?? {}
    const port = this.actualPort || Number(config.port) || 6802
    const tokens = Array.isArray(config.tokens) ? config.tokens : []
    const protocol = this.tlsEnabled ? 'https' : 'http'
    return {
      running: this.server !== null,
      port,
      url: this.server ? `${protocol}://${this.publicHost()}:${port}` : '',
      /** 是否以 HTTPS 监听（设置页据此提示） */
      tls: this.tlsEnabled,
      token: this.token || String(config.token || ''),
      /** 细粒度令牌数量（不含主令牌） */
      tokensCount: tokens.length,
      error: this.lastError,
      audit: this.auditLog.slice(-100)
    }
  }

  /**
   * 读取 HTTPS 证书/私钥。
   * 未配置返回空对象（走 HTTP，仅允许 loopback）；配置了但读不到/内容非法则返回 error 让 apply() 拒绝启动，
   * 避免"以为开了 HTTPS 实际还在明文"的静默降级。
   */
  private loadTlsCredentials(config: WebConsoleSettings): { options?: https.ServerOptions; error?: string } {
    // 错误文案会原样显示在设置页，按主进程语言生成
    const locale = mainLocaleFrom(() => app.getLocale())
    const certPath = String(config.tlsCertPath || '').trim()
    const keyPath = String(config.tlsKeyPath || '').trim()
    if (!certPath && !keyPath) return {}
    if (!certPath || !keyPath) {
      return { error: webConsoleTlsError(locale, 'pair-required') }
    }
    // 只接受绝对路径：相对路径的解析基准随 cwd 变化，容易被诱导读取任意文件
    if (!path.isAbsolute(certPath) || !path.isAbsolute(keyPath)) {
      return { error: webConsoleTlsError(locale, 'absolute-path') }
    }
    try {
      const cert = fs.readFileSync(certPath)
      const key = fs.readFileSync(keyPath)
      // 用 tls.createSecureContext 提前校验，避免 listen 时才抛错导致服务半启动
      tls.createSecureContext({ cert, key })
      return { options: { cert, key } }
    } catch (error) {
      logger.error('[WebConsole] Failed to load TLS credentials:', error)
      return { error: webConsoleTlsError(locale, 'load-failed', error instanceof Error ? error.message : String(error)) }
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
    this.ensureAuditLoaded()
    this.auditLog.push({ time: nowTime(), ip: normalizeIp(ip), action, detail, success })
    if (this.auditLog.length > MAX_AUDIT) this.auditLog.splice(0, this.auditLog.length - MAX_AUDIT)
    this.scheduleAuditFlush()
  }

  /**
   * 审计文件路径。
   *
   * 未打包 / 单测环境下 app.getPath('userData') 可能退化成当前工作目录，
   * 此时直接放弃持久化，避免把运行时审计写进源码仓库。
   */
  private resolveAuditFile(): string | null {
    try {
      const userData = app.getPath('userData')
      if (!userData) return null
      if (path.resolve(userData) === path.resolve(process.cwd())) return null
      return path.join(userData, AUDIT_FILE_NAME)
    } catch {
      return null
    }
  }

  /** 首次访问审计时从磁盘载入历史记录（失败按空日志处理，不影响功能） */
  private ensureAuditLoaded() {
    if (this.auditLoaded) return
    this.auditLoaded = true
    const file = this.resolveAuditFile()
    if (!file) return
    try {
      if (!fs.existsSync(file)) return
      const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (!Array.isArray(parsed)) return
      const entries: AuditEntry[] = []
      for (const item of parsed) {
        if (!item || typeof item !== 'object') continue
        const row = item as Partial<AuditEntry>
        if (typeof row.time !== 'string' || typeof row.ip !== 'string') continue
        if (typeof row.action !== 'string' || typeof row.detail !== 'string') continue
        entries.push({
          time: row.time,
          ip: row.ip,
          action: row.action,
          detail: row.detail,
          success: row.success === true
        })
      }
      this.auditLog = entries.slice(-MAX_AUDIT)
    } catch (error) {
      logger.warn('[WebConsole] 读取审计日志失败，按空日志处理:', error)
    }
  }

  private scheduleAuditFlush() {
    if (this.auditFlushTimer) return
    this.auditFlushTimer = setTimeout(() => {
      this.auditFlushTimer = null
      this.flushAuditSync()
    }, AUDIT_FLUSH_DELAY_MS)
    this.auditFlushTimer.unref?.()
  }

  /** 立即把审计日志写盘（先写临时文件再 rename，避免半截文件） */
  private flushAuditSync() {
    if (this.auditFlushTimer) {
      clearTimeout(this.auditFlushTimer)
      this.auditFlushTimer = null
    }
    const file = this.resolveAuditFile()
    if (!file) return
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      const tmp = file + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(this.auditLog.slice(-MAX_AUDIT)), { encoding: 'utf8', mode: 0o600 })
      fs.renameSync(tmp, file)
    } catch (error) {
      logger.warn('[WebConsole] 写入审计日志失败:', error)
    }
  }

  private sendJson(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
    const data = JSON.stringify(body)
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers
    })
    res.end(data)
  }

  /** aria2 任务 → 前端精简结构（名称取文件名，回退首个 URI） */
  private mapTask(task: Record<string, unknown>): TaskSummary {
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

  /** 一次性拉齐三类任务与全局统计（/api/status 与 SSE 帧共用同一份结构） */
  private async buildStatusPayload(): Promise<Record<string, unknown>> {
    const fields = ['gid', 'status', 'files', 'totalLength', 'completedLength', 'downloadSpeed']
    const [globalStat, active, waiting, stopped] = await Promise.all([
      callAria2Rpc({ ...activeRpcOptions(), method: 'aria2.getGlobalStat' }),
      callAria2Rpc({ ...activeRpcOptions(), method: 'aria2.tellActive', params: [fields] }),
      callAria2Rpc({ ...activeRpcOptions(), method: 'aria2.tellWaiting', params: [0, 100, fields] }),
      callAria2Rpc({ ...activeRpcOptions(), method: 'aria2.tellStopped', params: [0, 100, fields] })
    ])
    return {
      globalStat,
      active: (active as Record<string, unknown>[]).map(task => this.mapTask(task)),
      waiting: (waiting as Record<string, unknown>[]).map(task => this.mapTask(task)),
      stopped: (stopped as Record<string, unknown>[]).map(task => this.mapTask(task))
    }
  }

  /**
   * 队列只读视图（GET /api/queue）：队列设置 + 等待中的任务。
   *
   * 只读是刻意的：桌面端的最大并发数同样只读（D-27），改并发要回桌面设置，
   * 免得手机上一个误触把整台机器的下载并发改掉。
   * 设置取本地 settings.queue；任务取 aria2 的 waiting 列表（不含已停止）。
   */
  private async buildQueuePayload(): Promise<Record<string, unknown>> {
    const queue = getSettingsFresh()?.queue ?? {}
    const fields = ['gid', 'status', 'files', 'totalLength', 'completedLength', 'downloadSpeed']
    const waiting = (await callAria2Rpc({
      ...activeRpcOptions(),
      method: 'aria2.tellWaiting',
      params: [0, 100, fields]
    })) as Record<string, unknown>[]
    const tasks = waiting.map(task => this.mapTask(task))
    return {
      settings: {
        maxConcurrent: Number(queue.maxConcurrent ?? 5),
        retryEnabled: queue.retryEnabled === true,
        retryMaxAttempts: Number(queue.retryMaxAttempts ?? 3),
        retryDelaySeconds: Number(queue.retryDelaySeconds ?? 30)
      },
      tasks,
      total: tasks.length
    }
  }

  /**
   * 建立 SSE 长连接（GET /api/events）。
   *
   * 令牌走 Authorization 头而不是 URL 参数：EventSource 无法自定义头，
   * 所以页面侧用 fetch + ReadableStream 消费，避免令牌进入访问日志与浏览器历史。
   */
  private attachEventStream(req: http.IncomingMessage, res: http.ServerResponse, token: string, ip: string) {
    if (this.sseClients.size >= MAX_SSE_CLIENTS) {
      this.sendJson(res, 503, { ok: false, error: 'too_many_streams' })
      return
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'Connection': 'keep-alive',
      // 反向代理默认会缓冲响应，显式关闭，否则事件要攒够一块才下发
      'X-Accel-Buffering': 'no'
    })
    res.write('retry: 3000\n\n')
    this.sseClients.set(res, { token, ip })
    const drop = () => {
      this.sseClients.delete(res)
      this.stopEventStreamTimer()
    }
    req.on('close', drop)
    res.on('close', drop)
    this.ensureEventStreamTimer()
    // 新订阅者立即给一帧，不必等下一个节拍
    this.sseLastPayload = ''
    void this.pushStatusFrame()
  }

  private ensureEventStreamTimer() {
    if (this.sseTimer) return
    this.sseLastBeat = Date.now()
    this.sseTimer = setInterval(() => { void this.pushStatusFrame() }, SSE_TICK_MS)
    // 不阻止进程退出；真正退出前由 stop() 清理
    this.sseTimer.unref?.()
  }

  private stopEventStreamTimer() {
    if (this.sseClients.size > 0 || !this.sseTimer) return
    clearInterval(this.sseTimer)
    this.sseTimer = null
    this.sseLastPayload = ''
  }

  /** 计算一帧状态推给所有订阅者；与上一帧完全相同则跳过（心跳照发） */
  private async pushStatusFrame(): Promise<void> {
    if (this.sseClients.size === 0) {
      this.stopEventStreamTimer()
      return
    }
    this.recheckStreamAuth()
    if (this.sseClients.size === 0) return
    if (Date.now() - this.sseLastBeat >= SSE_HEARTBEAT_MS) {
      this.sseLastBeat = Date.now()
      this.writeToStreams(': ping\n\n')
    }
    let frame: string
    try {
      frame = 'event: status\ndata: ' + JSON.stringify(await this.buildStatusPayload()) + '\n\n'
    } catch (error) {
      // aria2 短暂不可用时发一条 error 事件，页面据此切到离线快照提示
      const message = error instanceof Error ? error.message : String(error)
      const errorFrame = 'event: error\ndata: ' + JSON.stringify({ ok: false, error: message }) + '\n\n'
      if (this.sseLastPayload === errorFrame) return
      this.sseLastPayload = errorFrame
      this.writeToStreams(errorFrame)
      return
    }
    if (frame === this.sseLastPayload) return
    this.sseLastPayload = frame
    this.writeToStreams(frame)
  }

  private writeToStreams(chunk: string) {
    for (const client of this.sseClients.keys()) {
      try {
        client.write(chunk)
      } catch {
        this.sseClients.delete(client)
      }
    }
  }

  /**
   * 定期复检 SSE 订阅者携带的令牌。
   *
   * 长连接建好之后不会再走 handle() 的鉴权，令牌若被撤销（主令牌改掉或副令牌删除），
   * 已建立的推送会一直活着。这里每隔 SSE_AUTH_CHECK_MS 重新解析一次令牌，
   * 失效的订阅者先收到 event: unauthorized，再被断开。
   */
  private recheckStreamAuth() {
    const now = Date.now()
    if (now - this.sseLastAuthCheck < SSE_AUTH_CHECK_MS) return
    this.sseLastAuthCheck = now
    if (this.sseClients.size === 0) return
    const settings = getSettingsFresh()
    for (const [client, meta] of this.sseClients) {
      const auth = resolveAuthFromSettings(settings, meta.token)
      if (auth && scopeAllows(auth.scopes, 'tasks:read')) continue
      this.sseClients.delete(client)
      try {
        client.write('event: unauthorized\ndata: {"ok":false,"error":"token_revoked"}\n\n')
        client.end()
      } catch {
        // 连接已断开，忽略
      }
      this.record(meta.ip, 'auth', 'SSE 令牌已失效，连接已断开', false)
    }
    this.stopEventStreamTimer()
  }

  /** 停止服务时主动断开 SSE（否则 server.close() 会一直等这些长连接） */
  private closeEventStreams() {
    if (this.sseTimer) {
      clearInterval(this.sseTimer)
      this.sseTimer = null
    }
    for (const client of this.sseClients.keys()) {
      try {
        client.end()
      } catch {
        // 连接已断开，忽略
      }
    }
    this.sseClients.clear()
    this.sseLastPayload = ''
  }

  /**
   * 取请求携带的令牌：优先 Authorization: Bearer，其次会话 Cookie。
   *
   * Bearer 是给扩展、MCP、脚本与第三方客户端用的（它们没有浏览器 Cookie 罐）；
   * Cookie 是给 Web 控制台页面用的，令牌原文不进页面，浏览器自动带上。
   */
  private presentedToken(req: http.IncomingMessage): string {
    const header = String(req.headers.authorization || '')
    if (header.startsWith('Bearer ')) return header.slice(7)
    const cookie = readSessionCookie(req.headers.cookie)
    if (!cookie) return ''
    return verifySessionToken(this.sessionSecret, this.sessionToken, cookie) ? this.sessionToken : ''
  }

  /** 会话 Cookie 是否可加 Secure（只有 HTTPS 监听时才加，否则浏览器会丢弃） */
  private sessionCookieSecure(): boolean {
    return this.tlsEnabled
  }

  /**
   * 会话接口（D-14）：POST /api/session 用令牌换 HttpOnly Cookie，DELETE 退出。
   *
   * 页面从此不再把令牌写进 localStorage：XSS 能跑的脚本读不到 Cookie（HttpOnly），
   * 跨站请求也带不上它（SameSite=Strict）。Bearer 通道保持可用，旧客户端不受影响。
   * @returns 是否已经处理完（true 表示 handle() 不必继续）
   */
  private async handleSession(req: http.IncomingMessage, res: http.ServerResponse, ip: string): Promise<boolean> {
    if (req.method === 'DELETE') {
      this.sessionToken = ''
      this.sendJson(res, 200, { ok: true }, { 'Set-Cookie': buildClearSessionCookie({ secure: this.sessionCookieSecure() }) })
      this.record(ip, 'logout', '/api/session', true)
      return true
    }
    if (req.method !== 'POST') return false
    let body: Record<string, unknown>
    try {
      body = await this.readBody(req)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.sendJson(res, message === 'Request body too large' ? 413 : 400, { ok: false, error: message })
      return true
    }
    const presented = typeof body.token === 'string' ? body.token.trim() : ''
    const auth = resolveAuthFromSettings(getSettingsFresh(), presented)
    if (!auth) {
      this.record(ip, 'auth', '/api/session', false)
      this.sendJson(res, 401, { ok: false, error: 'Unauthorized' })
      return true
    }
    if (auth.tokenId) this.touchToken(auth.tokenId)
    this.sessionToken = presented
    this.sendJson(
      res,
      200,
      { ok: true, scopes: auth.scopes },
      { 'Set-Cookie': buildSessionCookie(signSessionToken(this.sessionSecret, presented), { secure: this.sessionCookieSecure() }) }
    )
    this.record(ip, 'login', '/api/session', true)
    return true
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
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Frame-Options': 'DENY',
        // 严格 CSP：页面没有任何内联脚本/样式（全部走 data-act 事件委托与外部 hash 白名单），
        // 双重防护——meta 里也写了一份，响应头优先，避免旧缓存页面漏掉策略。
        'Content-Security-Policy': WEB_CONSOLE_CSP,
        'Referrer-Policy': 'no-referrer'
      })
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

    // 会话接口必须排在鉴权之前：登录时用户手里只有令牌，还没有 Cookie
    if (pathname === '/api/session' && (req.method === 'POST' || req.method === 'DELETE')) {
      if (await this.handleSession(req, res, ip)) return
    }

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
        this.sendJson(res, 200, { ok: true, ...(await this.buildStatusPayload()) })
        return
      }

      // SSE：任务状态变化即时推送，替代页面上的 3 秒轮询。
      // 用 Bearer 头而不是 URL 参数携带令牌，避免令牌落进访问日志/浏览器历史。
      if (req.method === 'GET' && pathname === '/api/events') {
        this.attachEventStream(req, res, this.presentedToken(req), ip)
        return
      }

      if (req.method === 'GET' && pathname === '/api/queue') {
        this.sendJson(res, 200, { ok: true, ...(await this.buildQueuePayload()) })
        return
      }

      if (req.method === 'GET' && pathname === '/api/audit') {
        this.ensureAuditLoaded()
        this.sendJson(res, 200, { ok: true, items: this.auditLog.slice(-100).reverse() })
        return
      }

      if (req.method === 'POST' && pathname === '/api/tasks') {
        const body = await this.readBody(req)
        const uris = Array.isArray(body.uris)
          ? body.uris.map((value) => String(value).trim()).filter(Boolean)
          : []
        if (uris.length === 0) {
          this.sendJson(res, 400, { ok: false, error: 'uris is required' })
          return
        }
        if (uris.length > 200) {
          this.sendJson(res, 400, { ok: false, error: 'too_many_uris', max: 200 })
          return
        }
        const invalidUris = uris.filter((uri) => !isAllowedDownloadUri(uri))
        if (invalidUris.length > 0) {
          this.sendJson(res, 400, { ok: false, error: 'invalid_uri', uris: invalidUris.slice(0, 10) })
          return
        }

        // tasks:write 只允许写入下载根目录或其相对子目录，避免令牌被拿来向任意路径落盘。
        let targetDir = ''
        if (body.dir !== undefined && body.dir !== null && body.dir !== '') {
          if (typeof body.dir !== 'string') {
            this.sendJson(res, 400, { ok: false, error: 'invalid_dir' })
            return
          }
          const requested = body.dir.trim()
          const baseDir = path.resolve(resolveBaseDownloadDir(getSettingsFresh() ?? undefined) || app.getPath('downloads'))
          const resolved = path.isAbsolute(requested) ? path.resolve(requested) : path.resolve(baseDir, requested)
          if (!requested || !isPathInside(resolved, baseDir)) {
            this.sendJson(res, 400, { ok: false, error: 'dir_outside_download_root' })
            return
          }
          targetDir = resolved
        }

        const options = targetDir ? { dir: targetDir } : {}
        const gid = await callAria2Rpc({ ...activeRpcOptions(), method: 'aria2.addUri', params: [uris, options] })
        this.record(ip, 'add', `${uris.join(' ')} -> ${targetDir || 'default'}`, true)
        this.sendJson(res, 200, { ok: true, gid, dir: targetDir || undefined })
        return
      }

      const bulkAction = pathname.match(/^\/api\/tasks\/(pauseAll|unpauseAll)$/)
      if (req.method === 'POST' && bulkAction) {
        const action = bulkAction[1]
        const method = action === 'pauseAll' ? 'aria2.pauseAll' : 'aria2.unpauseAll'
        await callAria2Rpc({ ...activeRpcOptions(), method, params: [] })
        this.record(ip, action, 'all', true)
        this.sendJson(res, 200, { ok: true })
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
