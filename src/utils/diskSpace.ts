/**
 * 磁盘空间预检（纯函数，便于单测）。
 *
 * 主进程侧只做 statfs 查询（见 IpcController 的 get-disk-free-space），
 * "空间是否够"的判定收在这一个纯函数里，供新建任务各页共用。
 */

export interface DiskSpaceInfo {
  /** 剩余空间（字节）；主进程查询失败时为 -1（未知） */
  free: number
  /** 总容量（字节） */
  total: number
}

/** 主进程查询失败时的哨兵值：渲染层视作"未知"，跳过预检（保持原行为） */
export const DISK_SPACE_UNKNOWN = -1

/**
 * 剩余空间是否足以容纳 requiredBytes 的下载。
 * - 空间未知（free < 0）或需求非法（<=0）时不拦截——预检是尽力而为，不能阻塞正常任务；
 * - 恰好相等视为足够（文件系统保留块等余量问题由后续 aria2 报错兜底，错误文案已人话化）。
 */
export function isDiskSpaceSufficient(freeBytes: number, requiredBytes: number): boolean {
  if (!Number.isFinite(freeBytes) || freeBytes < 0) return true
  if (!Number.isFinite(requiredBytes) || requiredBytes <= 0) return true
  return freeBytes >= requiredBytes
}
