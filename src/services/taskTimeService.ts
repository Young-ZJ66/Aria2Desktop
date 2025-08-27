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
    }
  }

  /**
   * 保存任务时间记录到本地存储
   */
  private saveToStorage() {
    try {
      const data = Object.fromEntries(this.taskTimes)
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data))
    } catch (error) {
      console.error('Failed to save task times to storage:', error)
    }
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
    console.log(`Recorded add time for task ${gid}:`, new Date(now))
  }

  /**
   * 记录任务完成时间
   */
  recordTaskComplete(gid: string, fileName?: string) {
    const existing = this.taskTimes.get(gid)

    // 如果已经有完成时间，不要覆盖
    if (existing?.completeTime) {
      console.log(`Task ${gid} already has complete time, skipping update`)
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
    console.log(`Recorded complete time for task ${gid}:`, new Date(now))
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
      console.log(`Cleaned up ${cleaned} old task time records`)
    }
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

// 定期清理过期记录
setInterval(() => {
  taskTimeService.cleanupOldRecords()
}, 24 * 60 * 60 * 1000) // 每24小时清理一次
