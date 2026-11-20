import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  type AppNotification,
  gidPrefix,
  resolveNotificationTitle
} from './notificationStore'

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

  it('gid 交错时同一失败通知仍然只记一条（D-50）', async () => {
    // 多个任务同时失败时通知会交错插入：只比较"最新一条"会让同一失败重复刷屏
    const store = await freshStore()
    store.push({ type: 'error', gid: 'g1', name: 'a.zip', detail: '第一次' })
    store.push({ type: 'error', gid: 'g2', name: 'b.zip', detail: '别的任务' })
    store.push({ type: 'error', gid: 'g1', name: 'a.zip', detail: '第一次' })
    expect(store.items).toHaveLength(2)
    expect(store.items.map(item => item.gid)).toEqual(['g2', 'g1'])
  })

  it('不同失败码视为不同事件，各记一条（D-50）', async () => {
    const store = await freshStore()
    store.push({ type: 'error', gid: 'g1', name: 'a.zip', errorCode: '1' })
    store.push({ type: 'error', gid: 'g1', name: 'a.zip', errorCode: '3' })
    expect(store.items).toHaveLength(2)
  })

  it('超过去重时间窗后重新记录（D-50）', async () => {
    vi.useFakeTimers()
    const store = await freshStore()
    store.push({ type: 'error', gid: 'g1', name: 'a.zip', detail: '第一次' })
    // 窗口是 60 秒：59 秒内仍算重复
    vi.advanceTimersByTime(59_000)
    store.push({ type: 'error', gid: 'g1', name: 'a.zip', detail: '第一次' })
    expect(store.items).toHaveLength(1)
    // 越过窗口后，用户真的又失败了一次，必须记下来
    vi.advanceTimersByTime(2_000)
    store.push({ type: 'error', gid: 'g1', name: 'a.zip', detail: '第一次' })
    expect(store.items).toHaveLength(2)
  })

  it('完成通知与失败通知互不抑制', async () => {
    const store = await freshStore()
    store.push({ type: 'complete', gid: 'g1', name: 'a.zip' })
    store.push({ type: 'error', gid: 'g1', name: 'a.zip' })
    expect(store.items).toHaveLength(2)
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

describe('删除单条通知', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('只删掉目标那条，其余顺序不变，并同步落盘', async () => {
    const data = stubStorage()
    const store = await freshStore()
    store.push({ type: 'error', gid: 'g1', name: 'a.zip' })
    store.push({ type: 'complete', gid: 'g2', name: 'b.zip' })
    store.push({ type: 'error', gid: 'g3', name: 'c.zip' })

    const target = store.items[1]!
    expect(store.remove(target.id)).toBe(true)
    expect(store.items.map(item => item.name)).toEqual(['c.zip', 'a.zip'])

    const saved = JSON.parse(data[STORAGE_KEY] ?? '[]') as AppNotification[]
    expect(saved.map(item => item.name)).toEqual(['c.zip', 'a.zip'])
  })

  it('id 不存在时返回 false，列表原样保留', async () => {
    const store = await freshStore()
    store.push({ type: 'error', gid: 'g1', name: 'a.zip' })

    expect(store.remove('not-exist')).toBe(false)
    expect(store.items).toHaveLength(1)
  })

  it('删掉未读通知后未读数跟着减少', async () => {
    const store = await freshStore()
    store.push({ type: 'error', gid: 'g1', name: 'a.zip' })
    store.push({ type: 'error', gid: 'g2', name: 'b.zip' })
    expect(store.unreadCount).toBe(2)

    store.remove(store.items[0]!.id)
    expect(store.unreadCount).toBe(1)
  })
})
describe('通知标题回退（D-25）', () => {
  const unknown = (prefix: string) => `未知任务（${prefix}）`

  it('优先使用任务名', () => {
    expect(
      resolveNotificationTitle(
        { name: 'ubuntu-24.04.iso', gid: 'abcdef0123456789' },
        unknown
      )
    ).toBe('ubuntu-24.04.iso')
  })

  it('任务名只有空白时继续回退到文件路径的 basename', () => {
    expect(
      resolveNotificationTitle(
        {
          name: '   ',
          files: [{ path: 'D:/Downloads/movie.mkv' }],
          gid: 'abcdef0123456789'
        },
        unknown
      )
    ).toBe('movie.mkv')
  })

  it('没有路径时用文件 uri 的 basename', () => {
    expect(
      resolveNotificationTitle(
        {
          files: [{ path: '', uris: [{ uri: 'https://example.com/files/archive.tar.gz' }] }],
          gid: 'abcdef0123456789'
        },
        unknown
      )
    ).toBe('archive.tar.gz')
  })

  it('magnet 链接取 dn 参数作为标题', () => {
    expect(
      resolveNotificationTitle(
        {
          uris: ['magnet:?xt=urn:btih:0123456789abcdef&dn=Ubuntu%2024.04%20LTS'],
          gid: 'abcdef0123456789'
        },
        unknown
      )
    ).toBe('Ubuntu 24.04 LTS')
  })

  it('magnet 的 dn 用 + 表示空格时也能还原', () => {
    expect(
      resolveNotificationTitle(
        { uris: ['magnet:?xt=urn:btih:aa&dn=Some+File.iso'], gid: 'abcdef0123456789' },
        unknown
      )
    ).toBe('Some File.iso')
  })

  it('全部线索缺失时回退到「未知任务（gid 前 8 位）」', () => {
    expect(resolveNotificationTitle({ gid: 'abcdef0123456789' }, unknown)).toBe(
      '未知任务（abcdef01）'
    )
  })

  it('gid 不足 8 位时用完整 gid 兜底', () => {
    expect(resolveNotificationTitle({ gid: 'abc' }, unknown)).toBe('未知任务（abc）')
  })

  it('目录型 URL（以 / 结尾）不产生标题，继续回退', () => {
    expect(
      resolveNotificationTitle(
        { uris: ['https://example.com/dir/'], gid: 'abcdef0123456789' },
        unknown
      )
    ).toBe('未知任务（abcdef01）')
  })

  it('文件名里的百分号编码会被解码', () => {
    expect(
      resolveNotificationTitle(
        { uris: ['https://example.com/%E6%B5%8B%E8%AF%95.zip'], gid: 'abcdef0123456789' },
        unknown
      )
    ).toBe('测试.zip')
  })

  it('gidPrefix 取前 8 位', () => {
    expect(gidPrefix('abcdef0123456789')).toBe('abcdef01')
    expect(gidPrefix('')).toBe('')
  })
})
