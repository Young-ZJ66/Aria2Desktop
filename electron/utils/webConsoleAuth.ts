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
  if (verb === 'GET' && pathname === '/api/audit') return 'audit:read'
  if (verb === 'POST' && pathname === '/api/tasks') return 'tasks:write'
  if (verb === 'POST' && /^\/api\/tasks\/[^/]+\/(pause|resume|remove)$/.test(pathname)) return 'tasks:control'
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
