import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const state = {
    displays: [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }],
    settings: { theme: 'light', minimizeToTray: true } as Record<string, unknown>,
    storeData: {} as Record<string, unknown>,
    storeSets: [] as Array<{ key: string; value: unknown }>,
    themeSource: 'system',
    themeSetThrows: false,
    normalBoundsThrows: false,
    indexPathThrows: false,
    normalizeThrows: false,
    loadError: null as Error | null,
    quitting: false,
    quitCalls: 0,
    listeners: new Map<string, { handler: (...args: unknown[]) => void; options: unknown }>(),
    headersHandler: null as null | ((details: unknown, callback: (response: unknown) => void) => void),
    permissionHandler: null as null | ((...args: unknown[]) => void),
    logs: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  }

  class FakeWebContents {
    handlers = new Map<string, (...args: unknown[]) => void>()
    sent: Array<{ channel: string; payload: unknown }> = []
    executed: string[] = []
    openHandler: ((details: { url: string }) => unknown) | null = null
    on(event: string, handler: (...args: unknown[]) => void) {
      this.handlers.set(event, handler)
    }
    send(channel: string, payload: unknown) {
      this.sent.push({ channel, payload })
    }
    executeJavaScript(code: string) {
      this.executed.push(code)
      return Promise.resolve()
    }
    setWindowOpenHandler(handler: (details: { url: string }) => unknown) {
      this.openHandler = handler
    }
    emit(event: string, ...args: unknown[]) {
      this.handlers.get(event)?.(...args)
    }
  }

  class FakeBrowserWindow {
    static instances: FakeBrowserWindow[] = []
    options: Record<string, unknown>
    webContents = new FakeWebContents()
    handlers = new Map<string, (...args: unknown[]) => void>()
    destroyed = false
    minimized = false
    maximized = false
    fullScreen = false
    visible = false
    bounds = { x: 100, y: 100, width: 1200, height: 800 }
    normalBounds = { x: 100, y: 100, width: 1200, height: 800 }
    showCalls = 0
    focusCalls = 0
    hideCalls = 0
    reloads = 0
    loadedUrl: string | null = null
    loadedFile: string | null = null
    constructor(options: Record<string, unknown>) {
      this.options = options
      FakeBrowserWindow.instances.push(this)
    }
    on(event: string, handler: (...args: unknown[]) => void) {
      this.handlers.set(event, handler)
    }
    emit(event: string, ...args: unknown[]) {
      this.handlers.get(event)?.(...args)
    }
    loadURL(url: string) {
      this.loadedUrl = url
      if (url.startsWith('data:')) return Promise.resolve()
      return state.loadError ? Promise.reject(state.loadError) : Promise.resolve()
    }
    loadFile(file: string) {
      this.loadedFile = file
      return state.loadError ? Promise.reject(state.loadError) : Promise.resolve()
    }
    isDestroyed() { return this.destroyed }
    destroy() {
      this.destroyed = true
      this.emit('closed')
    }
    isMinimized() { return this.minimized }
    restore() { this.minimized = false }
    show() { this.visible = true; this.showCalls++ }
    focus() { this.focusCalls++ }
    hide() { this.visible = false; this.hideCalls++ }
    isVisible() { return this.visible }
    maximize() { this.maximized = true }
    unmaximize() { this.maximized = false }
    setFullScreen(value: boolean) { this.fullScreen = value }
    isMaximized() { return this.maximized }
    isFullScreen() { return this.fullScreen }
    getBounds() { return { ...this.bounds } }
    getNormalBounds() {
      if (state.normalBoundsThrows) throw new Error('normal bounds unavailable')
      return { ...this.normalBounds }
    }
    setProgressBar() {}
    reload() { this.reloads++ }
  }

  return { state, FakeWebContents, FakeBrowserWindow }
})

vi.mock('electron', () => ({
  BrowserWindow: h.FakeBrowserWindow,
  Menu: { setApplicationMenu: () => {} },
  shell: { openExternal: () => Promise.resolve('') },
  screen: { getAllDisplays: () => h.state.displays },
  nativeTheme: {
    get themeSource() { return h.state.themeSource },
    set themeSource(value: string) {
      if (h.state.themeSetThrows) throw new Error('theme unavailable')
      h.state.themeSource = value
    }
  },
  session: {
    defaultSession: {
      webRequest: {
        onHeadersReceived: (handler: (details: unknown, callback: (response: unknown) => void) => void) => {
          h.state.headersHandler = handler
        }
      },
      setPermissionRequestHandler: (handler: (...args: unknown[]) => void) => {
        h.state.permissionHandler = handler
      }
    }
  },
  app: {
    whenReady: () => Promise.resolve(),
    getLocale: () => 'zh-CN',
    relaunch: () => {},
    exit: () => {},
    quit: () => { h.state.quitCalls++ }
  },
  clipboard: { readText: () => '' },
  dialog: { showMessageBox: () => Promise.resolve({ response: 1 }) }
}))

vi.mock('electron-store', () => ({ default: class FakeStore {} }))

vi.mock('../utils/appState', () => ({
  appState: {
    isQuitting: () => h.state.quitting,
    markQuitting: () => { h.state.quitting = true }
  }
}))

vi.mock('../utils/settingsAccessor', () => ({ getSettings: () => h.state.settings }))

vi.mock('../utils/ipcSecurity', () => ({
  registerSecureListener: (channel: string, handler: (...args: unknown[]) => void, options: unknown) => {
    h.state.listeners.set(channel, { handler, options })
  }
}))

vi.mock('../utils/ipcSecurityCore', () => ({
  DEV_ALLOWED_ORIGINS: ['http://localhost:5173'],
  normalizeFileUrl: (url: string) => {
    if (h.state.normalizeThrows) throw new Error('entry path unavailable')
    return url
  }
}))

vi.mock('../utils/resolvePaths', () => ({
  resolveAppIconPath: () => 'E:/app/build/Icon.ico',
  resolveRendererIndexPath: () => {
    if (h.state.indexPathThrows) throw new Error('renderer index missing')
    return 'E:/app/dist/vue/index.html'
  }
}))

vi.mock('../utils/windowBoundsCore', () => ({
  isPlausibleBounds: () => true,
  pickStoredBounds: (input: { current: { x: number; y: number; width: number; height: number } }) => input.current
}))

vi.mock('../utils/logger', () => ({ createLogger: () => h.state.logs }))
vi.mock('../utils/mainLocale', () => ({ mainLocaleFrom: () => 'zh' }))
vi.mock('../utils/mainProcessCopy', () => ({
  rendererCrashCopy: () => ({ title: 'T', message: 'M', detail: 'D', restart: 'R', close: 'C' })
}))

const { WindowController } = await import('./WindowController')

type Controller = InstanceType<typeof WindowController>
type WindowLike = InstanceType<typeof h.FakeBrowserWindow>
type PrivateApi = {
  setupEventHandlers: () => void
  setupWindowStatePersistence: () => void
  loadContent: () => void
  isAllowedNavigation: (url: string) => boolean
  revealWindow: () => void
}

function store(initial: Record<string, unknown> = {}) {
  h.state.storeData = { ...initial }
  return {
    get: (key: string) => h.state.storeData[key],
    set: (key: string, value: unknown) => {
      h.state.storeData[key] = value
      h.state.storeSets.push({ key, value })
    }
  }
}

function createController(initial: Record<string, unknown> = {}): Controller {
  return new WindowController(store(initial) as unknown as ConstructorParameters<typeof WindowController>[0])
}

function lastWindow(): WindowLike {
  const list = h.FakeBrowserWindow.instances
  return list[list.length - 1]
}

function fireListener(channel: string) {
  h.state.listeners.get(channel)?.handler()
}

function windowStateSet() {
  const entries = h.state.storeSets.filter(item => item.key === 'windowState')
  return entries[entries.length - 1]?.value as Record<string, unknown> | undefined
}

async function flushMicrotasks(times = 4) {
  for (let i = 0; i < times; i += 1) await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
  h.FakeBrowserWindow.instances.length = 0
  h.state.settings = { theme: 'light', minimizeToTray: true }
  h.state.storeData = {}
  h.state.storeSets = []
  h.state.themeSource = 'system'
  h.state.themeSetThrows = false
  h.state.normalBoundsThrows = false
  h.state.indexPathThrows = false
  h.state.normalizeThrows = false
  h.state.loadError = null
  h.state.quitting = false
  h.state.quitCalls = 0
  h.state.listeners.clear()
  h.state.headersHandler = null
  h.state.permissionHandler = null
  h.state.logs.debug.mockClear()
  h.state.logs.info.mockClear()
  h.state.logs.warn.mockClear()
  h.state.logs.error.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('安全通道的窗口取值器', () => {
  it('注册的通道都带 getMainWindow 取值器，且建窗后返回同一个窗口', () => {
    const controller = createController()
    const channels = [...h.state.listeners.keys()]
    expect(channels).toEqual(['app-ready', 'window-close'])
    const appReady = h.state.listeners.get('app-ready')?.options as { getMainWindow: () => unknown }
    expect(typeof appReady.getMainWindow).toBe('function')
    expect(appReady.getMainWindow()).toBeNull()
    const win = controller.createWindow()
    expect(appReady.getMainWindow()).toBe(win)
  })

  it('window-close 通道先标记退出再退出应用', () => {
    createController()
    fireListener('window-close')
    expect(h.state.quitting).toBe(true)
    expect(h.state.quitCalls).toBe(1)
  })

  it('app-ready 触发注入的就绪回调', () => {
    const controller = createController()
    const ready = vi.fn()
    controller.setOnRendererReady(ready)
    fireListener('app-ready')
    expect(ready).toHaveBeenCalledTimes(1)
    expect(controller.isRendererContentReady()).toBe(true)
    controller.setOnRendererReady(null)
    fireListener('app-ready')
    expect(ready).toHaveBeenCalledTimes(1)
  })
})

describe('导航判定的兜底', () => {
  it('生产环境非 file 协议一律拦下', () => {
    const controller = createController()
    const win = controller.createWindow() as unknown as WindowLike
    const event = { preventDefault: vi.fn() }
    win.webContents.emit('will-navigate', event, 'https://evil.example.com/a')
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(h.state.logs.warn).toHaveBeenCalled()
  })

  it('入口路径归一化抛错时放行导航而不是全盘阻断', () => {
    const controller = createController()
    const win = controller.createWindow() as unknown as WindowLike
    h.state.normalizeThrows = true
    const event = { preventDefault: vi.fn() }
    win.webContents.emit('will-navigate', event, 'file:///C:/Users/other/notes.html')
    expect(event.preventDefault).not.toHaveBeenCalled()
    const api = controller as unknown as PrivateApi
    expect(api.isAllowedNavigation('file:///C:/Users/other/notes.html')).toBe(true)
  })
})

describe('等待显示的定时器清理', () => {
  it('重建窗口时清掉上一次的等待显示定时器', async () => {
    const controller = createController()
    const first = controller.createWindow() as unknown as WindowLike
    controller.show()
    expect(first.showCalls).toBe(0)
    controller.createWindow()
    const second = lastWindow()
    await vi.advanceTimersByTimeAsync(11000)
    expect(first.showCalls).toBe(0)
    expect(second.showCalls).toBe(0)
  })

  it('窗口销毁时清掉等待显示的定时器', async () => {
    const controller = createController()
    const win = controller.createWindow() as unknown as WindowLike
    controller.show()
    win.destroy()
    await vi.advanceTimersByTimeAsync(11000)
    expect(win.showCalls).toBe(0)
  })

  it('重试链发现窗口已销毁就终止', async () => {
    const controller = createController()
    const win = controller.createWindow() as unknown as WindowLike
    controller.show()
    win.destroyed = true
    await vi.advanceTimersByTimeAsync(500)
    expect(win.showCalls).toBe(0)
    expect(win.focusCalls).toBe(0)
  })
})

describe('窗口状态持久化的边界', () => {
  it('move 事件同样防抖写入，且连续触发只写一次', async () => {
    const controller = createController()
    const win = controller.createWindow() as unknown as WindowLike
    win.emit('move')
    win.emit('move')
    await vi.advanceTimersByTimeAsync(500)
    expect(h.state.storeSets.filter(item => item.key === 'windowState')).toHaveLength(1)
    expect(windowStateSet()?.bounds).toEqual(win.bounds)
  })

  it('getNormalBounds 抛错时仍按当前边界保存', async () => {
    h.state.normalBoundsThrows = true
    const controller = createController()
    const win = controller.createWindow() as unknown as WindowLike
    win.emit('resize')
    await vi.advanceTimersByTimeAsync(500)
    expect(windowStateSet()?.bounds).toEqual(win.bounds)
  })

  it('窗口销毁后残留的 move 事件不再写状态', async () => {
    const controller = createController()
    const win = controller.createWindow() as unknown as WindowLike
    win.destroy()
    h.state.storeSets = []
    win.emit('move')
    await vi.advanceTimersByTimeAsync(500)
    expect(windowStateSet()).toBeUndefined()
  })

  it('没有窗口时注册持久化与事件处理器直接返回', () => {
    const controller = createController()
    const api = controller as unknown as PrivateApi
    expect(() => api.setupWindowStatePersistence()).not.toThrow()
    expect(() => api.setupEventHandlers()).not.toThrow()
    expect(() => api.loadContent()).not.toThrow()
    expect(controller.isVisible()).toBe(false)
    expect(() => controller.hide()).not.toThrow()
    expect(() => controller.setWindowTheme(true)).not.toThrow()
    expect(h.state.themeSource).toBe('system')
    expect(h.state.logs.error).not.toHaveBeenCalled()
  })
})

describe('内容加载与主题的兜底', () => {
  it('开发环境加载 dev server 失败只记错误日志', async () => {
    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'
    try {
      h.state.loadError = new Error('dev server down')
      const controller = createController()
      const win = controller.createWindow() as unknown as WindowLike
      await flushMicrotasks()
      expect(win.loadedUrl).toBe('http://localhost:5173')
      expect(h.state.logs.error).toHaveBeenCalledWith('[WindowController] Failed to load URL:', h.state.loadError)
    } finally {
      process.env.NODE_ENV = previous
    }
  })

  it('入口路径解析失败时生产环境回落提示页', async () => {
    h.state.indexPathThrows = true
    const controller = createController()
    expect(() => controller.createWindow()).toThrow('renderer index missing')
  })

  it('设置主题失败只记错误日志', () => {
    h.state.themeSetThrows = true
    const controller = createController()
    controller.createWindow()
    expect(() => controller.setWindowTheme(true)).not.toThrow()
    expect(h.state.logs.error).toHaveBeenCalledWith('[WindowController] Failed to set window theme:', expect.any(Error))
    expect(h.state.themeSource).toBe('system')
  })
})

describe('窗口无响应事件', () => {
  it('unresponsive 与 responsive 各记一条日志', () => {
    const controller = createController()
    const win = controller.createWindow() as unknown as WindowLike
    win.emit('unresponsive')
    win.emit('responsive')
    expect(h.state.logs.warn).toHaveBeenCalledWith('[WindowController] Window became unresponsive')
    expect(h.state.logs.info).toHaveBeenCalledWith('[WindowController] Window responsive again')
  })
})

describe('显示窗口的兜底', () => {
  it('没有主窗口时显示请求直接返回，不抛错也不建窗', () => {
    const controller = createController()
    const api = controller as unknown as PrivateApi

    expect(() => api.revealWindow()).not.toThrow()
    expect(h.FakeBrowserWindow.instances).toHaveLength(0)
  })
})
