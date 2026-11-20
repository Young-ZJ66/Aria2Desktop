import { describe, expect, it } from 'vitest'
import {
  ALL_WEB_CONSOLE_SCOPES,
  MIN_TOKEN_LENGTH,
  isPublicPath,
  resolveAuthFromSettings,
  routeScope,
  safeEqual,
  scopeAllows
} from './webConsoleAuth'
import type { AppSettings } from '../../src/shared/appSettings'

// Web 控制台是唯一能从局域网进来的入口，鉴权判定错一位就是「别人能停你的下载」。
// 这些是纯函数，穷举比集成测试便宜得多，所以把边界值全部钉住。

function settings(webConsole: AppSettings['webConsole']): AppSettings {
  return { webConsole } as AppSettings
}

describe('safeEqual', () => {
  it('相同字符串为真', () => {
    expect(safeEqual('abcdefghijklmnop', 'abcdefghijklmnop')).toBe(true)
  })

  it('等长不同内容为假', () => {
    expect(safeEqual('abcdefghijklmnop', 'abcdefghijklmnoq')).toBe(false)
  })

  it('长度不同直接为假（timingSafeEqual 会抛错，必须先比长度）', () => {
    expect(safeEqual('short', 'a-much-longer-token-value')).toBe(false)
  })

  it('空串与空串相等（调用方需自己拦空令牌）', () => {
    expect(safeEqual('', '')).toBe(true)
  })

  it('多字节字符按字节比较，不会因字符数相同而误判', () => {
    expect(safeEqual('令牌令牌令牌令牌', '令牌令牌令牌令牍')).toBe(false)
  })
})

describe('scopeAllows', () => {
  it('admin 隐含全部权限', () => {
    for (const scope of ALL_WEB_CONSOLE_SCOPES) {
      expect(scopeAllows(['admin'], scope)).toBe(true)
    }
  })

  it('精确匹配自身权限', () => {
    expect(scopeAllows(['tasks:read'], 'tasks:read')).toBe(true)
  })

  it('不匹配的权限为假', () => {
    expect(scopeAllows(['tasks:read'], 'tasks:write')).toBe(false)
  })

  it('undefined 与空数组都不授权', () => {
    expect(scopeAllows(undefined, 'tasks:read')).toBe(false)
    expect(scopeAllows([], 'tasks:read')).toBe(false)
  })
})

describe('resolveAuthFromSettings', () => {
  const master = 'master-token-0123456789'

  it('主令牌匹配时视为 admin，tokenId 为 null（兼容旧客户端）', () => {
    const result = resolveAuthFromSettings(settings({ token: master }), master)
    expect(result).toEqual({ scopes: ['admin'], tokenId: null })
  })

  it('主令牌前后空白被忽略（设置页粘贴常带空格）', () => {
    const result = resolveAuthFromSettings(settings({ token: '  ' + master + '  ' }), master)
    expect(result).toEqual({ scopes: ['admin'], tokenId: null })
  })

  it('细粒度令牌按自身 scopes 授权并带回 id', () => {
    const result = resolveAuthFromSettings(
      settings({ token: master, tokens: [{ id: 'tv', name: '只读', token: 'readonly-token-012345', scopes: ['tasks:read'] }] }),
      'readonly-token-012345'
    )
    expect(result).toEqual({ scopes: ['tasks:read'], tokenId: 'tv' })
  })

  it('过短的细粒度令牌被跳过（短令牌可暴力枚举）', () => {
    const short = 'x'.repeat(MIN_TOKEN_LENGTH - 1)
    const result = resolveAuthFromSettings(
      settings({ tokens: [{ id: 'short', name: '过短', token: short, scopes: ['admin'] }] }),
      short
    )
    expect(result).toBeNull()
  })

  it('细粒度令牌缺 id 时 tokenId 为 null', () => {
    const result = resolveAuthFromSettings(
      settings({ tokens: [{ token: 'no-id-token-0123456', scopes: ['audit:read'] } as never] }),
      'no-id-token-0123456'
    )
    expect(result).toEqual({ scopes: ['audit:read'], tokenId: null })
  })

  it('细粒度令牌缺 scopes 时按空权限处理（不默认给 admin）', () => {
    const result = resolveAuthFromSettings(
      settings({ tokens: [{ id: 'noscope', token: 'noscope-token-012345' } as never] }),
      'noscope-token-012345'
    )
    expect(result).toEqual({ scopes: [], tokenId: 'noscope' })
  })

  it('空令牌一律不匹配', () => {
    expect(resolveAuthFromSettings(settings({ token: master }), '')).toBeNull()
  })

  it('未配置 webConsole 时不匹配', () => {
    expect(resolveAuthFromSettings({} as AppSettings, 'anything-at-all-1234')).toBeNull()
  })

  it('令牌不匹配返回 null（调用方回 401）', () => {
    expect(resolveAuthFromSettings(settings({ token: master }), 'wrong-token-01234567')).toBeNull()
  })
})

describe('routeScope', () => {
  it('只读接口需要 tasks:read', () => {
    expect(routeScope('GET', '/api/status')).toBe('tasks:read')
    expect(routeScope('GET', '/api/events')).toBe('tasks:read')
  })

  it('队列视图只读，同样归 tasks:read', () => {
    expect(routeScope('GET', '/api/queue')).toBe('tasks:read')
    // 队列不提供写入口：改并发/重试必须回桌面端设置页
    expect(routeScope('POST', '/api/queue')).toBeNull()
  })

  it('审计接口单独需要 audit:read', () => {
    expect(routeScope('GET', '/api/audit')).toBe('audit:read')
  })

  it('新建任务需要 tasks:write', () => {
    expect(routeScope('POST', '/api/tasks')).toBe('tasks:write')
  })

  it('暂停/继续/删除需要 tasks:control（含 pauseAll/unpauseAll）', () => {
    expect(routeScope('POST', '/api/tasks/pauseAll')).toBe('tasks:control')
    expect(routeScope('POST', '/api/tasks/unpauseAll')).toBe('tasks:control')
    expect(routeScope('POST', '/api/tasks/abc123/pause')).toBe('tasks:control')
    expect(routeScope('POST', '/api/tasks/abc123/resume')).toBe('tasks:control')
    expect(routeScope('POST', '/api/tasks/abc123/remove')).toBe('tasks:control')
  })

  it('方法大小写不敏感', () => {
    expect(routeScope('get', '/api/status')).toBe('tasks:read')
    expect(routeScope('post', '/api/tasks')).toBe('tasks:write')
  })

  it('未登记的路由返回 null（免鉴权由调用方白名单决定）', () => {
    expect(routeScope('GET', '/api/unknown')).toBeNull()
    expect(routeScope('DELETE', '/api/tasks')).toBeNull()
    expect(routeScope('GET', '/api/tasks/abc123/pause')).toBeNull()
    expect(routeScope('POST', '/api/tasks/abc123/unknown')).toBeNull()
    expect(routeScope('GET', '/')).toBeNull()
  })
})

describe('isPublicPath', () => {
  it('登录页与 PWA 资源免鉴权', () => {
    for (const path of ['/', '/index.html', '/manifest.webmanifest', '/sw.js', '/openapi.json']) {
      expect(isPublicPath(path)).toBe(true)
    }
  })

  it('四个 PWA 图标免鉴权', () => {
    for (const path of ['/icon-192.png', '/icon-512.png', '/maskable-192.png', '/maskable-512.png']) {
      expect(isPublicPath(path)).toBe(true)
    }
  })

  it('接口路径不免鉴权', () => {
    expect(isPublicPath('/api/status')).toBe(false)
    expect(isPublicPath('/api/tasks')).toBe(false)
  })

  it('带查询串或尾斜杠的变体不命中（精确匹配，防路径混淆绕过）', () => {
    expect(isPublicPath('/?x=1')).toBe(false)
    expect(isPublicPath('/sw.js/')).toBe(false)
    expect(isPublicPath('//index.html')).toBe(false)
  })
})
