import { beforeEach, describe, expect, it, vi } from 'vitest'

// ipcSecurity 顶层 import electron 的 BrowserWindow/ipcMain，并依赖 appEnv/resolvePaths；
// 这里把三者都换成可控桩，专测「注册时包一层来源校验」这层行为。
const state = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  listeners: new Map<string, (event: unknown, ...args: unknown[]) => void>(),
  senderWindow: null as unknown,
  mainWindow: null as unknown
}))

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: () => state.senderWindow },
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => state.handlers.set(channel, fn),
    on: (channel: string, fn: (event: unknown, ...args: unknown[]) => void) => state.listeners.set(channel, fn)
  }
}))
vi.mock('./appEnv', () => ({ isPackagedApp: false, isDevMode: true }))
vi.mock('./resolvePaths', () => ({ resolveRendererIndexPath: () => 'E:\\app\\dist\\vue\\index.html' }))

const { registerSecureHandler, registerSecureListener } = await import('./ipcSecurity')

function event(url: string) {
  return { sender: { getURL: () => url } }
}

const MAIN = { id: 'main' }

beforeEach(() => {
  state.handlers.clear()
  state.listeners.clear()
  state.mainWindow = MAIN
  state.senderWindow = MAIN
})

describe('registerSecureHandler', () => {
  it('来源可信时调用 handler 并把参数透传', async () => {
    const handler = vi.fn(async (_event: unknown, a: number, b: number) => a + b)
    registerSecureHandler<[number, number], Promise<number>>('sum', handler, { getMainWindow: () => MAIN as never })
    const fn = state.handlers.get('sum')!
    await expect(fn(event('http://localhost:5173/#/downloading'), 2, 3)).resolves.toBe(5)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('非主窗口调用时返回默认 Unauthorized 且不执行 handler', async () => {
    const handler = vi.fn(() => 'secret')
    registerSecureHandler('danger', handler, { getMainWindow: () => MAIN as never })
    state.senderWindow = { id: 'other' }
    const fn = state.handlers.get('danger')!
    // wrapSecureHandler 对同步 handler 直接返回失败值（不是 Promise）
    expect(fn(event('http://localhost:5173/'))).toEqual({ success: false, error: 'Unauthorized' })
    expect(handler).not.toHaveBeenCalled()
  })

  it('显式传 failureValue 时用它（各通道失败形态不同）', async () => {
    const handler = vi.fn(() => ({ isRunning: true }))
    registerSecureHandler('aria2-status', handler, {
      getMainWindow: () => MAIN as never,
      failureValue: { isRunning: false, error: 'Unauthorized' }
    })
    state.senderWindow = null
    const fn = state.handlers.get('aria2-status')!
    expect(fn(event('http://localhost:5173/'))).toEqual({ isRunning: false, error: 'Unauthorized' })
  })

  it('显式传 undefined 时返回 undefined（fire-and-forget 通道不能被塞成 Unauthorized 对象）', async () => {
    const handler = vi.fn(() => undefined)
    registerSecureHandler('app-ready', handler, { getMainWindow: () => MAIN as never, failureValue: undefined })
    state.senderWindow = null
    const fn = state.handlers.get('app-ready')!
    expect(fn(event('http://localhost:5173/'))).toBeUndefined()
  })

  it('来源 origin 不在白名单时也判为未授权（防窗口被导航到恶意页面）', async () => {
    const handler = vi.fn(() => 'secret')
    registerSecureHandler('danger', handler, { getMainWindow: () => MAIN as never })
    const fn = state.handlers.get('danger')!
    expect(fn(event('http://localhost:5173.evil.com/'))).toEqual({ success: false, error: 'Unauthorized' })
  })
})

describe('registerSecureListener', () => {
  it('来源可信时触发 listener', () => {
    const listener = vi.fn()
    registerSecureListener<[string]>('evt', listener, { getMainWindow: () => MAIN as never })
    state.listeners.get('evt')!(event('http://localhost:5173/'), 'payload')
    expect(listener).toHaveBeenCalledWith(expect.anything(), 'payload')
  })

  it('来源不可信时静默丢弃（事件通道无返回值）', () => {
    const listener = vi.fn()
    registerSecureListener<[string]>('evt', listener, { getMainWindow: () => MAIN as never })
    state.senderWindow = null
    state.listeners.get('evt')!(event('http://localhost:5173/'), 'payload')
    expect(listener).not.toHaveBeenCalled()
  })
})
