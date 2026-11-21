import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { addDownloadToHistory, buildDailySeries, useDownloadHistoryStore } from './downloadHistoryStore'

describe('addDownloadToHistory', () => {
  it('累加今日与累计下载量', () => {
    const result = addDownloadToHistory({ totalBytes: 100, daily: { '2026-11-01': 100 } }, 200, '2026-11-01')
    expect(result.totalBytes).toBe(300)
    expect(result.daily['2026-11-01']).toBe(300)
  })

  it('忽略非正数', () => {
    const history = { totalBytes: 10, daily: { '2026-11-01': 10 } }
    expect(addDownloadToHistory(history, 0, '2026-11-01')).toBe(history)
    expect(addDownloadToHistory(history, -5, '2026-11-01')).toBe(history)
  })

  it('只保留最近 90 天', () => {
    const daily: Record<string, number> = {}
    for (let i = 0; i < 91; i++) {
      const date = new Date(2026, 0, 1 + i)
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      daily[key] = 1
    }
    const result = addDownloadToHistory({ totalBytes: 91, daily }, 1, '2026-04-02')
    expect(Object.keys(result.daily).length).toBe(90)
  })
})

describe('buildDailySeries', () => {
  it('生成连续日期并为缺失日期补 0', () => {
    const series = buildDailySeries({ '2026-11-18': 100, '2026-11-20': 300 }, 3, '2026-11-20')
    expect(series).toEqual([
      { dateKey: '2026-11-18', bytes: 100 },
      { dateKey: '2026-11-19', bytes: 0 },
      { dateKey: '2026-11-20', bytes: 300 }
    ])
  })

  it('跨月时日期连续', () => {
    const series = buildDailySeries({}, 3, '2026-03-01')
    expect(series.map(item => item.dateKey)).toEqual(['2026-02-27', '2026-02-28', '2026-03-01'])
  })
})

describe('useDownloadHistoryStore 的「今日」口径', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // loadHistory 会读 localStorage；测试环境里没有，给个不落盘的空实现
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {}
    })
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('跨零点后即使没有新下载，也不再显示昨天的量', () => {
    vi.setSystemTime(new Date(2026, 10, 3, 23, 30))
    const store = useDownloadHistoryStore()
    store.record(1024)
    expect(store.todayBytes).toBe(1024)

    // 到了第二天，但期间没有任何下载完成
    vi.setSystemTime(new Date(2026, 10, 4, 0, 1))
    vi.advanceTimersByTime(60_000)

    expect(store.todayBytes).toBe(0)
    // 累计量不受影响
    expect(store.totalBytes).toBe(1024)
  })

  it('跨零点后的第一次下载记到新日期，旧日期保留', () => {
    vi.setSystemTime(new Date(2026, 10, 3, 23, 59))
    const store = useDownloadHistoryStore()
    store.record(1024)

    vi.setSystemTime(new Date(2026, 10, 4, 0, 0, 30))
    store.record(2048)

    expect(store.todayBytes).toBe(2048)
    expect(store.history.daily['2026-11-03']).toBe(1024)
    expect(store.totalBytes).toBe(3072)
  })

  it('同一天内的多次下载继续累加到同一条记录', () => {
    vi.setSystemTime(new Date(2026, 10, 3, 9, 0))
    const store = useDownloadHistoryStore()
    store.record(100)
    vi.advanceTimersByTime(5_000)
    store.record(200)

    expect(store.todayBytes).toBe(300)
    expect(Object.keys(store.history.daily)).toEqual(['2026-11-03'])
  })
})

describe('useDownloadHistoryStore 的读写与重置', () => {
  let storage: Map<string, string>

  beforeEach(() => {
    vi.useFakeTimers()
    storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key)
    })
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('record 会把累加结果写进 localStorage', () => {
    vi.setSystemTime(new Date(2026, 10, 3, 9, 0))
    const store = useDownloadHistoryStore()

    store.record(4096)

    const saved = JSON.parse([...storage.values()][0] ?? '{}') as { totalBytes: number; daily: Record<string, number> }
    expect(saved.totalBytes).toBe(4096)
    expect(saved.daily['2026-11-03']).toBe(4096)
  })

  it('非正数与非有限数不写盘（也不改内存）', () => {
    vi.setSystemTime(new Date(2026, 10, 3, 9, 0))
    const store = useDownloadHistoryStore()

    store.record(0)
    store.record(-100)
    store.record(Number.NaN)
    store.record(Number.POSITIVE_INFINITY)

    expect(store.totalBytes).toBe(0)
    expect(store.todayBytes).toBe(0)
    expect(storage.size).toBe(0)
  })

  it('启动时从 localStorage 恢复历史', () => {
    vi.setSystemTime(new Date(2026, 10, 3, 9, 0))
    storage.set(
      'aria2-desktop-download-history',
      JSON.stringify({ totalBytes: 8192, daily: { '2026-11-02': 4096, '2026-11-03': 4096 } })
    )

    const store = useDownloadHistoryStore()

    expect(store.totalBytes).toBe(8192)
    expect(store.todayBytes).toBe(4096)
  })

  it('恢复时丢弃非数字与非正数的按日记录（防脏数据撑大内存）', () => {
    vi.setSystemTime(new Date(2026, 10, 3, 9, 0))
    storage.set(
      'aria2-desktop-download-history',
      JSON.stringify({ totalBytes: 'oops', daily: { '2026-11-01': -5, '2026-11-02': 'abc', '2026-11-03': 128 } })
    )

    const store = useDownloadHistoryStore()

    expect(store.history.daily).toEqual({ '2026-11-03': 128 })
    // totalBytes 不是数字时归 0，而不是 NaN 污染界面
    expect(store.totalBytes).toBe(0)
  })

  it('存储内容损坏时按空历史启动，不抛错', () => {
    storage.set('aria2-desktop-download-history', '{ not json')

    const store = useDownloadHistoryStore()

    expect(store.totalBytes).toBe(0)
    expect(store.history.daily).toEqual({})
  })

  it('reset 清空内存与 localStorage', () => {
    vi.setSystemTime(new Date(2026, 10, 3, 9, 0))
    const store = useDownloadHistoryStore()
    store.record(1024)

    store.reset()

    expect(store.totalBytes).toBe(0)
    expect(store.todayBytes).toBe(0)
    expect(store.history.daily).toEqual({})
    expect(storage.size).toBe(0)
  })

  it('reset 之后仍可继续累计（定时器与日期键都重新就绪）', () => {
    vi.setSystemTime(new Date(2026, 10, 3, 9, 0))
    const store = useDownloadHistoryStore()
    store.record(1024)
    store.reset()

    store.record(256)

    expect(store.totalBytes).toBe(256)
    expect(store.todayBytes).toBe(256)
  })
})

describe('useDownloadHistoryStore 的作用域清理', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined
    })
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('store 销毁时清掉跨零点检查定时器', () => {
    const store = useDownloadHistoryStore()
    const before = vi.getTimerCount()
    expect(before).toBeGreaterThan(0)

    store.$dispose()

    expect(vi.getTimerCount()).toBe(before - 1)
  })
})
