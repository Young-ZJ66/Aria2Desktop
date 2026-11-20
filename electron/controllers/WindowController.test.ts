import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const state = {
    locale: 'zh-CN',
    displays: [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }],
    settings: {} as Record<string, unknown>,
    storeData: {} as Record<string, unknown>,
    storeSets: [] as Array<{ key: string; value: unknown }>,
    themeSource: 'system',
    clipboardText: '',
    clipboardThrows: false,
    jsResult: Promise.resolve() as Promise<unknown>,
    jsThrows: false,
    loadError: null as Error | null,
    dialogResponse: 0,
    listeners: new Map<string, { handler: (...args: unknown[]) => void; options: unknown }>(),
    menuCalls: [] as unknown[],
    openExternal: [] as string[],
    relaunched: 0,
    exited: 0,
    quit: 0,
    quitting: false,
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
      if (state.jsThrows) return Promise.reject(new Error('renderer gone'))
      return state.jsResult
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
    progressCalls: Array<{ value: number; options?: unknown }> = []
    loadedUrl: string | null = null
    loadedFile: string | null = null
    reloads = 0
    restoreCalls = 0
    showCalls = 0
    focusCalls = 0
    hideCalls = 0
    maximizeCalls = 0
    fullScreenCalls: boolean[] = []
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
      // 兜底提示页（data:）必须能加载成功，否则错误分支里被 void 掉的 rejection 会变成未处理拒绝
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
    restore() { this.minimized = false; this.restoreCalls++ }
    show() { this.visible = true; this.showCalls++ }
    focus() { this.focusCalls++ }
    hide() { this.visible = false; this.hideCalls++ }
    isVisible() { return this.visible }
    maximize() { this.maximized = true; this.maximizeCalls++ }
    unmaximize() { this.maximized = false }
    setFullScreen(value: boolean) { this.fullScreen = value; this.fullScreenCalls.push(value) }
    isMaximized() { return this.maximized }
    isFullScreen() { return this.fullScreen }
    getBounds() { return { ...this.bounds } }
    getNormalBounds() { return { ...this.normalBounds } }
    setProgressBar(value: number, options?: unknown) { this.progressCalls.push({ value, options }) }
    reload() { this.reloads++ }
  }

  return { state, FakeWebContents, FakeBrowserWindow }
})

vi.mock('electron', () => ({
  BrowserWindow: h.FakeBrowserWindow,
  Menu: {
    setApplicationMenu: (menu: unknown) => { h.state.menuCalls.push(menu) }
  },
  shell: {
    openExternal: (url: string) => {
      h.state.openExternal.push(url)
      return Promise.resolve('')
    }
  },
  screen: { getAllDisplays: () => h.state.displays },
  nativeTheme: {
    get themeSource() { return h.state.themeSource },
    set themeSource(value: string) { h.state.themeSource = value }
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
    getLocale: () => h.state.locale,
    relaunch: () => { h.state.relaunched++ },
    exit: () => { h.state.exited++ },
    quit: () => { h.state.quit++ }
  },
  clipboard: {
    readText: () => {
      if (h.state.clipboardThrows) throw new Error('clipboard unavailable')
      return h.state.clipboardText
    }
  },
  dialog: { showMessageBox: () => Promise.resolve({ response: h.state.dialogResponse }) }
}))

vi.mock('electron-store', () => ({ default: class FakeStore {} }))

vi.mock('../utils/appState', () => ({
  appState: {
    isQuitting: () => h.state.quitting,
    markQuitting: () => { h.state.quitting = true }
  }
}))

vi.mock('../utils/settingsAccessor', () => ({
  getSettings: () => h.state.settings
}))

vi.mock('../utils/ipcSecurity', () => ({
  registerSecureListener: (channel: string, handler: (...args: unknown[]) => void, options: unknown) => {
    h.state.listeners.set(channel, { handler, options })
  }
}))

vi.mock('../utils/resolvePaths', () => ({
  resolveAppIconPath: () => 'E:/app/build/Icon.ico',
  resolveRendererIndexPath: () => 'E:/app/dist/vue/index.html'
}))

vi.mock('../utils/logger', () => ({
  createLogger: () => h.state.logs
}))

vi.mock('../utils/mainLocale', () => ({
  mainLocaleFrom: (getter?: () => string) => {
    const value = (getter ? getter() : '').toLowerCase()
    return value.indexOf('zh') === 0 ? 'zh' : 'en'
  }
}))

vi.mock('../utils/mainProcessCopy', () => ({
  rendererCrashCopy: () => ({ title: 'T', message: 'M', detail: 'D', restart: 'R', close: 'C' })
}))

const { WindowController } = await import('./WindowController')

type Controller = InstanceType<typeof WindowController>

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

function lastWindow() {
  const list = h.FakeBrowserWindow.instances
  return list[list.length - 1]
}

function fireListener(channel: string) {
  const entry = h.state.listeners.get(channel)
  entry?.handler()
}

async function flushMicrotasks(times = 4) {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

function windowStateSet() {
  const entry = h.state.storeSets.filter(item => item.key === 'windowState')
  return entry[entry.length - 1]?.value as Record<string, unknown> | undefined
}

beforeEach(() => {
  vi.useFakeTimers()
  h.FakeBrowserWindow.instances.length = 0
  h.state.displays = [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }]
  h.state.settings = { theme: 'light', minimizeToTray: true }
  h.state.storeData = {}
  h.state.storeSets = []
  h.state.themeSource = 'system'
  h.state.clipboardText = ''
  h.state.clipboardThrows = false
  h.state.jsResult = Promise.resolve()
  h.state.jsThrows = false
  h.state.loadError = null
  h.state.dialogResponse = 0
  h.state.listeners.clear()
  h.state.menuCalls = []
  h.state.openExternal = []
  h.state.relaunched = 0
  h.state.exited = 0
  h.state.quit = 0
  h.state.quitting = false
  h.state.headersHandler = null
  h.state.permissionHandler = null
  h.state.logs.debug.mockClear()
  h.state.logs.info.mockClear()
  h.state.logs.warn.mockClear()
  h.state.logs.error.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createWindow', () => {
  it('默认窗口参数与安全配置符合预期', async () => {
    const controller = createController()
    const win = controller.createWindow() as unknown as InstanceType<typeof h.FakeBrowserWindow>
    const options = win.options
    expect(options.width).toBe(1200)
    expect(options.height).toBe(800)
    expect(options.minWidth).toBe(800)
    expect(options.minHeight).toBe(600)
    expect(options.show).toBe(false)
    expect(options.center).toBe(true)
    expect(options.icon).toBe('E:/app/build/Icon.ico')
    const webPreferences = options.webPreferences as Record<string, unknown>
    expect(webPreferences.sandbox).toBe(true)
    expect(webPreferences.nodeIntegration).toBe(false)
    expect(webPreferences.contextIsolation).toBe(true)
    expect(webPreferences.backgroundThrottling).toBe(false)
    expect(h.state.menuCalls).toEqual([null])
    await flushMicrotasks()
    expect(win.loadedFile).toBe('E:/app/dist/vue/index.html')
  })

  it('恢复仍在屏幕内的边界并取消居中', async () => {
    const controller = createController({
      windowState: { bounds: { x: 200, y: 150, width: 1000, height: 700 } }
    })
    const win = controller.createWindow() as unknown as InstanceType<typeof h.FakeBrowserWindow>
    expect(win.options).toMatchObject({ x: 200, y: 150, width: 1000, height: 700, center: false })
    await flushMicrotasks()
  })

  it('丢弃已经不在任何显示器内的边界', async () => {
    const controller = createController({
      windowState: { bounds: { x: 5000, y: 5000, width: 1000, height: 700 } }
    })
    const win = controller.createWindow() as unknown as InstanceType<typeof h.FakeBrowserWindow>
    // 有保存状态时不再居中（center: !savedState），但越界坐标必须丢弃，交给系统决定位置
    expect(win.options.x).toBeUndefined()
    expect(win.options.y).toBeUndefined()
    expect(win.options.width).toBe(1200)
    expect(win.options.center).toBe(false)
    await flushMicrotasks()
  })

  it('恢复最大化与全屏状态', async () => {
    const controller = createController({
      windowState: { bounds: { x: 100, y: 100, width: 1200, height: 800 }, isMaximized: true, isFullScreen: true }
    })
    const win = controller.createWindow() as unknown as InstanceType<typeof h.FakeBrowserWindow>
    expect(win.maximizeCalls).toBe(1)
    expect(win.fullScreenCalls).toEqual([true])
    await flushMicrotasks()
  })

  it('重建窗口时重置就绪标记与等待重试链', async () => {
    const controller = createController()
    controller.createWindow()
    fireListener('app-ready')
    expect(controller.isRendererContentReady()).toBe(true)
    const second = controller.createWindow() as unknown as InstanceType<typeof h.FakeBrowserWindow>
    expect(controller.isRendererContentReady()).toBe(false)
    expect(second).toBe(lastWindow())
    await flushMicrotasks()
  })

  it('渲染层加载失败时回落到错误提示页', async () => {
    h.state.loadError = new Error('missing index.html')
    const controller = createController()
    const win = controller.createWindow() as unknown as InstanceType<typeof h.FakeBrowserWindow>
    await flushMicrotasks(8)
    expect(win.loadedUrl).toContain('data:text/html')
    expect(h.state.logs.error).toHaveBeenCalled()
  })
})

describe('渲染层就绪与刷盘', () => {
  it('收到 app-ready 后标记就绪并触发回调', async () => {
    const controller = createController()
    const onReady = vi.fn()
    controller.setOnRendererReady(onReady)
    controller.createWindow()
    fireListener('app-ready')
    expect(controller.isRendererContentReady()).toBe(true)
    expect(onReady).toHaveBeenCalledTimes(1)
    await flushMicrotasks()
  })

  it('window-close 通道标记退出并调用 app.quit', async () => {
    createController()
    fireListener('window-close')
    expect(h.state.quitting).toBe(true)
    expect(h.state.quit).toBe(1)
  })

  it('渲染层未就绪时不发送刷盘指令', async () => {
    const controller = createController()
    const win = controller.createWindow() as unknown as InstanceType<typeof h.FakeBrowserWindow>
    await controller.flushRendererData()
    expect(win.webContents.executed).toEqual([])
  })

  it('渲染层就绪时执行刷盘脚本', async () => {
    const controller = createController()
    const win = controller.createWindow() as unknown as InstanceType<typeof h.FakeBrowserWindow>
    fireListener('app-ready')
    await controller.flushRendererData()
    expect(win.webContents.executed).toHaveLength(1)
    expect(win.webContents.executed[0]).toContain('__flushPendingTaskData')
  })

  it('窗口已销毁时跳过刷盘', async () => {
    const controller = createController()
    const win = controller.createWindow() as unknown as InstanceType<typeof h.FakeBrowserWindow>
    fireListener('app-ready')
    win.destroyed = true
    await controller.flushRendererData()
    expect(win.webContents.executed).toEqual([])
  })

  it('渲染层抛错时不冒泡', async () => {
    const controller = createController()
    controller.createWindow()
    fireListener('app-ready')
    h.state.jsThrows = true
    await expect(controller.flushRendererData()).resolves.toBeUndefined()
  })
})

describe('关闭窗口拦截', () => {
  it('启用托盘时关闭改为隐藏', async () => {
    const controller = createController()
    const win = controller.createWindow() as unknown as InstanceType<typeof h.FakeBrowserWindow>
    const event = { preventDefault: vi.fn() }
    win.emit('close', event)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(win.hideCalls).toBe(1)
    expect(win.destroyed).toBe(false)
    await flushMicrotasks()
  })

  it('关窗即退出路径先刷盘再销毁窗口', async () => {
    h.state.settings = { theme: 'light', minimizeToTray: false }
    const controller = createController()
    const win = controller.createWindow() as unknown as InstanceType<typeof h.FakeBrowserWindow>
    fireListener('app-ready')
    const event = { preventDefault: vi.fn() }
    win.emit('close', event)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(win.hideCalls).toBe(1)
    await flushMicrotasks(8)
    expect(win.webContents.executed).toHaveLength(1)
    expect(win.destroyed).toBe(true)
  })

  it('刷盘期间重复关闭不会重复刷盘', async () => {
    h.state.settings = { theme: 'light', minimizeToTray: false }
    const controller = createController()
    const win = controller.createWindow() as unknown as InstanceType<typeof h.FakeBrowserWindow>
    fireListener('app-ready')
    win.emit('close', { preventDefault: vi.fn() })
    const second = { preventDefault: vi.fn() }
    win.emit('close', second)
    expect(second.preventDefault).not.toHaveBeenCalled()
    await flushMicrotasks(8)
    expect(win.webContents.executed).toHaveLength(1)
  })

  it('退出流程中不再拦截关闭', async () => {
    const controller = createController()
    const win = controller.createWindow() as unknown as InstanceType<typeof h.FakeBrowserWindow>
    h.state.quitting = true
    const event = { preventDefault: vi.fn() }
    win.emit('close', event)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(win.hideCalls).toBe(0)
    await flushMicrotasks()
  })

  it('hide 与 isVisible 作用于当前窗口', async () => {
    const controller = createController()
    const win = controller.createWindow() as unknown as InstanceType<typeof h.FakeBrowserWindow>
    win.visible = true
    expect(controller.isVisible()).toBe(true)
    controller.hide()
    expect(win.hideCalls).toBe(1)
    expect(controller.isVisible()).toBe(false)
    await flushMicrotasks()
  })
})

describe('焦点剪贴板检测', () => {
  it('焦点获得时推送 http 链接', async () => {
    const controller = createController()
    const win = controller.createWindow() as unknown as InstanceType<typeof h.FakeBrowserWindow>
    h.state.clipboardText = '  https://example.com/a.zip  '
    win.emit('focus')
    expect(win.webContents.sent).toEqual([
      { channel: 'clipboard-url-detected', payload: 'https://example.com/a.zip' }
    ])
    await flushMicrotasks()
  })

  it('普通文本不推送', async () => {
    const controller = createController()
    const win = controller.createWindow() as unknown as InstanceType<typeof h.FakeBrowserWindow>
    h.state.clipboardText = '只是一段文字'
    win.emit('focus')
    expect(win.webContents.sent).toEqual([])
    await flushMicrotasks()
  })

  it('超过 2048 字符的链接不推送', async () => {
    const controller = createController()
    const win = controller.createWindow() as unknown as InstanceType<typeof h.FakeBrowserWindow>
    h.state.clipboardText = 'https://example.com/' + 'a'.repeat(2100)
    win.emit('focus')
    expect(win.webContents.sent).toEqual([])
    await flushMicrotasks()
  })

  it('剪贴板读取失败时静默忽略', async () => {
    const controller = createController()
    const win = controller.createWindow() as unknown as InstanceType<typeof h.FakeBrowserWindow>
    h.state.clipboardThrows = true
    expect(() => win.emit('focus')).not.toThrow()
    expect(win.webContents.sent).toEqual([])
    await flushMicrotasks()
  })
})

describe('外部打开与导航限制', () => {
  it('http/https/mailto 交给系统打开，且始终拒绝在窗口内打开', async () => {
    const controller = createController()
    const win = controller.createWindow() as unknown as InstanceType<typeof h.FakeBrowserWindow>
    const handler = win.webContents.openHandler
    expect(handler).not.toBeNull()
    for (const url of ['https://a.example.com', 'http://b.example.com', 'mailto:x@example.com']) {
      expect(handler?.({ url })).toEqual({ action: 'deny' })
    }
    expect(h.state.openExternal).toHaveLength(3)
    await flushMicrotasks()
  })

  it('危险协议不交给系统处理', async () => {
    const controller = createController()
    const win = controller.createWindow() as unknown as InstanceType<typeof h.FakeBrowserWindow>
    const handler = win.webContents.openHandler
    expect(handler?.({ url: 'file:///C:/Windows/System32/calc.exe' })).toEqual({ action: 'deny' })
    expect(handler?.({ url: 'ms-msdt:/id' })).toEqual({ action: 'deny' })
    expect(h.state.openExternal).toEqual([])
    expect(h.state.logs.warn).toHaveBeenCalled()
    await flushMicrotasks()
  })

  it('非法 URL 不抛错', async () => {
    const controller = createController()
    const win = controller.createWindow() as unknown as InstanceType<typeof h.FakeBrowserWindow>
    expect(() => win.webContents.openHandler?.({ url: 'not a url' })).not.toThrow()
    expect(h.state.openExternal).toEqual([])
    await flushMicrotasks()
  })

  it('生产环境只允许停留在渲染层入口', async () => {
    const controller = createController()
    const win = controller.createWindow() as unknown as InstanceType<typeof h.FakeBrowserWindow>
    const allowed = { preventDefault: vi.fn() }
    win.webContents.emit('will-navigate', allowed, 'file:///E:/app/dist/vue/index.html#/downloading')
    expect(allowed.preventDefault).not.toHaveBeenCalled()
    const blocked = { preventDefault: vi.fn() }
    win.webContents.emit('will-navigate', blocked, 'file:///C:/Users/evil/notes.html')
    expect(blocked.preventDefault).toHaveBeenCalledTimes(1)
    await flushMicrotasks()
  })

  it('开发环境只允许 Vite dev server 的 origin', async () => {
    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'
    try {
      const controller = createController()
      const win = controller.createWindow() as unknown as InstanceType<typeof h.FakeBrowserWindow>
      expect(win.loadedUrl).toBe('http://localhost:5173')
      const allowed = { preventDefault: vi.fn() }
      win.webContents.emit('will-navigate', allowed, 'http://localhost:5173/#/queue')
      expect(allowed.preventDefault).not.toHaveBeenCalled()
      // 端口不同的同主机、以及完全外部站点都必须拦下（origin 精确匹配，不是前缀匹配）
      for (const url of ['http://localhost:5174/', 'https://localhost:5173/', 'http://evil.example.com/']) {
        const blocked = { preventDefault: vi.fn() }
        win.webContents.emit('will-navigate', blocked, url)
        expect(blocked.preventDefault).toHaveBeenCalledTimes(1)
      }
      await flushMicrotasks()
    } finally {
      process.env.NODE_ENV = previous
    }
  })

  it('webview 挂载一律阻断', async () => {
    const controller = createController()
    const win = controller.createWindow() as unknown as InstanceType<typeof h.FakeBrowserWindow>
    const event = { preventDefault: vi.fn() }
    win.webContents.emit('will-attach-webview', event)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    await flushMicrotasks()
  })
})

describe('渲染进程崩溃处理', () => {
  it('前三次崩溃自动重载', async () => {
    const controller = createController()
    const win = controller.createWindow() as unknown as InstanceType<typeof h.FakeBrowserWindow>
    for (let i = 0; i < 3; i++) {
      win.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 })
      await vi.advanceTimersByTimeAsync(1000)
    }
    expect(win.reloads).toBe(3)
    await flushMicrotasks()
  })

  it('第四次崩溃弹出对话框，选择重启则重新启动应用', async () => {
    h.state.dialogResponse = 0
    const controller = createController()
    const win = controller.createWindow() as unknown as InstanceType<typeof h.FakeBrowserWindow>
    for (let i = 0; i < 4; i++) {
      win.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 })
      await vi.advanceTimersByTimeAsync(1000)
    }
    await flushMicrotasks(8)
    expect(win.reloads).toBe(3)
    expect(h.state.relaunched).toBe(1)
    expect(h.state.exited).toBe(1)
  })

  it('崩溃对话框选择关闭时不重启', async () => {
    h.state.dialogResponse = 1
    const controller = createController()
    const win = controller.createWindow() as unknown as InstanceType<typeof h.FakeBrowserWindow>
    for (let i = 0; i < 4; i++) {
      win.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 })
      await vi.advanceTimersByTimeAsync(1000)
    }
    await flushMicrotasks(8)
    expect(h.state.relaunched).toBe(0)
    expect(h.state.exited).toBe(0)
  })

  it('退出流程中的崩溃不再处理', async () => {
    h.state.quitting = true
    const controller = createController()
    const win = controller.createWindow() as unknown as InstanceType<typeof h.FakeBrowserWindow>
    win.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 })
    await vi.advanceTimersByTimeAsync(1000)
    expect(win.reloads).toBe(0)
    await flushMicrotasks()
  })
})

describe('窗口状态持久化', () => {
  it('resize 后 500ms 防抖写入状态', async () => {
    const controller = createController()
    const win = controller.createWindow() as unknown as InstanceType<typeof h.FakeBrowserWindow>
    await flushMicrotasks()
    h.state.storeSets = []
    win.bounds = { x: 300, y: 200, width: 1100, height: 720 }
    win.emit('resize')
    await vi.advanceTimersByTimeAsync(499)
    expect(windowStateSet()).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    expect(windowStateSet()).toMatchObject({
      bounds: { x: 300, y: 200, width: 1100, height: 720 },
      isMaximized: false,
      isFullScreen: false
    })
  })

  it('最大化时立即写入，并优先记录正常态边界', async () => {
    const controller = createController()
    const win = controller.createWindow() as unknown as InstanceType<typeof h.FakeBrowserWindow>
    await flushMicrotasks()
    h.state.storeSets = []
    win.bounds = { x: 120, y: 90, width: 1024, height: 700 }
    win.emit('resize')
    await vi.advanceTimersByTimeAsync(500)
    h.state.storeSets = []
    win.bounds = { x: -7, y: -7, width: 1920, height: 1080 }
    win.maximized = true
    win.emit('maximize')
    expect(windowStateSet()).toMatchObject({
      bounds: { x: 120, y: 90, width: 1024, height: 700 },
      isMaximized: true
    })
  })

  it('窗口关闭后清空引用，便于 macOS 重建', async () => {
    const controller = createController()
    const win = controller.createWindow() as unknown as InstanceType<typeof h.FakeBrowserWindow>
    await flushMicrotasks()
    win.emit('closed')
    expect(controller.getMainWindow()).toBeNull()
    expect(controller.isVisible()).toBe(false)
  })

  it('关闭时清理未触发的防抖保存', async () => {
    const controller = createController()
    const win = controller.createWindow() as unknown as InstanceType<typeof h.FakeBrowserWindow>
    await flushMicrotasks()
    h.state.storeSets = []
    win.emit('resize')
    win.emit('closed')
    await vi.advanceTimersByTimeAsync(1000)
    expect(windowStateSet()).toBeUndefined()
  })
})

describe('窗口显示', () => {
  it('内容就绪时直接显示，最小化状态先还原', async () => {
    const controller = createController()
    const win = controller.createWindow() as unknown as InstanceType<typeof h.FakeBrowserWindow>
    fireListener('app-ready')
    win.minimized = true
    controller.show()
    expect(win.restoreCalls).toBe(1)
    expect(win.showCalls).toBe(1)
    expect(win.focusCalls).toBe(1)
    await flushMicrotasks()
  })

  it('内容未就绪时等就绪后再显示', async () => {
    const controller = createController()
    const win = controller.createWindow() as unknown as InstanceType<typeof h.FakeBrowserWindow>
    controller.show()
    expect(win.showCalls).toBe(0)
    fireListener('app-ready')
    await vi.advanceTimersByTimeAsync(100)
    expect(win.showCalls).toBe(1)
  })

  it('重复调用 show 不叠加重试链', async () => {
    const controller = createController()
    const win = controller.createWindow() as unknown as InstanceType<typeof h.FakeBrowserWindow>
    controller.show()
    controller.show()
    controller.show()
    fireListener('app-ready')
    await vi.advanceTimersByTimeAsync(100)
    expect(win.showCalls).toBe(1)
  })

  it('等待超时后强制显示', async () => {
    const controller = createController()
    const win = controller.createWindow() as unknown as InstanceType<typeof h.FakeBrowserWindow>
    controller.show()
    await vi.advanceTimersByTimeAsync(10100)
    expect(win.showCalls).toBe(1)
    expect(h.state.logs.warn).toHaveBeenCalled()
  })
})

describe('任务栏进度与主题', () => {
  it('进度为 0 时清除任务栏进度', async () => {
    const controller = createController()
    const win = controller.createWindow() as unknown as InstanceType<typeof h.FakeBrowserWindow>
    controller.setTaskbarProgress(0)
    controller.setTaskbarProgress(-1)
    expect(win.progressCalls).toEqual([{ value: -1, options: undefined }, { value: -1, options: undefined }])
    await flushMicrotasks()
  })

  it('进度超过 1 时裁剪，并透传模式', async () => {
    const controller = createController()
    const win = controller.createWindow() as unknown as InstanceType<typeof h.FakeBrowserWindow>
    controller.setTaskbarProgress(2.5, 'error')
    controller.setTaskbarProgress(0.42, 'paused')
    expect(win.progressCalls).toEqual([
      { value: 1, options: { mode: 'error' } },
      { value: 0.42, options: { mode: 'paused' } }
    ])
    await flushMicrotasks()
  })

  it('窗口销毁后设置进度无操作', async () => {
    const controller = createController()
    const win = controller.createWindow() as unknown as InstanceType<typeof h.FakeBrowserWindow>
    win.destroyed = true
    expect(() => controller.setTaskbarProgress(0.5)).not.toThrow()
    expect(win.progressCalls).toEqual([])
    await flushMicrotasks()
  })

  it('主题切换幂等', async () => {
    const controller = createController()
    controller.createWindow()
    await flushMicrotasks()
    controller.setWindowTheme(true)
    expect(h.state.themeSource).toBe('dark')
    h.state.logs.info.mockClear()
    controller.setWindowTheme(true)
    expect(h.state.logs.info).not.toHaveBeenCalled()
    controller.setWindowTheme(false)
    expect(h.state.themeSource).toBe('light')
  })

  it('ready-to-show 时按设置初始化主题并标记就绪', async () => {
    h.state.settings = { theme: 'dark', minimizeToTray: true }
    const controller = createController()
    const win = controller.createWindow() as unknown as InstanceType<typeof h.FakeBrowserWindow>
    win.emit('ready-to-show')
    expect(h.state.themeSource).toBe('dark')
    expect(controller.isRendererContentReady()).toBe(true)
    expect(win.showCalls).toBe(0)
    await flushMicrotasks()
  })
})

describe('CSP 与权限', () => {
  it('应用就绪后注入 CSP 响应头', async () => {
    createController()
    await flushMicrotasks()
    expect(h.state.headersHandler).not.toBeNull()
    const callback = vi.fn()
    h.state.headersHandler?.({ responseHeaders: { 'X-Test': ['1'] } }, callback)
    expect(callback).toHaveBeenCalledTimes(1)
    const response = callback.mock.calls[0][0] as { responseHeaders: Record<string, string[]> }
    expect(response.responseHeaders['X-Test']).toEqual(['1'])
    const csp = response.responseHeaders['Content-Security-Policy'][0]
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain('ws://localhost:*')
  })

  it('所有权限请求一律拒绝', async () => {
    createController()
    await flushMicrotasks()
    expect(h.state.permissionHandler).not.toBeNull()
    const callback = vi.fn()
    h.state.permissionHandler?.({}, 'media', callback)
    expect(callback).toHaveBeenCalledWith(false)
  })
})
