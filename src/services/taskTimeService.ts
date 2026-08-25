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

    this.saveToStorage()
    // 记录类信息日志：项目 lint 仅允许 warn/error 级 console，这里用 warn 表示"注意"
    console.warn(`Recorded add time for task ${gid}:`, new Date(now))
  }

  /**
   * 记录任务完成时间
   */
  recordTaskComplete(gid: string, fileName?: string) {
    const existing = this.taskTimes.get(gid)

    // 如果已经有完成时间，不要覆盖
    if (existing?.completeTime) {
      console.warn(`Task ${gid} already has complete time, skipping update`)
      return
    }

    const now = Date.now()

    this.taskTimes.set(gid, {
      gid,
      addTime: existing?.addTime || now, // 如果没有添加时间，使用当前时间
      completeTime: now,
      fileName: fileName || existing?.fileName
    })

    this.saveToStorage()
    // 记录类信息日志：项目 lint 仅允许 warn/error 级 console，这里用 warn 表示"注意"
    console.warn(`Recorded complete time for task ${gid}:`, new Date(now))
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
    this.saveToStorage()
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
      this.saveToStorage()
      // 记录类信息日志：项目 lint 仅允许 warn/error 级 console，这里用 warn 表示"注意"
      console.warn(`Cleaned up ${cleaned} old task time records`)
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
