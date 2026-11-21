import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 统一全局配置设置页骨架的补充单测。
 *
 * 既有 useGlobalSettingsForm.test.ts 用真实 vue，onMounted / onBeforeUnmount / watch
 * 这些「挂载之后才会发生」的分支跑不到。这里把这三个 API 换成收集器，手动触发挂载、
 * 卸载与 watch 回调，锁的是三条容易悄悄退化的约定：
 * 1) 写 aria2.conf 抛错只降级到 RPC，不能整次保存失败；
 * 2) 保存/加载失败时绝不能对齐脏快照，否则改动被当成已保存；
 * 3) 卸载后该页必须从脏页注册表摘掉，否则设置弹窗会一直问一个已经不存在的页。
 */

const h = vi.hoisted(() => ({
  connection: { isConnected: true, config: { host: '127.0.0.1', port: 6800 } },
  settings: { aria2: { port: 6800 } },
  stats: {
    globalOptions: {} as Record<string, string>,
    getGlobalOptions: vi.fn(),
    changeGlobalOptions: vi.fn()
  },
  feedback: {
    message: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
    confirm: vi.fn()
  },
  isLocal: vi.fn(),
  needsRestart: vi.fn(),
  minimum: vi.fn(),
  mounted: [] as Array<() => unknown>,
  beforeUnmount: [] as Array<() => unknown>,
  watchers: [] as Array<{ source: () => unknown; cb: (value: unknown, old?: unknown) => void }>
}))

vi.mock('vue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue')>()
  return {
    ...actual,
    onMounted: (fn: () => unknown) => { h.mounted.push(fn) },
    onBeforeUnmount: (fn: () => unknown) => { h.beforeUnmount.push(fn) },
    watch: (source: () => unknown, cb: (value: unknown, old?: unknown) => void) => {
      h.watchers.push({ source, cb })
      return () => {}
    }
  }
})
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: { error?: string }) => (params?.error ? key + '|' + params.error : key)
  })
}))
vi.mock('@/utils/feedback', () => h.feedback)
vi.mock('@/stores/connectionStore', () => ({ useConnectionStore: () => h.connection }))
vi.mock('@/stores/statsStore', () => ({ useStatsStore: () => h.stats }))
vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: () => ({ settings: h.settings }) }))
vi.mock('@/shared/localEngine', () => ({ isLocalEngineAddress: h.isLocal }))
vi.mock('@/utils/aria2RestartOptions', () => ({ hasRestartRequiredOption: h.needsRestart }))
vi.mock('@/composables/useMinimumLoading', () => ({ ensureMinimumDuration: h.minimum }))

type Form = { dir: string; limit: string }

const baseOptions = {
  applyOptions: (o: { dir?: string }) => { if (o.dir !== undefined) form.dir = o.dir },
  toOptions: (f: Form) => ({ dir: f.dir, 'max-overall-download-limit': f.limit }),
  defaults: () => ({ dir: '/default', limit: '0' })
}
let form: Form = { dir: '/old', limit: '0' }

async function load() {
  vi.resetModules()
  h.mounted = []
  h.beforeUnmount = []
  h.watchers = []
  return await import('./useGlobalSettingsForm')
}

function stubWindow(saveGlobalOptions?: unknown): void {
  ;(globalThis as unknown as { window: unknown }).window = { electronAPI: { aria2: { saveGlobalOptions } } }
}

beforeEach(() => {
  form = { dir: '/old', limit: '0' }
  h.connection.isConnected = true
  h.connection.config = { host: '127.0.0.1', port: 6800 }
  h.stats.globalOptions = {}
  h.stats.getGlobalOptions.mockReset()
  h.stats.getGlobalOptions.mockResolvedValue({ dir: '/from-engine' })
  h.stats.changeGlobalOptions.mockReset()
  h.stats.changeGlobalOptions.mockResolvedValue(undefined)
  for (const fn of Object.values(h.feedback.message)) fn.mockReset()
  h.feedback.confirm.mockReset()
  h.isLocal.mockReset()
  h.isLocal.mockReturnValue(true)
  h.needsRestart.mockReset()
  h.needsRestart.mockReturnValue(false)
  h.minimum.mockReset()
  h.minimum.mockResolvedValue(undefined)
  stubWindow(vi.fn(async () => ({ success: true })))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('保存时写配置文件与 RPC 的双通道', () => {
  it('写 aria2.conf 抛错时降级到 RPC，仍算保存成功', async () => {
    const saveGlobalOptions = vi.fn(async () => { throw new Error('EPERM') })
    stubWindow(saveGlobalOptions)
    const { useGlobalSettingsForm } = await load()
    const api = useGlobalSettingsForm(form, baseOptions)
    await expect(api.handleSave()).resolves.toBe(true)
    expect(saveGlobalOptions).toHaveBeenCalledTimes(1)
    expect(console.warn).toHaveBeenCalledWith('Failed to persist options to aria2 config:', expect.any(Error))
    expect(h.stats.changeGlobalOptions).toHaveBeenCalledTimes(1)
    expect(h.feedback.message.success).toHaveBeenCalledWith('settings.saved')
  })

  it('没有 saveGlobalOptions 通道时只走 RPC', async () => {
    ;(globalThis as unknown as { window: unknown }).window = { electronAPI: {} }
    const { useGlobalSettingsForm } = await load()
    const api = useGlobalSettingsForm(form, baseOptions)
    await expect(api.handleSave()).resolves.toBe(true)
    expect(h.stats.changeGlobalOptions).toHaveBeenCalledTimes(1)
    expect(h.feedback.message.success).toHaveBeenCalledWith('settings.saved')
  })

  it('远程引擎不写本机配置文件', async () => {
    h.isLocal.mockReturnValue(false)
    const saveGlobalOptions = vi.fn(async () => ({ success: true }))
    stubWindow(saveGlobalOptions)
    const { useGlobalSettingsForm } = await load()
    const api = useGlobalSettingsForm(form, baseOptions)
    await expect(api.handleSave()).resolves.toBe(true)
    expect(saveGlobalOptions).not.toHaveBeenCalled()
    expect(h.stats.changeGlobalOptions).toHaveBeenCalledTimes(1)
  })

  it('映射函数抛错时提示保存失败并返回 false', async () => {
    const { useGlobalSettingsForm } = await load()
    const api = useGlobalSettingsForm(form, {
      ...baseOptions,
      toOptions: () => { throw new Error('映射炸了') }
    })
    await expect(api.handleSave()).resolves.toBe(false)
    expect(h.feedback.message.error).toHaveBeenCalledWith('settings.saveFailed|映射炸了')
    expect(console.error).toHaveBeenCalledWith('Failed to save settings:', expect.any(Error))
    expect(api.saving.value).toBe(false)
  })

  it('RPC 与配置文件双双失败时报出 RPC 的原因', async () => {
    h.stats.changeGlobalOptions.mockRejectedValueOnce(new Error('option not found'))
    h.isLocal.mockReturnValue(false)
    const { useGlobalSettingsForm } = await load()
    const api = useGlobalSettingsForm(form, baseOptions)
    await expect(api.handleSave()).resolves.toBe(false)
    expect(h.feedback.message.error).toHaveBeenCalledWith('settings.saveFailed|option not found')
    expect(console.warn).toHaveBeenCalledWith(
      'RPC changeGlobalOption failed (startup options will apply after restart):',
      expect.any(Error)
    )
  })

  it('需要重启的选项给出重启提示', async () => {
    h.needsRestart.mockReturnValue(true)
    const { useGlobalSettingsForm } = await load()
    const api = useGlobalSettingsForm(form, baseOptions)
    await expect(api.handleSave()).resolves.toBe(true)
    expect(h.feedback.message.success).toHaveBeenCalledWith('settings.savedRestartAria2')
  })

  it('校验不通过时不写任何配置', async () => {
    const { useGlobalSettingsForm } = await load()
    const api = useGlobalSettingsForm(form, { ...baseOptions, validate: () => false })
    await expect(api.handleSave()).resolves.toBe(false)
    expect(h.stats.changeGlobalOptions).not.toHaveBeenCalled()
  })

  it('未连接时提示先连接', async () => {
    h.connection.isConnected = false
    const { useGlobalSettingsForm } = await load()
    const api = useGlobalSettingsForm(form, baseOptions)
    await expect(api.handleSave()).resolves.toBe(false)
    expect(h.feedback.message.warning).toHaveBeenCalledWith('settings.connectFirst')
  })
})

describe('加载与重置', () => {
  it('命中缓存时 loading 不翻转但仍应用配置', async () => {
    h.stats.globalOptions = { dir: '/cached' }
    const { useGlobalSettingsForm } = await load()
    const api = useGlobalSettingsForm(form, baseOptions)
    expect(form.dir).toBe('/cached')
    await api.loadSettings()
    expect(h.stats.getGlobalOptions).toHaveBeenCalledWith(false)
    expect(api.loading.value).toBe(false)
  })

  it('重载按钮会强制拉取并开关 reloading', async () => {
    h.stats.globalOptions = { dir: '/cached' }
    const { useGlobalSettingsForm } = await load()
    const api = useGlobalSettingsForm(form, baseOptions)
    await api.loadSettings(true)
    expect(h.stats.getGlobalOptions).toHaveBeenCalledWith(true)
    expect(api.reloading.value).toBe(false)
    expect(form.dir).toBe('/from-engine')
  })

  it('加载失败时报错并使用自定义的 i18n key', async () => {
    h.stats.getGlobalOptions.mockRejectedValueOnce(new Error('rpc down'))
    const { useGlobalSettingsForm } = await load()
    const api = useGlobalSettingsForm(form, { ...baseOptions, loadErrorKey: 'bt.loadFailed' })
    await api.loadSettings()
    expect(h.feedback.message.error).toHaveBeenCalledWith('bt.loadFailed|rpc down')
    expect(console.error).toHaveBeenCalledWith('Failed to load settings:', expect.any(Error))
  })

  it('重置确认后套用默认值并触发回调', async () => {
    const onAfterReset = vi.fn()
    h.feedback.confirm.mockImplementation((opts: { onPositiveClick: () => void }) => opts.onPositiveClick())
    const { useGlobalSettingsForm } = await load()
    const api = useGlobalSettingsForm(form, { ...baseOptions, onAfterReset })
    api.handleReset()
    expect(form.dir).toBe('/default')
    expect(h.feedback.message.success).toHaveBeenCalledWith('settings.restored')
    expect(onAfterReset).toHaveBeenCalledWith(form)
  })
})

describe('挂载与卸载', () => {
  it('挂载时已连接就立即加载', async () => {
    const { useGlobalSettingsForm } = await load()
    useGlobalSettingsForm(form, baseOptions)
    expect(h.mounted).toHaveLength(1)
    h.mounted[0]()
    await vi.waitFor(() => expect(h.stats.getGlobalOptions).toHaveBeenCalledTimes(1))
    expect(form.dir).toBe('/from-engine')
  })

  it('挂载时未连接不加载', async () => {
    h.connection.isConnected = false
    const { useGlobalSettingsForm } = await load()
    useGlobalSettingsForm(form, baseOptions)
    h.mounted[0]()
    await Promise.resolve()
    expect(h.stats.getGlobalOptions).not.toHaveBeenCalled()
  })

  it('卸载后该页从脏页注册表里摘掉', async () => {
    const { useGlobalSettingsForm, getDirtyPages } = await load()
    useGlobalSettingsForm(form, {
      ...baseOptions,
      dirtyTracking: { pageId: 'engine', fields: ['dir'] }
    })
    form.dir = '/edited'
    expect(getDirtyPages()).toEqual(['engine'])
    expect(h.beforeUnmount).toHaveLength(1)
    h.beforeUnmount[0]()
    expect(getDirtyPages()).toEqual([])
  })
})

describe('脏标记快照的对齐时机', () => {
  async function setupTracked() {
    const mod = await load()
    const api = mod.useGlobalSettingsForm(form, {
      ...baseOptions,
      dirtyTracking: { pageId: 'download', fields: ['dir', 'limit'] }
    })
    // 注册顺序固定：watch(saving) 在前、watch(loading) 在后（见源码 260/266 行）
    return {
      api,
      getDirtyPages: mod.getDirtyPages,
      saveDirtyPage: mod.saveDirtyPage,
      markFieldsSynced: api.markFieldsSynced,
      savingWatcher: h.watchers[0],
      loadingWatcher: h.watchers[1]
    }
  }

  it('保存成功后 watch(saving) 对齐快照，脏标记消失', async () => {
    const { api, getDirtyPages, savingWatcher } = await setupTracked()
    form.dir = '/edited'
    expect(getDirtyPages()).toEqual(['download'])
    await api.handleSave()
    savingWatcher.cb(false, true)
    expect(getDirtyPages()).toEqual([])
  })

  it('保存失败时 watch(saving) 不对齐，脏标记保留', async () => {
    h.connection.isConnected = false
    const { api, getDirtyPages, savingWatcher } = await setupTracked()
    form.dir = '/edited'
    await api.handleSave()
    savingWatcher.cb(false, true)
    expect(getDirtyPages()).toEqual(['download'])
  })

  it('加载成功后直接对齐快照（不依赖 watch(loading)）', async () => {
    const { api, getDirtyPages } = await setupTracked()
    form.dir = '/edited'
    await api.loadSettings()
    expect(getDirtyPages()).toEqual([])
  })

  it('重载失败时 loading 的 watch 不清脏标记', async () => {
    h.stats.getGlobalOptions.mockRejectedValueOnce(new Error('rpc down'))
    const { api, getDirtyPages, loadingWatcher } = await setupTracked()
    form.dir = '/edited'
    await api.loadSettings(true)
    loadingWatcher.cb(false, true)
    expect(getDirtyPages()).toEqual(['download'])
  })

  it('程序写入的字段只对齐自己，用户的其它编辑仍算脏', async () => {
    const { markFieldsSynced, getDirtyPages } = await setupTracked()
    form.dir = '/edited'
    form.limit = '1024'
    markFieldsSynced(['dir'])
    expect(getDirtyPages()).toEqual(['download'])
    form.limit = '0'
    expect(getDirtyPages()).toEqual([])
  })

  it('保存函数内部抛错时脏页保存返回 false 而不是冒泡', async () => {
    h.minimum.mockRejectedValueOnce(new Error('timer broken'))
    const { saveDirtyPage } = await setupTracked()
    await expect(saveDirtyPage('download')).resolves.toBe(false)
  })

  it('未注册的页返回 null', async () => {
    const { saveDirtyPage } = await setupTracked()
    await expect(saveDirtyPage('not-registered')).resolves.toBeNull()
  })

  it('加载成功后再触发 loading 的 watch 也会对齐快照', async () => {
    const { api, getDirtyPages, loadingWatcher } = await setupTracked()
    await api.loadSettings()
    // 加载成功后用户又改了字段：此时 loading 的 watch 才真正起到兜底对齐的作用
    form.dir = '/edited'
    expect(getDirtyPages()).toEqual(['download'])
    loadingWatcher.cb(false, true)
    expect(getDirtyPages()).toEqual([])
  })
})
