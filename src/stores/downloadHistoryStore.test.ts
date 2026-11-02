import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { addDownloadToHistory, useDownloadHistoryStore } from './downloadHistoryStore'

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
