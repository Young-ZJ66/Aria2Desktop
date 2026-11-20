import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type AnyFn = (...args: unknown[]) => unknown

const h = vi.hoisted(() => {
  const state = {
    uses: [] as unknown[],
    mounted: [] as string[],
    watchers: [] as { source: unknown; cb: (value: unknown) => void }[],
    directionCalls: [] as string[],
    a11yInstalls: 0,
    reports: [] as Record<string, unknown>[],
    reportsThrow: false,
    consoleErrors: [] as unknown[],
    listeners: new Map<string, (event: unknown) => void>(),
    hasElectronApi: true
  }
  return { state }
})

const fakeApp = {
  use: (plugin: unknown) => {
    h.state.uses.push(plugin)
  },
  mount: (selector: string) => {
    h.state.mounted.push(selector)
  },
  config: {} as Record<string, unknown>
}

const fakeLocale = { value: 'ar-SA' }

vi.mock('vue', () => ({
  createApp: () => fakeApp,
  watch: (source: unknown, cb: (value: unknown) => void) => {
    h.state.watchers.push({ source, cb })
    return () => {}
  }
}))
vi.mock('pinia', () => ({ createPinia: () => ({ name: 'pinia' }) }))
vi.mock('./App.vue', () => ({ default: { name: 'App' } }))
vi.mock('./router', () => ({ default: { name: 'router' } }))
vi.mock('./i18n', () => ({ default: { global: { locale: fakeLocale } } }))
vi.mock('./composables/useDirection', () => ({
  applyDocumentDirection: (locale: string) => {
    h.state.directionCalls.push(locale)
  }
}))
vi.mock('./utils/formA11y', () => ({
  installFormA11y: () => {
    h.state.a11yInstalls += 1
  }
}))
vi.mock('./styles/theme.css', () => ({}))
vi.mock('./styles/rtl.css', () => ({}))

function installWindow(): void {
  const win = {
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      h.state.listeners.set(type, listener)
    }
  } as unknown as Record<string, unknown>
  if (h.state.hasElectronApi) {
    win.electronAPI = {
      reportRendererError: (payload: Record<string, unknown>) => {
        if (h.state.reportsThrow) throw new Error('ipc down')
        h.state.reports.push(payload)
      }
    }
  }
  ;(globalThis as unknown as { window: unknown }).window = win
}

async function loadMain(): Promise<void> {
  vi.resetModules()
  await import('./main')
}

function fireListener(type: string, event: unknown): void {
  const listener = h.state.listeners.get(type)
  if (!listener) throw new Error('missing listener: ' + type)
  listener(event)
}

function makeError(message: string): Error {
  const error = new Error(message)
  error.stack = 'stack:' + message
  return error
}

beforeEach(() => {
  h.state.uses = []
  h.state.mounted = []
  h.state.watchers = []
  h.state.directionCalls = []
  h.state.a11yInstalls = 0
  h.state.reports = []
  h.state.reportsThrow = false
  h.state.consoleErrors = []
  h.state.listeners = new Map()
  h.state.hasElectronApi = true
  fakeLocale.value = 'ar-SA'
  fakeApp.config = {}
  installWindow()
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    h.state.consoleErrors.push(args[0])
  })
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-21T00:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  delete (globalThis as unknown as { window?: unknown }).window
})

describe('渲染层入口装配', () => {
  it('装上 pinia / 路由 / i18n 三个插件并按顺序挂载到 #app', async () => {
    await loadMain()

    expect(h.state.uses).toHaveLength(3)
    expect((h.state.uses[0] as { name?: string }).name).toBe('pinia')
    expect((h.state.uses[1] as { name?: string }).name).toBe('router')
    expect(h.state.uses[2]).toEqual({ global: { locale: fakeLocale } })
    expect(h.state.mounted).toEqual(['#app'])
  })

  it('启动时按当前语言写一次方向，并在语言切换时跟着改（D-29）', async () => {
    await loadMain()

    expect(h.state.directionCalls).toEqual(['ar-SA'])
    expect(h.state.watchers).toHaveLength(1)
    expect(h.state.watchers[0].source).toBe(fakeLocale)

    h.state.watchers[0].cb('en-US')
    h.state.watchers[0].cb('zh-CN')
    expect(h.state.directionCalls).toEqual(['ar-SA', 'en-US', 'zh-CN'])
  })

  it('挂载之后才补表单无障碍名称（要扫的是已渲染的 DOM）', async () => {
    await loadMain()

    expect(h.state.mounted).toEqual(['#app'])
    expect(h.state.a11yInstalls).toBe(1)
  })
})

describe('渲染层异常上报', () => {
  it('Vue 组件树内的错误带上 info 一起上报，并在控制台留一份', async () => {
    await loadMain()
    const handler = fakeApp.config.errorHandler as AnyFn
    const error = makeError('boom')

    handler(error, {}, 'render function')

    expect(h.state.reports).toEqual([
      { kind: 'vue:render function', message: 'boom', stack: 'stack:boom' }
    ])
    expect(h.state.consoleErrors).toEqual([error])
  })

  it('非 Error 的异常也归一成 Error 再上报（不能把原始值直接塞进 IPC）', async () => {
    await loadMain()
    const handler = fakeApp.config.errorHandler as AnyFn

    handler('plain string', {}, 'setup')

    expect(h.state.reports).toHaveLength(1)
    expect(h.state.reports[0].message).toBe('plain string')
    expect(typeof h.state.reports[0].stack).toBe('string')
  })

  it('未处理的 Promise 拒绝用 reason 上报', async () => {
    await loadMain()

    fireListener('unhandledrejection', { reason: makeError('rejected') })
    fireListener('unhandledrejection', { reason: 42 })

    expect(h.state.reports.map((r) => r.kind)).toEqual(['unhandledrejection', 'unhandledrejection'])
    expect(h.state.reports.map((r) => r.message)).toEqual(['rejected', '42'])
  })

  it('window.onerror 上报 error，没有 error 对象时退回 message', async () => {
    await loadMain()

    fireListener('error', { error: makeError('sync'), message: 'ignored' })
    fireListener('error', { error: null, message: 'message only' })

    expect(h.state.reports.map((r) => r.message)).toEqual(['sync', 'message only'])
  })

  it('资源加载错误（有 target 无 error）不上报，避免刷屏', async () => {
    await loadMain()

    fireListener('error', { error: null, target: { tagName: 'IMG' } })

    expect(h.state.reports).toEqual([])
  })

  it('同一异常 5 秒内只上报一次，超过窗口后重新上报', async () => {
    await loadMain()
    const handler = fakeApp.config.errorHandler as AnyFn
    const error = makeError('flood')

    handler(error, {}, 'render')
    handler(error, {}, 'render')
    expect(h.state.reports).toHaveLength(1)

    vi.setSystemTime(Date.now() + 5000)
    handler(error, {}, 'render')
    expect(h.state.reports).toHaveLength(2)
  })

  it('不同 kind 或不同 message 各自计数，不会被对方吃掉', async () => {
    await loadMain()
    const handler = fakeApp.config.errorHandler as AnyFn

    handler(makeError('same'), {}, 'render')
    handler(makeError('same'), {}, 'setup')
    handler(makeError('other'), {}, 'render')

    expect(h.state.reports.map((r) => r.kind)).toEqual([
      'vue:render',
      'vue:setup',
      'vue:render'
    ])
    expect(h.state.reports[2].message).toBe('other')
  })

  it('上报通道缺失时不抛错（老版本 preload 或纯 Web 预览）', async () => {
    h.state.hasElectronApi = false
    installWindow()
    await loadMain()
    const handler = fakeApp.config.errorHandler as AnyFn

    expect(() => handler(makeError('no bridge'), {}, 'render')).not.toThrow()
    expect(h.state.reports).toEqual([])
  })

  it('上报本身抛错时保持静默，不制造错误处理循环', async () => {
    h.state.reportsThrow = true
    await loadMain()
    const handler = fakeApp.config.errorHandler as AnyFn

    expect(() => handler(makeError('loop'), {}, 'render')).not.toThrow()
  })
})
