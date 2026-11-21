import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { Aria2Task } from '@/types/aria2'

type MockService = Record<string, ReturnType<typeof vi.fn>>

const h = vi.hoisted(() => {
  const state = {
    service: null as unknown,
    settings: {
      queue: { retryEnabled: false, retryMaxAttempts: 3, retryDelaySeconds: 30 }
    } as { queue: { retryEnabled?: boolean; retryMaxAttempts?: number; retryDelaySeconds?: number } },
    lists: { active: [] as unknown[], waiting: [] as unknown[], stopped: [] as unknown[] },
    persistedGids: new Set<string>(),
    persistedTasks: new Map<string, unknown>(),
    removedPersisted: [] as string[],
    removedTimes: [] as string[],
    recordedAdds: [] as Array<{ gid: string; name: string }>,
    recordedCompletes: [] as Array<{ gid: string; name: string }>,
    completeTimes: new Map<string, number>(),
    persistedCompleted: [] as Array<{ task: unknown; time: number }>,
    sources: new Map<string, unknown>(),
    sourceRecords: [] as Array<{ gid: string; source: unknown; options?: unknown }>,
    removedSources: [] as string[],
    saveMarked: [] as string[],
    retryMarkers: [] as string[],
    deleteCalls: [] as unknown[][],
    taskFilePaths: [] as string[],
    deleteResult: { success: true, results: [] as Array<{ success: boolean; error?: string }> } as {
      success: boolean
      results: Array<{ success: boolean; error?: string }>
      error?: string
    }
  }
  return { state }
})

vi.mock('@/services/completedTaskDeleteService', () => ({
  completedTaskDeleteService: {
    deleteCompletedTask: (...args: unknown[]) => {
      h.state.deleteCalls.push(args)
      return Promise.resolve(h.state.deleteResult)
    },
    getTaskFilePaths: () => h.state.taskFilePaths
  }
}))

vi.mock('@/services/taskPersistenceService', () => ({
  taskPersistenceService: {
    ensureLoaded: vi.fn(async () => {}),
    isTaskPersisted: (gid: string) => h.state.persistedGids.has(gid),
    getPersistedTask: (gid: string) => h.state.persistedTasks.get(gid) ?? null,
    removePersistedTask: (gid: string) => {
      h.state.removedPersisted.push(gid)
    },
    persistCompletedTask: (task: unknown, time: number) => {
      h.state.persistedCompleted.push({ task, time })
    },
    mergeWithAria2Tasks: (tasks: unknown[]) => tasks
  }
}))

vi.mock('@/services/taskTimeService', () => ({
  taskTimeService: {
    recordTaskAdd: (gid: string, name: string) => {
      h.state.recordedAdds.push({ gid, name })
    },
    recordTaskComplete: (gid: string, name: string) => {
      h.state.recordedCompletes.push({ gid, name })
    },
    getCompleteTime: (gid: string) => h.state.completeTimes.get(gid),
    removeTaskTime: (gid: string) => {
      h.state.removedTimes.push(gid)
    }
  }
}))

vi.mock('@/services/sessionManager', () => ({
  sessionManager: {
    markTaskForSave: (gid: string) => {
      h.state.saveMarked.push(gid)
    }
  }
}))

vi.mock('@/services/taskSourceService', () => ({
  taskSourceService: {
    ensureLoaded: vi.fn(async () => {}),
    record: (gid: string, source: unknown, options?: unknown) => {
      h.state.sources.set(gid, { source, options })
      h.state.sourceRecords.push({ gid, source, options })
    },
    get: (gid: string) => h.state.sources.get(gid),
    remove: (gid: string) => {
      h.state.sources.delete(gid)
      h.state.removedSources.push(gid)
    },
    clear: () => h.state.sources.clear()
  }
}))

vi.mock('./connectionStore', () => ({
  useConnectionStore: () => ({
    get service() {
      return h.state.service
    }
  })
}))

vi.mock('./settingsStore', () => ({
  useSettingsStore: () => ({ settings: h.state.settings })
}))

vi.mock('@/composables/useTrafficMonitor', () => ({
  useTrafficMonitor: () => ({
    recordRetryMarker: (label: string) => {
      h.state.retryMarkers.push(label)
    },
    speedHistory: { value: [] },
    retryMarkers: { value: [] },
    startMonitor: () => {},
    stopMonitor: () => {},
    resetHistory: () => {}
  })
}))

import { useTaskStore } from './taskStore'

function makeTask(
  gid: string,
  status: Aria2Task['status'],
  extra: Record<string, unknown> = {}
): Aria2Task {
  return {
    gid,
    status,
    totalLength: '100',
    completedLength: status === 'complete' ? '100' : '10',
    uploadLength: '0',
    downloadSpeed: '0',
    uploadSpeed: '0',
    connections: '0',
    numSeeders: '0',
    dir: 'D:/Downloads',
    files: [],
    ...extra
  } as unknown as Aria2Task
}

function makeFileTask(gid: string, status: Aria2Task['status'], uri: string): Aria2Task {
  return makeTask(gid, status, {
    files: [
      {
        index: '1',
        path: 'D:/Downloads/file.zip',
        length: '100',
        completedLength: '10',
        selected: 'true',
        uris: [{ uri, status: 'used' }]
      }
    ]
  })
}

function makeService(): MockService {
  const service: MockService = {
    // aria2 的 system.multicall 返回 [[result], [result], ...]：每项再包一层数组
    multicall: vi.fn(async () => [
      [[...h.state.lists.active]],
      [[...h.state.lists.waiting]],
      [[...h.state.lists.stopped]]
    ]),
    tellActive: vi.fn(async () => [...h.state.lists.active]),
    tellWaiting: vi.fn(async () => [...h.state.lists.waiting]),
    tellStopped: vi.fn(async () => [...h.state.lists.stopped]),
    addUri: vi.fn(async () => 'added-gid'),
    addTorrent: vi.fn(async () => 'torrent-gid'),
    addMetalink: vi.fn(async () => ['ml-1', 'ml-2']),
    remove: vi.fn(async () => 'OK'),
    forceRemove: vi.fn(async () => 'OK'),
    removeDownloadResult: vi.fn(async () => 'OK'),
    pause: vi.fn(async () => 'OK'),
    forcePause: vi.fn(async () => 'OK'),
    unpause: vi.fn(async () => 'OK'),
    pauseAll: vi.fn(async () => 'OK'),
    unpauseAll: vi.fn(async () => 'OK'),
    saveSession: vi.fn(async () => 'OK'),
    tellStatus: vi.fn(async () => makeTask('g1', 'error')),
    getOption: vi.fn(async () => ({ dir: 'D:/Downloads', out: 'file.zip' })),
    changePosition: vi.fn(async () => 3),
    on: vi.fn(),
    off: vi.fn()
  }
  h.state.service = service
  return service
}

function resetState(): void {
  h.state.service = null
  h.state.settings = { queue: { retryEnabled: false, retryMaxAttempts: 3, retryDelaySeconds: 30 } }
  h.state.lists = { active: [], waiting: [], stopped: [] }
  h.state.persistedGids.clear()
  h.state.persistedTasks.clear()
  h.state.removedPersisted.length = 0
  h.state.removedTimes.length = 0
  h.state.recordedAdds.length = 0
  h.state.recordedCompletes.length = 0
  h.state.completeTimes.clear()
  h.state.persistedCompleted.length = 0
  h.state.sources.clear()
  h.state.sourceRecords.length = 0
  h.state.removedSources.length = 0
  h.state.saveMarked.length = 0
  h.state.retryMarkers.length = 0
  h.state.deleteCalls.length = 0
  h.state.taskFilePaths = []
  h.state.deleteResult = { success: true, results: [] }
}

function stubWindow(api: Record<string, unknown> | null): void {
  vi.stubGlobal('window', api === null ? {} : { electronAPI: api })
}

beforeEach(() => {
  setActivePinia(createPinia())
  resetState()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('loadAllTasks 全量刷新', () => {
  it('用 system.multicall 一次取回三张列表，并给新出现的活动任务记录添加时间', async () => {
    const service = makeService()
    h.state.lists.active = [makeTask('a1', 'active')]
    h.state.lists.waiting = [makeTask('w1', 'waiting')]
    h.state.lists.stopped = [makeTask('s1', 'error')]
    const store = useTaskStore()

    await store.loadAllTasks()

    expect(service.multicall).toHaveBeenCalledTimes(1)
    expect(store.activeTasks.map(t => t.gid)).toEqual(['a1'])
    expect(store.waitingTasks.map(t => t.gid)).toEqual(['w1'])
    expect(store.stoppedTasks.map(t => t.gid)).toEqual(['s1'])
    expect(h.state.recordedAdds).toEqual([{ gid: 'a1', name: 'a1' }])
  })

  it('waiting 指纹不变时保留旧数组引用，避免每秒轮询触发全量重排', async () => {
    makeService()
    h.state.lists.waiting = [makeTask('w1', 'waiting')]
    const store = useTaskStore()
    await store.loadAllTasks()
    const first = store.waitingTasks

    await store.loadAllTasks()

    expect(store.waitingTasks).toBe(first)
  })

  it('waiting 列表状态变化时换新引用（指纹含状态）', async () => {
    makeService()
    h.state.lists.waiting = [makeTask('w1', 'waiting')]
    const store = useTaskStore()
    await store.loadAllTasks()
    const first = store.waitingTasks

    h.state.lists.waiting = [makeTask('w1', 'paused')]
    await store.loadAllTasks()

    expect(store.waitingTasks).not.toBe(first)
    expect(store.waitingTasks[0]?.status).toBe('paused')
  })

  it('新完成的未持久化任务写完成时间并落盘持久化记录', async () => {
    makeService()
    h.state.lists.stopped = [makeTask('s1', 'complete')]
    const store = useTaskStore()

    await store.loadAllTasks()

    expect(h.state.recordedCompletes).toEqual([{ gid: 's1', name: 's1' }])
    expect(h.state.persistedCompleted).toHaveLength(1)
  })

  it('已持久化的完成任务不重复记录完成时间', async () => {
    makeService()
    h.state.persistedGids.add('s1')
    h.state.lists.stopped = [makeTask('s1', 'complete')]
    const store = useTaskStore()

    await store.loadAllTasks()

    expect(h.state.recordedCompletes).toEqual([])
    expect(h.state.persistedCompleted).toEqual([])
  })

  it('multicall 整体失败时回退三次单请求，单个列表失败只保留旧值', async () => {
    const service = makeService()
    h.state.lists.waiting = [makeTask('w-old', 'waiting')]
    const store = useTaskStore()
    await store.loadAllTasks()

    service.multicall.mockRejectedValueOnce(new Error('multicall boom'))
    service.tellActive.mockResolvedValueOnce([makeTask('a1', 'active')])
    service.tellWaiting.mockRejectedValueOnce(new Error('waiting boom'))
    service.tellStopped.mockResolvedValueOnce([makeTask('s1', 'error')])

    await store.loadAllTasks()

    expect(store.activeTasks.map(t => t.gid)).toEqual(['a1'])
    expect(store.waitingTasks.map(t => t.gid)).toEqual(['w-old'])
    expect(store.stoppedTasks.map(t => t.gid)).toEqual(['s1'])
  })

  it('请求期间连接被清空时，旧响应不写进列表', async () => {
    const service = makeService()
    let release: ((value: unknown) => void) | null = null
    service.multicall.mockImplementationOnce(
      () => new Promise(resolve => {
        release = resolve
      })
    )
    h.state.lists.active = [makeTask('a1', 'active')]
    const store = useTaskStore()

    const pending = store.loadAllTasks()
    for (let i = 0; i < 10 && !release; i++) await Promise.resolve()
    store.clearTasks()
    expect(release).not.toBeNull()
    ;(release as unknown as (value: unknown) => void)([[[makeTask('a1', 'active')]], [[]], [[]]])
    await pending

    expect(store.activeTasks).toEqual([])
  })

  it('并发调用复用同一个进行中的请求，不重复打引擎', async () => {
    const service = makeService()
    const store = useTaskStore()

    await Promise.all([store.loadAllTasks(), store.loadAllTasks(), store.loadAllTasks()])

    expect(service.multicall).toHaveBeenCalledTimes(1)
  })

  it('isLoading 在刷新期间为真，结束后复位', async () => {
    const service = makeService()
    let release: ((value: unknown) => void) | null = null
    service.multicall.mockImplementationOnce(
      () => new Promise(resolve => {
        release = resolve
      })
    )
    const store = useTaskStore()

    const pending = store.loadAllTasks()
    for (let i = 0; i < 10 && !release; i++) await Promise.resolve()
    expect(store.isLoading).toBe(true)
    ;(release as unknown as (value: unknown) => void)([[[]], [[]], [[]]])
    await pending
    expect(store.isLoading).toBe(false)
  })
})

describe('loadLightTasks 轻量刷新', () => {
  it('只拉 active 列表，不动 waiting/stopped', async () => {
    const service = makeService()
    h.state.lists.active = [makeTask('a1', 'active')]
    const store = useTaskStore()

    await store.loadLightTasks()

    expect(service.tellActive).toHaveBeenCalledTimes(1)
    expect(service.tellWaiting).not.toHaveBeenCalled()
    expect(store.activeTasks.map(t => t.gid)).toEqual(['a1'])
  })

  it('并发调用复用同一个轻量请求', async () => {
    const service = makeService()
    const store = useTaskStore()

    await Promise.all([store.loadLightTasks(), store.loadLightTasks()])

    expect(service.tellActive).toHaveBeenCalledTimes(1)
  })

  it('全量刷新在飞时直接复用它，不再叠加一次轻量请求', async () => {
    const service = makeService()
    let release: ((value: unknown) => void) | null = null
    service.multicall.mockImplementationOnce(
      () => new Promise(resolve => {
        release = resolve
      })
    )
    const store = useTaskStore()

    const pending = store.loadAllTasks()
    for (let i = 0; i < 10 && !release; i++) await Promise.resolve()
    const light = store.loadLightTasks()
    await Promise.resolve()
    expect(service.tellActive).not.toHaveBeenCalled()
    ;(release as unknown as (value: unknown) => void)([[[]], [[]], [[]]])
    await Promise.all([pending, light])
  })
})

describe('findDuplicateTasks 提交前查重', () => {
  it('命中进行中任务的同一 URL，完成/出错任务不参与比对', async () => {
    makeService()
    h.state.lists.active = [makeFileTask('a1', 'active', 'https://example.com/a.zip')]
    h.state.lists.stopped = [makeFileTask('s1', 'complete', 'https://example.com/b.zip')]
    const store = useTaskStore()
    await store.loadAllTasks()

    expect(store.findDuplicateTasks(['https://example.com/a.zip']).map(m => m.gid)).toEqual(['a1'])
    expect(store.findDuplicateTasks(['https://example.com/b.zip'])).toEqual([])
  })

  it('磁力任务靠会话索引命中（aria2 不把 magnet 写进 files[].uris）', async () => {
    const service = makeService()
    // 任务必须在 addUri 内部那次刷新时就已存在，否则磁力索引会被当成"已结束任务"清理掉
    h.state.lists.active = [makeTask('mag-1', 'active')]
    const store = useTaskStore()
    service.addUri.mockResolvedValueOnce('mag-1')
    await store.addUri(['magnet:?xt=urn:btih:ABCDEF&dn=file'])

    const matches = store.findDuplicateTasks(['magnet:?xt=urn:btih:abcdef&dn=other'])

    expect(matches.map(m => m.gid)).toEqual(['mag-1'])
  })

  it('任务已不在进行中时磁力索引条目被清理', async () => {
    const service = makeService()
    h.state.lists.active = [makeTask('mag-1', 'active')]
    const store = useTaskStore()
    service.addUri.mockResolvedValueOnce('mag-1')
    await store.addUri(['magnet:?xt=urn:btih:ABCDEF'])
    expect(store.findDuplicateTasks(['magnet:?xt=urn:btih:ABCDEF'])).toHaveLength(1)

    store.clearTasks()
    expect(store.findDuplicateTasks(['magnet:?xt=urn:btih:ABCDEF'])).toEqual([])
  })
})

describe('新建任务', () => {
  it('普通链接直接透传选项，记录来源并立即保存会话', async () => {
    const service = makeService()
    service.addUri.mockResolvedValueOnce('g-new')
    const store = useTaskStore()

    const gid = await store.addUri(['https://example.com/file.zip'], { dir: 'D:/Downloads' })

    expect(gid).toBe('g-new')
    expect(service.addUri).toHaveBeenCalledWith(['https://example.com/file.zip'], { dir: 'D:/Downloads' })
    expect(h.state.sourceRecords[0]).toMatchObject({ gid: 'g-new', source: { kind: 'uri' } })
    expect(h.state.saveMarked).toEqual(['g-new'])
    expect(service.saveSession).toHaveBeenCalledTimes(1)
    expect(h.state.recordedAdds[0]).toEqual({ gid: 'g-new', name: 'file.zip' })
  })

  it('磁力任务强制加 bt-save-metadata，供「保存 .torrent」导出', async () => {
    const service = makeService()
    const store = useTaskStore()

    await store.addUri(['magnet:?xt=urn:btih:ABCDEF'], { dir: 'D:/Downloads' })

    expect(service.addUri).toHaveBeenCalledWith(
      ['magnet:?xt=urn:btih:ABCDEF'],
      { dir: 'D:/Downloads', 'bt-save-metadata': 'true' }
    )
  })

  it('addTorrent 记录种子来源（重试依赖它重建任务）', async () => {
    const service = makeService()
    service.addTorrent.mockResolvedValueOnce('t-1')
    const store = useTaskStore()

    const gid = await store.addTorrent('BASE64', ['https://tracker/announce'], { dir: 'D:/Downloads' })

    expect(gid).toBe('t-1')
    expect(h.state.sourceRecords[0]).toMatchObject({
      gid: 't-1',
      source: { kind: 'torrent', torrent: 'BASE64' }
    })
    expect(h.state.saveMarked).toEqual(['t-1'])
  })

  it('addMetalink 为每个 gid 记录来源', async () => {
    const service = makeService()
    const store = useTaskStore()

    const gids = await store.addMetalink('METALINK')

    expect(gids).toEqual(['ml-1', 'ml-2'])
    expect(h.state.sourceRecords.map(r => r.gid)).toEqual(['ml-1', 'ml-2'])
    expect(service.saveSession).toHaveBeenCalledTimes(1)
  })

  it('未连接时新建任务直接抛错，不静默失败', async () => {
    const store = useTaskStore()

    await expect(store.addUri(['https://example.com/a.zip'])).rejects.toThrow('Not connected')
    await expect(store.addTorrent('BASE64')).rejects.toThrow('Not connected')
    await expect(store.addMetalink('METALINK')).rejects.toThrow('Not connected')
  })
})

describe('moveInQueue 等待队列排序', () => {
  it.each([
    ['up', -1, 'POS_CUR'],
    ['down', 1, 'POS_CUR'],
    ['top', 0, 'POS_SET']
  ] as const)('%s → changePosition(%i, %s)', async (direction, pos, how) => {
    const service = makeService()
    service.changePosition.mockResolvedValueOnce(7)
    const store = useTaskStore()

    const newPos = await store.moveInQueue('w1', direction)

    expect(newPos).toBe(7)
    expect(service.changePosition).toHaveBeenCalledWith('w1', pos, how)
  })

  it('bottom 用 POS_END 直接沉底', async () => {
    const service = makeService()
    const store = useTaskStore()

    await store.moveInQueue('w1', 'bottom')

    expect(service.changePosition).toHaveBeenCalledWith('w1', 0, 'POS_END')
  })

  it('未连接时抛错', async () => {
    const store = useTaskStore()

    await expect(store.moveInQueue('w1', 'up')).rejects.toThrow('Not connected')
  })
})

describe('retryErrorTask 失败重试', () => {
  it('种子来源用 addTorrent 重建，并把来源迁移到新 gid', async () => {
    const service = makeService()
    h.state.sources.set('g1', {
      source: { kind: 'torrent', torrent: 'BASE64', uris: ['https://tracker'] },
      options: { out: 'file.zip' }
    })
    const store = useTaskStore()

    const newGid = await store.retryErrorTask('g1')

    expect(newGid).toBe('torrent-gid')
    expect(service.addTorrent).toHaveBeenCalledWith('BASE64', ['https://tracker'], { out: 'file.zip' })
    expect(h.state.sources.get('torrent-gid')).toMatchObject({ source: { kind: 'torrent' } })
    expect(h.state.removedSources).toContain('g1')
  })

  it('metalink 来源取第一个 gid', async () => {
    const service = makeService()
    h.state.sources.set('g1', { source: { kind: 'metalink', metalink: 'META' } })
    const store = useTaskStore()

    await expect(store.retryErrorTask('g1')).resolves.toBe('ml-1')
    expect(service.addMetalink).toHaveBeenCalledWith('META', { dir: 'D:/Downloads', out: 'file.zip' })
  })

  it('URI 来源用原始链接重建', async () => {
    const service = makeService()
    h.state.sources.set('g1', {
      source: { kind: 'uri', uris: ['https://example.com/a.zip'] },
      options: { dir: 'D:/Other' }
    })
    const store = useTaskStore()

    await store.retryErrorTask('g1')

    expect(service.addUri).toHaveBeenCalledWith(['https://example.com/a.zip'], { dir: 'D:/Other' })
  })

  it('没有原始来源但能拿到 infoHash 时用磁力链接兜底', async () => {
    const service = makeService()
    service.tellStatus.mockResolvedValueOnce(makeTask('g1', 'error', { infoHash: 'ABCDEF0123' }))
    const store = useTaskStore()

    await store.retryErrorTask('g1')

    expect(service.addUri).toHaveBeenCalledWith(
      ['magnet:?xt=urn:btih:ABCDEF0123'],
      expect.objectContaining({ dir: 'D:/Downloads' })
    )
  })

  it('既无来源也无 URI 时抛错，且不动旧任务', async () => {
    const service = makeService()
    service.tellStatus.mockResolvedValueOnce(makeTask('g1', 'error'))
    const store = useTaskStore()

    await expect(store.retryErrorTask('g1')).rejects.toThrow('No URIs found')
    expect(service.forceRemove).not.toHaveBeenCalled()
  })

  it('透传原选项时剔除 gid（aria2 不允许 addUri 指定 gid）', async () => {
    const service = makeService()
    service.tellStatus.mockResolvedValueOnce(
      makeFileTask('g1', 'error', 'https://example.com/a.zip')
    )
    service.getOption.mockResolvedValueOnce({ gid: 'g1', out: 'a.zip', split: '16' })
    const store = useTaskStore()

    await store.retryErrorTask('g1')

    const options = service.addUri.mock.calls[0]?.[1] as Record<string, unknown>
    expect(options).not.toHaveProperty('gid')
    expect(options).toMatchObject({ out: 'a.zip', split: '16' })
  })

  it('先建新任务成功，再删旧任务（失败时不丢重试入口）', async () => {
    const service = makeService()
    h.state.sources.set('g1', { source: { kind: 'uri', uris: ['https://example.com/a.zip'] } })
    const store = useTaskStore()

    await store.retryErrorTask('g1')

    const addOrder = service.addUri.mock.invocationCallOrder[0] ?? 0
    const removeOrder = service.forceRemove.mock.invocationCallOrder[0] ?? 0
    expect(addOrder).toBeLessThan(removeOrder)
    expect(service.removeDownloadResult).toHaveBeenCalledWith('g1')
    expect(h.state.removedPersisted).toContain('g1')
    expect(h.state.removedTimes).toContain('g1')
  })

  it('新任务创建失败时不删旧任务', async () => {
    const service = makeService()
    service.addUri.mockRejectedValueOnce(new Error('engine down'))
    h.state.sources.set('g1', { source: { kind: 'uri', uris: ['https://example.com/a.zip'] } })
    const store = useTaskStore()

    await expect(store.retryErrorTask('g1')).rejects.toThrow('engine down')
    expect(service.forceRemove).not.toHaveBeenCalled()
  })
})

describe('队列失败自动重试', () => {
  it('刚从下载中变 error 的任务到点自动重试一次并打标记', async () => {
    vi.useFakeTimers()
    const service = makeService()
    h.state.settings.queue = { retryEnabled: true, retryMaxAttempts: 3, retryDelaySeconds: 30 }
    h.state.sources.set('g1', { source: { kind: 'uri', uris: ['https://example.com/a.zip'] } })
    h.state.lists.active = [makeTask('g1', 'active')]
    const store = useTaskStore()
    await store.loadAllTasks()

    h.state.lists.active = []
    h.state.lists.stopped = [makeTask('g1', 'error')]
    await store.loadAllTasks()
    expect(service.addUri).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(30000)

    expect(service.addUri).toHaveBeenCalledTimes(1)
    expect(h.state.retryMarkers).toEqual(['g1 #1'])
  })

  it('启动时加载到的历史失败任务不重试', async () => {
    vi.useFakeTimers()
    const service = makeService()
    h.state.settings.queue = { retryEnabled: true, retryMaxAttempts: 3, retryDelaySeconds: 30 }
    h.state.lists.stopped = [makeTask('s-old', 'error')]
    const store = useTaskStore()

    await store.loadAllTasks()
    await vi.advanceTimersByTimeAsync(60000)

    expect(service.addUri).not.toHaveBeenCalled()
  })

  it('未开启自动重试时不排定时器', async () => {
    vi.useFakeTimers()
    const service = makeService()
    h.state.lists.active = [makeTask('g1', 'active')]
    const store = useTaskStore()
    await store.loadAllTasks()
    h.state.lists.active = []
    h.state.lists.stopped = [makeTask('g1', 'error')]

    await store.loadAllTasks()
    await vi.advanceTimersByTimeAsync(60000)

    expect(service.addUri).not.toHaveBeenCalled()
  })

  it('达到最大次数后不再重试（计数随新 gid 继承）', async () => {
    vi.useFakeTimers()
    const service = makeService()
    h.state.settings.queue = { retryEnabled: true, retryMaxAttempts: 1, retryDelaySeconds: 10 }
    h.state.sources.set('g1', { source: { kind: 'uri', uris: ['https://example.com/a.zip'] } })
    h.state.sources.set('added-gid', { source: { kind: 'uri', uris: ['https://example.com/a.zip'] } })
    h.state.lists.active = [makeTask('g1', 'active')]
    const store = useTaskStore()
    await store.loadAllTasks()

    h.state.lists.active = []
    h.state.lists.stopped = [makeTask('g1', 'error')]
    await store.loadAllTasks()
    await vi.advanceTimersByTimeAsync(10000)
    expect(service.addUri).toHaveBeenCalledTimes(1)

    // 重试产物 g2 再次失败：此时 attempts 已继承为 1，等于上限，不再重试
    h.state.lists.active = [makeTask('added-gid', 'active')]
    h.state.lists.stopped = []
    await store.loadAllTasks()
    h.state.lists.active = []
    h.state.lists.stopped = [makeTask('added-gid', 'error')]
    await store.loadAllTasks()
    await vi.advanceTimersByTimeAsync(10000)

    expect(service.addUri).toHaveBeenCalledTimes(1)
  })
})

describe('removeTask 活动任务路径', () => {
  it('活动任务先 forceRemove 释放句柄，再删文件与引擎记录', async () => {
    const service = makeService()
    const deleteFiles = vi.fn(async () => ({ success: true, results: [{ success: true }] }))
    stubWindow({ deleteFiles })
    h.state.lists.active = [makeFileTask('a1', 'active', 'https://example.com/a.zip')]
    h.state.taskFilePaths = ['D:/Downloads/a.zip']
    const store = useTaskStore()
    await store.loadAllTasks()
    // 引擎侧任务已被删掉：后续那次刷新不应再把它拉回来
    h.state.lists.active = []

    await store.removeTask('a1', true)

    expect(service.forceRemove).toHaveBeenCalledWith('a1')
    expect(deleteFiles).toHaveBeenCalledWith(['D:/Downloads/a.zip'], 'D:/Downloads')
    expect(service.removeDownloadResult).toHaveBeenCalledWith('a1')
    expect(store.activeTasks).toEqual([])
    expect(h.state.removedPersisted).toContain('a1')
  })

  it('forceRemove 失败但任务已不存在时继续清理', async () => {
    const service = makeService()
    service.forceRemove.mockRejectedValueOnce(new Error('GID not found'))
    service.tellStatus.mockRejectedValueOnce(new Error('GID not found'))
    h.state.lists.waiting = [makeTask('w1', 'waiting')]
    const store = useTaskStore()
    await store.loadAllTasks()

    await store.removeTask('w1')

    expect(h.state.removedPersisted).toContain('w1')
    expect(store.waitingTasks).toEqual([])
  })

  it('forceRemove 失败且任务仍在时抛错，不继续删记录', async () => {
    const service = makeService()
    service.forceRemove.mockRejectedValueOnce(new Error('busy'))
    service.tellStatus.mockResolvedValueOnce(makeTask('w1', 'waiting'))
    h.state.lists.waiting = [makeTask('w1', 'waiting')]
    const store = useTaskStore()
    await store.loadAllTasks()

    await expect(store.removeTask('w1')).rejects.toThrow('停止任务失败')
    expect(h.state.removedPersisted).toEqual([])
  })

  it('文件删除失败时抛错并保留任务记录，用户可重试', async () => {
    const service = makeService()
    const deleteFiles = vi.fn(async () => ({ success: false, results: [{ success: false, error: 'EBUSY' }] }))
    stubWindow({ deleteFiles })
    h.state.lists.active = [makeFileTask('a1', 'active', 'https://example.com/a.zip')]
    h.state.taskFilePaths = ['D:/Downloads/a.zip']
    const store = useTaskStore()
    await store.loadAllTasks()

    await expect(store.removeTask('a1', true)).rejects.toThrow('文件删除失败: EBUSY')
    expect(h.state.removedPersisted).toEqual([])
    expect(service.removeDownloadResult).not.toHaveBeenCalled()
  })
})

describe('其余操作', () => {
  it('未连接时暂停全部/继续全部静默返回，不抛错', async () => {
    const store = useTaskStore()

    await expect(store.pauseAllTasks()).resolves.toBeUndefined()
    await expect(store.unpauseAllTasks()).resolves.toBeUndefined()
  })

  it('已连接时暂停全部/继续全部打到引擎并刷新', async () => {
    const service = makeService()
    const store = useTaskStore()

    await store.pauseAllTasks()
    await store.unpauseAllTasks()

    expect(service.pauseAll).toHaveBeenCalledTimes(1)
    expect(service.unpauseAll).toHaveBeenCalledTimes(1)
    expect(service.multicall).toHaveBeenCalledTimes(2)
  })

  it('pauseTask 默认用 pause，force 时用 forcePause', async () => {
    const service = makeService()
    const store = useTaskStore()

    await store.pauseTask('g1')
    await store.pauseTask('g1', true)

    expect(service.pause).toHaveBeenCalledWith('g1')
    expect(service.forcePause).toHaveBeenCalledWith('g1')
  })

  it('exportTorrent 在没有主进程通道时返回 not_available', async () => {
    makeService()
    stubWindow({})
    const store = useTaskStore()

    await expect(store.exportTorrent('g1')).resolves.toEqual({ success: false, error: 'not_available' })
  })

  it('exportTorrent 有通道时透传结果', async () => {
    makeService()
    const exportTaskTorrent = vi.fn(async () => ({ success: true, path: 'D:/a.torrent' }))
    stubWindow({ exportTaskTorrent })
    const store = useTaskStore()

    await expect(store.exportTorrent('g1')).resolves.toEqual({ success: true, path: 'D:/a.torrent' })
    expect(exportTaskTorrent).toHaveBeenCalledWith('g1')
  })

  it('clearTasks 清空三张列表并让进行中的刷新失效', async () => {
    makeService()
    h.state.lists.active = [makeTask('a1', 'active')]
    h.state.lists.waiting = [makeTask('w1', 'waiting')]
    h.state.lists.stopped = [makeTask('s1', 'error')]
    const store = useTaskStore()
    await store.loadAllTasks()

    store.clearTasks()

    expect(store.allTasks).toEqual([])
    expect(store.totalTasks).toBe(0)
    expect(store.isLoading).toBe(false)
  })

  it('下载完成事件先刷新再回调，并把事件转给插件系统', async () => {
    const service = makeService()
    const notifyDownloadEvent = vi.fn()
    stubWindow({ notifyDownloadEvent })
    h.state.lists.stopped = [makeTask('s1', 'complete', { files: [{ index: '1', path: 'D:/Downloads/s1.zip', length: '1', completedLength: '1', selected: 'true', uris: [] }] })]
    const store = useTaskStore()
    const callback = vi.fn()
    store.onDownloadComplete(callback)
    // 先按 downloadEvents 批量注册 handleDownloadEvent，随后 off 掉再换成 handleDownloadComplete，
    // 所以同一个事件名有两条注册记录，要取最后一条。
    const listener = service.on.mock.calls.filter(call => call[0] === 'downloadComplete').pop()?.[1] as
      | ((event: unknown) => Promise<void>)
      | undefined
    expect(listener).toBeTypeOf('function')

    await listener?.({ gid: 's1' })

    expect(callback).toHaveBeenCalledWith('s1')
    expect(notifyDownloadEvent).toHaveBeenCalledWith('downloadComplete', 's1', 's1.zip')
  })

  it('退订后不再收到下载完成回调', async () => {
    const service = makeService()
    stubWindow({})
    const store = useTaskStore()
    const callback = vi.fn()
    const off = store.onDownloadComplete(callback)
    off()
    const listener = service.on.mock.calls.find(call => call[0] === 'downloadComplete')?.[1] as
      | ((event: unknown) => Promise<void>)
      | undefined

    await listener?.({ gid: 's1' })

    expect(callback).not.toHaveBeenCalled()
  })
})
