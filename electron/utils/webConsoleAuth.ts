/**
 * Web 控制台鉴权与路由权限（纯函数，无 IO，便于单测）
 *
 * 从 webConsoleServer 拆出来：鉴权是"安全边界"，必须能被穷举测试；
 * 而 webConsoleServer 依赖 electron/http 服务器，不便在单测里反复起停。
 */

import crypto from 'node:crypto'
import type { AppSettings, WebConsoleScope, WebConsoleToken } from '../../src/shared/appSettings'

/** 全部权限范围（用于 UI 展示与文档；admin 隐含全部） */
export const ALL_WEB_CONSOLE_SCOPES: WebConsoleScope[] = ['tasks:read', 'tasks:write', 'tasks:control', 'audit:read', 'admin']

/** 令牌最小长度：短令牌可暴力枚举，且与主令牌规则保持一致 */
export const MIN_TOKEN_LENGTH = 16

/** 恒定时间比较（长度不同直接 false，避免 timingSafeEqual 抛错） */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

/** admin 通配：拥有 admin 即视为拥有 required */
export function scopeAllows(scopes: WebConsoleScope[] | undefined, required: WebConsoleScope): boolean {
  if (!Array.isArray(scopes) || scopes.length === 0) return false
  if (scopes.includes('admin')) return true
  return scopes.includes(required)
}

/**
 * 解析 Bearer 令牌对应的权限。
 *
 * - 主令牌（settings.webConsole.token）视为 admin，兼容旧客户端；
 * - settings.webConsole.tokens 中长度达标的条目按自身 scopes 授权；
 * - 无匹配返回 null（调用方回 401）。
 */
export function resolveAuthFromSettings(settings: AppSettings, presented: string): { scopes: WebConsoleScope[]; tokenId: string | null } | null {
  if (!presented) return null
  const config = settings.webConsole ?? {}
  const master = String(config.token || '').trim()
  if (master && safeEqual(presented, master)) {
    return { scopes: ['admin'], tokenId: null }
  }
  const tokens: WebConsoleToken[] = Array.isArray(config.tokens) ? config.tokens : []
  for (const entry of tokens) {
    const value = String(entry?.token || '')
    if (value.length < MIN_TOKEN_LENGTH) continue
    if (safeEqual(presented, value)) {
      return { scopes: Array.isArray(entry.scopes) ? entry.scopes : [], tokenId: entry.id || null }
    }
  }
  return null
}

/**
 * 路由到所需权限的映射；返回 null 表示该路由免鉴权（登录页、静态资源、OpenAPI 文档）。
 * 注意：/api/ 之外的路径一律免鉴权，由 handle() 的白名单分支处理。
 */
export function routeScope(method: string, pathname: string): WebConsoleScope | null {
  const verb = method.toUpperCase()
  if (verb === 'GET' && pathname === '/api/status') return 'tasks:read'
  // SSE 事件流与 /api/status 同源同权限：只读任务状态
  if (verb === 'GET' && pathname === '/api/events') return 'tasks:read'
  // 队列视图只读：队列设置 + 等待中的任务，与 /api/status 同一档权限
  if (verb === 'GET' && pathname === '/api/queue') return 'tasks:read'
  if (verb === 'GET' && pathname === '/api/audit') return 'audit:read'
  if (verb === 'POST' && pathname === '/api/tasks') return 'tasks:write'
  if (verb === 'POST' && /^\/api\/tasks\/(pauseAll|unpauseAll)$/.test(pathname)) return 'tasks:control'
  if (verb === 'POST' && /^\/api\/tasks\/[^/]+\/(pause|resume|remove)$/.test(pathname)) return 'tasks:control'
  // /api/session 不登记在这里：它是登录入口，必须能在没有 Cookie 的情况下调用，
  // 由 handle() 在查路由权限之前单独分支处理（见 handleSession）。
  return null
}

/** 免鉴权的静态资源路径（PWA 资源与文档） */
const PUBLIC_PATHS = new Set([
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/sw.js',
  '/openapi.json',
  '/icon-192.png',
  '/icon-512.png',
  '/maskable-192.png',
  '/maskable-512.png'
])

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname)
}

/* ------------------------------------------------------------------ */
/* 会话 Cookie（D-14）                                                 */
/* ------------------------------------------------------------------ */

/** 浏览器端保存会话的 Cookie 名（HttpOnly，页面脚本读不到） */
export const WEB_CONSOLE_SESSION_COOKIE = 'aria2web_session'

/** 会话有效期：8 小时，足够一次远程盯下载，又不至于长期留一把钥匙 */
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60

/**
 * 会话 Cookie 的值 = HMAC(进程内随机密钥, 令牌)。
 *
 * 这样浏览器手里拿到的不是令牌本身：页面脚本、扩展、XSS 都读不到令牌原文，
 * 只能拿到一个绑定当前进程的摘要；进程重启密钥变化，旧 Cookie 自动失效。
 */
export function createSessionSecret(): Buffer {
  return crypto.randomBytes(32)
}

export function signSessionToken(secret: Buffer, token: string): string {
  return crypto.createHmac('sha256', secret).update(token, 'utf8').digest('base64url')
}

export function verifySessionToken(secret: Buffer, token: string, presented: string): boolean {
  if (!token || !presented) return false
  return safeEqual(presented, signSessionToken(secret, token))
}

/** 从 Cookie 头里取出会话值（同名 Cookie 取第一个，其余忽略） */
export function readSessionCookie(cookieHeader: string | undefined): string {
  const header = String(cookieHeader || '')
  if (!header) return ''
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    if (part.slice(0, index).trim() !== WEB_CONSOLE_SESSION_COOKIE) continue
    return decodeURIComponent(part.slice(index + 1).trim())
  }
  return ''
}

/**
 * 组装 Set-Cookie 头。
 *
 * HttpOnly：页面脚本读不到，XSS 偷不走；SameSite=Strict：跨站请求一律不带，
 * 顺带挡掉 CSRF；Secure 只在 HTTPS 监听时加，否则明文 LAN 下浏览器会直接丢掉 Cookie。
 */
export function buildSessionCookie(value: string, options: { secure: boolean; maxAgeSeconds?: number }): string {
  const parts = [
    WEB_CONSOLE_SESSION_COOKIE + '=' + encodeURIComponent(value),
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=' + String(options.maxAgeSeconds ?? SESSION_MAX_AGE_SECONDS)
  ]
  if (options.secure) parts.push('Secure')
  return parts.join('; ')
}

/** 清除会话用的 Set-Cookie（Max-Age=0 让浏览器立刻丢弃） */
export function buildClearSessionCookie(options: { secure: boolean }): string {
  return buildSessionCookie('', { secure: options.secure, maxAgeSeconds: 0 })
}
