/**
 * 会话管理器 - 处理Aria2任务的即时保存和批量保存
 * 解决新添加任务在应用退出时丢失的问题
 */

export class SessionManager {
  private saveTimer: NodeJS.Timeout | null = null
  private isSaving = false
  /** 保存进行期间又有新保存请求到达时，完成后补一次保存 */
  private needsResave = false

  /**
   * 立即保存会话
   */
  async saveSessionImmediate(): Promise<boolean> {
    if (this.isSaving) {
      // 正在保存时记录待重试，避免本次变更被静默丢弃
      this.needsResave = true
      return false
    }

    this.isSaving = true
    try {
      // 通过Electron API调用Aria2的saveSession
      if (!window.electronAPI?.saveSession) {
        console.warn('Electron API not available for session saving')
        return false
      }

      await window.electronAPI.saveSession()
      return true
    } catch (error) {
      console.error('Failed to save session immediately:', error)
      return false
    } finally {
      this.isSaving = false
      // 保存期间有新的保存请求：稍后补一次，确保最新状态落盘
      if (this.needsResave) {
        this.needsResave = false
        this.saveSessionDebounced(500)
      }
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
   * 标记任务需要保存（触发一次防抖保存，确保新任务快速持久化）
   */
  markTaskForSave(gid: string): void {
    void gid
    this.saveSessionDebounced(500)
  }
}

// 导出单例实例
export const sessionManager = new SessionManager()
