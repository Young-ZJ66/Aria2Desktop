import type { Aria2Task } from '@/types/aria2'
import { getTaskName } from '@/utils/taskUtils'

/** 单个失败项：任务名 + 已本地化的原因 */
export interface BatchFailure {
  name: string
  reason: string
}

/** 一批批量操作的汇总结果（D-39 / D-51）：成功、失败、跳过与失败详情 */
export interface BatchOutcome {
  success: number
  failed: number
  skipped: number
  failures: BatchFailure[]
}

/** 建一个空的汇总结果 */
export function createBatchOutcome(): BatchOutcome {
  return { success: 0, failed: 0, skipped: 0, failures: [] }
}

/** 记录一次失败：计数 + 留下任务名与原因，供结果面板逐条列明 */
export function recordFailure(outcome: BatchOutcome, name: string, reason: string): void {
  outcome.failed += 1
  outcome.failures.push({ name, reason })
}

/** 按任务记录一次失败（名字取自任务本身，失败详情里不能只有 gid） */
export function recordBatchFailure(outcome: BatchOutcome, task: Aria2Task, reason: string): void {
  recordFailure(outcome, getTaskName(task), reason)
}

/**
 * 是否需要弹结果面板。
 * 全部成功时只给一条 success 提示就够了，面板留给「有失败或有跳过」的情况——
 * 那才是用户需要逐条看清楚、并照着失败项继续操作的时候。
 */
export function needsBatchResult(outcome: BatchOutcome | null): outcome is BatchOutcome {
  if (!outcome) return false
  return outcome.failed > 0 || outcome.skipped > 0
}
