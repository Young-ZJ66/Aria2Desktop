/**
 * 插件市场服务
 *
 * 只信任注册表 URL 返回的 JSON，但安装前仍会逐项校验：id/版本/入口 URL、
 * 强制 SHA-256、配置了可信发布者时强制签名。下载与落盘由 PluginManager 完成，
 * 插件和主进程之间仍然隔着 utilityProcess。
 */

import { getSettingsFresh } from '../utils/settingsAccessor'
import { createLogger } from '../utils/logger'
import type { PluginManager, RegistryPluginEntry } from './pluginManager'
import type { PluginInfo } from '../types/plugin'

const logger = createLogger('PluginMarket')

export interface MarketPlugin extends RegistryPluginEntry {
  installedVersion?: string
  installed?: boolean
}

interface CacheEntry {
  at: number
  plugins: MarketPlugin[]
}

const CACHE_TTL_MS = 10 * 60 * 1000
const MAX_REGISTRY_BYTES = 2 * 1024 * 1024

function isRegistryEntry(value: unknown): value is RegistryPluginEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  return typeof entry.id === 'string' &&
    typeof entry.name === 'string' &&
    typeof entry.version === 'string' &&
    typeof entry.entryUrl === 'string' &&
    typeof entry.sha256 === 'string'
}

export class PluginMarketService {
  private pluginManager: PluginManager
  private cache: CacheEntry | null = null

  constructor(pluginManager: PluginManager) {
    this.pluginManager = pluginManager
  }

  /** 拉取注册表并合并本地安装状态；网络失败时返回错误而不是抛异常 */
  async list(force = false): Promise<{ success: boolean; plugins: MarketPlugin[]; error?: string }> {
    const settings = getSettingsFresh()
    const market = settings.pluginMarket
    if (market?.enabled === false) {
      return { success: false, plugins: [], error: 'MARKET_DISABLED' }
    }
    const registryUrl = (market?.registryUrl || '').trim()
    if (!/^https:\/\//i.test(registryUrl)) {
      return { success: false, plugins: [], error: 'INVALID_REGISTRY_URL' }
    }
    if (!force && this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) {
      return { success: true, plugins: this.mergeInstalled(this.cache.plugins) }
    }

    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15000)
      let response: Response
      try {
        response = await fetch(registryUrl, {
          signal: controller.signal,
          redirect: 'follow',
          headers: { 'Accept': 'application/json' }
        })
      } finally {
        clearTimeout(timer)
      }
      if (!response.ok) return { success: false, plugins: [], error: `HTTP_${response.status}` }
      const contentLength = Number(response.headers.get('content-length') || 0)
      if (contentLength > MAX_REGISTRY_BYTES) return { success: false, plugins: [], error: 'REGISTRY_TOO_LARGE' }
      const buffer = await response.arrayBuffer()
      if (buffer.byteLength > MAX_REGISTRY_BYTES) return { success: false, plugins: [], error: 'REGISTRY_TOO_LARGE' }
      const text = new TextDecoder().decode(buffer)
      const parsed = JSON.parse(text) as unknown
      const rawPlugins = Array.isArray(parsed)
        ? parsed
        : (parsed && typeof parsed === 'object' && Array.isArray((parsed as { plugins?: unknown }).plugins)
          ? (parsed as { plugins: unknown[] }).plugins
          : null)
      if (!rawPlugins) return { success: false, plugins: [], error: 'INVALID_REGISTRY' }
      const seen = new Set<string>()
      const plugins: MarketPlugin[] = []
      for (const item of rawPlugins) {
        if (!isRegistryEntry(item)) continue
        if (seen.has(item.id)) continue
        if (!/^https:\/\//i.test(item.entryUrl)) continue
        if (!/^[a-f0-9]{64}$/i.test(item.sha256)) continue
        seen.add(item.id)
        plugins.push({ ...item })
      }
      this.cache = { at: Date.now(), plugins }
      return { success: true, plugins: this.mergeInstalled(plugins) }
    } catch (error) {
      logger.warn('Failed to fetch plugin registry:', error)
      return { success: false, plugins: [], error: error instanceof Error ? error.message : 'NETWORK_ERROR' }
    }
  }

  /** 安装指定插件（下载、校验、落盘、加载、启用） */
  async install(pluginId: string): Promise<{ success: boolean; error?: string; plugin?: PluginInfo }> {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,80}$/.test(pluginId)) {
      return { success: false, error: 'INVALID_ID' }
    }
    const listed = await this.list()
    if (!listed.success) return { success: false, error: listed.error }
    const entry = listed.plugins.find(item => item.id === pluginId)
    if (!entry) return { success: false, error: 'NOT_FOUND' }
    const trusted = getSettingsFresh().trustedPluginPublishers ?? []
    const upgrade = !!entry.installed && entry.installedVersion !== entry.version
    return this.pluginManager.installFromRegistry(entry, trusted, { upgrade })
  }

  private mergeInstalled(plugins: MarketPlugin[]): MarketPlugin[] {
    const installed = new Map(this.pluginManager.getPlugins().map(info => [info.manifest.id, info]))
    return plugins.map(plugin => {
      const local = installed.get(plugin.id)
      return {
        ...plugin,
        installed: !!local,
        installedVersion: local?.manifest.version
      }
    })
  }

  clearCache(): void {
    this.cache = null
  }
}
