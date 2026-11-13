/**
 * 任务持久化存储服务
 * 用于在本地存储已完成的任务，避免 Aria2 重启后丢失
 */

import type { Aria2Task } from '@/types/aria2'
import { devLog } from '@/utils/devLog'

export interface PersistedTask extends Aria2Task {
  persistedAt: number // 持久化时间戳
  completedAt?: number // 完成时间戳
}

/**
 * 已完成任务保留上限（按完成时间淘汰最旧）。导出给测试断言，避免两边各写一个数字。
 * SQLite 后端（v1.3.5 起默认）按行存储，与主进程 HISTORY_MAX_ROWS 同为 5 万；
 * localStorage 回退环境下这个上限同样生效，但配额（约 5MB）通常先到——那条路径
 * 本来就是无 Electron 后端的开发态兜底。
 */
export const MAX_PERSISTED_TASKS = 50_000

class TaskPersistenceService {
  private readonly STORAGE_KEY = 'aria2_persisted_tasks'
  private readonly MAX_TASKS = MAX_PERSISTED_TASKS
  private persistedTasks: Map<string, PersistedTask> = new Map()
  /** 是否已完成异步后端加载（避免每次 loadAllTasks 都重复请求） */
  private loaded = false
  private loadPromise: Promise<void> | null = null

  constructor() {
    // 非 Electron 环境 / 主进程未就绪时的同步兜底（Electron 环境下会被 ensureLoaded 覆盖）
    this.loadFromLocalStorage()
  }

  /**
   * 异步初始化：从主进程加载持久化任务（Electron 环境，存于 userData 下的 JSON 文件）。
   * 启动时由 loadAllTasks 首次调用前 await，确保本地记录就绪、避免 localStorage 配额限制。
   */
  async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    if (this.loadPromise) return this.loadPromise
    this.loadPromise = this.loadFromBackend()
    try {
      await this.loadPromise
      // 仅成功时标记已加载；失败时保持 false，允许下次调用重试
      this.loaded = true
    } catch (error) {
      console.error('Failed to load persisted tasks from backend:', error)
    } finally {
      this.loadPromise = null
    }
  }

  private async loadFromBackend(): Promise<void> {
    if (!window.electronAPI?.loadPersistedTasks) return
    const data = await window.electronAPI.loadPersistedTasks()
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      this.persistedTasks = new Map<string, PersistedTask>(Object.entries(data) as [string, PersistedTask][])
      devLog(`Loaded ${this.persistedTasks.size} persisted tasks from backend`)
    }
  }

  /** 从本地存储加载（localStorage，非 Electron 环境回退） */
  private loadFromLocalStorage() {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY)
      if (stored) {
        const data = JSON.parse(stored)
        // 防恶意/损坏存储：数组形态不是合法的键值对象
        if (Array.isArray(data)) {
          throw new Error('Invalid data format: expected object, got array')
        }
        this.persistedTasks = new Map(Object.entries(data))
        devLog(`Loaded ${this.persistedTasks.size} persisted tasks from storage`)
      }
    } catch (error) {
      console.error('Failed to load persisted tasks from storage:', error)
      // 清理损坏数据，避免下次启动仍反复 parse 失败
      localStorage.removeItem(this.STORAGE_KEY)
      this.persistedTasks = new Map()
    }
  }

  /**
   * 合批落盘定时器。
   *
   * 为什么需要：`persist()` 每次都会 `Object.fromEntries(整个 Map)` 再做全量序列化 + 一次 IPC，
   * 而 `loadAllTasks` 会对**每个新完成的任务**各调一次 `persistCompletedTask`——
   * 首次连上一个已有数百条完成任务的外部引擎时，就是数百次全量 JSON 序列化 + 数百次 IPC，
   * 足以卡住渲染线程。这里把同一批写入合并为一次。
   */
  private persistTimer: ReturnType<typeof setTimeout> | null = null
  /** 合批窗口：够短以免退出时丢记录，够长以吸收批量写入 */
  private static readonly PERSIST_DEBOUNCE_MS = 300

  /** 安排一次合批落盘（同一窗口内的多次改动只写一次） */
  private schedulePersist(): void {
    if (this.persistTimer) return
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      this.persist()
    }, TaskPersistenceService.PERSIST_DEBOUNCE_MS)
  }

  /** 立即落盘并等待写盘完成（清空、退出前等需要强一致的场景）；返回是否成功 */
  async flush(): Promise<boolean> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    return await this.persist()
  }

  /** 最近一次落盘失败原因（诊断页/设置页展示用） */
  private lastPersistError: string | null = null

  getLastPersistError(): string | null {
    return this.lastPersistError
  }

  /** 持久化到后端（Electron IPC 写文件），非 Electron 环境回退 localStorage。
    返回 Promise<boolean>：schedulePersist 路径不 await（合批语义）；flush 路径 await（强一致） */
  private async persist(): Promise<boolean> {
    if (window.electronAPI?.savePersistedTasks) {
      const data = Object.fromEntries(this.persistedTasks)
      try {
        const result = await window.electronAPI.savePersistedTasks(data)
        if (result && result.success === false) {
          // 后端会因超过 10MB 上限拒绝写入；过去这里直接忽略返回值，界面却显示“已保存”
          this.lastPersistError = result.error || '保存失败'
          console.error('Failed to persist tasks to backend:', this.lastPersistError)
          return false
        }
        this.lastPersistError = null
        return true
      } catch (error) {
        this.lastPersistError = error instanceof Error ? error.message : String(error)
        console.error('Failed to persist tasks to backend:', error)
        return false
      }
    }
    return this.saveToLocalStorage()
  }

  private saveToLocalStorage(): boolean {
    try {
      const data = Object.fromEntries(this.persistedTasks)
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data))
      this.lastPersistError = null
      return true
    } catch (error) {
      this.lastPersistError = error instanceof Error ? error.message : String(error)
      console.error('Failed to save persisted tasks to localStorage:', error)
      return false
    }
  }

  /**
   * 持久化已完成任务
   */
  async persistCompletedTask(task: Aria2Task, completedAt?: number) {
    const existing = this.persistedTasks.get(task.gid)

    // 如果任务已经持久化，不要覆盖完成时间
    if (existing) {
      console.warn(`Task ${task.gid} already persisted, skipping update`)
      return
    }

    const persistedTask: PersistedTask = {
      ...task,
      persistedAt: Date.now(),
      completedAt: completedAt || Date.now()
    }

    this.persistedTasks.set(task.gid, persistedTask)

    // 如果超过最大数量，删除最旧的任务
    if (this.persistedTasks.size > this.MAX_TASKS) {
      this.cleanupOldTasks()
    }

    // SQLite 增量通道：完成一条写一条，不再把整张 Map 全量序列化。
    // 历史 5 万条时全量重写既是渲染线程的开销（JSON.stringify 整表），
    // 也是主进程的写放大（一次事务重写所有行）。
    if (window.electronAPI?.savePersistedTask) {
      try {
        const result = await window.electronAPI.savePersistedTask(task.gid, persistedTask)
        if (result?.success === false) {
          // 增量通道失败（JSON 回退后端也可能在这里失败）：记录错误并退回合批全量路径重试
          this.lastPersistError = result.error || '保存失败'
          this.schedulePersist()
        } else {
          this.lastPersistError = null
        }
      } catch (error) {
        this.lastPersistError = error instanceof Error ? error.message : String(error)
        this.schedulePersist()
      }
      devLog(`Persisted completed task: ${task.gid} at ${new Date(persistedTask.completedAt!)}`)
      return
    }

    this.schedulePersist()
    devLog(`Persisted completed task: ${task.gid} at ${new Date(persistedTask.completedAt!)}`)
  }

  /**
   * 获取所有持久化的已完成任务
   */
  getPersistedTasks(): PersistedTask[] {
    return Array.from(this.persistedTasks.values())
  }

  /**
   * 获取特定任务
   */
  getPersistedTask(gid: string): PersistedTask | undefined {
    return this.persistedTasks.get(gid)
  }

  /**
   * 检查任务是否已持久化
   */
  isTaskPersisted(gid: string): boolean {
    return this.persistedTasks.has(gid)
  }

  /**
   * 删除持久化任务
   */
  removePersistedTask(gid: string) {
    this.persistedTasks.delete(gid)
    this.deleteIncremental([gid])
    devLog(`Removed persisted task: ${gid}`)
  }

  /**
   * 批量删除持久化任务
   */
  removePersistedTasks(gids: string[]) {
    gids.forEach(gid => this.persistedTasks.delete(gid))
    this.deleteIncremental(gids)
    devLog(`Removed ${gids.length} persisted tasks`)
  }

  /**
   * 增量删除通道：Electron 后端可用时直接按 gid 删行，不再全量重写。
   * JSON 回退后端不支持增量（返回 fallback:true），此时退回合批全量保存——
   * 全量保存会把已从内存 Map 删除的 gid 一并从后端清除。
   */
  private async deleteIncremental(gids: string[]): Promise<void> {
    const api = window.electronAPI?.deletePersistedTasks
    if (!api) {
      this.schedulePersist()
      return
    }
    try {
      const result = await api(gids)
      if (result?.success === false && result.fallback) {
        this.schedulePersist()
      } else if (result?.success === false) {
        this.lastPersistError = result.error || '删除失败'
      } else {
        this.lastPersistError = null
      }
    } catch (error) {
      this.lastPersistError = error instanceof Error ? error.message : String(error)
      this.schedulePersist()
    }
  }

  /**
   * 清理过期的持久化任务
   */
  private cleanupOldTasks() {
    const tasks = Array.from(this.persistedTasks.values())

    // 按完成时间排序，保留最新的任务
    tasks.sort((a, b) => (b.completedAt || b.persistedAt) - (a.completedAt || a.persistedAt))

    // 删除超出限制的任务
    const tasksToRemove = tasks.slice(this.MAX_TASKS)
    tasksToRemove.forEach(task => {
      this.persistedTasks.delete(task.gid)
    })

    if (tasksToRemove.length > 0) {
      devLog(`Cleaned up ${tasksToRemove.length} old persisted tasks`)
    }
  }

  /**
   * 清理过期任务（超过指定天数）
   */
  cleanupExpiredTasks(days: number) {
    const expireTime = Date.now() - (days * 24 * 60 * 60 * 1000)
    let cleaned = 0

    for (const [gid, task] of this.persistedTasks.entries()) {
      const taskTime = task.completedAt || task.persistedAt
      if (taskTime < expireTime) {
        this.persistedTasks.delete(gid)
        cleaned++
      }
    }

    if (cleaned > 0) {
      this.schedulePersist()
      devLog(`Cleaned up ${cleaned} expired persisted tasks`)
    }
  }

  /**
   * 合并 Aria2 任务和持久化任务
   */
  mergeWithAria2Tasks(aria2Tasks: Aria2Task[]): Aria2Task[] {
    const aria2Gids = new Set(aria2Tasks.map(task => task.gid))
    const persistedTasks = this.getPersistedTasks()

    // 过滤出不在 Aria2 中的持久化任务
    const uniquePersistedTasks = persistedTasks.filter(task => !aria2Gids.has(task.gid))

    // 合并任务列表
    return [...aria2Tasks, ...uniquePersistedTasks]
  }

  /**
   * 同步 Aria2 已完成任务到持久化存储
   * 注意：这个方法现在主要用于初始化，不会覆盖已有记录
   */
  syncAria2CompletedTasks(aria2CompletedTasks: Aria2Task[]) {
    aria2CompletedTasks.forEach(task => {
      if (!this.isTaskPersisted(task.gid) && task.status === 'complete') {
        // 对于已存在的完成任务，使用估算的完成时间（24 小时前，保持稳定）
        const estimatedTime = Date.now() - (24 * 60 * 60 * 1000)
        this.persistCompletedTask(task, estimatedTime)
      }
    })
  }

  /**
   * 获取存储统计信息
   */
  getStorageStats() {
    return {
      totalTasks: this.persistedTasks.size,
      maxTasks: this.MAX_TASKS,
      storageKey: this.STORAGE_KEY
    }
  }

  /**
   * 清空所有持久化任务（慎用）
   */
  async clearAllPersistedTasks(): Promise<boolean> {
    this.persistedTasks.clear()
    localStorage.removeItem(this.STORAGE_KEY)
    // Electron 后端：直接清空整个后端存储，避免主进程残留旧记录
    if (window.electronAPI?.clearPersistedTasks) {
      try {
        const result = await window.electronAPI.clearPersistedTasks()
        if (result?.success === false) {
          this.lastPersistError = result.error || '清空失败'
        } else {
          this.lastPersistError = null
        }
        devLog('Cleared all persisted tasks')
        return result?.success !== false
      } catch (error) {
        this.lastPersistError = error instanceof Error ? error.message : String(error)
        // 清空通道失败时退回全量保存（空表全量保存即清空）
        const ok = await this.flush()
        devLog('Cleared all persisted tasks (fallback)')
        return ok
      }
    }
    // 无 Electron 后端：localStorage 回退
    const ok = await this.flush()
    devLog('Cleared all persisted tasks')
    return ok
  }
}

// 创建单例实例
export const taskPersistenceService = new TaskPersistenceService()

// v1.3.5 起**不再**挂 24 小时定时器按天龄静默删除历史：
// SQLite 后端的容量管理是超 5 万行裁最旧（HISTORY_MAX_ROWS），与记录新旧无关；
// 按天龄清理会无声删掉用户的历史，属于用户没有要求过的数据丢失。
// cleanupExpiredTasks 保留为显式 API，供将来设置页“清理 N 天前的记录”按钮直接调用。
