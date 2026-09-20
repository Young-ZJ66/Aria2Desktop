/**
 * 任务列表指纹计算（纯函数，独立于 Pinia store，便于单测）。
 *
 * 用途：定时轮询返回的 waiting/stopped 列表，在内容未变化时保留旧数组引用，
 * 避免每秒全量替换数组触发表格无效 diff 与全量重排序。
 */

/** 指纹计算所需的最小任务形状（只依赖 gid 与 status，不引入完整任务类型） */
export interface FingerprintTask {
  gid: string
  status: string
}

/**
 * 计算任务列表指纹（djb2 滚动哈希）。
 * 相比全量 stringify（map+join 生成 O(n) 大字符串），逐字符累加哈希，
 * 大列表（1000+）每秒轮询时显著降低内存与 CPU 开销。
 * 注：gid 为 16 位十六进制字符串，哈希碰撞概率可忽略。
 */
export function computeTaskListFingerprint(tasks: readonly FingerprintTask[]): string {
  let hash = 5381
  for (const task of tasks) {
    const gid = task.gid
    for (let j = 0; j < gid.length; j++) {
      hash = ((hash << 5) + hash + gid.charCodeAt(j)) >>> 0
    }
    hash = ((hash << 5) + hash + task.status.charCodeAt(0)) >>> 0
  }
  return hash.toString(36)
}
