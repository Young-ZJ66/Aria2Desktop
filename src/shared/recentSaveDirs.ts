/**
 * 最近保存目录列表的维护逻辑（纯函数，便于单测）。
 *
 * 新建任务成功提交时记录目标目录，供三页目录输入的快捷下拉选择。
 * 最新在前、去重、上限 8 条；反斜杠路径统一为正斜杠比较（Windows 两种
 * 写法指同一目录，不应占两条名额）。
 */

export const RECENT_SAVE_DIRS_MAX = 8

/** 比较用归一化：反斜杠→正斜杠、去尾部斜杠、小写（Windows 盘符/路径不区分大小写） */
function normalizeForCompare(dir: string): string {
  return dir.replace(/\\+/g, '/').replace(/\/+$/, '').toLowerCase()
}

/**
 * 把 dir 记入最近列表：已存在则提升到最前，不存在则插入头部；超过上限截断。
 * 返回新数组（不修改入参）。
 */
export function pushRecentSaveDir(recent: string[], dir: string): string[] {
  const trimmed = dir.trim()
  if (!trimmed) return recent
  const key = normalizeForCompare(trimmed)
  const next = [trimmed, ...recent.filter(d => normalizeForCompare(d) !== key)]
  return next.slice(0, RECENT_SAVE_DIRS_MAX)
}
