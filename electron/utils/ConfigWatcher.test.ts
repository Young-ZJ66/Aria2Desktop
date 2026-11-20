import { describe, expect, it, vi } from 'vitest'

// ConfigWatcher 只把 store 当「能 onDidChange 的对象」用，测试里换成假 store，
// 避免 electron-store 在 node 环境下触碰 electron 的路径 API。
vi.mock('electron-store', () => ({ default: class {} }))
// ConfigWatcher → ./logger → electron-log/main → ./appEnv → electron 的 app；
// vitest 里 app 是 undefined，会崩在 app.isPackaged，故把 logger 整个换掉。
vi.mock('./logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
}))

const { ConfigWatcher } = await import('./ConfigWatcher')

interface FakeStore {
  listeners: Map<string, Array<(newValue: unknown, oldValue: unknown) => void>>
  onDidChange: (key: string, callback: (newValue: unknown, oldValue: unknown) => void) => () => void
  emit: (key: string, newValue: unknown, oldValue: unknown) => void
}

function fakeStore(): FakeStore {
  const listeners = new Map<string, Array<(newValue: unknown, oldValue: unknown) => void>>()
  return {
    listeners,
    onDidChange(key, callback) {
      const rows = listeners.get(key) ?? []
      rows.push(callback)
      listeners.set(key, rows)
      return () => {
        const current = listeners.get(key) ?? []
        listeners.set(key, current.filter((fn) => fn !== callback))
      }
    },
    emit(key, newValue, oldValue) {
      for (const fn of listeners.get(key) ?? []) fn(newValue, oldValue)
    }
  }
}

describe('ConfigWatcher 监听配置变更', () => {
  it('watch 的回调收到新旧值，并冒泡成 change 事件', () => {
    const store = fakeStore()
    const watcher = new ConfigWatcher(store as never)
    const callback = vi.fn()
    const onChange = vi.fn()
    watcher.watch('language', callback)
    watcher.on('change', onChange)
    store.emit('language', 'en-US', 'zh-CN')
    expect(callback).toHaveBeenCalledWith('en-US', 'zh-CN')
    expect(onChange).toHaveBeenCalledWith({ key: 'language', newValue: 'en-US', oldValue: 'zh-CN' })
  })

  it('同一键重复 watch 被忽略（只保留第一个回调，避免重复触发）', () => {
    const store = fakeStore()
    const watcher = new ConfigWatcher(store as never)
    const first = vi.fn()
    const second = vi.fn()
    watcher.watch('language', first)
    watcher.watch('language', second)
    store.emit('language', 'en-US', 'zh-CN')
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()
  })

  it('unwatch 后不再回调', () => {
    const store = fakeStore()
    const watcher = new ConfigWatcher(store as never)
    const callback = vi.fn()
    watcher.watch('language', callback)
    watcher.unwatch('language')
    store.emit('language', 'en-US', 'zh-CN')
    expect(callback).not.toHaveBeenCalled()
  })

  it('unwatch 未监听的键不抛错', () => {
    const watcher = new ConfigWatcher(fakeStore() as never)
    expect(() => watcher.unwatch('nope')).not.toThrow()
  })

  it('unwatch 之后可以重新 watch（设置页反复开关订阅）', () => {
    const store = fakeStore()
    const watcher = new ConfigWatcher(store as never)
    const first = vi.fn()
    watcher.watch('language', first)
    watcher.unwatch('language')
    const second = vi.fn()
    watcher.watch('language', second)
    store.emit('language', 'ja-JP', 'zh-CN')
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith('ja-JP', 'zh-CN')
  })

  it('unwatchAll 解除全部订阅', () => {
    const store = fakeStore()
    const watcher = new ConfigWatcher(store as never)
    const a = vi.fn()
    const b = vi.fn()
    watcher.watch('language', a)
    watcher.watch('theme', b)
    watcher.unwatchAll()
    store.emit('language', 'en-US', 'zh-CN')
    store.emit('theme', 'dark', 'light')
    expect(a).not.toHaveBeenCalled()
    expect(b).not.toHaveBeenCalled()
  })

  it('多个键互不串扰', () => {
    const store = fakeStore()
    const watcher = new ConfigWatcher(store as never)
    const a = vi.fn()
    const b = vi.fn()
    watcher.watch('language', a)
    watcher.watch('theme', b)
    store.emit('theme', 'dark', 'light')
    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledWith('dark', 'light')
  })
})
