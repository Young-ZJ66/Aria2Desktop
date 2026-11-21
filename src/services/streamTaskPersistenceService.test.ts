import { describe, expect, it, vi } from 'vitest'
import {
  MAX_PERSISTED_STREAM_TASKS,
  STREAM_TASK_INTERRUPTED_ERROR,
  STREAM_TASK_SCHEMA_VERSION,
  STREAM_TASK_STORAGE_KEY,
  StreamTaskPersistenceService,
  sanitizePersistedStreamTask,
  type StreamTaskStorageLike
} from './streamTaskPersistenceService'
import type { StreamTask } from '@/utils/streamTaskUtils'

/** 假 localStorage：只实现持久化服务用到的三个方法，附带 dump 便于断言落盘内容 */
function createFakeStorage(initial?: string): StreamTaskStorageLike & {
  dump: () => string | null
  removeItem: ReturnType<typeof vi.fn>
  setItem: ReturnType<typeof vi.fn>
} {
  let value: string | null = initial ?? null
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, next: string) => { value = next }),
    removeItem: vi.fn(() => { value = null }),
    dump: () => value
  }
}

function makeTask(patch: Partial<StreamTask> = {}): StreamTask {
  return {
    gid: 'sd-persist-1',
    url: 'https://example.com/video',
    formatId: '30080',
    merge: true,
    outputDir: 'D:/Downloads',
    title: '测试视频',
    status: 'complete',
    percent: 100,
    speedBytes: 0,
    speedText: '',
    eta: '',
    totalBytes: 1_000_000,
    downloadedBytes: 1_000_000,
    filePath: 'D:/Downloads/测试视频.mp4',
    filePaths: ['D:/Downloads/测试视频.mp4'],
    createdAt: 1_700_000_000_000,
    completedAt: 1_700_000_100_000,
    input: {
      url: 'https://example.com/video',
      formatId: '30080',
      merge: true,
      outputDir: 'D:/Downloads',
      title: '测试视频',
      playlist: { ids: ['1', '3'] },
      subtitle: { enabled: true, languages: ['zh-Hans', 'en'], includeAuto: true },
      cookieFile: 'D:/cookies.txt',
      extractAudio: true
    },
    ...patch
  }
}

function envelope(tasks: unknown[], schemaVersion = STREAM_TASK_SCHEMA_VERSION): string {
  return JSON.stringify({ schemaVersion, tasks })
}

describe('sanitizePersistedStreamTask：单条记录的清洗与降级', () => {
  it('完整记录（含 input 全部字段）原样还原', () => {
    const task = sanitizePersistedStreamTask(makeTask())
    expect(task).not.toBeNull()
    expect(task?.gid).toBe('sd-persist-1')
    expect(task?.status).toBe('complete')
    expect(task?.filePaths).toEqual(['D:/Downloads/测试视频.mp4'])
    expect(task?.completedAt).toBe(1_700_000_100_000)
    expect(task?.input?.playlist).toEqual({ ids: ['1', '3'] })
    expect(task?.input?.subtitle).toEqual({ enabled: true, languages: ['zh-Hans', 'en'], includeAuto: true })
    expect(task?.input?.cookieFile).toBe('D:/cookies.txt')
    expect(task?.input?.extractAudio).toBe(true)
  })

  it('上一次运行遗留的 active/paused 改写为 error + 中断文案', () => {
    for (const status of ['active', 'paused'] as const) {
      const task = sanitizePersistedStreamTask(makeTask({ status, percent: 42 }))
      expect(task?.status).toBe('error')
      expect(task?.percent).toBe(0)
      expect(task?.error).toBe(STREAM_TASK_INTERRUPTED_ERROR)
      // 速度/ETA 是运行态数据，恢复后必须清零，否则界面显示一个不动的速度
      expect(task?.speedBytes).toBe(0)
      expect(task?.speedText).toBe('')
      expect(task?.eta).toBe('')
    }
  })

  it('缺 gid/url 或 status 非法的记录被丢弃（不污染列表）', () => {
    expect(sanitizePersistedStreamTask(null)).toBeNull()
    expect(sanitizePersistedStreamTask('not-an-object')).toBeNull()
    expect(sanitizePersistedStreamTask({ url: 'https://example.com/a', status: 'complete' })).toBeNull()
    expect(sanitizePersistedStreamTask({ gid: 'x', status: 'complete' })).toBeNull()
    expect(sanitizePersistedStreamTask({ gid: 'x', url: 'https://example.com/a', status: 'cancelled' })).toBeNull()
  })

  it('没有 input 的旧记录（扩展发起的下载）安全降级，不伪造参数', () => {
    const task = sanitizePersistedStreamTask({
      gid: 'sd-ext-1',
      url: 'https://www.bilibili.com/video/BV1GJ411x7h7',
      status: 'error',
      error: 'HTTP 403'
    })
    expect(task?.input).toBeUndefined()
    expect(task?.title).toBe('https://www.bilibili.com/video/BV1GJ411x7h7')
    expect(task?.error).toBe('HTTP 403')
    expect(task?.createdAt).toBeGreaterThan(0)
  })

  it('input 里坏掉的可选字段被剔除，但保留可用的部分', () => {
    const task = sanitizePersistedStreamTask({
      gid: 'sd-1',
      url: 'https://example.com/a',
      status: 'complete',
      input: {
        url: 'https://example.com/a',
        outputDir: 'D:/Downloads',
        formatId: 123,
        merge: 'yes',
        playlist: { ids: ['1', '', 5] },
        subtitle: { enabled: true, languages: ['zh-Hans', ''] },
        cookieFile: ''
      }
    })
    expect(task?.input?.formatId).toBe('')
    expect(task?.input?.merge).toBe(false)
    expect(task?.input?.playlist).toEqual({ ids: ['1'] })
    expect(task?.input?.subtitle).toEqual({ enabled: true, languages: ['zh-Hans'] })
    expect(task?.input?.cookieFile).toBeUndefined()
    // input 缺 url/outputDir 时整块丢弃：没有目录的重试请求无法执行
    expect(sanitizePersistedStreamTask({
      gid: 'sd-2',
      url: 'https://example.com/a',
      status: 'complete',
      input: { formatId: 'x' }
    })?.input).toBeUndefined()
  })
})

describe('StreamTaskPersistenceService：落盘与恢复', () => {
  it('upsert + flush 后能被新实例读回（含完整 input）', () => {
    const storage = createFakeStorage()
    const service = new StreamTaskPersistenceService({ storage })
    service.upsert(makeTask())
    service.flush()

    const persisted = JSON.parse(storage.dump() as string)
    expect(persisted.schemaVersion).toBe(STREAM_TASK_SCHEMA_VERSION)

    const reloaded = new StreamTaskPersistenceService({ storage }).load()
    expect(reloaded).toHaveLength(1)
    expect(reloaded[0]?.gid).toBe('sd-persist-1')
    expect(reloaded[0]?.input?.cookieFile).toBe('D:/cookies.txt')
    expect(reloaded[0]?.filePaths).toEqual(['D:/Downloads/测试视频.mp4'])
  })

  it('remove 删除单条记录并落盘（删除任务时同步清理）', () => {
    const storage = createFakeStorage()
    const service = new StreamTaskPersistenceService({ storage })
    service.replaceAll([makeTask({ gid: 'a' }), makeTask({ gid: 'b' })])
    service.flush()
    expect(JSON.parse(storage.dump() as string).tasks).toHaveLength(2)

    service.remove('a')
    service.flush()
    const tasks = JSON.parse(storage.dump() as string).tasks as Array<{ gid: string }>
    expect(tasks.map(task => task.gid)).toEqual(['b'])
    expect(service.getSnapshot().map(task => task.gid)).toEqual(['b'])
  })

  it('损坏的 JSON 被清理，启动不抛错且返回空列表', () => {
    const storage = createFakeStorage('{ this is not json')
    const service = new StreamTaskPersistenceService({ storage })
    expect(service.load()).toEqual([])
    expect(storage.removeItem).toHaveBeenCalledWith(STREAM_TASK_STORAGE_KEY)
    expect(storage.dump()).toBeNull()
  })

  it('顶层结构非法的数据被清理', () => {
    const storage = createFakeStorage(JSON.stringify({ schemaVersion: 1, tasks: 'oops' }))
    expect(new StreamTaskPersistenceService({ storage }).load()).toEqual([])
    expect(storage.dump()).toBeNull()
  })

  it('单条坏记录跳过，其余记录照常恢复', () => {
    const storage = createFakeStorage(envelope([
      makeTask({ gid: 'good-1' }),
      { gid: 'bad', status: 'complete' },
      null,
      makeTask({ gid: 'good-2', status: 'active' })
    ]))
    const restored = new StreamTaskPersistenceService({ storage }).load()
    expect(restored.map(task => task.gid)).toEqual(['good-1', 'good-2'])
    expect(restored[1]?.status).toBe('error')
    expect(restored[1]?.error).toBe(STREAM_TASK_INTERRUPTED_ERROR)
  })

  it('schemaVersion 比当前新时整体忽略（不猜未来字段语义）', () => {
    const storage = createFakeStorage(envelope([makeTask()], STREAM_TASK_SCHEMA_VERSION + 1))
    expect(new StreamTaskPersistenceService({ storage }).load()).toEqual([])
    // 忽略但不删除：降级回旧版本 App 时数据还在
    expect(storage.removeItem).not.toHaveBeenCalled()
  })

  it('超过上限时按 createdAt 新→旧保留，最多 500 条', () => {
    const tasks = Array.from({ length: MAX_PERSISTED_STREAM_TASKS + 20 }, (_, index) =>
      makeTask({ gid: 'sd-' + index, createdAt: 1_700_000_000_000 + index })
    )
    const storage = createFakeStorage(envelope(tasks))
    const restored = new StreamTaskPersistenceService({ storage }).load()
    expect(restored).toHaveLength(MAX_PERSISTED_STREAM_TASKS)
    expect(restored[0]?.gid).toBe('sd-' + (MAX_PERSISTED_STREAM_TASKS + 19))
  })

  it('没有可用存储时所有操作静默降级为空操作', () => {
    const service = new StreamTaskPersistenceService({ storage: null })
    expect(service.load()).toEqual([])
    expect(() => {
      service.upsert(makeTask())
      service.flush()
      service.remove('sd-persist-1')
      service.clear()
    }).not.toThrow()
    expect(service.getSnapshot()).toEqual([])
  })
})

describe('StreamTaskPersistenceService 的存储异常', () => {
  it('localStorage 属性本身抛错时按无存储处理', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() { throw new Error('storage disabled') }
    })
    try {
      const service = new StreamTaskPersistenceService()
      expect(service.load()).toEqual([])
      expect(() => service.flush()).not.toThrow()
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor)
      else delete (globalThis as { localStorage?: unknown }).localStorage
    }
  })

  it('getItem 抛错时当作没有数据，且不清除存储', () => {
    const storage = {
      getItem: vi.fn((): string | null => { throw new Error('quota') }),
      setItem: vi.fn(),
      removeItem: vi.fn()
    }
    expect(new StreamTaskPersistenceService({ storage }).load()).toEqual([])
    expect(storage.removeItem).not.toHaveBeenCalled()
  })

  it('setItem 抛错只记日志，内存快照照常更新', () => {
    const storage = {
      getItem: vi.fn((): string | null => null),
      setItem: vi.fn(() => { throw new Error('full') }),
      removeItem: vi.fn()
    }
    const service = new StreamTaskPersistenceService({ storage })
    expect(() => {
      service.upsert(makeTask())
      service.flush()
    }).not.toThrow()
    expect(storage.setItem).toHaveBeenCalled()
    expect(service.getSnapshot()).toHaveLength(1)
  })

  it('写入走 300ms 合批：连续 upsert 只落盘一次', async () => {
    vi.useFakeTimers()
    try {
      const storage = createFakeStorage()
      const service = new StreamTaskPersistenceService({ storage })
      service.upsert(makeTask({ gid: 'sd-batch-1' }))
      service.upsert(makeTask({ gid: 'sd-batch-2' }))
      expect(storage.setItem).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(300)
      expect(storage.setItem).toHaveBeenCalledTimes(1)
      expect(storage.dump()).toContain('sd-batch-2')
    } finally {
      vi.useRealTimers()
    }
  })
})

