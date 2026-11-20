/**
 * D-24 任务状态筛选：纯函数，便于单测（组件本身无法在 node 环境挂载）。
 */

export type TaskStatusFilter = 'all' | 'active' | 'waiting' | 'paused' | 'error' | 'complete'

/** 筛选顺序：先「全部」，再按任务生命周期排列 */
export const TASK_STATUS_FILTERS: readonly TaskStatusFilter[] = [
  'all',
  'active',
  'waiting',
  'paused',
  'error',
  'complete'
] as const

export type TaskListType = 'active' | 'waiting' | 'stopped' | 'active-and-waiting'

/**
 * 每个列表实际可能出现哪些状态。
 *
 * 为什么需要按列表裁剪：TaskList 的 allTasks 会按 taskType 组装数据源——
 * 完成页已经把 error 任务过滤掉了（失败任务归入下载页），等待页只有 waiting。
 * 如果所有页面都给出六个选项，用户在完成页点「失败」只会看到空列表。
 */
export function availableStatusFilters(taskType: TaskListType): Exclude<TaskStatusFilter, 'all'>[] {
  switch (taskType) {
    case 'waiting':
      return ['waiting']
    case 'stopped':
      return ['complete']
    case 'active':
      return ['active', 'paused', 'waiting']
    case 'active-and-waiting':
    default:
      return ['active', 'waiting', 'paused', 'error', 'complete']
  }
}

/**
 * 任务状态是否匹配筛选。
 *
 * 注意 aria2 的 'removed' 状态：它既不属于失败也不属于完成，选中任何具体状态时
 * 都应被排除（只有「全部」保留）。
 */
export function matchesStatusFilter(
  status: string | undefined,
  filter: TaskStatusFilter
): boolean {
  if (filter === 'all') return true
  if (!status) return false
  return status === filter
}

/** 是否为「失败」任务：aria2 用 status=error 表示下载失败 */
export function isFailedTask(status: string | undefined): boolean {
  return status === 'error'
}
