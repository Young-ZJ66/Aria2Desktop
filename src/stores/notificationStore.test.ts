import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { type AppNotification } from './notificationStore'

const STORAGE_KEY = 'aria2-desktop-notifications'

/** 内存版 localStorage：store 在模块顶层不读，但每个用例 import 后都会读一次 */
function stubStorage(initial: Record<string, string> = {}) {
  const data = { ...initial }
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => { data[key] = value },
    removeItem: (key: string) => { delete data[key] }
  })
  return data
}

/** store 是单例，换 localStorage 后要重新 import 才会重新 loadItems */
async function freshStore() {
  vi.resetModules()
  const mod = await import('./notificationStore')
  setActivePinia(createPinia())
  return mod.useNotificationStore()
}

describe('通知中心记录失败原因', () => {
  beforeEach(() => {
    stubStorage()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('push 时保存 detail，并在列表里读得到', async () => {
    const store = await freshStore()
    store.push({ type: 'error', gid: 'g1', name: 'a.zip', detail: '磁盘空间不足，清理出空间后重试' })
    expect(store.items[0]?.detail).toBe('磁盘空间不足，清理出空间后重试')
  })

  it('没有 detail 时字段为空，不写入空串', async () => {
    const store = await freshStore()
    store.push({ type: 'error', gid: 'g1', name: 'a.zip' })
    expect(store.items[0]?.detail).toBeUndefined()
  })

  it('detail 会随列表落进 localStorage', async () => {
    const data = stubStorage()
    const store = await freshStore()
    store.push({ type: 'error', gid: 'g1', name: 'a.zip', detail: '域名解析失败' })
    const saved = JSON.parse(data[STORAGE_KEY] ?? '[]') as AppNotification[]
    expect(saved[0]?.detail).toBe('域名解析失败')
  })

  it('同一 gid 同一类型在去重窗口内只记一条', async () => {
    vi.useFakeTimers()
    const store = await freshStore()
    store.push({ type: 'error', gid: 'g1', name: 'a.zip', detail: '第一次' })
    store.push({ type: 'error', gid: 'g1', name: 'a.zip', detail: '第二次' })
    expect(store.items).toHaveLength(1)
    expect(store.items[0]?.detail).toBe('第一次')
  })

  it('读取历史记录时保留字符串 detail，丢弃其它类型', async () => {
    stubStorage({
      [STORAGE_KEY]: JSON.stringify([
        { id: '1', type: 'error', gid: 'g1', name: 'a.zip', detail: '磁盘空间不足', createdAt: 1, read: false },
        { id: '2', type: 'error', gid: 'g2', name: 'b.zip', detail: 42, createdAt: 2, read: false },
        { id: '3', type: 'error', gid: 'g3', name: 'c.zip', createdAt: 3, read: false }
      ])
    })
    const store = await freshStore()
    expect(store.items.map(item => item.detail)).toEqual(['磁盘空间不足', undefined, undefined])
  })
})
