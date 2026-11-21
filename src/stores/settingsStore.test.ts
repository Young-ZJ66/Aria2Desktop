import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { AppSettings } from '@/shared/appSettings'

/**
 * 设置 store。
 *
 * 这里锁的是三条容易悄悄坏掉的不变量：
 * 1) 基础下载目录的口径必须与主进程删除白名单一致（download.defaultDir → aria2.downloadDir → 空串）；
 * 2) 多个设置页同时提交时必须按调用顺序落盘，否则后发的先完成会让旧值覆盖新值；
 * 3) 单次保存失败不能把整个保存队列卡死。
 */

const h = vi.hoisted(() => {
  const defaultSettings = {
    language: 'zh-CN',
    theme: 'light',
    refreshInterval: 1000,
    autoConnect: true,
    aria2: { host: 'localhost', port: 6800, protocol: 'http', secret: '', path: '/jsonrpc', downloadDir: '' },
    download: { defaultDir: '', maxConcurrentDownloads: 5 },
    category: { autoClassify: true, categories: [{ id: 'default', dirname: 'Other', extensions: [] }] }
  } as unknown as AppSettings
  return {
    defaultSettings,
    state: { settings: defaultSettings },
    listeners: [] as ((s: unknown) => void)[],
    matchMedia: vi.fn()
  }
})

vi.mock('@/services/settingsService', () => {
  const settingsService = {
    getSettings: () => h.state.settings,
    loadSettings: vi.fn(async () => {}),
    saveSettings: vi.fn(async () => {}),
    resetSettings: vi.fn(async () => { h.state.settings = h.defaultSettings }),
    exportSettings: vi.fn(() => '{"language":"zh-CN"}'),
    importSettings: vi.fn(async () => {}),
    onSettingsChange: vi.fn((listener: (s: unknown) => void) => { h.listeners.push(listener) }),
    removeListener: vi.fn((listener: (s: unknown) => void) => {
      const index = h.listeners.indexOf(listener)
      if (index >= 0) h.listeners.splice(index, 1)
    })
  }
  return { settingsService, defaultSettings: h.defaultSettings, SettingsService: class {} }
})

import { settingsService } from '@/services/settingsService'
import { useSettingsStore } from './settingsStore'

const saveSettings = vi.mocked(settingsService.saveSettings)

function fakeMatchMedia(matches = false) {
  return {
    matches,
    media: '(prefers-color-scheme: dark)',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
    onchange: null
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  h.state.settings = h.defaultSettings
  h.listeners.length = 0
  ;(globalThis as unknown as { window: unknown }).window = {
    matchMedia: h.matchMedia,
    electronAPI: { setWindowTheme: vi.fn(async () => {}) }
  }
  h.matchMedia.mockReset()
  h.matchMedia.mockImplementation(() => fakeMatchMedia())
  // 必须 mockReset 而不是 mockClear：mockClear 只清调用记录，上一个用例设置的
  // 挂起实现会残留下来，后续用例的保存永远等不到 resolve
  saveSettings.mockReset()
  saveSettings.mockImplementation(async (patch: Partial<AppSettings>) => {
    h.state.settings = { ...h.state.settings, ...patch } as AppSettings
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  delete (globalThis as { document?: unknown }).document
})

describe('初始状态与派生配置', () => {
  it('初始设置直接取自 settingsService', () => {
    const store = useSettingsStore()
    // ref 会把对象包成响应式代理，不能比引用
    expect(store.settings).toEqual(h.defaultSettings)
    expect(store.theme).toBe('light')
    expect(store.language).toBe('zh-CN')
  })

  it('基础下载目录优先取下载设置的默认目录', () => {
    h.state.settings = {
      ...h.defaultSettings,
      download: { defaultDir: 'D:/Downloads' },
      aria2: { ...h.defaultSettings.aria2, downloadDir: 'E:/Engine' }
    } as AppSettings
    const store = useSettingsStore()
    expect(store.taskBaseDir).toBe('D:/Downloads')
  })

  it('下载默认目录为空时回落到引擎的下载目录', () => {
    h.state.settings = {
      ...h.defaultSettings,
      download: { defaultDir: '' },
      aria2: { ...h.defaultSettings.aria2, downloadDir: 'E:/Engine' }
    } as AppSettings
    const store = useSettingsStore()
    expect(store.taskBaseDir).toBe('E:/Engine')
  })

  it('两者都为空时返回空串（此时新建任务不传 dir）', () => {
    const store = useSettingsStore()
    expect(store.taskBaseDir).toBe('')
  })

  it('aria2/download 缺失时回落到默认设置而不是 undefined', () => {
    h.state.settings = { language: 'en-US' } as AppSettings
    const store = useSettingsStore()
    expect(store.aria2Config?.port).toBe(6800)
    expect(store.downloadConfig?.maxConcurrentDownloads).toBe(5)
  })

  it('分类配置缺失时回落到默认分类规则', () => {
    h.state.settings = { language: 'zh-CN' } as AppSettings
    const store = useSettingsStore()
    expect(store.categoryConfig?.autoClassify).toBe(true)
    expect(store.categoryConfig?.categories?.length).toBeGreaterThan(0)
  })
})

describe('保存串行化', () => {
  it('两次并发保存按调用顺序落盘（后发的不会先完成）', async () => {
    const order: string[] = []
    const deferred: (() => void)[] = []
    saveSettings.mockImplementation(async (patch: Partial<AppSettings>) => {
      const name = String(patch.language)
      order.push('start:' + name)
      await new Promise<void>((resolve) => { deferred.push(resolve) })
      order.push('end:' + name)
      h.state.settings = { ...h.state.settings, ...patch } as AppSettings
    })
    const store = useSettingsStore()
    const first = store.updateSetting('language', 'en-US')
    const second = store.updateSetting('language', 'ja-JP')
    await Promise.resolve()
    expect(order).toEqual(['start:en-US'])
    deferred.shift()?.()
    await first
    await Promise.resolve()
    expect(order).toEqual(['start:en-US', 'end:en-US', 'start:ja-JP'])
    deferred.shift()?.()
    await second
    expect(order).toEqual(['start:en-US', 'end:en-US', 'start:ja-JP', 'end:ja-JP'])
  })

  it('保存失败会记 error 并抛给调用方，但队列不中断', async () => {
    saveSettings.mockRejectedValueOnce(new Error('磁盘满了'))
    const store = useSettingsStore()
    await expect(store.updateSetting('language', 'en-US')).rejects.toThrow('磁盘满了')
    expect(store.error).toBe('磁盘满了')
    await expect(store.updateSetting('language', 'ja-JP')).resolves.toBeUndefined()
    expect(store.error).toBeNull()
    expect(saveSettings).toHaveBeenCalledTimes(2)
  })

  it('并发保存期间 isLoading 保持为 true，全部结束后复位', async () => {
    let resolveSave: () => void = () => {}
    saveSettings.mockImplementation(async (patch: Partial<AppSettings>) => {
      await new Promise<void>((resolve) => { resolveSave = resolve })
      h.state.settings = { ...h.state.settings, ...patch } as AppSettings
    })
    const store = useSettingsStore()
    const first = store.updateSetting('language', 'en-US')
    const second = store.updateSetting('theme', 'dark')
    await Promise.resolve()
    expect(store.isLoading).toBe(true)
    resolveSave()
    await first
    expect(store.isLoading).toBe(true)
    resolveSave()
    await second
    expect(store.isLoading).toBe(false)
  })
})

describe('各设置页的合并口径', () => {
  it('updateSetting 只改一个键', async () => {
    const store = useSettingsStore()
    await store.updateSetting('theme', 'dark')
    expect(saveSettings).toHaveBeenCalledWith({ theme: 'dark' })
    expect(store.settings.theme).toBe('dark')
    expect(store.settings.language).toBe('zh-CN')
  })

  it('updateGeneralSettings 不会把未传字段写成 undefined', async () => {
    const store = useSettingsStore()
    await store.updateGeneralSettings({ theme: 'dark' })
    const patch = saveSettings.mock.calls[0][0] as Record<string, unknown>
    expect(patch.theme).toBe('dark')
    expect(patch.language).toBe('zh-CN')
    expect(patch.refreshInterval).toBe(1000)
    expect(patch.autoConnect).toBe(true)
  })

  it('updateAria2Config 浅合并到现有 aria2 配置', async () => {
    const store = useSettingsStore()
    await store.updateAria2Config({ port: 6801 })
    const patch = saveSettings.mock.calls[0][0] as { aria2: Record<string, unknown> }
    expect(patch.aria2.port).toBe(6801)
    expect(patch.aria2.host).toBe('localhost')
    expect(patch.aria2.path).toBe('/jsonrpc')
  })

  it('updateDownloadConfig 浅合并到现有下载配置', async () => {
    const store = useSettingsStore()
    await store.updateDownloadConfig({ defaultDir: 'D:/DL' })
    const patch = saveSettings.mock.calls[0][0] as { download: Record<string, unknown> }
    expect(patch.download.defaultDir).toBe('D:/DL')
    expect(patch.download.maxConcurrentDownloads).toBe(5)
  })
})

describe('重置、导入导出与事件', () => {
  it('resetSettings 后重新读取设置', async () => {
    h.state.settings = { ...h.defaultSettings, theme: 'dark' } as AppSettings
    const store = useSettingsStore()
    expect(store.theme).toBe('dark')
    await store.resetSettings()
    expect(store.theme).toBe('light')
    expect(store.isLoading).toBe(false)
  })

  it('importSettings 失败记 error 并抛出', async () => {
    vi.mocked(settingsService.importSettings).mockRejectedValueOnce(new Error('JSON 坏了'))
    const store = useSettingsStore()
    await expect(store.importSettings('{bad')).rejects.toThrow('JSON 坏了')
    expect(store.error).toBe('JSON 坏了')
    expect(store.isLoading).toBe(false)
  })

  it('exportSettings 透传服务层结果', () => {
    const store = useSettingsStore()
    expect(store.exportSettings()).toBe('{"language":"zh-CN"}')
  })

  it('initialize 加载后同步设置并复位 loading', async () => {
    h.state.settings = { ...h.defaultSettings, language: 'de-DE' } as AppSettings
    const store = useSettingsStore()
    await store.initialize()
    expect(store.language).toBe('de-DE')
    expect(store.isLoading).toBe(false)
    expect(store.error).toBeNull()
  })

  it('主进程推送设置变化时同步到 store', () => {
    const store = useSettingsStore()
    expect(h.listeners).toHaveLength(1)
    const next = { ...h.defaultSettings, theme: 'dark' } as AppSettings
    h.listeners[0](next)
    expect(store.settings).toEqual(next)
  })

  it('getSetting 读取当前值', () => {
    const store = useSettingsStore()
    expect(store.getSetting('language')).toBe('zh-CN')
  })
})

describe('applyTheme', () => {
  function installDocument(matches = false) {
    const classes = new Set<string>()
    const attrs: Record<string, string> = {}
    ;(globalThis as { document?: unknown }).document = {
      documentElement: {
        classList: {
          add: (name: string) => classes.add(name),
          remove: (name: string) => classes.delete(name),
          toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name))
        },
        setAttribute: (key: string, value: string) => { attrs[key] = value }
      }
    }
    h.matchMedia.mockImplementation(() => fakeMatchMedia(matches))
    return { classes, attrs }
  }

  it('深色主题挂 dark 类并写 data-theme', async () => {
    const { classes, attrs } = installDocument()
    h.state.settings = { ...h.defaultSettings, theme: 'dark' } as AppSettings
    const store = useSettingsStore()
    await store.applyTheme()
    expect(classes.has('dark')).toBe(true)
    expect(attrs['data-theme']).toBe('dark')
    expect(window.electronAPI?.setWindowTheme).toHaveBeenCalledWith(true)
  })

  it('auto 模式跟随系统深色', async () => {
    const { classes, attrs } = installDocument(true)
    h.state.settings = { ...h.defaultSettings, theme: 'auto' } as AppSettings
    const store = useSettingsStore()
    await store.applyTheme()
    expect(classes.has('dark')).toBe(true)
    expect(attrs['data-theme']).toBe('dark')
  })

  it('切出 auto 模式时摘掉系统主题监听', async () => {
    installDocument()
    // mediaQuery 在 store 创建时取一次 window.matchMedia，所以要在建 store 之前换实现
    const mql = fakeMatchMedia(false)
    h.matchMedia.mockImplementation(() => mql)
    h.state.settings = { ...h.defaultSettings, theme: 'auto' } as AppSettings
    const store = useSettingsStore()
    await store.applyTheme()
    expect(mql.addEventListener).toHaveBeenCalledWith('change', expect.any(Function))
    // store 里的 settings ref 在创建时已绑定到旧对象，改 h.state.settings 不会影响它
    store.settings = { ...h.defaultSettings, theme: 'light' } as AppSettings
    await store.applyTheme()
    expect(mql.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function))
  })

  function installDoc(mql: ReturnType<typeof fakeMatchMedia>) {
    const classes = new Set<string>()
    const attrs: Record<string, string> = {}
    ;(globalThis as { document?: unknown }).document = {
      documentElement: {
        classList: {
          add: (name: string) => classes.add(name),
          remove: (name: string) => classes.delete(name),
          toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name))
        },
        setAttribute: (key: string, value: string) => { attrs[key] = value }
      }
    }
    h.matchMedia.mockImplementation(() => mql)
    return { classes, attrs }
  }

  it('非首次应用主题时挂过渡类，320ms 后移除', async () => {
    vi.useFakeTimers()
    try {
      const mql = fakeMatchMedia(false)
      const { classes } = installDoc(mql)
      h.state.settings = { ...h.defaultSettings, theme: 'light' } as AppSettings
      const store = useSettingsStore()
      await store.applyTheme()
      // 首次应用不播过渡，避免启动首帧闪烁
      expect(classes.has('theme-transition')).toBe(false)

      store.settings = { ...h.defaultSettings, theme: 'dark' } as AppSettings
      await store.applyTheme()
      expect(classes.has('theme-transition')).toBe(true)
      vi.advanceTimersByTime(320)
      expect(classes.has('theme-transition')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('连续切换主题时只保留最后一次过渡计时器', async () => {
    vi.useFakeTimers()
    try {
      const mql = fakeMatchMedia(false)
      const { classes } = installDoc(mql)
      const store = useSettingsStore()
      store.settings = { ...h.defaultSettings, theme: 'light' } as AppSettings
      await store.applyTheme()
      // 首次不挂过渡类，但此后 themeAppliedOnce 已置位
      expect(classes.has('theme-transition')).toBe(false)

      store.settings = { ...h.defaultSettings, theme: 'dark' } as AppSettings
      await store.applyTheme()
      expect(classes.has('theme-transition')).toBe(true)

      // 第二次切换时上一个计时器还没到期：必须清掉它，否则它会提前摘掉过渡类
      await vi.advanceTimersByTimeAsync(100)
      store.settings = { ...h.defaultSettings, theme: 'light' } as AppSettings
      await store.applyTheme()

      await vi.advanceTimersByTimeAsync(240)
      // 旧计时器若没被清掉，此刻（距第一次切换 340ms）过渡类已被移除
      expect(classes.has('theme-transition')).toBe(true)

      await vi.advanceTimersByTimeAsync(100)
      expect(classes.has('theme-transition')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('主进程设置窗口主题失败只告警，不影响本地主题', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const mql = fakeMatchMedia(false)
    const { classes, attrs } = installDoc(mql)
    ;(window.electronAPI as unknown as { setWindowTheme: () => Promise<void> }).setWindowTheme = vi.fn(async () => {
      throw new Error('theme boom')
    })
    h.state.settings = { ...h.defaultSettings, theme: 'dark' } as AppSettings
    const store = useSettingsStore()
    await store.applyTheme()

    expect(classes.has('dark')).toBe(true)
    expect(attrs['data-theme']).toBe('dark')
    expect(warn).toHaveBeenCalledWith('Failed to update window theme:', expect.any(Error))
  })

  it('没有主进程桥接时只改本地类名', async () => {
    const mql = fakeMatchMedia(false)
    const { classes, attrs } = installDoc(mql)
    ;(globalThis as unknown as { window: unknown }).window = { matchMedia: h.matchMedia }
    h.state.settings = { ...h.defaultSettings, theme: 'dark' } as AppSettings
    const store = useSettingsStore()
    await store.applyTheme()

    expect(classes.has('dark')).toBe(true)
    expect(attrs['data-theme']).toBe('dark')
  })

  it('系统主题变化时只在 auto 模式下重新应用主题', async () => {
    const mql = fakeMatchMedia(false)
    const { classes } = installDoc(mql)
    h.state.settings = { ...h.defaultSettings, theme: 'auto' } as AppSettings
    const store = useSettingsStore()
    await store.applyTheme()
    const listener = mql.addEventListener.mock.calls[0][1] as () => void
    expect(listener).toBeTypeOf('function')

    mql.matches = true
    listener()
    await Promise.resolve()
    await Promise.resolve()
    expect(classes.has('dark')).toBe(true)

    // 切到固定浅色后，系统变化不再影响主题
    classes.delete('dark')
    store.settings = { ...h.defaultSettings, theme: 'light' } as AppSettings
    listener()
    await Promise.resolve()
    await Promise.resolve()
    expect(classes.has('dark')).toBe(false)
  })
})

describe('设置的失败路径与合并口径', () => {
  it('初始化失败时把原因写进 error 并结束 loading', async () => {
    vi.mocked(settingsService.loadSettings).mockRejectedValueOnce(new Error('load boom'))
    const store = useSettingsStore()
    await store.initialize()
    expect(store.error).toBe('load boom')
    expect(store.isLoading).toBe(false)
  })

  it('初始化抛出非 Error 时用兜底文案', async () => {
    vi.mocked(settingsService.loadSettings).mockRejectedValueOnce('ipc closed')
    const store = useSettingsStore()
    await store.initialize()
    expect(store.error).toBe('加载设置失败')
  })

  it('重置设置失败时记错误并向上抛', async () => {
    vi.mocked(settingsService.resetSettings).mockRejectedValueOnce(new Error('reset boom'))
    const store = useSettingsStore()
    await expect(store.resetSettings()).rejects.toThrow('reset boom')
    expect(store.error).toBe('reset boom')
    expect(store.isLoading).toBe(false)
  })

  it('导入设置失败且抛出非 Error 时用兜底文案', async () => {
    vi.mocked(settingsService.importSettings).mockRejectedValueOnce('bad json')
    const store = useSettingsStore()
    await expect(store.importSettings('{}')).rejects.toBe('bad json')
    expect(store.error).toBe('导入设置失败')
  })

  it('updateCategoryConfig 只合并传入的字段', async () => {
    const store = useSettingsStore()
    await store.updateCategoryConfig({ autoClassify: false })
    expect(store.settings.category?.autoClassify).toBe(false)
    expect(store.settings.category?.categories).toHaveLength(1)
  })

  it('导入成功后 store 直接采用服务层的最新设置', async () => {
    const imported = { ...h.defaultSettings, theme: 'dark', language: 'en-US' } as AppSettings
    // 服务层导入成功后会把新设置写回自己的单例，store 必须重新取一次而不是保留旧值
    vi.mocked(settingsService.importSettings).mockImplementationOnce(async () => {
      h.state.settings = imported
    })
    const store = useSettingsStore()
    expect(store.theme).toBe('light')

    await store.importSettings('{"theme":"dark"}')

    expect(store.theme).toBe('dark')
    expect(store.language).toBe('en-US')
    expect(store.error).toBeNull()
    expect(store.isLoading).toBe(false)
  })

  it('store 销毁时摘掉设置变更监听器（HMR 下不泄漏）', () => {
    const store = useSettingsStore()
    expect(h.listeners).toHaveLength(1)
    store.$dispose()
    expect(h.listeners).toHaveLength(0)
  })
})
