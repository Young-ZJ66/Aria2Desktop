/**
 * 会话管理器 - 处理Aria2任务的即时保存和批量保存
 * 解决新添加任务在应用退出时丢失的问题
 */

export class SessionManager {
  private saveTimer: ReturnType<typeof setTimeout> | null = null
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

      // 主进程 RPC 失败时返回 { success: false, error }（而非抛错），
      // 因此必须检查返回值：此前无条件 return true 会让调用方以为会话已落盘，
      // 结果是崩溃后未完成任务静默从恢复列表消失，且没有任何日志。
      const result = await window.electronAPI.saveSession()
      if (!result?.success) {
        console.warn('Session save rejected by main process:', result?.error)
        return false
      }
      return true
    } catch (error) {
      console.error('Failed to save session immediately:', error)
      // 保存失败时重置 needsResave，避免 finally 中调度重复重试导致连锁失败
      this.needsResave = false
      return false
    } finally {
      // 保存期间有新的保存请求：在释放 isSaving 之前调度微任务串行重试，
      // 重试会重新获取 isSaving 锁，避免与外部 immediate 调用并发
      if (this.needsResave) {
        this.needsResave = false
        queueMicrotask(() => void this.saveSessionImmediate())
      }
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
   * 标记任务需要保存（触发一次防抖保存，确保新任务快速持久化）
   */
  markTaskForSave(gid: string): void {
    void gid
    this.saveSessionDebounced(500)
  }
}

// 导出单例实例
export const sessionManager = new SessionManager()
