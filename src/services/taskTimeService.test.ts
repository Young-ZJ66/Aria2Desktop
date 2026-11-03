/**
 * taskTimeService 的不变式测试。
 *
 * 任务时间记录是"添加时间/完成时间"显示的唯一来源，此前零测试。
 * 关键不变式：重复上报不覆盖已记录的时间（否则完成时间会被重算成
 * "约 24 小时前"那一类怪值）、合批落盘、上限淘汰最旧、坏数据自愈。
 *
 * 存储键是模块私有常量，测试统一从"实际写入的键"里取，避免硬编码。
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

let store: Record<string, string>
let removeItemSpy: Mock<(k: string) => void>

function makeLocalStorage() {
  store = {}
  const ls = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v
    },
    removeItem: (k: string) => {
      removeItemSpy(k)
      delete store[k]
    },
    clear: () => {
      store = {}
    }
  }
  vi.stubGlobal('localStorage', ls)
}

/** 服务写盘后，存储里那个唯一的键就是真实的存储键 */
function storageKey(): string | undefined {
  return Object.keys(store)[0]
}

async function loadService() {
  vi.resetModules()
  const mod = await import('./taskTimeService')
  return mod
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-05-20T10:00:00'))
  removeItemSpy = vi.fn()
  makeLocalStorage()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('taskTimeService', () => {
  it('重复上报添加时间时保留最初的时间与完成时间', async () => {
    const { taskTimeService } = await loadService()
    taskTimeService.recordTaskAdd('a', 'a.zip')
    taskTimeService.recordTaskComplete('a')
    const firstComplete = taskTimeService.getCompleteTime('a')
    // 同一个 gid 再次出现（引擎重启后全量刷新很常见），不应重置任何时间
    taskTimeService.recordTaskAdd('a', 'a.zip')
    taskTimeService.recordTaskComplete('a')

    const record = taskTimeService.getTaskTime('a')
    expect(record?.completeTime).toBe(firstComplete)
    expect(record?.addTime).toBe(Date.parse('2026-05-20T10:00:00'))
  })

  it('写入走 300ms 合批，flush 立即落盘并取消排队', async () => {
    const { taskTimeService } = await loadService()
    taskTimeService.recordTaskAdd('c1')
    taskTimeService.recordTaskAdd('c2')
    taskTimeService.recordTaskAdd('c3')
    // 还没到合批窗口：不应落盘
    expect(storageKey()).toBeUndefined()
    vi.advanceTimersByTime(299)
    expect(storageKey()).toBeUndefined()
    vi.advanceTimersByTime(1)
    expect(storageKey()).toBeDefined()
    const persisted = JSON.parse(store[storageKey()!] ?? '{}') as Record<string, unknown>
    expect(Object.keys(persisted)).toHaveLength(3)

    taskTimeService.recordTaskAdd('c4')
    taskTimeService.flush()
    const afterFlush = JSON.parse(store[storageKey()!] ?? '{}') as Record<string, unknown>
    expect(Object.keys(afterFlush)).toHaveLength(4)
    vi.advanceTimersByTime(1000)
    // flush 已取消排队，不会多写一次
    const still = JSON.parse(store[storageKey()!] ?? '{}') as Record<string, unknown>
    expect(Object.keys(still)).toHaveLength(4)
  })

  it('localStorage 里是坏数据时清键并从空表开始，不抛错', async () => {
    // 先从服务自身拿到真实存储键（模块私有，不在测试里硬编码）
    const { taskTimeService } = await loadService()
    taskTimeService.recordTaskAdd('probe')
    taskTimeService.flush()
    const realKey = storageKey()!
    // 模拟历史坏数据后重启
    store[realKey] = 'not-json{{'
    removeItemSpy.mockClear()
    const { taskTimeService: reloaded } = await loadService()
    expect(reloaded.getAllRecords()).toHaveLength(0)
    expect(removeItemSpy).toHaveBeenCalledTimes(1)
    expect(removeItemSpy).toHaveBeenCalledWith(realKey)
  })

  it('超过 2000 条时淘汰最旧（按完成时间，其次添加时间）', async () => {
    const { taskTimeService } = await loadService()
    for (let i = 0; i < 2001; i++) {
      taskTimeService.recordTaskAdd(`task-${i}`)
      vi.advanceTimersByTime(1) // 每条差 1ms，保证顺序可断言
    }
    taskTimeService.flush()
    const persisted = JSON.parse(store[storageKey()!] ?? '{}') as Record<string, unknown>
    expect(Object.keys(persisted)).toHaveLength(2000)
    expect(persisted['task-0']).toBeUndefined()
    expect(persisted['task-1']).toBeDefined()
    expect(persisted['task-2000']).toBeDefined()
  })

  it('clearAll 清空内存并删掉存储键', async () => {
    const { taskTimeService } = await loadService()
    taskTimeService.recordTaskAdd('d')
    taskTimeService.flush()
    expect(storageKey()).toBeDefined()
    taskTimeService.clearAll()
    expect(taskTimeService.getAllRecords()).toHaveLength(0)
    expect(storageKey()).toBeUndefined()
  })

  it('cleanupOldRecords 只清 30 天前的记录', async () => {
    const { taskTimeService } = await loadService()
    taskTimeService.recordTaskAdd('fresh')
    taskTimeService.flush()
    const key = storageKey()!
    const raw = JSON.parse(store[key] ?? '{}') as Record<string, { gid: string; addTime: number }>
    raw['old'] = { gid: 'old', addTime: Date.now() - 31 * 24 * 60 * 60 * 1000 }
    store[key] = JSON.stringify(raw)
    // 重新加载（模拟重启后清理）
    const { taskTimeService: reloaded } = await loadService()
    reloaded.cleanupOldRecords()
    expect(reloaded.getTaskTime('old')).toBeUndefined()
    expect(reloaded.getTaskTime('fresh')).toBeDefined()
  })
})
