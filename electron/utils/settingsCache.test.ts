import { describe, expect, it, vi } from 'vitest'
import { createSettingsCache } from './settingsCache'

/**
 * 缓存语义是"改了密钥但 RPC 鉴权仍用旧密钥"这类难查故障的根源，
 * 因此在纯逻辑层把 命中 / 失效 / 写后读一致 锁死；
 * `settingsAccessor` 只是把这些语义接到 electron-store 上。
 */
describe('createSettingsCache', () => {
  it('首次读取调用 read，之后的读取命中缓存', () => {
    const read = vi.fn(() => ({ theme: 'dark' }))
    const cache = createSettingsCache(read)

    expect(cache.get()).toEqual({ theme: 'dark' })
    expect(cache.get()).toEqual({ theme: 'dark' })
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('invalidate 后重新读取', () => {
    const read = vi.fn().mockReturnValueOnce({ v: 1 }).mockReturnValueOnce({ v: 2 })
    const cache = createSettingsCache(read)

    expect(cache.get()).toEqual({ v: 1 })
    cache.invalidate()
    expect(cache.get()).toEqual({ v: 2 })
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('reload 强制重读并刷新缓存', () => {
    const read = vi.fn().mockReturnValueOnce({ v: 1 }).mockReturnValueOnce({ v: 2 })
    const cache = createSettingsCache(read)

    expect(cache.reload()).toEqual({ v: 1 })
    expect(cache.reload()).toEqual({ v: 2 })
    // reload 之后再 get 不应再触发读取
    expect(cache.get()).toEqual({ v: 2 })
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('set 直接用给定值填充，不触发 read（写入后立刻回读拿到的就是新值）', () => {
    const read = vi.fn(() => ({ v: 'old' }))
    const cache = createSettingsCache(read)

    cache.set({ v: 'new' })
    expect(cache.get()).toEqual({ v: 'new' })
    expect(read).not.toHaveBeenCalled()
  })

  it('缓存值本身为 undefined 时也只读取一次（靠标志位而非值判断是否已缓存）', () => {
    const read = vi.fn(() => undefined)
    const cache = createSettingsCache(read)

    expect(cache.get()).toBeUndefined()
    expect(cache.get()).toBeUndefined()
    expect(read).toHaveBeenCalledTimes(1)
  })
})
