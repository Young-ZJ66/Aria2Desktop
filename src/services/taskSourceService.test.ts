import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 任务原始来源存储的回归测试。
 *
 * 为什么重要：aria2 的 tellStatus 对种子/磁力任务不返回原始 magnet/torrent，
 * 失败任务的「重试」只能靠这份记录重建请求。记录丢了 = 重试按钮点了没反应。
 * 同时它要容忍损坏的本地缓存（JSON 解析失败不能让任务列表崩）。
 */
interface FakeApi {
  getStoreValue?: (key: string) => Promise<unknown>
  setStoreValue?: (key: string, value: unknown) => Promise<void>
}

let api: FakeApi
const storage = new Map<string, string>()

function installWindow(): void {
  // 源码直接读全局 localStorage（不是 window.localStorage），两处都要铺
  const fakeStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value) },
    removeItem: (key: string) => { storage.delete(key) }
  }
  ;(globalThis as unknown as { window: unknown }).window = { electronAPI: api, localStorage: fakeStorage }
  ;(globalThis as unknown as { localStorage: unknown }).localStorage = fakeStorage
}

async function loadService(): Promise<typeof import('./taskSourceService')> {
  vi.resetModules()
  return import('./taskSourceService')
}

beforeEach(() => {
  storage.clear()
  api = {}
  installWindow()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  delete (globalThis as unknown as { window?: unknown }).window
  delete (globalThis as unknown as { localStorage?: unknown }).localStorage
})

describe('record / get / remove', () => {
  it('记录 URI 来源与提交选项', async () => {
    const { taskSourceService } = await loadService()
    taskSourceService.record('gid-1', { kind: 'uri', uris: ['https://example.com/a.zip'] }, { dir: '/tmp' })
    const record = taskSourceService.get('gid-1')
    expect(record?.source).toEqual({ kind: 'uri', uris: ['https://example.com/a.zip'] })
    expect(record?.options).toEqual({ dir: '/tmp' })
    expect(typeof record?.createdAt).toBe('number')
  })

  it('记录 torrent / metalink 来源', async () => {
    const { taskSourceService } = await loadService()
    taskSourceService.record('gid-t', { kind: 'torrent', torrent: 'BASE64' })
    taskSourceService.record('gid-m', { kind: 'metalink', metalink: '<metalink/>' })
    expect(taskSourceService.get('gid-t')?.source.kind).toBe('torrent')
    expect(taskSourceService.get('gid-m')?.source.kind).toBe('metalink')
  })

  it('同一 gid 重复记录以最后一次为准', async () => {
    const { taskSourceService } = await loadService()
    taskSourceService.record('gid-1', { kind: 'uri', uris: ['https://a'] })
    taskSourceService.record('gid-1', { kind: 'uri', uris: ['https://b'] })
    expect(taskSourceService.get('gid-1')?.source).toEqual({ kind: 'uri', uris: ['https://b'] })
  })

  it('remove 后取不到；未记录过的 gid 返回 undefined', async () => {
    const { taskSourceService } = await loadService()
    taskSourceService.record('gid-1', { kind: 'uri', uris: ['https://a'] })
    taskSourceService.remove('gid-1')
    expect(taskSourceService.get('gid-1')).toBeUndefined()
    expect(taskSourceService.get('nope')).toBeUndefined()
  })

  it('clear 清空全部记录', async () => {
    const { taskSourceService } = await loadService()
    taskSourceService.record('gid-1', { kind: 'uri', uris: ['https://a'] })
    taskSourceService.record('gid-2', { kind: 'uri', uris: ['https://b'] })
    taskSourceService.clear()
    expect(taskSourceService.get('gid-1')).toBeUndefined()
    expect(taskSourceService.get('gid-2')).toBeUndefined()
  })
})

describe('容量上限', () => {
  it('超过 2000 条时淘汰最旧的记录（防止本地存储无限膨胀）', async () => {
    const { taskSourceService } = await loadService()
    for (let index = 0; index < 2005; index += 1) {
      taskSourceService.record('gid-' + index, { kind: 'uri', uris: ['https://example.com/' + index] })
    }
    expect(taskSourceService.get('gid-0')).toBeUndefined()
    expect(taskSourceService.get('gid-4')).toBeUndefined()
    expect(taskSourceService.get('gid-5')).toBeDefined()
    expect(taskSourceService.get('gid-2004')).toBeDefined()
  })
})

describe('持久化', () => {
  it('300ms 防抖后写回主进程存储', async () => {
    vi.useFakeTimers()
    const setStoreValue = vi.fn(async () => {})
    api.setStoreValue = setStoreValue
    installWindow()
    const { taskSourceService } = await loadService()
    taskSourceService.record('gid-1', { kind: 'uri', uris: ['https://a'] })
    taskSourceService.record('gid-2', { kind: 'uri', uris: ['https://b'] })
    expect(setStoreValue).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(300)
    expect(setStoreValue).toHaveBeenCalledTimes(1)
    const [key, value] = setStoreValue.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(key).toBe('taskSources')
    expect(Object.keys(value).sort()).toEqual(['gid-1', 'gid-2'])
  })

  it('没有主进程 API 时回落到 localStorage', async () => {
    vi.useFakeTimers()
    const { taskSourceService } = await loadService()
    taskSourceService.record('gid-1', { kind: 'uri', uris: ['https://a'] })
    await vi.advanceTimersByTimeAsync(300)
    const raw = storage.get('taskSources')
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw!)).toHaveProperty('gid-1')
  })

  it('写入失败只告警，不影响后续记录', async () => {
    vi.useFakeTimers()
    api.setStoreValue = vi.fn(async () => { throw new Error('disk full') })
    installWindow()
    const { taskSourceService } = await loadService()
    taskSourceService.record('gid-1', { kind: 'uri', uris: ['https://a'] })
    await vi.advanceTimersByTimeAsync(300)
    expect(console.warn).toHaveBeenCalled()
    expect(taskSourceService.get('gid-1')).toBeDefined()
  })
})

describe('损坏缓存的容错', () => {
  it('localStorage 里是坏 JSON 时清掉键并空表启动', async () => {
    storage.set('taskSources', '{not json')
    const { taskSourceService } = await loadService()
    expect(storage.has('taskSources')).toBe(false)
    expect(taskSourceService.get('gid-1')).toBeUndefined()
  })

  it('ensureLoaded 从主进程存储恢复记录', async () => {
    api.getStoreValue = vi.fn(async () => ({
      'gid-1': { source: { kind: 'uri', uris: ['https://a'] }, createdAt: 1 }
    }))
    installWindow()
    const { taskSourceService } = await loadService()
    await taskSourceService.ensureLoaded()
    expect(taskSourceService.get('gid-1')?.source).toEqual({ kind: 'uri', uris: ['https://a'] })
  })

  it('ensureLoaded 只真正读一次（并发调用共享同一 Promise）', async () => {
    const getStoreValue = vi.fn(async () => ({}))
    api.getStoreValue = getStoreValue
    installWindow()
    const { taskSourceService } = await loadService()
    await Promise.all([taskSourceService.ensureLoaded(), taskSourceService.ensureLoaded()])
    await taskSourceService.ensureLoaded()
    expect(getStoreValue).toHaveBeenCalledTimes(1)
  })
})
describe('恢复与未命中', () => {
  it('localStorage 里是合法对象时启动即恢复记录', async () => {
    storage.set('taskSources', JSON.stringify({
      'gid-a': { source: { kind: 'uri', uris: ['https://a'] }, createdAt: 11 },
      'gid-b': { source: { kind: 'torrent', torrent: 'BASE64' }, createdAt: 12 }
    }))
    const { taskSourceService } = await loadService()
    expect(taskSourceService.get('gid-a')?.createdAt).toBe(11)
    expect(taskSourceService.get('gid-b')?.source.kind).toBe('torrent')
  })

  it('localStorage 里是数组时按空表启动（数组不是合法记录表）', async () => {
    storage.set('taskSources', JSON.stringify(['gid-a']))
    const { taskSourceService } = await loadService()
    expect(taskSourceService.get('gid-a')).toBeUndefined()
    // 数组不算损坏数据，键不会被清掉
    expect(storage.has('taskSources')).toBe(true)
  })

  it('ensureLoaded 读取失败只告警并保持空表', async () => {
    api.getStoreValue = vi.fn(async () => { throw new Error('ipc down') })
    installWindow()
    const { taskSourceService } = await loadService()
    await expect(taskSourceService.ensureLoaded()).resolves.toBeUndefined()
    expect(console.warn).toHaveBeenCalled()
    expect(taskSourceService.get('gid-1')).toBeUndefined()
  })

  it('remove 未命中的 gid 不会触发写盘', async () => {
    vi.useFakeTimers()
    const setStoreValue = vi.fn(async () => {})
    api.setStoreValue = setStoreValue
    installWindow()
    const { taskSourceService } = await loadService()
    taskSourceService.record('gid-1', { kind: 'uri', uris: ['https://a'] })
    await vi.advanceTimersByTimeAsync(300)
    expect(setStoreValue).toHaveBeenCalledTimes(1)
    taskSourceService.remove('nope')
    await vi.advanceTimersByTimeAsync(300)
    expect(setStoreValue).toHaveBeenCalledTimes(1)
    expect(taskSourceService.get('gid-1')).toBeDefined()
  })
})
