import type { AppSettings, ConnectionProfileConfig } from '../../src/shared/appSettings'
import { getSettingsFresh } from './settingsAccessor'

/**
 * 主进程后台服务使用的 RPC 端点。
 *
 * 为什么需要它：以前 SpeedScheduler / DownloadScheduler / UPnP / Tracker / 插件
 * 都直接读 settings.aria2（内置引擎的配置），于是用户在连接预设里切到远程 aria2 后，
 * 这些"后台功能"仍然把指令发到 127.0.0.1:6800 —— 表面上有远程连接，实际调度器、
 * 限速、Tracker 更新都在操作本机引擎。本模块按 activeProfileId 解析出真正生效的端点。
 */
export interface ActiveRpcConfig {
  host: string
  port: number
  protocol: 'http' | 'https'
  secret: string
  path: string
  /** 是否指向本机内置引擎（127.0.0.1/localhost/::1） */
  isLocal: boolean
  /** 预设名称，仅用于日志 */
  profileName: string
}

function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]'
}

function normalizePath(pathname: string | undefined): string {
  const raw = String(pathname || '/jsonrpc').trim() || '/jsonrpc'
  return raw.startsWith('/') ? raw : `/${raw}`
}

/**
 * 读取当前活动连接对应的 RPC 配置。
 * 找不到预设时回退到 settings.aria2（首次启动/旧数据）。
 */
export function getActiveRpcConfig(settings: AppSettings = getSettingsFresh()): ActiveRpcConfig {
  const profiles = Array.isArray(settings.connectionProfiles) ? settings.connectionProfiles : []
  const active = profiles.find(profile => profile.id === settings.activeProfileId)
  const legacy = settings.aria2 || {}

  const config: Partial<ConnectionProfileConfig> = active?.config || {
    host: legacy.host,
    port: legacy.port,
    protocol: legacy.protocol,
    secret: legacy.secret,
    path: legacy.path
  }

  const rawProtocol = String(config.protocol || 'http').toLowerCase()
  const protocol: 'http' | 'https' = rawProtocol === 'https' || rawProtocol === 'wss' ? 'https' : 'http'
  const host = String(config.host || '127.0.0.1').trim() || '127.0.0.1'
  const port = Number(config.port) || 6800

  return {
    host,
    port,
    protocol,
    secret: String(config.secret || ''),
    path: normalizePath(config.path),
    isLocal: isLoopbackHost(host),
    profileName: active?.name || 'default'
  }
}

/** 转成 callAria2Rpc 可直接展开的端点字段 */
export function activeRpcOptions(settings?: AppSettings): {
  host: string
  port: number
  protocol: 'http' | 'https'
  path: string
  secret: string
} {
  const config = getActiveRpcConfig(settings)
  return {
    host: config.host,
    port: config.port,
    protocol: config.protocol,
    path: config.path,
    secret: config.secret
  }
}

/** 仅当当前活动连接指向本机内置引擎时返回配置，否则 null（UPnP 等只对本机有意义的服务用） */
export function getLocalActiveRpcConfig(settings: AppSettings = getSettingsFresh()): ActiveRpcConfig | null {
  const config = getActiveRpcConfig(settings)
  return config.isLocal ? config : null
}
