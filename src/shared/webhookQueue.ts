/**
 * Webhook 投递队列契约（主进程 webhookDispatchService 与渲染层共用）
 *
 * 主进程产物是 CJS，运行时无法解析 @/ 别名；主进程引入必须用相对路径
 * （参照 rssSubscriptionService.ts 引 autoImport 的方式）。
 */

/** 单条 Webhook 投递队列条目（持久化于 store 顶层键 webhookQueue） */
export interface WebhookQueueEntry {
  id: string
  /** 目标 URL（http/https） */
  url: string
  /** HTTP 方法 */
  method: 'POST' | 'GET'
  /** 事件名（download.complete / download.error） */
  event: string
  /** 关联任务 gid（可为空字符串） */
  gid: string
  /** 已尝试次数（含首次投递） */
  attempts: number
  /** 最大重试次数（不含首次投递） */
  maxRetries: number
  /** 指数退避基准秒数（入队时固化；缺省 60） */
  baseDelaySeconds: number
  /** 下次投递时间（epoch 毫秒） */
  nextAttemptAt: number
  /** 最近一次失败原因 */
  lastError: string
  /** pending=待投递/退避等待 delivering=投递进行中 failed=超过重试上限待人工处理 */
  status: 'pending' | 'delivering' | 'failed'
  /** 入队时间（epoch 毫秒） */
  createdAt: number
  /** 最近一次尝试时间（epoch 毫秒） */
  lastAttemptAt?: number
  /**
   * 投递载荷（入队时快照）。
   *
   * 为什么不投递时再查：任务状态与文件列表在重试时可能已被 aria2 清理，
   * 队列要能独立重放，所以载荷必须随条目落盘。
   */
  payload?: Record<string, unknown>
}
