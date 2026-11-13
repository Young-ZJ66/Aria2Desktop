/**
 * 已完成任务持久化：单测覆盖"会丢用户记录"的那几条路径。
 *
 * 为什么值得测：这个服务是重启后能看见已完成任务的唯一来源，失效的代价是用户的下载历史
 * 静默消失。它同时引入了两个容易写错的机制——合批落盘（300ms 窗口）与上限淘汰（1000 条），
 * 两者的边界都很难靠手点验出来。
 *
 * 环境：单测跑在 node（无 DOM），所以自己塞一个 `window` 与 `localStorage` 的假实现，
 * 每个用例 `vi.resetModules()` 重新 import，避免单例之间串状态。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Aria2Task } from '@/types/aria2'

interface FakeStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
  dump: () => Record<string, string>
}

/**
 * 假 localStorage。
 *
 * `corruptValue` 用于模拟"键里存着坏数据"：由于服务的存储键是私有字段，测试在 import 之前
 * 拿不到它，所以这里对**任何**首次读取都返回这份坏数据；被 removeItem 过的键之后返回 null，
 * 正好对应"读到坏数据 → 清掉这个键"的行为。
 */
function createLocalStorage(corruptValue?: string): FakeStorage {
  const map = new Map<string, string>()
  const removed = new Set<string>()
  return {
    getItem: key => (removed.has(key) ? null : map.get(key) ?? corruptValue ?? null),
    setItem: (key, value) => { removed.delete(key); map.set(key, value) },
    removeItem: key => { map.delete(key); removed.add(key) },
    dump: () => Object.fromEntries(map)
  }
}

interface LoadOptions {
  backend?: Record<string, unknown> | unknown[]
  withBackend?: boolean
  /** false = 模拟旧 preload（无增量 API），服务应退回全量合批路径 */
  incremental?: boolean
  corruptStorage?: string
}

async function loadService(options: LoadOptions = {}) {
  vi.resetModules()

  const localStorage = createLocalStorage(options.corruptStorage)
  const savePersistedTasks = vi.fn().mockResolvedValue(undefined)
  const loadPersistedTasks = vi.fn().mockResolvedValue(options.backend ?? {})
  // v1.3.5 增量通道：withBackend 默认同时挂上；incremental:false 时模拟旧 preload（无增量 API），服务应退回全量合批
  const savePersistedTask = vi.fn().mockResolvedValue({ success: true })
  const deletePersistedTasks = vi.fn().mockResolvedValue({ success: true })
  const clearPersistedTasks = vi.fn().mockResolvedValue({ success: true })

  vi.stubGlobal('localStorage', localStorage)
  vi.stubGlobal('window', {
    electronAPI: options.withBackend === false
      ? undefined
      : options.incremental === false
        ? { savePersistedTasks, loadPersistedTasks }
        : { savePersistedTasks, loadPersistedTasks, savePersistedTask, deletePersistedTasks, clearPersistedTasks }
  })

  const mod = await import('./taskPersistenceService')
  return {
    service: mod.taskPersistenceService,
    maxTasks: mod.MAX_PERSISTED_TASKS,
    savePersistedTasks,
    loadPersistedTasks,
    savePersistedTask,
    deletePersistedTasks,
    clearPersistedTasks,
    localStorage
  }
}

/** 取第一次落盘的载荷（`mock.calls` 的索引访问在 noUncheckedIndexedAccess 下是可能为空的） */
function firstPayload(mock: ReturnType<typeof vi.fn>): Record<string, unknown> | undefined {
  return mock.mock.calls[0]?.[0] as Record<string, unknown> | undefined
}

function makeTask(gid: string, status: Aria2Task['status'] = 'complete'): Aria2Task {
  return {
    gid,
    status,
    totalLength: '1024',
    completedLength: '1024',
    uploadLength: '0',
    downloadSpeed: '0',
    uploadSpeed: '0',
    connections: '1',
    dir: 'D:/Downloads',
    files: []
  } as Aria2Task
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  // 服务在模块顶层起了一个 24 小时的清理定时器；切回真实计时器会把它一并丢弃
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('persistCompletedTask（重复与合批）', () => {
  it('同一个 gid 重复持久化时不覆盖原始完成时间', async () => {
    const { service } = await loadService()
    service.persistCompletedTask(makeTask('g1'), 1_000)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    service.persistCompletedTask(makeTask('g1'), 9_999)
    warn.mockRestore()

    expect(service.getPersistedTask('g1')?.completedAt).toBe(1_000)
  })

  it('同一窗口内的多次写入合并为一次落盘（旧 preload 无增量通道时的回退路径）', async () => {
    const { service, savePersistedTasks } = await loadService({ incremental: false })

    service.persistCompletedTask(makeTask('a'))
    service.persistCompletedTask(makeTask('b'))
    service.persistCompletedTask(makeTask('c'))

    expect(savePersistedTasks).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(300)

    expect(savePersistedTasks).toHaveBeenCalledTimes(1)
    expect(Object.keys(firstPayload(savePersistedTasks) ?? {}).sort()).toEqual(['a', 'b', 'c'])
  })

  it('增量通道可用时每条记录直接单条写入，不再全量合批', async () => {
    const { service, savePersistedTasks, savePersistedTask } = await loadService()

    service.persistCompletedTask(makeTask('a'), 1_000)
    service.persistCompletedTask(makeTask('b'), 2_000)
    await Promise.resolve() // persistCompletedTask 是 async：让 microtask 队列跑完

    expect(savePersistedTask).toHaveBeenCalledTimes(2)
    expect(savePersistedTask.mock.calls[0]?.[0]).toBe('a')
    expect(savePersistedTask).not.toHaveBeenCalledWith('a', expect.objectContaining({ gid: 'b' }))
    // 全量通道不应被触碰
    expect(savePersistedTasks).not.toHaveBeenCalled()
  })

  it('增量单条写入失败时记录错误并退回全量合批重试', async () => {
    const { service, savePersistedTask, savePersistedTasks } = await loadService()
    savePersistedTask.mockResolvedValue({ success: false, error: 'disk full' })

    service.persistCompletedTask(makeTask('a'), 1_000)
    await Promise.resolve()

    expect(service.getLastPersistError()).toBe('disk full')
    // 失败后应有合批全量兜底（300ms 窗口）
    await vi.advanceTimersByTimeAsync(300)
    expect(savePersistedTasks).toHaveBeenCalledTimes(1)
    expect(Object.keys(firstPayload(savePersistedTasks) ?? {})).toEqual(['a'])
  })

  it('flush 立即落盘，并取消排队中的那次写入', async () => {
    const { service, savePersistedTasks } = await loadService({ incremental: false })

    service.persistCompletedTask(makeTask('a'))
    await service.flush()

    expect(savePersistedTasks).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(savePersistedTasks).toHaveBeenCalledTimes(1)
  })
})

describe('上限淘汰（超过上限时保留最新的）', () => {
  it('挤掉完成时间最早的那条，条数收敛到上限', async () => {
    // 上限本身是 5 万（见下方常量断言），单测不可能真插 5 万条再等淘汰——
    // 这里在运行时把实例的裁剪阈值改小（readonly 只是 TS 层约束），验证裁剪方向。
    // 真正的行级裁剪在主进程 HistoryDatabase.trimToLimit（有自己的单测）。
    const { service } = await loadService()
    const smallLimit = 3
    Object.defineProperty(service, 'MAX_TASKS', { value: smallLimit, writable: false })

    for (let index = 0; index < smallLimit + 2; index++) {
      await service.persistCompletedTask(makeTask(`task-${index}`), 1_000 + index)
    }

    expect(service.getStorageStats().maxTasks).toBe(smallLimit)
    expect(service.getStorageStats().totalTasks).toBe(smallLimit)
    // completedAt 最早的两条被裁掉
    expect(service.getPersistedTask('task-0')).toBeUndefined()
    expect(service.getPersistedTask('task-1')).toBeUndefined()
    expect(service.getPersistedTask('task-2')).toBeDefined()
    expect(service.getPersistedTask(`task-${smallLimit + 1}`)).toBeDefined()
  })

  it('上限常量与主进程 SQLite 行上限一致（5 万）', async () => {
    const { maxTasks } = await loadService()
    expect(maxTasks).toBe(50_000)
  })
})

describe('删除与清理', () => {
  it('增量通道下批量删除按 gid 直删，不再全量落盘', async () => {
    const { service, deletePersistedTasks, savePersistedTasks } = await loadService()

    service.removePersistedTasks(['a', 'b'])
    await Promise.resolve()

    expect(deletePersistedTasks).toHaveBeenCalledTimes(1)
    expect(deletePersistedTasks.mock.calls[0]?.[0]).toEqual(['a', 'b'])
    expect(savePersistedTasks).not.toHaveBeenCalled()
  })

  it('单条删除也走增量通道', async () => {
    const { service, deletePersistedTasks } = await loadService()

    service.removePersistedTask('only-one')
    await Promise.resolve()

    expect(deletePersistedTasks).toHaveBeenCalledWith(['only-one'])
  })

  it('JSON 回退后端（fallback:true）时退回全量合批删除', async () => {
    const { service, deletePersistedTasks, savePersistedTasks } = await loadService()
    deletePersistedTasks.mockResolvedValue({ success: false, error: 'unsupported', fallback: true })

    service.persistCompletedTask(makeTask('a'), 1_000)
    await Promise.resolve()
    savePersistedTasks.mockClear()

    service.removePersistedTask('a')
    await vi.advanceTimersByTimeAsync(300)

    expect(savePersistedTasks).toHaveBeenCalledTimes(1)
    expect(firstPayload(savePersistedTasks)).toEqual({})
  })

  it('清空历史走 clear 通道而非全量保存', async () => {
    const { service, clearPersistedTasks, savePersistedTasks } = await loadService()

    const ok = await service.clearAllPersistedTasks()

    expect(ok).toBe(true)
    expect(clearPersistedTasks).toHaveBeenCalledTimes(1)
    expect(savePersistedTasks).not.toHaveBeenCalled()
  })
})

describe('损坏数据的兜底', () => {
  it('后端返回数组时按空处理，不把数组当任务表', async () => {
    const { service } = await loadService({ backend: [] })

    await service.ensureLoaded()

    expect(service.getPersistedTasks()).toEqual([])
  })

  it('localStorage 里是数组时清掉该键，不抛错也不加载', async () => {
    // 这条路径本来就要打一条错误日志（提醒数据损坏），测试里静音以免污染输出
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { service, localStorage } = await loadService({ withBackend: false, corruptStorage: '[]' })
    const storageKey = service.getStorageStats().storageKey

    expect(service.getPersistedTasks()).toEqual([])
    expect(localStorage.getItem(storageKey)).toBeNull()
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })

  it('没有 Electron 后端时写入 localStorage（浏览器/开发态回退）', async () => {
    const { service, localStorage } = await loadService({ withBackend: false })
    const storageKey = service.getStorageStats().storageKey

    service.persistCompletedTask(makeTask('a'), 1_000)
    await service.flush()

    const stored = JSON.parse(localStorage.getItem(storageKey) ?? '{}')
    expect(Object.keys(stored)).toEqual(['a'])
    expect(stored.a.completedAt).toBe(1_000)
  })
})

describe('与实时任务合并', () => {
  it('持久化记录里与实时任务同 gid 的不再重复返回', async () => {
    const { service } = await loadService()

    service.persistCompletedTask(makeTask('live'), 1_000)
    service.persistCompletedTask(makeTask('gone'), 2_000)

    const merged = service.mergeWithAria2Tasks([makeTask('live', 'active')])
    expect(merged.map(task => task.gid).sort()).toEqual(['gone', 'live'])
  })
})
