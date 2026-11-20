import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSettings } from '../../src/shared/appSettings'

/**
 * activeRpcConfig 的回归用例。
 *
 * 背景：SpeedScheduler / DownloadScheduler / UPnP / Tracker / 插件都曾直接读
 * settings.aria2，于是用户在连接预设里切到远程 aria2 后，这些后台服务仍然把指令
 * 发到 127.0.0.1:6800 —— 界面上是远程连接，实际调度器在操作本机引擎。
 * 这里把 settingsAccessor 桩掉，纯验证「活动连接 → 端点」的解析口径。
 */
const getSettingsFresh = vi.hoisted(() => vi.fn())
vi.mock('./settingsAccessor', () => ({ getSettingsFresh }))

const { activeRpcOptions, getActiveRpcConfig, getLocalActiveRpcConfig } = await import('./activeRpcConfig')

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    aria2: {
      host: '127.0.0.1',
      port: 6800,
      secret: 'legacy-secret',
      protocol: 'http',
      path: '/jsonrpc'
    },
    connectionProfiles: [],
    ...overrides
  } as AppSettings
}

function remoteProfile() {
  return {
    id: 'remote',
    name: 'NAS',
    config: { host: 'nas.local', port: 6801, protocol: 'https' as const, secret: 's3cret', path: 'rpc' }
  }
}

beforeEach(() => {
  getSettingsFresh.mockReset()
  getSettingsFresh.mockReturnValue(settings())
})

describe('getActiveRpcConfig 解析活动连接', () => {
  it('没有活动预设时回退 settings.aria2', () => {
    const config = getActiveRpcConfig(settings({ activeProfileId: 'missing' }))
    expect(config).toMatchObject({ host: '127.0.0.1', port: 6800, protocol: 'http', secret: 'legacy-secret', path: '/jsonrpc' })
    expect(config.isLocal).toBe(true)
    expect(config.profileName).toBe('default')
  })

  it('活动预设优先于 settings.aria2', () => {
    const config = getActiveRpcConfig(
      settings({ connectionProfiles: [remoteProfile()], activeProfileId: 'remote' })
    )
    expect(config).toMatchObject({ host: 'nas.local', port: 6801, protocol: 'https', secret: 's3cret', path: '/rpc' })
    expect(config.isLocal).toBe(false)
    expect(config.profileName).toBe('NAS')
  })

  it('wss 归一化为 https，ws 归一化为 http', () => {
    const wss = getActiveRpcConfig(settings({
      connectionProfiles: [{ id: 'p', name: 'P', config: { ...remoteProfile().config, protocol: 'wss' as never } }],
      activeProfileId: 'p'
    }))
    expect(wss.protocol).toBe('https')
    const ws = getActiveRpcConfig(settings({
      connectionProfiles: [{ id: 'p', name: 'P', config: { ...remoteProfile().config, protocol: 'ws' as never } }],
      activeProfileId: 'p'
    }))
    expect(ws.protocol).toBe('http')
  })

  it('协议大小写不敏感，未知协议按 http 处理', () => {
    const upper = getActiveRpcConfig(settings({
      connectionProfiles: [{ id: 'p', name: 'P', config: { ...remoteProfile().config, protocol: 'HTTPS' as never } }],
      activeProfileId: 'p'
    }))
    expect(upper.protocol).toBe('https')
    const unknown = getActiveRpcConfig(settings({
      connectionProfiles: [{ id: 'p', name: 'P', config: { ...remoteProfile().config, protocol: 'ftp' as never } }],
      activeProfileId: 'p'
    }))
    expect(unknown.protocol).toBe('http')
  })

  it('端口非法或缺失时回落 6800，主机为空时回落 127.0.0.1', () => {
    const config = getActiveRpcConfig(settings({
      connectionProfiles: [{ id: 'p', name: 'P', config: { ...remoteProfile().config, host: '   ', port: 0 } }],
      activeProfileId: 'p'
    }))
    expect(config.port).toBe(6800)
    expect(config.host).toBe('127.0.0.1')
  })

  it('path 缺少前导斜杠时补齐，为空时回落 /jsonrpc', () => {
    const config = getActiveRpcConfig(settings({
      connectionProfiles: [{ id: 'p', name: 'P', config: { ...remoteProfile().config, path: '  ' } }],
      activeProfileId: 'p'
    }))
    expect(config.path).toBe('/jsonrpc')
  })

  it.each(['127.0.0.1', 'localhost', '::1', '[::1]'])('%s 视为本机引擎', host => {
    const config = getActiveRpcConfig(settings({
      connectionProfiles: [{ id: 'p', name: 'P', config: { ...remoteProfile().config, host } }],
      activeProfileId: 'p'
    }))
    expect(config.isLocal).toBe(true)
  })

  it('远程主机不视为本机引擎', () => {
    const config = getActiveRpcConfig(
      settings({ connectionProfiles: [remoteProfile()], activeProfileId: 'remote' })
    )
    expect(config.isLocal).toBe(false)
  })

  it('未传参时读 getSettingsFresh', () => {
    getActiveRpcConfig()
    expect(getSettingsFresh).toHaveBeenCalledTimes(1)
  })
})

describe('activeRpcOptions 只暴露 RPC 端点字段', () => {
  it('展开的字段恰好是 host/port/protocol/path/secret', () => {
    const options = activeRpcOptions(
      settings({ connectionProfiles: [remoteProfile()], activeProfileId: 'remote' })
    )
    expect(options).toEqual({
      host: 'nas.local',
      port: 6801,
      protocol: 'https',
      path: '/rpc',
      secret: 's3cret'
    })
  })
})

describe('getLocalActiveRpcConfig 只对本机引擎返回配置', () => {
  it('本机连接返回完整配置', () => {
    const config = getLocalActiveRpcConfig(settings())
    expect(config).not.toBeNull()
    expect(config?.host).toBe('127.0.0.1')
  })

  it('远程连接返回 null（UPnP 等只对本机有意义）', () => {
    const config = getLocalActiveRpcConfig(
      settings({ connectionProfiles: [remoteProfile()], activeProfileId: 'remote' })
    )
    expect(config).toBeNull()
  })
})
