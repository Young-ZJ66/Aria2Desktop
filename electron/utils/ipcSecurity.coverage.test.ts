import { beforeEach, describe, expect, it, vi } from 'vitest'

// ipcSecurity 会在进程内缓存渲染层入口 URL；入口路径解析失败时它必须回退到
// 「任意 file:// 放行」的保守语义，否则整个应用的 IPC 会被锁死。这里把
// resolveRendererIndexPath 换成抛错版本，专测那条回退路径。
const state = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  listeners: new Map<string, (event: unknown, ...args: unknown[]) => void>(),
  senderWindow: null as unknown,
  mainWindow: null as unknown,
  resolveCalls: 0
}))

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: () => state.senderWindow },
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => state.handlers.set(channel, fn),
    on: (channel: string, fn: (event: unknown, ...args: unknown[]) => void) => state.listeners.set(channel, fn)
  }
}))
vi.mock('./appEnv', () => ({ isPackagedApp: true, isDevMode: false }))
vi.mock('./resolvePaths', () => ({
  resolveRendererIndexPath: () => {
    state.resolveCalls += 1
    throw new Error('renderer entry missing')
  }
}))

const { registerSecureHandler, registerSecureListener } = await import('./ipcSecurity')

const MAIN = { id: 'main' }

function event(url: string) {
  return { sender: { getURL: () => url } }
}

beforeEach(() => {
  state.handlers.clear()
  state.listeners.clear()
  state.mainWindow = MAIN
  state.senderWindow = MAIN
})

describe('入口路径解析失败时的 IPC 来源判定', () => {
  it('打包态回退为放行任意 file:// 页面（宁可保持可用也不锁死 IPC）', () => {
    const handler = vi.fn(() => 'ok')
    registerSecureHandler('get-app-version', handler, { getMainWindow: () => MAIN as never })
    const fn = state.handlers.get('get-app-version')!
    expect(fn(event('file:///C:/Program%20Files/App/dist/vue/index.html#/downloading'))).toBe('ok')
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('非 file:// 的 http 页面仍然被拒（回退不等于放开网络来源）', () => {
    const handler = vi.fn(() => 'secret')
    registerSecureHandler('danger', handler, { getMainWindow: () => MAIN as never })
    const fn = state.handlers.get('danger')!
    expect(fn(event('https://evil.example.com/'))).toEqual({ success: false, error: 'Unauthorized' })
    expect(handler).not.toHaveBeenCalled()
  })

  it('事件通道同样回退放行 file:// 来源', () => {
    const listener = vi.fn()
    registerSecureListener<[string]>('evt', listener, { getMainWindow: () => MAIN as never })
    state.listeners.get('evt')!(event('file:///C:/App/dist/vue/index.html'), 'payload')
    expect(listener).toHaveBeenCalledWith(expect.anything(), 'payload')
  })

  it('入口路径只解析一次（进程内缓存，失败结果也被缓存）', () => {
    const handler = vi.fn(() => 'ok')
    registerSecureHandler('cached', handler, { getMainWindow: () => MAIN as never })
    const fn = state.handlers.get('cached')!
    fn(event('file:///C:/App/dist/vue/index.html'))
    fn(event('file:///C:/App/dist/vue/index.html'))
    expect(state.resolveCalls).toBe(2) // 文件 URL 与目录 URL 各解析一次，之后走缓存
  })

  it('主窗口不匹配时即使来源是 file:// 也拒绝', () => {
    const handler = vi.fn(() => 'secret')
    registerSecureHandler('window-check', handler, { getMainWindow: () => MAIN as never })
    state.senderWindow = { id: 'other' }
    const fn = state.handlers.get('window-check')!
    expect(fn(event('file:///C:/App/dist/vue/index.html'))).toEqual({ success: false, error: 'Unauthorized' })
    expect(handler).not.toHaveBeenCalled()
  })
})
