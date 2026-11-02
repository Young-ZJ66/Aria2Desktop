import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

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
}

function installElectronApi(stored: unknown = null): FakeElectronApi {
  const api: FakeElectronApi = {
    getStoreValue: vi.fn(async () => stored),
    setStoreValue: vi.fn(async () => undefined)
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

  it('窗口状态记忆默认开启（设置页开关与主进程判定都依赖这个默认值）', async () => {
    const { service, defaults } = await loadService({ stored: {} })
    expect(defaults.keepWindowState).toBe(true)
    expect(service.getSettings().keepWindowState).toBe(true)
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
