/**
 * 「下载全部完成后执行关机/休眠/退出」的判定规则。
 *
 * 这是 PureCore：被 useAppLifecycle 的 watcher 使用，也被单测锁定语义。
 * 历史教训（2026-11）：旧实现只看 activeTasks 的长度——
 * 1. 用户手动暂停最后一个任务时，任务从 tellActive 挪进 tellWaiting（暂停的任务
 *    在 aria2 里属于等待队列），长度归零被误判成"全部完成"，电脑被关机；
 * 2. 连接断开时任务列表被清空，同样长度归零，网络抖动一次就可能关机。
 * 3. 用户删掉最后一个活动任务（或任务失败进了 stopped 但被清掉）时，两个队列
 *    同样归零——空队列并不等于"有东西下载完了"。因此还要求"确实存在已完成
 *    任务"：完成后被用户立刻删光时也不该关机。
 * 因此"全部完成"必须同时满足：没有活动任务、没有等待任务（含排队与暂停）、连接还在、
 * 至少有一个已完成任务。
 */

export type CompletionWatchResult = 'mark-active' | 'fire' | 'ignore'

export interface CompletionWatchInput {
  /** 上一轮观察以来是否出现过活动任务（防止启动时空列表触发动作） */
  hadActiveTasks: boolean
  /** 活动任务数（aria2 tellActive） */
  activeCount: number
  /** 等待任务数（aria2 tellWaiting，包含排队与暂停） */
  waitingCount: number
  /** 当前是否连接着引擎 */
  isConnected: boolean
  /** 已完成任务数（aria2 tellStopped；完成后被删光则为 0） */
  completedCount: number
}

/** 每次任务列表变化时判定：标记出现过活动任务 / 触发完成动作 / 忽略 */
export function evaluateDownloadCompletion(input: CompletionWatchInput): CompletionWatchResult {
  if (input.activeCount + input.waitingCount > 0) return 'mark-active'
  // 列表为空时必须"确实连着引擎"才算完成：断线后列表是被 clearTasks 清空的，
  // 不是下载完成了；也绝不能在从未有过活动任务时触发
  if (!input.isConnected || !input.hadActiveTasks) return 'ignore'
  // 空队列 ≠ 下载完成：删掉/失败掉最后一个任务也会清空两个队列，
  // 必须确实有"已完成"的任务撑着才算数
  if (input.completedCount <= 0) return 'ignore'
  return 'fire'
}

/** Windows 的 shutdown /t 60 带系统级 60 秒宽限，与这里保持一致 */
export const SHUTDOWN_CANCEL_WINDOW_MS = 60_000

/**
 * 关机已进入系统倒计时后，用户又添加了新任务——替用户撤销关机。
 * @param shutdownArmedAt 关机命令成功执行的时刻（毫秒时间戳），0 表示没有挂起的关机
 */
export function shouldCancelPendingShutdown(shutdownArmedAt: number, now: number, taskCount: number): boolean {
  return shutdownArmedAt > 0 && taskCount > 0 && now - shutdownArmedAt < SHUTDOWN_CANCEL_WINDOW_MS
}
