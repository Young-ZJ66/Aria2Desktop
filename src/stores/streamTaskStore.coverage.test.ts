import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { StreamDownloadEvent } from '@/types/electron'
import { STREAM_TASK_STORAGE_KEY, streamTaskPersistence } from '@/services/streamTaskPersistenceService'
import { useStreamTaskStore } from './streamTaskStore'

/**
 * streamTaskStore 的失败与降级分支补充单测。
 *
 * 既有 streamTaskStore.test.ts 覆盖正常链路与持久化；这里专攻「旧 preload / 进程刚退出
 * / 事件先于 IPC 回包」这类真实会遇到的时序：IPC 通道缺失、状态已被事件改过、
 * 删除文件时单条抛错，以及完成事件缺少单文件路径时的展示名兜底。
 */
function stubLocalStorage(initial?: string): { dump: () => string | null } {
  let value: string | null = initial ?? null
  const storage = {
    getItem: (key: string) => (key === STREAM_TASK_STORAGE_KEY ? value : null),
    setItem: (key: string, next: string) => { if (key === STREAM_TASK_STORAGE_KEY) value = next },
    removeItem: (key: string) => { if (key === STREAM_TASK_STORAGE_KEY) value = null }
  }
  vi.stubGlobal('localStorage', storage)
  return { dump: () => value }
}

let emit: ((event: StreamDownloadEvent) => void) | null = null

function installApi(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const api: Record<string, unknown> = {
    streamDownloadStart: vi.fn(async () => ({ success: true, id: 'sd-test-1' })),
    streamDownloadCancel: vi.fn(async () => true),
    streamDownloadDiscard: vi.fn(async () => true),
    streamDownloadPause: vi.fn(async () => true),
    streamDownloadResume: vi.fn(async () => true),
    streamDownloadDeleteFile: vi.fn(async () => ({ success: true })),
    onStreamDownloadEvent: vi.fn((callback: (event: StreamDownloadEvent) => void) => {
      emit = callback
      return () => { emit = null }
    }),
    ...overrides
  }
  for (const [key, value] of Object.entries(api)) if (value === undefined) delete api[key]
  vi.stubGlobal('window', { electronAPI: api })
  return api
}

function makeTask(store: ReturnType<typeof useStreamTaskStore>, gid: string, patch: Record<string, unknown> = {}): void {
  store.tasks.push({
    gid,
    url: 'https://example.com/video',
    formatId: '30080',
    merge: true,
    outputDir: 'D:/Downloads',
    title: '测试视频',
    status: 'active',
    percent: 10,
    speedBytes: 1024,
    speedText: '1.00 KiB/s',
    eta: '00:10',
    totalBytes: 1_000_000,
    downloadedBytes: 100_000,
    createdAt: 1_700_000_000_000,
    ...patch
  } as never)
}

beforeEach(() => {
  setActivePinia(createPinia())
  emit = null
  stubLocalStorage()
  streamTaskPersistence.clear()
  installApi()
})

afterEach(() => {
  streamTaskPersistence.clear()
  vi.unstubAllGlobals()
})

describe('streamTaskStore：聚合值与启动兜底', () => {
  it('activeSpeedBytes 只累加进行中任务，activeCount 只数进行中', () => {
    const store = useStreamTaskStore()
    makeTask(store, 'a', { status: 'active', speedBytes: 1000 })
    makeTask(store, 'b', { status: 'active', speedBytes: 500 })
    makeTask(store, 'c', { status: 'paused', speedBytes: 9999 })
    makeTask(store, 'd', { status: 'complete', speedBytes: 8888 })
    expect(store.activeSpeedBytes).toBe(1500)
    expect(store.activeCount).toBe(2)
  })

  it('缺少 streamDownloadStart 通道时返回 Not available', async () => {
    installApi({ streamDownloadStart: undefined })
    const store = useStreamTaskStore()
    await expect(store.startTask({ url: 'https://e.com/v', formatId: '1', merge: true, outputDir: 'D:/D', title: 't' }))
      .resolves.toEqual({ success: false, error: 'Not available' })
  })
})

describe('streamTaskStore：事件与记录的时序', () => {
  it('未知 gid 的进度事件被忽略', () => {
    const store = useStreamTaskStore()
    emit!({ type: 'progress', id: 'unknown', percent: 50 } as StreamDownloadEvent)
    expect(store.tasks).toHaveLength(0)
  })

  it('完成事件只给 filePaths 时用首个文件补 filePath，标题为空则用文件名', () => {
    const store = useStreamTaskStore()
    makeTask(store, 'sd-1', { title: '', url: 'https://example.com/video' })
    emit!({
      type: 'completed',
      id: 'sd-1',
      filePaths: ['D:/Downloads/最终名称.mp4', 'D:/Downloads/最终名称.srt']
    } as StreamDownloadEvent)
    const task = store.findByGid('sd-1')!
    expect(task.status).toBe('complete')
    expect(task.filePath).toBe('D:/Downloads/最终名称.mp4')
    expect(task.filePaths).toEqual(['D:/Downloads/最终名称.mp4', 'D:/Downloads/最终名称.srt'])
    expect(task.title).toBe('最终名称.mp4')
  })

  it('完成事件没有任何输出文件时标题保持原样', () => {
    const store = useStreamTaskStore()
    makeTask(store, 'sd-2', { title: '', url: 'https://example.com/video' })
    emit!({ type: 'completed', id: 'sd-2' } as StreamDownloadEvent)
    const task = store.findByGid('sd-2')!
    expect(task.filePath).toBeUndefined()
    expect(task.title).toBe('')
  })
})

describe('streamTaskStore：旧 preload 与状态竞态', () => {
  it('缺少 cancel 通道时取消返回 false', async () => {
    installApi({ streamDownloadCancel: undefined })
    const store = useStreamTaskStore()
    await expect(store.cancelTask('sd-1')).resolves.toBe(false)
  })

  it('取消成功时透传主进程结果', async () => {
    installApi({ streamDownloadCancel: vi.fn(async () => false) })
    const store = useStreamTaskStore()
    await expect(store.cancelTask('sd-1')).resolves.toBe(false)
  })

  it('暂停：任务不存在或无通道时返回 false', async () => {
    const store = useStreamTaskStore()
    await expect(store.pauseTask('missing')).resolves.toBe(false)
    makeTask(store, 'sd-1')
    installApi({ streamDownloadPause: undefined })
    await expect(store.pauseTask('sd-1')).resolves.toBe(false)
  })

  it('暂停：已是 paused 直接成功，不重复调用主进程', async () => {
    const store = useStreamTaskStore()
    makeTask(store, 'sd-1', { status: 'paused' })
    const api = installApi()
    await expect(store.pauseTask('sd-1')).resolves.toBe(true)
    expect(api.streamDownloadPause).not.toHaveBeenCalled()
  })

  it('暂停：非进行中任务返回 false', async () => {
    const store = useStreamTaskStore()
    makeTask(store, 'sd-1', { status: 'complete' })
    await expect(store.pauseTask('sd-1')).resolves.toBe(false)
  })

  it('暂停：主进程回包前事件已改成 paused 时不再重复改状态', async () => {
    const store = useStreamTaskStore()
    makeTask(store, 'sd-1')
    installApi({
      streamDownloadPause: vi.fn(async () => {
        emit!({ type: 'paused', id: 'sd-1' } as StreamDownloadEvent)
        return true
      })
    })
    await expect(store.pauseTask('sd-1')).resolves.toBe(true)
    expect(store.findByGid('sd-1')!.status).toBe('paused')
  })

  it('暂停：主进程返回 false 但事件已把状态改成 paused 时以界面为准', async () => {
    const store = useStreamTaskStore()
    makeTask(store, 'sd-1')
    installApi({
      streamDownloadPause: vi.fn(async () => {
        emit!({ type: 'paused', id: 'sd-1' } as StreamDownloadEvent)
        return false
      })
    })
    await expect(store.pauseTask('sd-1')).resolves.toBe(true)
  })

  it('继续：任务不存在、状态不是 paused、缺通道都返回 false', async () => {
    const store = useStreamTaskStore()
    await expect(store.resumeTask('missing')).resolves.toBe(false)
    makeTask(store, 'sd-active', { status: 'active' })
    await expect(store.resumeTask('sd-active')).resolves.toBe(false)
    makeTask(store, 'sd-paused', { status: 'paused' })
    installApi({ streamDownloadResume: undefined })
    await expect(store.resumeTask('sd-paused')).resolves.toBe(false)
  })

  it('继续成功后任务回到进行中', async () => {
    const store = useStreamTaskStore()
    makeTask(store, 'sd-1', { status: 'paused' })
    await expect(store.resumeTask('sd-1')).resolves.toBe(true)
    expect(store.findByGid('sd-1')!.status).toBe('active')
  })

  it('恢复全部：单条失败只计数不影响其余', async () => {
    const store = useStreamTaskStore()
    makeTask(store, 'sd-ok', { status: 'paused' })
    makeTask(store, 'sd-bad', { status: 'paused' })
    installApi({
      streamDownloadResume: vi.fn(async (gid: string) => gid === 'sd-ok')
    })
    await expect(store.resumeAllTasks()).resolves.toEqual({ resumed: 1, failed: 1 })
  })
})

describe('streamTaskStore：删除与重试的失败分支', () => {
  it('删除不存在的任务返回 Task not found', async () => {
    const store = useStreamTaskStore()
    await expect(store.removeTask('missing')).resolves.toEqual({ success: false, error: 'Task not found' })
  })

  it('进行中任务取消失败时保留记录', async () => {
    const store = useStreamTaskStore()
    makeTask(store, 'sd-1')
    installApi({ streamDownloadDiscard: vi.fn(async () => false) })
    await expect(store.removeTask('sd-1')).resolves.toEqual({ success: false, error: 'Cancel failed' })
    expect(store.findByGid('sd-1')).toBeDefined()
  })

  it('旧 preload 没有 discard 时退回 cancel 通道', async () => {
    const store = useStreamTaskStore()
    makeTask(store, 'sd-1')
    const api = installApi({ streamDownloadDiscard: undefined })
    await expect(store.removeTask('sd-1')).resolves.toEqual({ success: true })
    expect(api.streamDownloadCancel).toHaveBeenCalledWith('sd-1')
    expect(store.findByGid('sd-1')).toBeUndefined()
  })

  it('删除文件时单条抛错只汇总错误并保留记录', async () => {
    const store = useStreamTaskStore()
    makeTask(store, 'sd-1', {
      status: 'complete',
      filePath: 'D:/Downloads/a.mp4',
      filePaths: ['D:/Downloads/a.mp4']
    })
    installApi({
      streamDownloadDeleteFile: vi.fn(async () => { throw new Error('EBUSY: 文件被占用') })
    })
    await expect(store.removeTask('sd-1', true)).resolves.toEqual({ success: false, error: 'EBUSY: 文件被占用' })
    expect(store.findByGid('sd-1')).toBeDefined()
  })

  it('删除文件时主进程返回失败只汇总错误串', async () => {
    const store = useStreamTaskStore()
    makeTask(store, 'sd-1', {
      status: 'complete',
      filePath: 'D:/Downloads/a.mp4',
      filePaths: ['D:/Downloads/a.mp4']
    })
    installApi({ streamDownloadDeleteFile: vi.fn(async () => ({ success: false, error: 'not allowed' })) })
    await expect(store.removeTask('sd-1', true)).resolves.toEqual({ success: false, error: 'not allowed' })
  })

  it('重试不存在的任务返回 Task not found', async () => {
    const store = useStreamTaskStore()
    await expect(store.retryTask('missing')).resolves.toEqual({ success: false, error: 'Task not found' })
  })
})

describe('streamTaskStore：启动时恢复持久化记录', () => {
  it('上次运行遗留的进行中任务恢复为可重试的错误态', () => {
    stubLocalStorage(JSON.stringify({
      schemaVersion: 1,
      tasks: [
        { gid: 'sd-old-1', url: 'https://example.com/a', status: 'active', createdAt: 1_700_000_000_000 },
        { gid: 'sd-old-2', url: 'https://example.com/b', status: 'complete', createdAt: 1_700_000_100_000 }
      ]
    }))

    const store = useStreamTaskStore()

    expect(store.tasks.map((task) => task.gid)).toEqual(['sd-old-1', 'sd-old-2'])
    expect(store.findByGid('sd-old-1')?.status).toBe('error')
    expect(store.findByGid('sd-old-1')?.error).toBeTruthy()
    expect(store.findByGid('sd-old-2')?.status).toBe('complete')
  })

  it('持久化里没有可识别记录时不改动任务列表', () => {
    stubLocalStorage(JSON.stringify({ schemaVersion: 1, tasks: [{ gid: 'bad' }, null, 42] }))

    const store = useStreamTaskStore()

    expect(store.tasks).toEqual([])
  })
})
