import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { PLUGIN_REGISTRY_PINNED_TAG } from '../shared/appSettings'

/**
 * settingsService 是设置的唯一读写入口，其中三条不变式一旦破坏，用户是"静默"受损的：
 *
 * 1. 局部保存不能把同级设置清空（`saveSettings({ download: { defaultDir } })` 之后
 *    并发数、分类规则等必须还在）；
 * 2. 导出/导入往返不能泄露或抹掉 RPC 密钥（导出脱敏为 `***`，导入必须保留本机值，
 *    否则引擎立刻连不上）；
 * 3. 重置设置不能把密钥一起重置（密钥属于运行中引擎的凭据，改它要走去 RPC 安全页）。
 *
 * 这里针对的都是"合并/序列化"这类纯逻辑，不依赖真实 Electron。
 */

interface FakeElectronApi {
  getStoreValue: ReturnType<typeof vi.fn>
  setStoreValue: ReturnType<typeof vi.fn>
  writeLog: ReturnType<typeof vi.fn>
}

function installElectronApi(stored: unknown = null): FakeElectronApi {
  const api: FakeElectronApi = {
    getStoreValue: vi.fn(async () => stored),
    setStoreValue: vi.fn(async () => undefined),
    writeLog: vi.fn(async () => undefined)
  }
  vi.stubGlobal('window', { electronAPI: api })
  return api
}

/** 只声明用例里真正会读的字段，避免用 any 把断言变成"什么都能过" */
interface SavedPayload {
  theme?: string
  refreshInterval?: number
  aria2: { port?: number; secret?: string }
  download: { defaultDir?: string; maxConcurrentDownloads?: number; autoStart?: boolean }
  connectionProfiles: Array<{ id: string; name?: string; config?: { secret?: string } }>
  webConsole?: { token?: string; tokens?: Array<{ name?: string; token?: string }> }
  pluginMarket?: { enabled?: boolean; registryUrl?: string; developerMode?: boolean }
  trustedPluginPublishers?: string[]
}

/** 取第 n 次（默认最后一次）setStoreValue 落盘的载荷 */
function savedPayload(api: FakeElectronApi, index = -1): SavedPayload {
  const calls = api.setStoreValue.mock.calls
  const call = calls[index < 0 ? calls.length + index : index]
  return call?.[1] as SavedPayload
}

/** 每个用例都要一份干净的实例：单例在 import 时就构造并读过一次存储 */
async function loadService(options: { withElectron?: boolean; stored?: unknown } = {}) {
  const api = options.withElectron === false ? null : installElectronApi(options.stored ?? null)
  vi.resetModules()
  const mod = await import('./settingsService')
  const service = new mod.SettingsService()
  await service.loadSettings()
  return { service, api, defaults: mod.defaultSettings }
}

beforeEach(() => {
  vi.useRealTimers()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * v1.4.0 → v1.5.0 升级不丢配置（发布清单第 5 项）。
 *
 * v1.4.0 的磁盘配置里没有 queue / taskTemplates / completionRules / webConsole /
 * pluginMarket 这几块（其中前四块在 v1.4.0 甚至会被设置保存静默抹掉，见 D-53）。
 * 升级后必须做到两件事：
 *  1. 缺的块回落到默认值，不能是 undefined（否则读 `settings.queue.maxConcurrent` 直接抛错）；
 *  2. 用户已有的字段一个都不能被默认值覆盖（尤其是密钥与令牌这类凭据）。
 */
describe('v1.4.0 升级兼容', () => {
  /** v1.4.0 磁盘上的真实形状：只有当时存在的键，且没有 queue/taskTemplates/completionRules */
  const legacySettings = {
    language: 'zh-CN',
    theme: 'dark',
    autoConnect: false,
    aria2: { port: 6800, secret: 'legacy-secret', engineMode: 'local' },
    download: { defaultDir: 'D:/Downloads', maxConcurrentDownloads: 8 },
    connectionProfiles: [{ id: 'legacy', name: '本机', config: { host: '127.0.0.1', port: 6800, secret: 'legacy-secret' } }],
    activeProfileId: 'legacy'
  }

  it('v1.4.0 配置升级后缺失的配置块回落到默认值', async () => {
    const { service, defaults } = await loadService({ stored: legacySettings })
    const settings = service.getSettings()

    // 缺失块必须是对象/数组而不是 undefined，否则界面读取即抛错
    expect(settings.queue).toEqual(defaults.queue)
    expect(settings.taskTemplates).toEqual([])
    expect(settings.completionRules).toEqual([])
    expect(settings.webConsole).toEqual(defaults.webConsole)
    expect(settings.pluginMarket).toEqual(defaults.pluginMarket)
    expect(settings.trustedPluginPublishers).toEqual(defaults.trustedPluginPublishers)
  })

  it('v1.4.0 配置里已有的凭据与自定义项不被默认值覆盖', async () => {
    const { service } = await loadService({ stored: legacySettings })
    const settings = service.getSettings()

    expect(settings.aria2?.secret).toBe('legacy-secret')
    expect(settings.download?.defaultDir).toBe('D:/Downloads')
    expect(settings.download?.maxConcurrentDownloads).toBe(8)
    expect(settings.connectionProfiles?.[0]?.config?.secret).toBe('legacy-secret')
    expect(settings.activeProfileId).toBe('legacy')
    expect(settings.language).toBe('zh-CN')
    expect(settings.theme).toBe('dark')
  })

  it('v1.4.0 配置缺少 clipboardMonitorEnabled 时按关闭处理（D-36 默认值收紧）', async () => {
    const { service } = await loadService({ stored: legacySettings })
    expect(service.getSettings().clipboardMonitorEnabled).toBe(false)
  })

  it('v1.4.0 配置里 webConsole 只有部分字段时补全其余默认值', async () => {
    const { service, defaults } = await loadService({
      stored: { ...legacySettings, webConsole: { enabled: true, port: 6802 } }
    })
    const webConsole = service.getSettings().webConsole

    expect(webConsole?.enabled).toBe(true)
    expect(webConsole?.port).toBe(6802)
    // 用户没配过的字段（令牌、TLS 路径）回落到默认值，不能被抹成 undefined
    expect(webConsole?.token).toBe(defaults.webConsole?.token)
    expect(webConsole?.allowedIps).toEqual(defaults.webConsole?.allowedIps)
  })
})

describe('加载与合并', () => {
  it('只存了部分字段时，其余字段回落到默认值', async () => {
    const { service, defaults } = await loadService({
      stored: { theme: 'dark', download: { defaultDir: 'D:/dl' } }
    })

    const settings = service.getSettings()
    expect(settings.theme).toBe('dark')
    expect(settings.download?.defaultDir).toBe('D:/dl')
    expect(settings.download?.maxConcurrentDownloads).toBe(defaults.download?.maxConcurrentDownloads)
    expect(settings.aria2?.port).toBe(defaults.aria2?.port)
    expect(settings.category?.categories?.length).toBe(defaults.category?.categories?.length)
  })

  it('未知的遗留字段不会顶掉默认值', async () => {
    // ui 组已从 AppSettings 移除（无消费方的死字段），旧配置文件里残留的 ui 仍要原样带过：
    // 删字段不能让老用户的设置文件读一遍就报错或被"清洗"
    const { service, defaults } = await loadService({
      stored: { theme: 'dark', legacyFlag: 1, ui: { showToolbar: false } }
    })

    const settings = service.getSettings() as Record<string, unknown>
    expect(settings.theme).toBe('dark')
    expect(settings.legacyFlag).toBe(1) // 旧版本字段原样带过，不做破坏
    expect(settings.ui).toMatchObject({ showToolbar: false })
    expect(settings.refreshInterval).toBe(defaults.refreshInterval)
  })

  it('窗口状态默认开启，剪贴板监控默认关闭（D-36）', async () => {
    const { service, defaults } = await loadService({ stored: {} })
    expect(defaults.keepWindowState).toBe(true)
    expect(defaults.clipboardMonitorEnabled).toBe(false)
    expect(service.getSettings().keepWindowState).toBe(true)
    expect(service.getSettings().clipboardMonitorEnabled).toBe(false)
  })

  it('窗口状态不能被旧配置关闭，剪贴板关闭状态被尊重', async () => {
    const { service } = await loadService({
      stored: { keepWindowState: false, clipboardMonitorEnabled: false }
    })

    expect(service.getSettings().keepWindowState).toBe(true)
    expect(service.getSettings().clipboardMonitorEnabled).toBe(false)
  })

  it('剪贴板监控可以被 saveSettings 开启，也可以再关闭', async () => {
    const { service } = await loadService()

    await service.saveSettings({ keepWindowState: false, clipboardMonitorEnabled: true })
    expect(service.getSettings().keepWindowState).toBe(true)
    expect(service.getSettings().clipboardMonitorEnabled).toBe(true)

    await service.saveSettings({ clipboardMonitorEnabled: false })
    expect(service.getSettings().clipboardMonitorEnabled).toBe(false)
  })

  it('读取失败时回落到默认设置并清掉损坏的本地副本', async () => {
    const removeItem = vi.fn()
    vi.stubGlobal('localStorage', {
      getItem: () => '{ 坏掉的 JSON',
      setItem: vi.fn(),
      removeItem
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.resetModules()
    const mod = await import('./settingsService')
    const service = new mod.SettingsService()
    await service.loadSettings()

    expect(service.getSettings().theme).toBe(mod.defaultSettings.theme)
    expect(removeItem).toHaveBeenCalledWith('aria2-desktop-settings')
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
})

describe('局部保存', () => {
  it('只改一个子字段时不清空同级设置', async () => {
    const { service, api, defaults } = await loadService()

    await service.saveSettings({ download: { defaultDir: 'E:/new-dir' } })

    const saved = savedPayload(api!)
    expect(saved.download.defaultDir).toBe('E:/new-dir')
    expect(saved.download.maxConcurrentDownloads).toBe(defaults.download?.maxConcurrentDownloads)
    expect(saved.download.autoStart).toBe(defaults.download?.autoStart)
  })

  it('保存失败时回滚内存中的设置', async () => {
    const { service, api } = await loadService()
    const beforeTheme = service.getSettings().theme
    api!.setStoreValue.mockRejectedValueOnce(new Error('disk full'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(service.saveSettings({ theme: beforeTheme === 'dark' ? 'light' : 'dark' })).rejects.toThrow('disk full')

    expect(service.getSettings().theme).toBe(beforeTheme)
    error.mockRestore()
  })

  it('数组是整体替换而不是逐项合并', async () => {
    const { service, api } = await loadService()

    await service.saveSettings({ connectionProfiles: [{ id: 'x', name: 'X', config: { host: 'h', port: 1, protocol: 'http', secret: '', path: '/' } }] })

    const saved = savedPayload(api!)
    expect(saved.connectionProfiles).toHaveLength(1)
    expect(saved.connectionProfiles[0]?.id).toBe('x')
  })

  it('落盘的是合并后的完整对象，且是纯对象（可 JSON 序列化）', async () => {
    const { service, api } = await loadService()

    await service.saveSettings({ theme: 'dark' })

    const saved = api!.setStoreValue.mock.calls[0]?.[1]
    expect(JSON.parse(JSON.stringify(saved))).toEqual(saved)
    expect(saved.aria2).toBeTypeOf('object')
    expect(saved.category).toBeTypeOf('object')
  })

  it('保存后通知监听器，且单个监听器抛错不影响其他监听器', async () => {
    const { service } = await loadService()
    const broken = vi.fn(() => {
      throw new Error('listener boom')
    })
    const healthy = vi.fn()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    service.onSettingsChange(broken)
    service.onSettingsChange(healthy)

    await service.saveSettings({ theme: 'dark' })

    expect(broken).toHaveBeenCalledTimes(1)
    expect(healthy).toHaveBeenCalledTimes(1)
    expect(healthy.mock.calls[0]?.[0]).toMatchObject({ theme: 'dark' })
    error.mockRestore()
  })

  it('移除监听器后不再收到通知', async () => {
    const { service } = await loadService()
    const listener = vi.fn()

    service.onSettingsChange(listener)
    service.removeListener(listener)
    await service.saveSettings({ theme: 'dark' })

    expect(listener).not.toHaveBeenCalled()
  })

  it('getSettings 返回副本，外部修改不会写回内部状态', async () => {
    const { service } = await loadService()

    const snapshot = service.getSettings()
    snapshot.theme = 'dark'

    expect(service.getSettings().theme).not.toBe('dark')
  })

  it('没有 Electron 后端时写 localStorage', async () => {
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', { getItem: () => null, setItem, removeItem: vi.fn() })
    vi.stubGlobal('window', {})

    vi.resetModules()
    const mod = await import('./settingsService')
    const service = new mod.SettingsService()
    await service.loadSettings()
    await service.saveSettings({ theme: 'dark' })

    expect(setItem).toHaveBeenCalledWith('aria2-desktop-settings', expect.any(String))
  })
})

describe('导出与导入', () => {
  it('导出时把 aria2 与预设里的密钥脱敏', async () => {
    const { service } = await loadService({
      stored: {
        aria2: { secret: 'top-secret' },
        connectionProfiles: [
          { id: 'default', name: '', config: { host: 'localhost', port: 6800, protocol: 'http', secret: 'profile-secret', path: '/jsonrpc' } }
        ]
      }
    })

    const exported = JSON.parse(service.exportSettings())

    expect(exported.aria2.secret).toBe('***')
    expect(exported.connectionProfiles[0].config.secret).toBe('***')
    expect(service.exportSettings()).not.toContain('top-secret')
  })

  it('导入时保留本机密钥，不因备份里是 *** 就把密钥写坏', async () => {
    const { service, api } = await loadService({
      stored: {
        aria2: { secret: 'local-secret' },
        connectionProfiles: [
          { id: 'default', name: '', config: { host: 'localhost', port: 6800, protocol: 'http', secret: 'local-secret', path: '/jsonrpc' } }
        ]
      }
    })

    await service.importSettings(
      JSON.stringify({
        theme: 'dark',
        aria2: { secret: '***', port: 6900 },
        connectionProfiles: [
          { id: 'default', name: '重命名', config: { host: 'localhost', port: 6900, protocol: 'http', secret: '***', path: '/jsonrpc' } }
        ]
      })
    )

    const saved = savedPayload(api!)
    expect(saved.theme).toBe('dark')
    expect(saved.aria2.port).toBe(6900)
    expect(saved.aria2.secret).toBe('local-secret')
    expect(saved.connectionProfiles[0]?.config?.secret).toBe('local-secret')
    expect(saved.connectionProfiles[0]?.name).toBe('重命名')
  })

  it('导入回来路不明的结构时拒绝，不写入任何东西', async () => {
    const { service, api } = await loadService()
    // 拒绝路径本来就会打一条错误日志，这里静音以免污染测试输出
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(service.importSettings('[1,2,3]')).rejects.toThrow('无效的设置文件格式')
    await expect(service.importSettings('"just a string"')).rejects.toThrow('无效的设置文件格式')
    await expect(service.importSettings('{')).rejects.toThrow('无效的设置文件格式')
    expect(api!.setStoreValue).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })

  it('导入带 __proto__ 的对象不会污染 Object.prototype', async () => {
    const { service } = await loadService()

    await service.importSettings('{"__proto__":{"polluted":"yes"},"theme":"dark"}')

    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(service.getSettings().theme).toBe('dark')
  })
})

describe('设置变更日志', () => {
  it('只记录变更的字段名，不记录用户填写的值', async () => {
    const { service, api } = await loadService()

    await service.saveSettings({ theme: 'dark', download: { defaultDir: 'E:/private-dir' } })

    const calls = api!.writeLog.mock.calls
    expect(calls).toHaveLength(1)
    const [level, message] = calls[0] ?? []
    expect(level).toBe('info')
    expect(String(message)).toContain('[Settings] 设置已更新:')
    expect(String(message)).toContain('theme')
    expect(String(message)).toContain('download(defaultDir)')
    // 安全红线：日志里只能出现字段名，绝不能出现值
    expect(String(message)).not.toContain('E:/private-dir')
    expect(String(message)).not.toContain('dark')
  })

  it('没有实际变化时不写日志', async () => {
    const { service, api } = await loadService()

    await service.saveSettings({})

    expect(api!.writeLog).not.toHaveBeenCalled()
  })
})

describe('插件市场默认安全策略（D-02）', () => {
  it('默认注册表地址固定在发布 tag 上，不读 main 分支', async () => {
    const { service } = await loadService()

    const url = service.getSettings().pluginMarket?.registryUrl || ''
    // 读 main 等于"任何人往主分支推一个 commit 就能给所有用户下发插件代码"
    expect(url).not.toMatch(/\/main\//)
    // 断言用常量而不是写死版本号：升级 tag 是发布流程的一部分，不该让单测跟着改
    expect(PLUGIN_REGISTRY_PINNED_TAG).toMatch(/^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/)
    expect(url).toContain(`/${PLUGIN_REGISTRY_PINNED_TAG}/`)
    expect(url.endsWith('/plugin-registry.json')).toBe(true)
  })

  it('默认可信发布者非空且是 PEM 公钥', async () => {
    const { service } = await loadService()

    const publishers = service.getSettings().trustedPluginPublishers || []
    expect(publishers.length).toBeGreaterThan(0)
    expect(publishers[0]).toContain('BEGIN PUBLIC KEY')
  })

  it('老配置里存了空数组时回落到默认公钥，不会静默关掉签名校验', async () => {
    const { service, defaults } = await loadService({
      stored: { trustedPluginPublishers: [] }
    })

    expect(service.getSettings().trustedPluginPublishers).toEqual(defaults.trustedPluginPublishers)
    expect((service.getSettings().trustedPluginPublishers || []).length).toBeGreaterThan(0)
  })

  it('用户自定义公钥会原样保留，不追加默认值', async () => {
    const { service } = await loadService({
      stored: { trustedPluginPublishers: ['-----BEGIN PUBLIC KEY-----\ncustom\n-----END PUBLIC KEY-----'] }
    })

    expect(service.getSettings().trustedPluginPublishers).toEqual([
      '-----BEGIN PUBLIC KEY-----\ncustom\n-----END PUBLIC KEY-----'
    ])
  })

  it('开发者模式默认关闭，重置后仍关闭', async () => {
    const { service, api } = await loadService({ stored: { pluginMarket: { developerMode: true } } })

    expect(service.getSettings().pluginMarket?.developerMode).toBe(true)

    await service.resetSettings()

    expect(savedPayload(api!).pluginMarket?.developerMode).toBe(false)
  })

  it('重置设置后可信发布者仍是默认公钥（不能重置成空数组）', async () => {
    const { service, api, defaults } = await loadService({
      stored: { trustedPluginPublishers: ['custom-key'] }
    })

    await service.resetSettings()

    expect(savedPayload(api!).trustedPluginPublishers).toEqual(defaults.trustedPluginPublishers)
    expect((savedPayload(api!).trustedPluginPublishers || []).length).toBeGreaterThan(0)
  })

  it('导出时把 Web 控制台令牌一并脱敏，导入时保留本机令牌', async () => {
    const { service, api } = await loadService({
      stored: {
        webConsole: {
          token: 'console-secret',
          tokens: [{ name: 'phone', token: 'phone-secret' }]
        }
      }
    })

    const exported = service.exportSettings()
    expect(exported).not.toContain('console-secret')
    expect(exported).not.toContain('phone-secret')
    expect(JSON.parse(exported).webConsole.token).toBe('***')

    await service.importSettings(JSON.stringify({
      webConsole: {
        token: '***',
        tokens: [{ name: 'phone', token: '***' }]
      }
    }))

    const saved = savedPayload(api!)
    expect(saved.webConsole?.token).toBe('console-secret')
    expect(saved.webConsole?.tokens?.[0]?.token).toBe('phone-secret')
  })
})

describe('重置', () => {
  it('重置保留 RPC 密钥与预设密钥，其余回到默认', async () => {
    const { service, api, defaults } = await loadService({
      stored: {
        theme: 'dark',
        refreshInterval: 5000,
        aria2: { secret: 'keep-me' },
        connectionProfiles: [
          { id: 'default', name: '自定义', config: { host: 'localhost', port: 6800, protocol: 'http', secret: 'keep-me', path: '/jsonrpc' } }
        ]
      }
    })

    await service.resetSettings()

    const saved = savedPayload(api!)
    expect(saved.theme).toBe(defaults.theme)
    expect(saved.refreshInterval).toBe(defaults.refreshInterval)
    expect(saved.aria2.secret).toBe('keep-me')
    expect(saved.connectionProfiles[0]?.config?.secret).toBe('keep-me')
  })
})

describe('浏览器环境的读取与单键读写', () => {
  it('没有 electronAPI 时从 localStorage 读设置', async () => {
    vi.stubGlobal('window', {})
    const getItem = vi.fn(() => JSON.stringify({ theme: 'dark', refreshInterval: 8000 }))
    vi.stubGlobal('localStorage', { getItem, setItem: vi.fn(), removeItem: vi.fn() })
    vi.resetModules()
    const mod = await import('./settingsService')
    const service = new mod.SettingsService()
    await service.loadSettings()

    expect(getItem).toHaveBeenCalledWith('aria2-desktop-settings')
    expect(service.getSettings().theme).toBe('dark')
    expect(service.getSettings().refreshInterval).toBe(8000)
  })

  it('getSetting 读单个键，updateSetting 只写这一个键', async () => {
    const { service, api } = await loadService({ stored: { theme: 'light' } })

    expect(service.getSetting('theme')).toBe('light')

    await service.updateSetting('theme', 'dark')

    expect(service.getSetting('theme')).toBe('dark')
    const saved = savedPayload(api!)
    expect(saved.theme).toBe('dark')
  })
})

describe('导入时的密钥回填边界', () => {
  it('令牌不是脱敏占位时原样保留，不覆盖为本机值', async () => {
    const { service, api } = await loadService({
      stored: { webConsole: { token: 'local-console', tokens: [{ name: 'phone', token: 'local-phone' }] } }
    })

    await service.importSettings(JSON.stringify({
      webConsole: {
        token: '***',
        tokens: [
          { name: 'phone', token: 'imported-phone' },
          { name: 'tablet', token: '***' }
        ]
      }
    }))

    const saved = savedPayload(api!)
    expect(saved.webConsole?.token).toBe('local-console')
    expect(saved.webConsole?.tokens).toEqual([
      { name: 'phone', token: 'imported-phone' },
      { name: 'tablet', token: '***' }
    ])
  })

  it('没有 config 的连接预设原样保留，不会补出空密钥', async () => {
    const { service, api } = await loadService({
      stored: { connectionProfiles: [{ id: 'default', name: '本机', config: { host: 'localhost', port: 6800, protocol: 'http', secret: 'local-secret', path: '/jsonrpc' } }] }
    })

    await service.importSettings(JSON.stringify({
      connectionProfiles: [
        { id: 'default', name: '本机', config: { host: 'localhost', port: 6800, protocol: 'http', secret: '***', path: '/jsonrpc' } },
        { id: 'broken', name: '坏预设' }
      ]
    }))

    const saved = savedPayload(api!)
    expect(saved.connectionProfiles[0]?.config?.secret).toBe('local-secret')
    expect(saved.connectionProfiles[1]).toEqual({ id: 'broken', name: '坏预设' })
  })
})

