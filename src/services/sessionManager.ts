/**
 * 会话管理器 - 处理Aria2任务的即时保存和批量保存
 * 解决新添加任务在应用退出时丢失的问题
 */

export class SessionManager {
  private saveQueue = new Set<string>()
  private saveTimer: NodeJS.Timeout | null = null
  private isSaving = false
  private forceMode = false

  /**
   * 立即保存会话
   */
  async saveSessionImmediate(): Promise<boolean> {
    if (this.isSaving) {
      console.log('Session save already in progress, skipping...')
      return false
    }

    this.isSaving = true
    try {
      // 通过Electron API调用Aria2的saveSession
      if (!window.electronAPI?.saveSession) {
        console.warn('Electron API not available for session saving')
        return false
      }

      const result = await window.electronAPI.saveSession()
      console.log('Session saved immediately:', result)
      return true
    } catch (error) {
      console.error('Failed to save session immediately:', error)
      return false
    } finally {
      this.isSaving = false
    }
  }

  /**
   * 延迟保存会话（防抖）
   */
  saveSessionDebounced(delay: number = 1000): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
    }

    this.saveTimer = setTimeout(async () => {
      await this.saveSessionImmediate()
      this.saveTimer = null
    }, delay)
  }

  /**
   * 标记任务需要保存
   */
  markTaskForSave(gid: string): void {
    this.saveQueue.add(gid)
    
    // 短延迟保存，确保新任务快速持久化
    this.saveSessionDebounced(500)
  }

  /**
   * 批量保存标记的任务
   */
  async savePendingTasks(): Promise<boolean> {
    if (this.saveQueue.size === 0) {
      return true
    }

    console.log(`Batch saving ${this.saveQueue.size} tasks`)
    const success = await this.saveSessionImmediate()
    
    if (success) {
      this.saveQueue.clear()
    }
    
    return success
  }

  /**
   * 强制保存模式 - 应用退出时使用
   */
  async forceExit(): Promise<boolean> {
    this.forceMode = true
    
    // 清除延迟保存定时器
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    
    // 执行最终保存
    return await this.saveSessionImmediate()
  }

  /**
   * 获取待保存任务数量
   */
  getPendingTaskCount(): number {
    return this.saveQueue.size
  }
}

// 导出单例实例
export const sessionManager = new SessionManager()