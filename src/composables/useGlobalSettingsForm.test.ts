import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 全局配置设置页的加载/保存/重置骨架。
 *
 * 这里锁的是三处曾经真实出过问题的地方：
 * 1) 保存要如实回报「这次是否真的落地」——未连接、校验失败、配置与 RPC 双双失败都必须返回 false，
 *    否则设置弹窗会以为保存成功直接关掉，用户改动无声丢失；
 * 2) 远程引擎不能把配置写进本机 aria2.conf（会污染本地引擎，重启后覆盖本地设置）；
 * 3) 脏标记只在保存/加载**成功**后对齐，失败时保持原快照，关闭弹窗仍要提醒。
 */

const h = vi.hoisted(() => ({
  connection: { isConnected: true, config: { host: '127.0.0.1', port: 6800 } },
  settings: { aria2: { port: 6800 } },
  stats: {
    globalOptions: {} as Record<string, string>,
    getGlobalOptions: vi.fn(),
    changeGlobalOptions: vi.fn()
  },
  feedback: { message: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }, confirm: vi.fn() },
  isLocal: vi.fn(() => true),
  needsRestart: vi.fn(() => false),
  minimum: vi.fn(async () => {})
}))

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string, params?: { error?: string }) => params?.error ? key + '|' + params.error : key }) }))
vi.mock('@/utils/feedback', () => h.feedback)
vi.mock('@/stores/connectionStore', () => ({ useConnectionStore: () => h.connection }))
vi.mock('@/stores/statsStore', () => ({ useStatsStore: () => h.stats }))
vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: () => ({ settings: h.settings }) }))
vi.mock('@/shared/localEngine', () => ({ isLocalEngineAddress: h.isLocal }))
vi.mock('@/utils/aria2RestartOptions', () => ({ hasRestartRequiredOption: h.needsRestart }))
vi.mock('@/composables/useMinimumLoading', () => ({ ensureMinimumDuration: h.minimum }))

type Form = { dir: string, limit: string, tracker?: string }

async function load() {
  vi.resetModules()
  return await import('./useGlobalSettingsForm')
}

function makeForm(): Form {
  return { dir: '/old', limit: '0', tracker: '' }
}

beforeEach(() => {
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
  ;(globalThis as unknown as { window: unknown }).window = {
    electronAPI: { aria2: { saveGlobalOptions: vi.fn(async () => ({ success: true })) } }
  }
})

describe('加载配置', () => {
  it('未连接时给出提示且不请求引擎', async () => {
    h.connection.isConnected = false
    const { useGlobalSettingsForm } = await load()
    const form = makeForm()
    const applied: unknown[] = []
    const api = useGlobalSettingsForm(form, {
      applyOptions: (o: unknown) => applied.push(o),
      toOptions: (f: Form) => ({ dir: f.dir }),
      defaults: makeForm
    })
    await api.loadSettings()
    expect(h.feedback.message.warning).toHaveBeenCalledWith('settings.connectFirst')
    expect(h.stats.getGlobalOptions).not.toHaveBeenCalled()
    expect(applied).toHaveLength(0)
  })

  it('有缓存时不显示加载态（避免首屏闪烁）', async () => {
    h.stats.globalOptions = { dir: '/cached' }
    const { useGlobalSettingsForm } = await load()
    const form = makeForm()
    const api = useGlobalSettingsForm(form, {
      applyOptions: (o: { dir?: string }) => { form.dir = o.dir ?? form.dir },
      toOptions: (f: Form) => ({ dir: f.dir }),
      defaults: makeForm
    })
    // 构造时就用缓存初始化了表单
    expect(form.dir).toBe('/cached')
    const pending = api.loadSettings()
    expect(api.loading.value).toBe(false)
    await pending
    expect(api.loading.value).toBe(false)
  })

  it('强制重载时按钮自己转圈，结束后复位', async () => {
    h.stats.globalOptions = { dir: '/cached' }
    const { useGlobalSettingsForm } = await load()
    const form = makeForm()
    const api = useGlobalSettingsForm(form, {
      applyOptions: () => {},
      toOptions: (f: Form) => ({ dir: f.dir }),
      defaults: makeForm
    })
    const pending = api.loadSettings(true)
    expect(api.reloading.value).toBe(true)
    await pending
    expect(api.reloading.value).toBe(false)
    expect(h.stats.getGlobalOptions).toHaveBeenCalledWith(true)
  })

  it('加载失败给出带原因的提示，且不把表单洗成默认值', async () => {
    h.stats.getGlobalOptions.mockRejectedValue(new Error('RPC 断了'))
    const { useGlobalSettingsForm } = await load()
    const form = makeForm()
    const applied: unknown[] = []
    const api = useGlobalSettingsForm(form, {
      applyOptions: (o: unknown) => applied.push(o),
      toOptions: (f: Form) => ({ dir: f.dir }),
      defaults: makeForm
    })
    await api.loadSettings()
    expect(h.feedback.message.error).toHaveBeenCalledWith('settings.loadFailed|RPC 断了')
    expect(applied).toHaveLength(0)
  })
})

describe('保存配置', () => {
  async function setup(overrides: { validate?: () => boolean } = {}) {
    const { useGlobalSettingsForm } = await load()
    const form = makeForm()
    const api = useGlobalSettingsForm(form, {
      applyOptions: (o: { dir?: string }) => { form.dir = o.dir ?? form.dir },
      toOptions: (f: Form) => ({ dir: f.dir, 'max-overall-download-limit': f.limit }),
      defaults: makeForm,
      validate: overrides.validate
    })
    return { api, form }
  }

  it('未连接时返回 false 并提示先连接', async () => {
    h.connection.isConnected = false
    const { api } = await setup()
    await expect(api.handleSave()).resolves.toBe(false)
    expect(h.feedback.message.warning).toHaveBeenCalledWith('settings.connectFirst')
    expect(h.stats.changeGlobalOptions).not.toHaveBeenCalled()
  })

  it('校验未通过时返回 false 且不写任何配置', async () => {
    const { api } = await setup({ validate: () => false })
    await expect(api.handleSave()).resolves.toBe(false)
    expect(h.stats.changeGlobalOptions).not.toHaveBeenCalled()
  })

  it('本机引擎：先写配置文件再走 RPC，两者都成功返回 true', async () => {
    const { api } = await setup()
    await expect(api.handleSave()).resolves.toBe(true)
    expect(window.electronAPI?.aria2?.saveGlobalOptions).toHaveBeenCalledWith({ dir: '/old', 'max-overall-download-limit': '0' })
    expect(h.stats.changeGlobalOptions).toHaveBeenCalledTimes(1)
    expect(h.feedback.message.success).toHaveBeenCalledWith('settings.saved')
  })

  it('远程引擎：不写本机配置文件（否则重启后覆盖本地引擎设置）', async () => {
    h.isLocal.mockReturnValue(false)
    const { api } = await setup()
    await expect(api.handleSave()).resolves.toBe(true)
    expect(window.electronAPI?.aria2?.saveGlobalOptions).not.toHaveBeenCalled()
    expect(h.stats.changeGlobalOptions).toHaveBeenCalledTimes(1)
  })

  it('RPC 失败但配置文件已写入：仍算保存成功，并提示重启引擎生效', async () => {
    h.stats.changeGlobalOptions.mockRejectedValue(new Error('not modifiable'))
    const { api } = await setup()
    await expect(api.handleSave()).resolves.toBe(true)
    expect(h.feedback.message.success).toHaveBeenCalledWith('settings.savedRestartAria2')
  })

  it('含需重启选项时提示重启引擎', async () => {
    h.needsRestart.mockReturnValue(true)
    const { api } = await setup()
    await api.handleSave()
    expect(h.needsRestart).toHaveBeenCalledWith({ dir: '/old', 'max-overall-download-limit': '0' })
    expect(h.feedback.message.success).toHaveBeenCalledWith('settings.savedRestartAria2')
  })

  it('配置与 RPC 双双失败时返回 false 并报错（不能假装保存成功）', async () => {
    h.isLocal.mockReturnValue(false)
    h.stats.changeGlobalOptions.mockRejectedValue(new Error('引擎拒绝'))
    const { api } = await setup()
    await expect(api.handleSave()).resolves.toBe(false)
    expect(h.feedback.message.error).toHaveBeenCalledWith('settings.saveFailed|引擎拒绝')
  })

  it('保存期间 saving 为真，结束后复位', async () => {
    let resolveRpc: () => void = () => {}
    h.stats.changeGlobalOptions.mockImplementation(() => new Promise<void>((resolve) => { resolveRpc = resolve }))
    const { api } = await setup()
    const pending = api.handleSave()
    await Promise.resolve()
    expect(api.saving.value).toBe(true)
    resolveRpc()
    await pending
    expect(api.saving.value).toBe(false)
  })
})

describe('重置为默认值', () => {
  it('确认后把表单改回默认值并给出提示', async () => {
    const { useGlobalSettingsForm } = await load()
    const form: Form = { dir: '/old', limit: '1024' }
    const afterReset = vi.fn()
    h.feedback.confirm.mockImplementation((opts: { onPositiveClick: () => void }) => { opts.onPositiveClick() })
    const api = useGlobalSettingsForm(form, {
      applyOptions: () => {},
      toOptions: (f: Form) => ({ dir: f.dir }),
      defaults: makeForm,
      onAfterReset: afterReset
    })
    api.handleReset()
    expect(form.dir).toBe('/old')
    expect(h.feedback.message.success).toHaveBeenCalledWith('settings.restored')
    expect(afterReset).toHaveBeenCalledWith(form)
  })
})

describe('未保存修改追踪', () => {
  it('字段变化后该页被列为脏页', async () => {
    const { useGlobalSettingsForm, getDirtyPages } = await load()
    const form = makeForm()
    useGlobalSettingsForm(form, {
      applyOptions: () => {},
      toOptions: (f: Form) => ({ dir: f.dir }),
      defaults: makeForm,
      dirtyTracking: { pageId: 'download', fields: ['dir'] }
    })
    expect(getDirtyPages()).toEqual([])
    form.dir = '/new'
    expect(getDirtyPages()).toEqual(['download'])
  })

  it('程序写入的字段可用 markFieldsSynced 对齐，不算用户编辑', async () => {
    const { useGlobalSettingsForm, getDirtyPages } = await load()
    const form: Form = { ...makeForm(), tracker: 'a' }
    const api = useGlobalSettingsForm(form, {
      applyOptions: () => {},
      toOptions: (f: Form) => ({ dir: f.dir }),
      defaults: makeForm,
      dirtyTracking: { pageId: 'bt', fields: ['dir', 'tracker'] }
    })
    form.tracker = 'b'
    expect(getDirtyPages()).toEqual(['bt'])
    api.markFieldsSynced(['tracker'])
    expect(getDirtyPages()).toEqual([])
  })

  it('保存失败时不清脏标记（否则改动会无声丢失）', async () => {
    const { useGlobalSettingsForm, getDirtyPages, saveDirtyPage } = await load()
    const form = makeForm()
    useGlobalSettingsForm(form, {
      applyOptions: () => {},
      toOptions: (f: Form) => ({ dir: f.dir }),
      defaults: makeForm,
      dirtyTracking: { pageId: 'download', fields: ['dir'] }
    })
    form.dir = '/new'
    h.connection.isConnected = false
    await expect(saveDirtyPage('download')).resolves.toBe(false)
    expect(getDirtyPages()).toEqual(['download'])
  })

  it('未注册的页保存返回 null', async () => {
    const { saveDirtyPage } = await load()
    await expect(saveDirtyPage('nope')).resolves.toBeNull()
  })
})
