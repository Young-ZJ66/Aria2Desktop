import { describe, expect, it } from 'vitest'
import { addDownloadToHistory } from './downloadHistoryStore'

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
