/**
 * 任务时间记录服务
 * 用于记录任务的添加时间和完成时间
 */

export interface TaskTimeRecord {
  gid: string
  addTime: number      // 任务添加到下载列表的时间
  completeTime?: number // 任务完成的时间
  fileName?: string    // 文件名（用于显示）
}

class TaskTimeService {
  private readonly STORAGE_KEY = 'aria2_task_times'
  private readonly MAX_RECORDS = 2000
  private taskTimes: Map<string, TaskTimeRecord> = new Map()
  /** 合批落盘定时器（见 scheduleSave 的说明） */
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  /** 合批窗口：够短以免退出丢记录，够长以吸收批量写入 */
  private static readonly SAVE_DEBOUNCE_MS = 300

  constructor() {
    this.loadFromStorage()
  }

  /**
   * 从本地存储加载任务时间记录
   */
  private loadFromStorage() {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY)
      if (stored) {
        const data = JSON.parse(stored)
        this.taskTimes = new Map(Object.entries(data))
      }
    } catch (error) {
      console.error('Failed to load task times from storage:', error)
      // 清理损坏数据，避免下次启动仍反复 parse 失败
      localStorage.removeItem(this.STORAGE_KEY)
      this.taskTimes = new Map()
    }
  }

  /**
   * 保存任务时间记录到本地存储
   *
   * 注意：这是**同步**的全量序列化 + localStorage 写入，因此调用方一律走
   * `scheduleSave()` 合批，避免"每个新任务写一次全量"卡住渲染线程。
   */
  private saveToStorage() {
    this.cleanupIfOverLimit()
    try {
      const data = Object.fromEntries(this.taskTimes)
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data))
    } catch (error) {
      console.error('Failed to save task times to storage:', error)
    }
  }

  /**
   * 合批保存：把同一批（如首次连上外部引擎时为数百个任务逐个 recordTaskAdd）
   * 的写入合并成一次全量序列化。
   *
   * 为什么需要：`taskStore.loadAllTasks` 对每个新出现的任务都会调 `recordTaskAdd`，
   * 而每次都会 `Object.fromEntries` + `JSON.stringify` 全部记录（上限 2000 条）并同步写盘。
   */
  private scheduleSave(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.saveToStorage()
    }, TaskTimeService.SAVE_DEBOUNCE_MS)
  }

  /** 立即落盘（退出前/需要强一致时） */
  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    this.saveToStorage()
  }

  /**
   * 超出上限时按时间排序删除最旧记录（无完成时间时用添加时间）
   */
  private cleanupIfOverLimit() {
    if (this.taskTimes.size <= this.MAX_RECORDS) return
    const records = Array.from(this.taskTimes.values())
    records.sort((a, b) => (b.completeTime || b.addTime) - (a.completeTime || a.addTime))
    const recordsToRemove = records.slice(this.MAX_RECORDS)
    recordsToRemove.forEach(record => {
      this.taskTimes.delete(record.gid)
    })
  }

  /**
   * 记录任务添加时间
   */
  recordTaskAdd(gid: string, fileName?: string) {
    const now = Date.now()
    const existing = this.taskTimes.get(gid)

    this.taskTimes.set(gid, {
      gid,
      addTime: existing?.addTime || now, // 如果已存在，保持原有的添加时间
      completeTime: existing?.completeTime,
      fileName: fileName || existing?.fileName
    })

    this.scheduleSave()
  }

  /**
   * 记录任务完成时间
   */
  recordTaskComplete(gid: string, fileName?: string) {
    const existing = this.taskTimes.get(gid)

    // 如果已经有完成时间，不要覆盖
    if (existing?.completeTime) return

    const now = Date.now()

    this.taskTimes.set(gid, {
      gid,
      addTime: existing?.addTime || now, // 如果没有添加时间，使用当前时间
      completeTime: now,
      fileName: fileName || existing?.fileName
    })

    this.scheduleSave()
  }

  /**
   * 获取任务时间记录
   */
  getTaskTime(gid: string): TaskTimeRecord | undefined {
    return this.taskTimes.get(gid)
  }

  /**
   * 获取任务完成时间
   */
  getCompleteTime(gid: string): number | undefined {
    return this.taskTimes.get(gid)?.completeTime
  }

  /**
   * 获取任务添加时间
   */
  getAddTime(gid: string): number | undefined {
    return this.taskTimes.get(gid)?.addTime
  }

  /**
   * 删除任务时间记录
   */
  removeTaskTime(gid: string) {
    this.taskTimes.delete(gid)
    this.scheduleSave()
  }

  /**
   * 清理过期的任务时间记录（超过30天的记录）
   */
  cleanupOldRecords() {
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000)
    let cleaned = 0

    for (const [gid, record] of this.taskTimes.entries()) {
      const recordTime = record.completeTime || record.addTime
      if (recordTime < thirtyDaysAgo) {
        this.taskTimes.delete(gid)
        cleaned++
      }
    }

    if (cleaned > 0) {
      this.scheduleSave()
    }
  }

  /**
   * 清空所有任务时间记录（连接切换时使用）
   */
  clearAll() {
    this.taskTimes.clear()
    localStorage.removeItem(this.STORAGE_KEY)
  }

  /**
   * 获取所有任务时间记录（用于调试）
   */
  getAllRecords(): TaskTimeRecord[] {
    return Array.from(this.taskTimes.values())
  }
}

// 创建单例实例
export const taskTimeService = new TaskTimeService()

// 定期清理过期记录（保存引用，可通过 stopTimeCleanupTimer 停止）
const timeCleanupTimer = setInterval(() => {
  taskTimeService.cleanupOldRecords()
}, 24 * 60 * 60 * 1000) // 每24小时清理一次

export function stopTimeCleanupTimer() {
  clearInterval(timeCleanupTimer)
}
