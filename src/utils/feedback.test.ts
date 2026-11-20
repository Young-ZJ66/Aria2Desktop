import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

interface FakeDialogOptions {
  type?: string
  title?: string
  content?: string
  closable?: boolean
  onClose?: () => void
  onEsc?: () => void
  action?: () => unknown
}

const h = vi.hoisted(() => ({
  createDiscreteApi: vi.fn(),
  instances: [] as Array<{
    unmounted: number
    message: Record<string, ReturnType<typeof vi.fn>>
    dialog: { create: ReturnType<typeof vi.fn>, created: FakeDialogOptions[], destroyed: number }
  }>,
  isDark: false,
  hasDocument: true
}))

vi.mock('naive-ui', () => ({
  darkTheme: { name: 'dark' },
  NButton: 'NButton',
  createDiscreteApi: (...args: unknown[]) => h.createDiscreteApi(...args)
}))

function makeInstance() {
  const message = {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn()
  }
  const dialog = {
    created: [] as FakeDialogOptions[],
    destroyed: 0,
    create: vi.fn((options: FakeDialogOptions) => {
      dialog.created.push(options)
      return {
        destroy: () => {
          dialog.destroyed += 1
        }
      }
    })
  }
  const instance = { unmounted: 0, message, dialog }
  h.instances.push(instance)
  return {
    message,
    dialog: { create: dialog.create },
    unmount: () => {
      instance.unmounted += 1
    }
  }
}

function installDocument(isDark: boolean, hasDocument = true) {
  h.isDark = isDark
  h.hasDocument = hasDocument
  if (!hasDocument) {
    vi.stubGlobal('document', undefined)
    return
  }
  const documentElement = {
    classList: { contains: (name: string) => isDark && name === 'dark' },
    getAttribute: (name: string) => (isDark && name === 'data-theme' ? 'dark' : null)
  }
  // vue 的 runtime-dom 在模块加载阶段就要 document.createElement('template')，
  // 所以桩 document 必须满足它，否则 import('./feedback') 直接抛 TypeError
  vi.stubGlobal('document', {
    documentElement,
    createElement: () => ({ style: {}, setAttribute: () => {}, appendChild: () => {} }),
    createElementNS: () => ({ style: {}, setAttribute: () => {}, appendChild: () => {} }),
    createTextNode: () => ({}),
    querySelector: () => null,
    addEventListener: () => {},
    removeEventListener: () => {},
    body: { appendChild: () => {} }
  })
}

async function loadFeedback() {
  vi.resetModules()
  h.createDiscreteApi.mockReset()
  h.createDiscreteApi.mockImplementation(() => makeInstance())
  return import('./feedback')
}

beforeEach(() => {
  h.instances.length = 0
  installDocument(false)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('message 封装', () => {
  it('四种级别都转发到 discrete api 的 message', async () => {
    const { message } = await loadFeedback()
    message.success('saved')
    message.error('failed')
    message.warning('careful')
    message.info('noted')
    const instance = h.instances[0]
    expect(instance.message.success).toHaveBeenCalledWith('saved', undefined)
    expect(instance.message.error).toHaveBeenCalledWith('failed', undefined)
    expect(instance.message.warning).toHaveBeenCalledWith('careful', undefined)
    expect(instance.message.info).toHaveBeenCalledWith('noted', undefined)
  })

  it('透传 MessageOptions', async () => {
    const { message } = await loadFeedback()
    message.success('saved', { duration: 8000 })
    expect(h.instances[0].message.success).toHaveBeenCalledWith('saved', { duration: 8000 })
  })

  it('同一主题下复用同一个实例，不重复创建', async () => {
    const { message } = await loadFeedback()
    message.success('a')
    message.success('b')
    expect(h.createDiscreteApi).toHaveBeenCalledTimes(1)
  })
})

describe('主题跟随', () => {
  it('浅色主题不注入 darkTheme', async () => {
    const { message } = await loadFeedback()
    message.success('a')
    const options = h.createDiscreteApi.mock.calls[0][1] as { configProviderProps: { theme: unknown } }
    expect(options.configProviderProps.theme).toBeUndefined()
  })

  it('深色主题注入 darkTheme 并按深色生成覆盖', async () => {
    installDocument(true)
    const { message } = await loadFeedback()
    message.success('a')
    const options = h.createDiscreteApi.mock.calls[0][1] as {
      configProviderProps: { theme: unknown, themeOverrides: { common: { bodyColor: string } } }
    }
    expect(options.configProviderProps.theme).toEqual({ name: 'dark' })
    expect(typeof options.configProviderProps.themeOverrides.common.bodyColor).toBe('string')
  })

  it('只有 data-theme=dark 也算深色（不依赖 class）', async () => {
    vi.stubGlobal('document', {
      documentElement: {
        classList: { contains: () => false },
        getAttribute: (name: string) => (name === 'data-theme' ? 'dark' : null)
      },
      createElement: () => ({ style: {}, setAttribute: () => {}, appendChild: () => {} }),
      createElementNS: () => ({ style: {}, setAttribute: () => {}, appendChild: () => {} }),
      createTextNode: () => ({}),
      querySelector: () => null,
      addEventListener: () => {},
      removeEventListener: () => {},
      body: { appendChild: () => {} }
    })
    const { message } = await loadFeedback()
    message.success('a')
    const options = h.createDiscreteApi.mock.calls[0][1] as { configProviderProps: { theme: unknown } }
    expect(options.configProviderProps.theme).toEqual({ name: 'dark' })
  })

  it('主题切换后重建实例并卸载旧实例（避免容器残留）', async () => {
    const { message } = await loadFeedback()
    message.success('a')
    expect(h.instances).toHaveLength(1)
    installDocument(true)
    message.success('b')
    expect(h.instances).toHaveLength(2)
    expect(h.instances[0].unmounted).toBe(1)
    expect(h.instances[1].unmounted).toBe(0)
  })

  it('没有 document 时按浅色处理，不抛错', async () => {
    installDocument(false, false)
    const { message } = await loadFeedback()
    expect(() => message.success('a')).not.toThrow()
    const options = h.createDiscreteApi.mock.calls[0][1] as { configProviderProps: { theme: unknown } }
    expect(options.configProviderProps.theme).toBeUndefined()
  })
})

describe('confirm 弹窗', () => {
  function buttonsOf(_create?: ReturnType<typeof vi.fn>) {
    const options = h.instances[h.instances.length - 1].dialog.created[0]
    const vnode = options.action?.() as { children: unknown[] }
    const children = (vnode.children as Array<{ props?: Record<string, unknown> } | null>)
    return { options, buttons: children.filter(Boolean) as Array<{ props: Record<string, unknown> }> }
  }

  it('默认按 warning 类型展示，标题与正文透传', async () => {
    const { confirm } = await loadFeedback()
    confirm({ title: '删除任务', content: '确定要删除吗？' })
    const options = h.instances[0].dialog.created[0]
    expect(options.type).toBe('warning')
    expect(options.title).toBe('删除任务')
    expect(options.content).toBe('确定要删除吗？')
    expect(options.closable).toBe(true)
  })

  it('显式 type 覆盖默认值', async () => {
    const { confirm } = await loadFeedback()
    confirm({ title: 't', content: 'c', type: 'error' })
    expect(h.instances[0].dialog.created[0].type).toBe('error')
  })

  it('确认按钮是主按钮，点击后回调并关闭', async () => {
    const { confirm } = await loadFeedback()
    const onPositiveClick = vi.fn()
    confirm({ title: 't', content: 'c', positiveText: '确定', onPositiveClick })
    const { buttons } = buttonsOf(h.instances[0].dialog.create)
    const positive = buttons.find((b) => b.props.type === 'primary')
    expect(positive).toBeTruthy()
    expect(positive?.props.size).toBe('small')
    await (positive?.props.onClick as () => Promise<void>)()
    expect(onPositiveClick).toHaveBeenCalledTimes(1)
    expect(h.instances[0].dialog.destroyed).toBe(1)
  })

  it('回调返回 false 时保持弹窗不关闭（异步校验场景）', async () => {
    const { confirm } = await loadFeedback()
    confirm({ title: 't', content: 'c', positiveText: '确定', onPositiveClick: async () => false })
    const { buttons } = buttonsOf(h.instances[0].dialog.create)
    const positive = buttons.find((b) => b.props.type === 'primary')
    await (positive?.props.onClick as () => Promise<void>)()
    expect(h.instances[0].dialog.destroyed).toBe(0)
  })

  it('取消按钮是默认样式，点击后回调并关闭', async () => {
    const { confirm } = await loadFeedback()
    const onNegativeClick = vi.fn()
    confirm({ title: 't', content: 'c', negativeText: '取消', onNegativeClick })
    const { buttons } = buttonsOf(h.instances[0].dialog.create)
    const negative = buttons.find((b) => b.props.type !== 'primary')
    expect(negative).toBeTruthy()
    expect(negative?.props.size).toBe('small')
    ;(negative?.props.onClick as () => void)()
    expect(onNegativeClick).toHaveBeenCalledTimes(1)
    expect(h.instances[0].dialog.destroyed).toBe(1)
  })

  it('未提供文案时不渲染对应按钮', async () => {
    const { confirm } = await loadFeedback()
    confirm({ title: 't', content: 'c', positiveText: '确定' })
    const { buttons } = buttonsOf(h.instances[0].dialog.create)
    expect(buttons).toHaveLength(1)
  })

  it('关闭按钮与 ESC 的回调分别接线（naive 里是两条独立回调）', async () => {
    const { confirm } = await loadFeedback()
    const onClose = vi.fn()
    const onEsc = vi.fn()
    confirm({ title: 't', content: 'c', onClose, onEsc })
    const options = h.instances[0].dialog.created[0]
    options.onClose?.()
    options.onEsc?.()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onEsc).toHaveBeenCalledTimes(1)
  })
})
