import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { Aria2Task } from '@/types/aria2'

type Handler = (payload?: unknown) => void

const h = vi.hoisted(() => {
  const state = {
    conn: null as null | { service: unknown },
    settings: {
      queue: { retryEnabled: false, retryMaxAttempts: 3, retryDelaySeconds: 0 }
    } as Record<string, unknown>,
    lists: { active: [] as unknown[], waiting: [] as unknown[], stopped: [] as unknown[] },
    persistedGids: new Set<string>(),
    persistedTasks: new Map<string, unknown>(),
    removedPersisted: [] as string[],
    removedTimes: [] as string[],
    recordedAdds: [] as Array<{ gid: string; name: string }>,
    sources: new Map<string, unknown>(),
    sourceRecords: [] as Array<{ gid: string; source: unknown; options?: unknown }>,
    removedSources: [] as string[],
    saveMarked: [] as string[],
    retryMarkers: [] as string[],
    deleteCalls: [] as unknown[][],
    taskFilePaths: [] as string[],
    filePathsThrow: false,
    ensureGate: null as null | (() => void),
    ensureThrows: false,
    deleteResult: { success: true, results: [] as Array<{ success: boolean; error?: string }> } as {
      success: boolean
      results: Array<{ success: boolean; error?: string }>
      error?: string
    },
    removalOutcome: { ok: true } as { ok: boolean; error?: unknown },
    notifyThrows: false
  }
  return { state }
})

vi.mock('./connectionStore', async () => {
  const { shallowReactive } = await import('vue')
  const store = shallowReactive({ service: null as unknown })
  h.state.conn = store as unknown as { service: unknown }
  return { useConnectionStore: () => store }
})

vi.mock('./settingsStore', () => ({
  useSettingsStore: () => ({ settings: h.state.settings })
}))

vi.mock('@/services/completedTaskDeleteService', () => ({
  completedTaskDeleteService: {
    deleteCompletedTask: (...args: unknown[]) => {
      h.state.deleteCalls.push(args)
      return Promise.resolve(h.state.deleteResult)
    },
    getTaskFilePaths: () => {
      if (h.state.filePathsThrow) throw new Error('no file info')
      return h.state.taskFilePaths
    }
  }
}))

vi.mock('@/services/taskPersistenceService', () => ({
  taskPersistenceService: {
    ensureLoaded: () => {
      if (h.state.ensureGate !== null) {
        return new Promise<void>((resolve) => {
          h.state.ensureGate = () => {
            h.state.ensureGate = null
            resolve()
          }
        })
      }
      if (h.state.ensureThrows) return Promise.reject(new Error('persist load failed'))
      return Promise.resolve()
    },
    isTaskPersisted: (gid: string) => h.state.persistedGids.has(gid),
    getPersistedTask: (gid: string) => h.state.persistedTasks.get(gid) ?? null,
    removePersistedTask: (gid: string) => {
      h.state.removedPersisted.push(gid)
    },
    persistCompletedTask: () => {},
    mergeWithAria2Tasks: (tasks: unknown[]) => tasks
  }
}))

vi.mock('@/services/taskTimeService', () => ({
  taskTimeService: {
    recordTaskAdd: (gid: string, name: string) => {
      h.state.recordedAdds.push({ gid, name })
    },
    recordTaskComplete: () => {},
    getCompleteTime: () => undefined,
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
    ensureLoaded: () => Promise.resolve(),
    record: (gid: string, source: unknown, options?: unknown) => {
      h.state.sources.set(gid, { source, options })
      h.state.sourceRecords.push({ gid, source, options })
    },
    get: (gid: string) => h.state.sources.get(gid),
    remove: (gid: string) => {
      h.state.sources.delete(gid)
      h.state.removedSources.push(gid)
    }
  }
}))

vi.mock('@/services/taskRemovalCore', () => ({
  removeFromEngine: () => Promise.resolve(h.state.removalOutcome)
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

function makeTask(gid: string, status: Aria2Task['status'], extra: Record<string, unknown> = {}): Aria2Task {
  return {
    gid,
    status,
    totalLength: '100',
    completedLength: '10',
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

function makeService(overrides: Record<string, unknown> = {}) {
  const handlers = new Map<string, Set<Handler>>()
  // 测试桩要能被逐个方法替换，统一用 any 方便按需覆盖
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service: Record<string, any> = {
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
    addMetalink: vi.fn(async () => ['ml-1']),
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
    getOption: vi.fn(async () => ({ dir: 'D:/Downloads' })),
    changePosition: vi.fn(async () => 3),
    on: vi.fn((event: string, fn: Handler) => {
      if (!handlers.has(event)) handlers.set(event, new Set())
      handlers.get(event)!.add(fn)
    }),
    off: vi.fn((event: string, fn: Handler) => {
      handlers.get(event)?.delete(fn)
    }),
    emit: (event: string, payload?: unknown) => {
      for (const fn of [...(handlers.get(event) ?? [])]) fn(payload)
    },
    handlerCount: (event: string) => handlers.get(event)?.size ?? 0,
    ...overrides
  }
  return service
}

async function flush(rounds = 30): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve()
}

function resetState(): void {
  if (h.state.conn) h.state.conn.service = null
  h.state.settings = { queue: { retryEnabled: false, retryMaxAttempts: 3, retryDelaySeconds: 0 } }
  h.state.lists = { active: [], waiting: [], stopped: [] }
  h.state.persistedGids.clear()
  h.state.persistedTasks.clear()
  h.state.removedPersisted.length = 0
  h.state.removedTimes.length = 0
  h.state.recordedAdds.length = 0
  h.state.sources.clear()
  h.state.sourceRecords.length = 0
  h.state.removedSources.length = 0
  h.state.saveMarked.length = 0
  h.state.retryMarkers.length = 0
  h.state.deleteCalls.length = 0
  h.state.taskFilePaths = []
  h.state.filePathsThrow = false
  h.state.ensureGate = null
  h.state.ensureThrows = false
  h.state.deleteResult = { success: true, results: [] }
  h.state.removalOutcome = { ok: true }
  h.state.notifyThrows = false
}

function stubWindow(api: Record<string, unknown> | null): void {
  vi.stubGlobal('window', api === null ? {} : { electronAPI: api })
}

beforeEach(() => {
  setActivePinia(createPinia())
  resetState()
  stubWindow(null)
  // 这些用例刻意制造失败分支，产品代码会打 warn/error；静音掉避免刷屏
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('计算属性按任务状态分流', () => {
  it('downloadingTasks 只保留 active，waiting/stopped 不混进来', async () => {
    h.state.lists.active = [makeTask('a1', 'active'), makeTask('a2', 'paused')]
    h.state.lists.waiting = [makeTask('w1', 'waiting')]
    h.state.conn!.service = makeService()
    const store = useTaskStore()

    await store.loadAllTasks()

    expect(store.downloadingTasks.map(t => t.gid)).toEqual(['a1'])
    expect(store.totalTasks).toBe(3)
  })

  it('completedTasks 只保留 stopped 里的 complete，error 任务不算完成', async () => {
    h.state.lists.stopped = [
      makeTask('s1', 'complete'),
      makeTask('s2', 'error'),
      makeTask('s3', 'removed')
    ]
    h.state.conn!.service = makeService()
    const store = useTaskStore()

    await store.loadAllTasks()

    expect(store.completedTasks.map(t => t.gid)).toEqual(['s1'])
    expect(store.errorTasks.map(t => t.gid)).toEqual(['s2'])
  })
})

describe('刷新链路的边界', () => {
  it('未连接时全量与轻量刷新都直接返回，不发任何请求', async () => {
    const store = useTaskStore()

    await expect(store.loadAllTasks()).resolves.toBeUndefined()
    await expect(store.loadLightTasks()).resolves.toBeUndefined()
    expect(store.activeTasks).toEqual([])
    expect(store.isLoading).toBe(false)
  })

  it('轻量刷新在飞时先等它收尾；期间连接被换掉则本次全量作废', async () => {
    let release: (() => void) | null = null
    const first = makeService({
      tellActive: vi.fn(() => new Promise<Aria2Task[]>((resolve) => {
        release = () => resolve([makeTask('stale', 'active')])
      }))
    })
    h.state.conn!.service = first
    const store = useTaskStore()

    const light = store.loadLightTasks()
    await flush()
    const full = store.loadAllTasks()
    await flush()
    // 全量刷新已经捕获了旧 service，此时用户切走了连接
    h.state.conn!.service = makeService()
    await flush()
    release!()
    await Promise.all([light, full])

    expect(store.activeTasks).toEqual([])
    expect(store.isLoading).toBe(false)
  })

  it('multicall 里单个分支失败只保留旧值并告警，其余分支照常更新', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    h.state.lists.waiting = [makeTask('w1', 'waiting')]
    h.state.conn!.service = makeService({
      multicall: vi.fn(async () => [
        { faultCode: 1, faultString: 'active boom' },
        [[makeTask('w1', 'waiting'), makeTask('w2', 'waiting')]],
        { faultCode: 1, faultString: 'stopped boom' }
      ])
    })
    const store = useTaskStore()

    await store.loadAllTasks()

    expect(store.waitingTasks.map(t => t.gid)).toEqual(['w1', 'w2'])
    expect(store.activeTasks).toEqual([])
    expect(store.stoppedTasks).toEqual([])
    expect(warn).toHaveBeenCalledWith('Failed to load active tasks:', expect.anything())
    expect(warn).toHaveBeenCalledWith('Failed to load stopped tasks:', expect.anything())
  })

  it('轻量刷新在 ensureLoaded 期间连接被换掉时直接放弃，不写列表', async () => {
    h.state.lists.active = [makeTask('old', 'active')]
    h.state.conn!.service = makeService()
    const store = useTaskStore()
    await store.loadAllTasks()
    expect(store.activeTasks.map(t => t.gid)).toEqual(['old'])

    h.state.ensureGate = () => {}
    const light = store.loadLightTasks()
    await flush()
    h.state.conn!.service = makeService({
      tellActive: vi.fn(async () => [makeTask('fresh', 'active')])
    })
    await flush()
    h.state.ensureGate!()
    await light

    expect(store.activeTasks.map(t => t.gid)).toEqual(['old'])
  })

  it('轻量刷新拿到 active 后连接被换掉，响应不写进列表', async () => {
    let release: ((tasks: Aria2Task[]) => void) | null = null
    h.state.conn!.service = makeService({
      tellActive: vi.fn(() => new Promise<Aria2Task[]>((resolve) => {
        release = resolve
      }))
    })
    const store = useTaskStore()
    const light = store.loadLightTasks()
    await flush()
    h.state.conn!.service = makeService()
    await flush()
    release!([makeTask('stale', 'active')])
    await light

    expect(store.activeTasks).toEqual([])
  })

  it('轻量刷新里 ensureLoaded 失败与 tellActive 抛错都不冒泡，后者只记错误日志', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.state.ensureThrows = true
    h.state.conn!.service = makeService({
      tellActive: vi.fn(async () => {
        throw new Error('rpc down')
      })
    })
    const store = useTaskStore()

    await expect(store.loadLightTasks()).resolves.toBeUndefined()

    expect(error).toHaveBeenCalledWith('Failed to load active tasks:', expect.anything())
  })

  it('刷新在飞时收到 WS 事件只标记补刷，收尾后再补一次全量', async () => {
    let resolveFirst: ((value: unknown) => void) | null = null
    let call = 0
    const service = makeService({
      multicall: vi.fn(() => {
        call += 1
        if (call === 1) {
          return new Promise((resolve) => {
            resolveFirst = resolve
          })
        }
        return Promise.resolve([[[], [[]], [[makeTask('w1', 'waiting')]]]])
      })
    })
    h.state.conn!.service = service
    const store = useTaskStore()

    const pending = store.loadAllTasks()
    await flush()
    expect(store.isLoading).toBe(true)
    service.emit('downloadStop')
    resolveFirst!([[[]], [[]], [[]]])
    await pending
    await flush()

    // 在飞期间的 WS 事件被记成"待补刷"，收尾后会再打一次引擎
    expect(service.multicall.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(store.isLoading).toBe(false)
  })
})

describe('自动重试的边界', () => {
  it('非 error 状态与从未进行过的任务都不会被排进自动重试', async () => {
    vi.useFakeTimers()
    h.state.settings = { queue: { retryEnabled: true, retryMaxAttempts: 3, retryDelaySeconds: 0 } }
    const service = makeService()
    h.state.conn!.service = service
    const store = useTaskStore()

    h.state.lists.stopped = [makeTask('s1', 'complete')]
    await store.loadAllTasks()
    h.state.lists.stopped = [makeTask('s2', 'error')]
    await store.loadAllTasks()
    await vi.advanceTimersByTimeAsync(10)

    expect(service.addUri).not.toHaveBeenCalled()
  })

  it('触发时用户已关闭自动重试则跳过，不重建任务', async () => {
    vi.useFakeTimers()
    h.state.settings = { queue: { retryEnabled: true, retryMaxAttempts: 3, retryDelaySeconds: 0 } }
    const service = makeService()
    h.state.conn!.service = service
    const store = useTaskStore()

    h.state.lists.active = [makeTask('g1', 'active')]
    await store.loadAllTasks()
    h.state.lists.active = []
    h.state.lists.stopped = [makeTask('g1', 'error')]
    await store.loadAllTasks()

    h.state.settings = { queue: { retryEnabled: false, retryMaxAttempts: 3, retryDelaySeconds: 0 } }
    await vi.advanceTimersByTimeAsync(10)

    expect(service.addUri).not.toHaveBeenCalled()
    expect(h.state.retryMarkers).toEqual([])
  })

  it('到点重试成功时打标记并刷新列表', async () => {
    vi.useFakeTimers()
    h.state.settings = { queue: { retryEnabled: true, retryMaxAttempts: 3, retryDelaySeconds: 0 } }
    h.state.sources.set('g1', { source: { kind: 'uri', uris: ['https://a/1.zip'] }, options: {} })
    const service = makeService()
    h.state.conn!.service = service
    const store = useTaskStore()

    h.state.lists.active = [makeTask('g1', 'active')]
    await store.loadAllTasks()
    h.state.lists.active = []
    h.state.lists.stopped = [makeTask('g1', 'error')]
    await store.loadAllTasks()
    await vi.advanceTimersByTimeAsync(10)

    expect(service.addUri).toHaveBeenCalledTimes(1)
    expect(h.state.retryMarkers).toEqual(['g1 #1'])
  })

  it('重试本身失败时只告警，不冒泡到刷新流程', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.useFakeTimers()
    h.state.settings = { queue: { retryEnabled: true, retryMaxAttempts: 3, retryDelaySeconds: 0 } }
    const service = makeService({
      tellStatus: vi.fn(async () => {
        throw new Error('gone')
      })
    })
    h.state.conn!.service = service
    const store = useTaskStore()

    h.state.lists.active = [makeTask('g1', 'active')]
    await store.loadAllTasks()
    h.state.lists.active = []
    h.state.lists.stopped = [makeTask('g1', 'error')]
    await store.loadAllTasks()
    await vi.advanceTimersByTimeAsync(10)

    expect(warn).toHaveBeenCalledWith('Auto retry failed:', 'g1', expect.anything())
  })

  it('删除任务时取消已排的重试，不再对已删除的任务发请求', async () => {
    vi.useFakeTimers()
    h.state.settings = { queue: { retryEnabled: true, retryMaxAttempts: 3, retryDelaySeconds: 5 } }
    const service = makeService()
    h.state.conn!.service = service
    const store = useTaskStore()

    h.state.lists.active = [makeTask('g1', 'active')]
    await store.loadAllTasks()
    h.state.lists.active = []
    h.state.lists.stopped = [makeTask('g1', 'error')]
    await store.loadAllTasks()

    await store.removeTask('g1')
    await vi.advanceTimersByTimeAsync(10_000)

    expect(service.addUri).not.toHaveBeenCalled()
  })

  it('clearTasks 清掉所有已排的重试定时器', async () => {
    vi.useFakeTimers()
    h.state.settings = { queue: { retryEnabled: true, retryMaxAttempts: 3, retryDelaySeconds: 5 } }
    const service = makeService()
    h.state.conn!.service = service
    const store = useTaskStore()

    h.state.lists.active = [makeTask('g1', 'active')]
    await store.loadAllTasks()
    h.state.lists.active = []
    h.state.lists.stopped = [makeTask('g1', 'error')]
    await store.loadAllTasks()

    store.clearTasks()
    await vi.advanceTimersByTimeAsync(10_000)

    expect(service.addUri).not.toHaveBeenCalled()
    expect(store.activeTasks).toEqual([])
  })
})

describe('新建任务与来源记录', () => {
  it('addUriBatch 未连接时直接抛错', async () => {
    const store = useTaskStore()
    await expect(store.addUriBatch([{ uri: 'https://a/1.zip' }])).rejects.toThrow('Not connected')
  })

  it('addUriBatch 中途连接被换掉时该行失败，其余行照常加入', async () => {
    const service = makeService()
    h.state.conn!.service = service
    const store = useTaskStore()

    let calls = 0
    service.addUri = vi.fn(async () => {
      calls += 1
      if (calls === 1) h.state.conn!.service = makeService()
      return 'gid-' + calls
    })

    const result = await store.addUriBatch([
      { requestId: 'r1', uri: 'https://a/1.zip' },
      { requestId: 'r2', uri: 'https://a/2.zip' }
    ])

    expect(result.added).toEqual([{ requestId: 'r1', uri: 'https://a/1.zip', gid: 'gid-1' }])
    expect(result.failed).toEqual([
      { requestId: 'r2', uri: 'https://a/2.zip', error: 'Connection changed' }
    ])
  })

  it('addUriBatch 立即保存会话失败只告警，不影响加入结果', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const service = makeService({
      saveSession: vi.fn(async () => {
        throw new Error('session write failed')
      })
    })
    h.state.conn!.service = service
    const store = useTaskStore()

    const result = await store.addUriBatch([{ uri: 'magnet:?xt=urn:btih:abc' }])

    expect(result.added).toHaveLength(1)
    expect(result.failed).toEqual([])
    expect(warn).toHaveBeenCalledWith('Failed to save session immediately:', expect.anything())
    expect(service.addUri).toHaveBeenCalledWith(['magnet:?xt=urn:btih:abc'], { 'bt-save-metadata': 'true' })
  })

  it('addUri 的会话保存失败只告警，任务照常返回 gid', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const service = makeService({
      saveSession: vi.fn(async () => {
        throw new Error('disk full')
      })
    })
    h.state.conn!.service = service
    const store = useTaskStore()

    const gid = await store.addUri(['https://a/file.zip'])

    expect(gid).toBe('added-gid')
    expect(warn).toHaveBeenCalledWith('Failed to save session immediately:', expect.anything())
  })

  it('磁力索引超过上限时淘汰最老的条目，只保留仍在进行中的映射', async () => {
    const service = makeService()
    let seq = 0
    service.addUri = vi.fn(async () => 'gid-' + seq++)
    h.state.conn!.service = service
    const store = useTaskStore()

    for (let i = 0; i <= 500; i += 1) {
      await store.addUri(['magnet:?xt=urn:btih:' + i])
    }
    h.state.lists.active = Array.from({ length: 501 }, (_, i) => makeTask('gid-' + i, 'active'))
    await store.loadAllTasks()

    expect(store.findDuplicateTasks(['magnet:?xt=urn:btih:0'])).toEqual([])
    expect(store.findDuplicateTasks(['magnet:?xt=urn:btih:500'])).toHaveLength(1)
  })
})

describe('删除任务的边界', () => {
  it('未连接时删除任务直接抛错', async () => {
    const store = useTaskStore()
    await expect(store.removeTask('g1')).rejects.toThrow('Not connected')
  })

  it('引擎记录删不掉时抛错并保留本地记录，用户可重试', async () => {
    const service = makeService()
    h.state.conn!.service = service
    h.state.removalOutcome = { ok: false, error: new Error('rpc timeout') }
    h.state.lists.stopped = [makeTask('g1', 'error')]
    const store = useTaskStore()
    await store.loadAllTasks()

    await expect(store.removeTask('g1')).rejects.toThrow('删除任务记录失败: rpc timeout')
    expect(h.state.removedPersisted).toEqual([])
    expect(h.state.removedTimes).toEqual([])
  })

  it('取要删除的文件路径失败时只告警，任务记录照常清理', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    stubWindow({ deleteFiles: vi.fn(async () => ({ success: true, results: [] })) })
    const service = makeService()
    h.state.conn!.service = service
    h.state.filePathsThrow = true
    h.state.lists.stopped = [makeTask('g1', 'error')]
    const store = useTaskStore()
    await store.loadAllTasks()

    await expect(store.removeTask('g1', true)).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith('Failed to get files for deletion:', expect.anything())
    expect(h.state.removedTimes).toEqual(['g1'])
  })

  it('删记录后的会话保存失败只告警，删除仍算成功', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const service = makeService({
      saveSession: vi.fn(async () => {
        throw new Error('session busy')
      })
    })
    h.state.conn!.service = service
    h.state.lists.stopped = [makeTask('g1', 'error')]
    const store = useTaskStore()
    await store.loadAllTasks()

    await expect(store.removeTask('g1')).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith('saveSession after removeTask failed:', expect.anything())
  })

  it('持久化任务找不到记录时只清本地痕迹，不碰引擎', async () => {
    const service = makeService()
    h.state.conn!.service = service
    h.state.persistedGids.add('p1')
    const store = useTaskStore()

    await expect(store.removeTask('p1')).resolves.toBe(true)
    expect(h.state.removedPersisted).toEqual(['p1'])
    expect(h.state.removedTimes).toEqual(['p1'])
    expect(service.removeDownloadResult).not.toHaveBeenCalled()
  })
})

describe('暂停与恢复的边界', () => {
  it('未连接时暂停与恢复都抛错', async () => {
    const store = useTaskStore()
    await expect(store.pauseTask('g1')).rejects.toThrow('Not connected')
    await expect(store.pauseTask('g1', true)).rejects.toThrow('Not connected')
    await expect(store.unpauseTask('g1')).rejects.toThrow('Not connected')
  })

  it('恢复任务打到 unpause 并刷新列表', async () => {
    const service = makeService()
    h.state.conn!.service = service
    const store = useTaskStore()

    await store.unpauseTask('g1')

    expect(service.unpause).toHaveBeenCalledWith('g1')
    expect(service.multicall).toHaveBeenCalled()
  })
})

describe('失败任务重试的边界', () => {
  it('未连接时重试直接抛错', async () => {
    const store = useTaskStore()
    await expect(store.retryErrorTask('g1')).rejects.toThrow('Not connected')
  })

  it('metalink 没返回 gid 时抛错，不动旧任务', async () => {
    const service = makeService({ addMetalink: vi.fn(async () => []) })
    h.state.conn!.service = service
    h.state.sources.set('g1', {
      source: { kind: 'metalink', metalink: '<metalink/>' },
      options: { dir: 'D:/Downloads' }
    })
    const store = useTaskStore()

    await expect(store.retryErrorTask('g1')).rejects.toThrow('No GID returned')
    expect(service.forceRemove).not.toHaveBeenCalled()
  })
})

describe('下载事件转发', () => {
  it('下载开始事件触发刷新并把 gid 与任务名转给插件', async () => {
    const service = makeService()
    h.state.conn!.service = service
    const notify = vi.fn()
    stubWindow({ notifyDownloadEvent: notify })
    h.state.lists.active = [makeTask('g1', 'active')]
    const store = useTaskStore()
    await store.loadAllTasks()

    service.emit('downloadStart', { gid: 'g1' })
    await flush()

    expect(notify).toHaveBeenCalledWith('downloadStart', 'g1', expect.any(String))
  })

  it('下载失败事件先刷新再回调，最后转给插件', async () => {
    const service = makeService()
    h.state.conn!.service = service
    const notify = vi.fn()
    stubWindow({ notifyDownloadEvent: notify })
    const store = useTaskStore()
    const seen: string[] = []
    const unsubscribe = store.onDownloadError((gid) => seen.push(gid))
    await store.loadAllTasks()

    service.emit('downloadError', { gid: 'g9' })
    await flush()

    expect(seen).toEqual(['g9'])
    expect(notify).toHaveBeenCalledWith('downloadError', 'g9', '')
    unsubscribe()
    service.emit('downloadError', { gid: 'g10' })
    await flush()
    expect(seen).toEqual(['g9'])
  })

  it('gid 为空时不通知插件；通知通道抛错只告警', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const service = makeService()
    h.state.conn!.service = service
    const notify = vi.fn(() => {
      if (h.state.notifyThrows) throw new Error('ipc closed')
    })
    stubWindow({ notifyDownloadEvent: notify })
    useTaskStore()

    service.emit('downloadStart', {})
    await flush()
    expect(notify).not.toHaveBeenCalled()

    h.state.notifyThrows = true
    service.emit('downloadStart', { gid: 'g1' })
    await flush()
    expect(warn).toHaveBeenCalledWith('Failed to notify plugins:', expect.anything())
  })

  it('下载完成事件在没有 gid 时也照样刷新并通知回调空串', async () => {
    const service = makeService()
    h.state.conn!.service = service
    const store = useTaskStore()
    const seen: string[] = []
    store.onDownloadComplete((gid) => seen.push(gid))

    service.emit('downloadComplete', undefined)
    await flush()

    expect(seen).toEqual([''])
  })
})

describe('连接切换时的监听器', () => {
  it('切换连接时先摘掉旧连接的监听器，再给新连接挂上（含 btDownloadComplete）', async () => {
    const first = makeService()
    h.state.conn!.service = first
    await flush()
    // 同一测试进程里先前用例创建的 store 也会挂在 service 上，这里只断言"挂上了"而不是精确条数
    expect(first.handlerCount('downloadStop')).toBeGreaterThanOrEqual(1)

    const second = makeService()
    h.state.conn!.service = second
    await flush()

    for (const event of ['downloadStart', 'downloadPause', 'downloadStop', 'downloadComplete', 'downloadError']) {
      expect(first.off).toHaveBeenCalledWith(event, expect.any(Function))
    }
    expect(first.off).toHaveBeenCalledWith('btDownloadComplete', expect.any(Function))
    expect(second.on).toHaveBeenCalledWith('btDownloadComplete', expect.any(Function))
    expect(second.handlerCount('btDownloadComplete')).toBeGreaterThanOrEqual(1)
    expect(second.handlerCount('downloadStop')).toBeGreaterThanOrEqual(1)
  })
})
