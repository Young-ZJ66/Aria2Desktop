import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { Aria2Task } from '@/types/aria2'

// taskStore 在模块顶层 import 这些单例，依赖与连接都要在 hoisted 区准备好
const mocks = vi.hoisted(() => ({
  deleteCompletedTask: vi.fn(),
  removedPersistedGids: [] as string[],
  removedTimeGids: [] as string[],
  persistedGids: new Set<string>(),
  persistedTasks: new Map<string, unknown>(),
  service: {
    tellActive: vi.fn(async () => []),
    tellWaiting: vi.fn(async () => []),
    tellStopped: vi.fn(async () => []),
    addUri: vi.fn(async () => 'g1'),
    removeDownloadResult: vi.fn(async () => {}),
    forceRemove: vi.fn(async () => {}),
    saveSession: vi.fn(async () => {}),
    on: vi.fn(),
    off: vi.fn()
  }
}))

vi.mock('@/services/completedTaskDeleteService', () => ({
  completedTaskDeleteService: {
    deleteCompletedTask: (...args: unknown[]) => mocks.deleteCompletedTask(...args),
    getTaskFilePaths: vi.fn(() => [])
  }
}))

vi.mock('@/services/taskPersistenceService', () => ({
  taskPersistenceService: {
    ensureLoaded: vi.fn(async () => {}),
    isTaskPersisted: (gid: string) => mocks.persistedGids.has(gid),
    getPersistedTask: (gid: string) => mocks.persistedTasks.get(gid) ?? null,
    removePersistedTask: (gid: string) => {
      mocks.removedPersistedGids.push(gid)
    },
    persistCompletedTask: vi.fn(),
    mergeWithAria2Tasks: (tasks: unknown[]) => tasks
  }
}))

vi.mock('@/services/taskTimeService', () => ({
  taskTimeService: {
    recordTaskAdd: vi.fn(),
    recordTaskComplete: vi.fn(),
    getCompleteTime: vi.fn(() => undefined),
    removeTaskTime: (gid: string) => {
      mocks.removedTimeGids.push(gid)
    }
  }
}))

vi.mock('@/services/sessionManager', () => ({
  sessionManager: { markTaskForSave: vi.fn() }
}))

vi.mock('@/services/taskSourceService', () => ({
  taskSourceService: { record: vi.fn() }
}))

vi.mock('./connectionStore', () => ({
  useConnectionStore: () => ({ service: mocks.service })
}))

import { useTaskStore } from './taskStore'

function makeCompletedTask(gid: string): Aria2Task {
  return {
    gid,
    status: 'complete',
    totalLength: '100',
    completedLength: '100',
    uploadLength: '0',
    downloadSpeed: '0',
    uploadSpeed: '0',
    connections: '0',
    numSeeders: '0',
    dir: 'D:/Downloads',
    files: []
  } as Aria2Task
}

function makeDeleteResult(success: boolean, errors: string[] = []) {
  return { success, taskId: 'g1', taskName: 'file.zip', filesDeleted: 0, errors }
}

describe('taskStore.removeTask 的持久化任务分支', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mocks.deleteCompletedTask.mockReset()
    mocks.deleteCompletedTask.mockResolvedValue(makeDeleteResult(true))
    mocks.removedPersistedGids.length = 0
    mocks.removedTimeGids.length = 0
    mocks.persistedGids.clear()
    mocks.persistedTasks.clear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('回归核心：不删文件也要清引擎记录（deleteCompletedTask 必须带上 service）', async () => {
    const task = makeCompletedTask('g1')
    mocks.persistedGids.add('g1')
    mocks.persistedTasks.set('g1', task)
    const store = useTaskStore()

    await store.removeTask('g1', false)

    // 修复前走 else 分支只清本地记录，引擎的 stopped 记录原样保留 → 任务下次刷新又回来
    expect(mocks.deleteCompletedTask).toHaveBeenCalledWith(task, false, mocks.service)
  })

  it('勾选删除文件时同样走删除服务', async () => {
    const task = makeCompletedTask('g1')
    mocks.persistedGids.add('g1')
    mocks.persistedTasks.set('g1', task)
    const store = useTaskStore()

    await store.removeTask('g1', true)

    expect(mocks.deleteCompletedTask).toHaveBeenCalledWith(task, true, mocks.service)
  })

  it('引擎拒绝时向上抛错，且不清本地持久化记录（可重试）', async () => {
    mocks.persistedGids.add('g1')
    mocks.persistedTasks.set('g1', makeCompletedTask('g1'))
    mocks.deleteCompletedTask.mockResolvedValue(makeDeleteResult(false, ['删除任务记录失败: RPC Error']))
    const store = useTaskStore()

    await expect(store.removeTask('g1', false)).rejects.toThrow('删除任务记录失败: RPC Error')
    expect(mocks.removedPersistedGids).not.toContain('g1')
    expect(mocks.removedTimeGids).not.toContain('g1')
  })

  it('持久化记录已被别处清理时退回纯本地清理', async () => {
    mocks.persistedGids.add('g1')
    // 注意：persistedTasks 里没有 g1（竞态）
    const store = useTaskStore()

    await expect(store.removeTask('g1', false)).resolves.toBe(true)
    expect(mocks.deleteCompletedTask).not.toHaveBeenCalled()
    expect(mocks.removedPersistedGids).toContain('g1')
    expect(mocks.removedTimeGids).toContain('g1')
  })

  it('删除成功后触发一次全量刷新（列表与引擎同步）', async () => {
    mocks.persistedGids.add('g1')
    mocks.persistedTasks.set('g1', makeCompletedTask('g1'))
    const store = useTaskStore()

    await store.removeTask('g1', false)

    expect(mocks.service.tellStopped).toHaveBeenCalled()
  })
})

describe('taskStore.addUriBatch 多 URL 独立任务', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mocks.service.addUri.mockReset()
    mocks.service.addUri.mockResolvedValue('g1')
    mocks.service.saveSession.mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('每个 URI 单独调用 addUri([uri])，不再把多 URI 当作镜像', async () => {
    mocks.service.addUri
      .mockResolvedValueOnce('g1')
      .mockResolvedValueOnce('g2')
      .mockResolvedValueOnce('g3')
    const store = useTaskStore()

    const result = await store.addUriBatch([
      { requestId: '1', uri: 'https://example.com/a.zip', options: { dir: 'D:/Downloads' } },
      { requestId: '2', uri: 'https://example.com/b.zip', options: { dir: 'D:/Downloads' } },
      { requestId: '3', uri: 'https://example.com/c.zip', options: { dir: 'D:/Downloads' } }
    ])

    expect(mocks.service.addUri).toHaveBeenCalledTimes(3)
    expect(mocks.service.addUri).toHaveBeenNthCalledWith(1, ['https://example.com/a.zip'], { dir: 'D:/Downloads' })
    expect(mocks.service.addUri).toHaveBeenNthCalledWith(2, ['https://example.com/b.zip'], { dir: 'D:/Downloads' })
    expect(mocks.service.addUri).toHaveBeenNthCalledWith(3, ['https://example.com/c.zip'], { dir: 'D:/Downloads' })
    expect(result.added.map(item => item.gid)).toEqual(['g1', 'g2', 'g3'])
    expect(result.failed).toEqual([])
    expect(mocks.service.saveSession).toHaveBeenCalledTimes(1)
  })

  it('单项失败不中断其余项，并回传失败行的 requestId', async () => {
    mocks.service.addUri
      .mockResolvedValueOnce('g1')
      .mockRejectedValueOnce(new Error('RPC failed'))
      .mockResolvedValueOnce('g3')
    const store = useTaskStore()

    const result = await store.addUriBatch([
      { requestId: '1', uri: 'https://example.com/a.zip' },
      { requestId: '2', uri: 'https://example.com/b.zip' },
      { requestId: '3', uri: 'https://example.com/c.zip' }
    ])

    expect(result.added.map(item => item.gid)).toEqual(['g1', 'g3'])
    expect(result.failed).toEqual([
      { requestId: '2', uri: 'https://example.com/b.zip', error: 'RPC failed' }
    ])
  })

  it('磁力任务逐项保留 bt-save-metadata 语义', async () => {
    const store = useTaskStore()

    await store.addUriBatch([
      { requestId: '1', uri: 'magnet:?xt=urn:btih:abc' }
    ])

    expect(mocks.service.addUri).toHaveBeenCalledWith(
      ['magnet:?xt=urn:btih:abc'],
      { 'bt-save-metadata': 'true' }
    )
  })
})
