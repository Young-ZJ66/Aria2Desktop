import type { Aria2Task } from '@/types/aria2'

/**
 * 重复任务检测（纯函数，便于单测）。
 *
 * 场景：剪贴板预填 / 批量粘贴 / 手动输入都可能重复添加同一链接。aria2 对相同 URI
 * 不去重（会再下一个副本），文件重名只在"提交后"由冲突确认兜底——最好在提交前提示。
 *
 * 只比对**未完成**的任务（active / waiting / paused）：重新下载已完成任务通常是
 * 有意为之，不应拦；error 任务重提即重试，也不拦。
 */

/** 参与重复比对的进行中状态 */
const DUPLICATABLE_STATUSES: ReadonlySet<Aria2Task['status']> = new Set([
  'active',
  'waiting',
  'paused'
])

/**
 * 规范化 URL 用于相等比较：
 * - magnet: 按 `xt` 中的 infoHash 归一——同一种子换 tracker / 改 dn 是同一任务，
 *   整串比对会漏报；
 * - 去 hash（fragment 不参与服务器请求，同一资源常带不同分享锚点）；
 * - 去尾部斜杠（仅无 query 时；`https://a/f.zip` 与 `https://a/f.zip/` 对 aria2
 *   是两个 URI，但落地文件名一致，按重复处理更符合直觉）；
 * - scheme 与 host 小写（协议与域名不区分大小写，路径区分）。
 * 解析失败（非法输入）时原样小写返回。
 */
export function normalizeUrlForCompare(raw: string): string {
  const trimmed = raw.trim()
  try {
    const url = new URL(trimmed)
    if (url.protocol === 'magnet:') {
      const xt = url.searchParams.get('xt')
      if (xt) return 'magnet:' + xt.toLowerCase()
    }
    url.hash = ''
    let out = url.toString()
    if (!url.search && out.endsWith('/') && url.pathname !== '/') out = out.slice(0, -1)
    // URL.toString() 已把 scheme/host 规范为小写
    return out
  } catch {
    return trimmed.toLowerCase()
  }
}

export interface DuplicateMatch {
  /** 用户输入且命中的原始 URI */
  uri: string
  /** 已有任务 gid */
  gid: string
  /** 已有任务状态 */
  status: Aria2Task['status']
  /** 展示用任务名：普通任务取首个文件路径名，BT 取 info.name */
  name: string
}

/** 从任务记录提取展示名（与任务列表的命名规则一致：BT 名优先，其次文件路径） */
function taskDisplayName(task: Aria2Task): string {
  const btName = task.bittorrent?.info?.name
  if (btName) return btName
  const path = task.files[0]?.path ?? ''
  if (!path) return task.gid
  // aria2 的 path 是绝对路径；列表页展示也只需末段
  return path.split(/[\\/]/).pop() || task.gid
}

/**
 * 在任务列表中查找与输入 URI 重复的**进行中**任务。
 * 返回按"输入顺序、同 URI 按任务创建时间新在前"排序的去重结果
 * （每个输入 URI 至多一条，避免提示里重复罗列同一个链接）。
 */
export function findDuplicateUris(
  uris: string[],
  tasks: Aria2Task[]
): DuplicateMatch[] {
  const normalizedTasks: { task: Aria2Task; uris: Set<string> }[] = []
  for (const task of tasks) {
    if (!DUPLICATABLE_STATUSES.has(task.status)) continue
    const taskUris = new Set<string>()
    for (const file of task.files) {
      for (const { uri } of file.uris) {
        taskUris.add(normalizeUrlForCompare(uri))
      }
    }
    if (taskUris.size > 0) normalizedTasks.push({ task, uris: taskUris })
  }
  if (normalizedTasks.length === 0) return []

  const seenInput = new Set<string>()
  const matches: DuplicateMatch[] = []
  for (const raw of uris) {
    const normalized = normalizeUrlForCompare(raw)
    if (seenInput.has(normalized)) continue
    seenInput.add(normalized)
    const hit = normalizedTasks.find(t => t.uris.has(normalized))
    if (hit) {
      matches.push({
        uri: raw,
        gid: hit.task.gid,
        status: hit.task.status,
        name: taskDisplayName(hit.task)
      })
    }
  }
  return matches
}

/**
 * 磁力链接判重（会话级索引路径）。
 *
 * 实测（aria2 1.37）：magnet 发起的任务 files[].uris 为**空数组**——引擎不保存
 * magnet URI，上面的 findDuplicateUris 对磁力任务天然不命中。补这条路径：
 * store 在 addUri 时把 magnet → gid 记进会话级索引，这里拿索引反查任务。
 *
 * @param magnetIndex 规范化 magnet（normalizeUrlForCompare，即 magnet:infoHash）→ gid
 */
export function findMagnetDuplicates(
  uris: string[],
  magnetIndex: ReadonlyMap<string, string>,
  tasks: Aria2Task[]
): DuplicateMatch[] {
  if (magnetIndex.size === 0) return []
  const byGid = new Map(tasks.map(t => [t.gid, t]))
  const seen = new Set<string>()
  const matches: DuplicateMatch[] = []
  for (const raw of uris) {
    const normalized = normalizeUrlForCompare(raw)
    if (!normalized.startsWith('magnet:') || seen.has(normalized)) continue
    seen.add(normalized)
    const gid = magnetIndex.get(normalized)
    if (!gid) continue
    const task = byGid.get(gid)
    if (!task || !DUPLICATABLE_STATUSES.has(task.status)) continue
    matches.push({
      uri: raw,
      gid,
      status: task.status,
      name: taskDisplayName(task)
    })
  }
  return matches
}
