import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 剪贴板下载链接检测。
 *
 * 这是个「太主动就会烦人」的功能，几条边界必须锁住：
 * 1) 只认单行、短、带下载协议的文本——否则复制一段代码/一句话就弹新建任务；
 * 2) 同一个链接只弹一次，不然每次切窗口都弹；
 * 3) stop() 之后（断开连接）绝不能再弹窗。
 */
const openNewTaskWithUrl = vi.hoisted(() => vi.fn())

vi.mock('@/stores/uiStore', () => ({ useUiStore: () => ({ openNewTaskWithUrl }) }))

import { useClipboardMonitor } from './useClipboardMonitor'

interface FakeTarget {
  handlers: Map<string, () => void>
  addEventListener: (type: string, handler: () => void) => void
  removeEventListener: (type: string, handler: () => void) => void
}

function fakeTarget(): FakeTarget {
  const target: FakeTarget = {
    handlers: new Map(),
    addEventListener(type, handler) { target.handlers.set(type, handler) },
    removeEventListener(type) { target.handlers.delete(type) }
  }
  return target
}

let doc: FakeTarget & { visibilityState: string }
let win: FakeTarget
const readClipboard = vi.fn()

beforeEach(() => {
  vi.useFakeTimers()
  openNewTaskWithUrl.mockClear()
  readClipboard.mockReset()
  doc = Object.assign(fakeTarget(), { visibilityState: 'visible' })
  win = fakeTarget()
  ;(globalThis as unknown as { document: unknown }).document = doc
  ;(globalThis as unknown as { window: unknown }).window = Object.assign(win, {
    electronAPI: { readClipboard }
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  delete (globalThis as unknown as { document?: unknown }).document
  delete (globalThis as unknown as { window?: unknown }).window
})

async function triggerCheck(): Promise<void> {
  doc.handlers.get('visibilitychange')?.()
  await vi.advanceTimersByTimeAsync(300)
}

describe('识别规则', () => {
  it('http 链接会填入新建任务弹窗', async () => {
    readClipboard.mockResolvedValue('https://example.com/a.zip')
    const monitor = useClipboardMonitor()
    monitor.start()
    await triggerCheck()
    expect(openNewTaskWithUrl).toHaveBeenCalledWith('https://example.com/a.zip')
    monitor.stop()
  })

  it('magnet / ftp 也算下载链接', async () => {
    readClipboard.mockResolvedValue('magnet:?xt=urn:btih:abc')
    const monitor = useClipboardMonitor()
    monitor.start()
    await triggerCheck()
    expect(openNewTaskWithUrl).toHaveBeenCalledWith('magnet:?xt=urn:btih:abc')
    monitor.stop()
  })

  it('普通文本不弹窗', async () => {
    readClipboard.mockResolvedValue('今天天气不错')
    const monitor = useClipboardMonitor()
    monitor.start()
    await triggerCheck()
    expect(openNewTaskWithUrl).not.toHaveBeenCalled()
    monitor.stop()
  })

  it('多行文本不当作链接', async () => {
    readClipboard.mockResolvedValue('https://example.com/a.zip\n第二行')
    const monitor = useClipboardMonitor()
    monitor.start()
    await triggerCheck()
    expect(openNewTaskWithUrl).not.toHaveBeenCalled()
    monitor.stop()
  })

  it('超长文本（>2048）不当作链接', async () => {
    readClipboard.mockResolvedValue('https://example.com/' + 'a'.repeat(2100))
    const monitor = useClipboardMonitor()
    monitor.start()
    await triggerCheck()
    expect(openNewTaskWithUrl).not.toHaveBeenCalled()
    monitor.stop()
  })
})

describe('去重与生命周期', () => {
  it('同一个链接只弹一次', async () => {
    readClipboard.mockResolvedValue('https://example.com/a.zip')
    const monitor = useClipboardMonitor()
    monitor.start()
    await triggerCheck()
    await triggerCheck()
    expect(openNewTaskWithUrl).toHaveBeenCalledTimes(1)
    monitor.stop()
  })

  it('短时间多次焦点只读一次剪贴板（300ms 防抖）', async () => {
    readClipboard.mockResolvedValue('https://example.com/a.zip')
    const monitor = useClipboardMonitor()
    monitor.start()
    win.handlers.get('focus')?.()
    win.handlers.get('focus')?.()
    await vi.advanceTimersByTimeAsync(300)
    expect(readClipboard).toHaveBeenCalledTimes(1)
    monitor.stop()
  })

  it('start 注册两个监听，stop 全部摘掉', async () => {
    const monitor = useClipboardMonitor()
    monitor.start()
    expect(doc.handlers.has('visibilitychange')).toBe(true)
    expect(win.handlers.has('focus')).toBe(true)
    monitor.stop()
    expect(doc.handlers.has('visibilitychange')).toBe(false)
    expect(win.handlers.has('focus')).toBe(false)
  })

  it('stop 之后不再读取剪贴板（断开连接后不该弹窗）', async () => {
    readClipboard.mockResolvedValue('https://example.com/a.zip')
    const monitor = useClipboardMonitor()
    monitor.start()
    monitor.stop()
    await vi.advanceTimersByTimeAsync(1000)
    expect(readClipboard).not.toHaveBeenCalled()
    expect(openNewTaskWithUrl).not.toHaveBeenCalled()
  })

  it('重复 start 不会重复注册监听', async () => {
    readClipboard.mockResolvedValue('https://example.com/a.zip')
    const monitor = useClipboardMonitor()
    monitor.start()
    monitor.start()
    await triggerCheck()
    expect(readClipboard).toHaveBeenCalledTimes(1)
    monitor.stop()
  })
})

describe('异常与主进程推送', () => {
  it('读取剪贴板抛错时静默返回', async () => {
    readClipboard.mockRejectedValue(new Error('ipc failed'))
    const monitor = useClipboardMonitor()
    monitor.start()
    await expect(triggerCheck()).resolves.toBeUndefined()
    expect(openNewTaskWithUrl).not.toHaveBeenCalled()
    monitor.stop()
  })

  it('没有 electronAPI 时直接跳过', async () => {
    delete (globalThis as unknown as { window: { electronAPI?: unknown } }).window.electronAPI
    const monitor = useClipboardMonitor()
    monitor.start()
    await triggerCheck()
    expect(openNewTaskWithUrl).not.toHaveBeenCalled()
    monitor.stop()
  })

  it('主进程推送的 URL 同样会校验与去重', async () => {
    const monitor = useClipboardMonitor()
    monitor.start()
    monitor.handleDetectedUrl('not a url')
    expect(openNewTaskWithUrl).not.toHaveBeenCalled()
    monitor.handleDetectedUrl('https://example.com/a.zip')
    monitor.handleDetectedUrl('https://example.com/a.zip')
    expect(openNewTaskWithUrl).toHaveBeenCalledTimes(1)
    monitor.stop()
  })

  it('未 start 时主进程推送被忽略', () => {
    const monitor = useClipboardMonitor()
    monitor.handleDetectedUrl('https://example.com/a.zip')
    expect(openNewTaskWithUrl).not.toHaveBeenCalled()
  })
})

describe('读取过程中的状态变化', () => {
  it('等待主进程回话期间被 stop 时丢弃这次结果', async () => {
    let resolveRead: (value: string) => void = () => {}
    readClipboard.mockReturnValue(new Promise<string>((resolve) => { resolveRead = resolve }))
    const monitor = useClipboardMonitor()
    monitor.start()
    doc.handlers.get('visibilitychange')?.()
    await vi.advanceTimersByTimeAsync(300)
    expect(readClipboard).toHaveBeenCalledTimes(1)

    monitor.stop()
    resolveRead('https://example.com/late.zip')
    await vi.advanceTimersByTimeAsync(0)
    expect(openNewTaskWithUrl).not.toHaveBeenCalled()
  })
})

