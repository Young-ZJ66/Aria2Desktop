import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionManager } from './sessionManager'

/**
 * 会话保存的回归测试。
 *
 * 这条链路决定「新加的任务会不会在应用退出/崩溃后消失」：主进程 RPC 失败时返回
 * `{ success: false }` 而不是抛错，所以调用方必须看返回值——此前无条件 return true
 * 让 UI 以为已落盘，结果是崩溃后未完成任务静默从恢复列表消失且没有日志。
 * 另外保存进行中再次请求不能丢：丢一次就等于丢一个刚添加的任务。
 */
type SaveFn = () => Promise<{ success: boolean; error?: string }>

let saveSession: ReturnType<typeof vi.fn<SaveFn>>

function installApi(fn: SaveFn | null): void {
  ;(globalThis as unknown as { window: unknown }).window = fn ? { electronAPI: { saveSession: fn } } : { electronAPI: {} }
}

beforeEach(() => {
  saveSession = vi.fn<SaveFn>(async () => ({ success: true }))
  installApi(saveSession as unknown as SaveFn)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  delete (globalThis as unknown as { window?: unknown }).window
})

describe('saveSessionImmediate：立即保存', () => {
  it('主进程确认保存后返回 true', async () => {
    const manager = new SessionManager()
    await expect(manager.saveSessionImmediate()).resolves.toBe(true)
    expect(saveSession).toHaveBeenCalledTimes(1)
  })

  it('主进程返回 success:false 时返回 false（不能假装已落盘）', async () => {
    saveSession.mockResolvedValue({ success: false, error: 'rpc failed' })
    const manager = new SessionManager()
    await expect(manager.saveSessionImmediate()).resolves.toBe(false)
    expect(console.warn).toHaveBeenCalled()
  })

  it('主进程抛错时返回 false 且不把异常抛给调用方', async () => {
    saveSession.mockRejectedValue(new Error('boom'))
    const manager = new SessionManager()
    await expect(manager.saveSessionImmediate()).resolves.toBe(false)
  })

  it('electronAPI 缺失时返回 false', async () => {
    installApi(null)
    const manager = new SessionManager()
    await expect(manager.saveSessionImmediate()).resolves.toBe(false)
  })
})

describe('保存进行中的并发请求', () => {
  it('第二次请求返回 false 并在首次完成后补一次保存（不丢变更）', async () => {
    let release: (() => void) | null = null
    saveSession.mockImplementationOnce(() => new Promise((resolve) => {
      release = () => resolve({ success: true })
    }))
    const manager = new SessionManager()
    const first = manager.saveSessionImmediate()
    await expect(manager.saveSessionImmediate()).resolves.toBe(false)
    expect(saveSession).toHaveBeenCalledTimes(1)

    release!()
    await expect(first).resolves.toBe(true)
    // finally 里的 queueMicrotask 会重跑一次保存
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(saveSession).toHaveBeenCalledTimes(2)
  })

  it('首次保存失败时不登记补保存（避免连锁失败）', async () => {
    let reject: ((error: Error) => void) | null = null
    saveSession.mockImplementationOnce(() => new Promise((_resolve, rejectFn) => {
      reject = rejectFn
    }))
    const manager = new SessionManager()
    const first = manager.saveSessionImmediate()
    await manager.saveSessionImmediate()
    reject!(new Error('boom'))
    await expect(first).resolves.toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(saveSession).toHaveBeenCalledTimes(1)
  })
})

describe('saveSessionDebounced / markTaskForSave：防抖', () => {
  it('连续请求只触发一次保存', async () => {
    vi.useFakeTimers()
    const manager = new SessionManager()
    manager.saveSessionDebounced(1000)
    manager.saveSessionDebounced(1000)
    manager.saveSessionDebounced(1000)
    expect(saveSession).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(saveSession).toHaveBeenCalledTimes(1)
  })

  it('markTaskForSave 用 500ms 防抖（新任务要尽快落盘）', async () => {
    vi.useFakeTimers()
    const manager = new SessionManager()
    manager.markTaskForSave('gid-1')
    await vi.advanceTimersByTimeAsync(499)
    expect(saveSession).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(saveSession).toHaveBeenCalledTimes(1)
  })
})
