/**
 * 任务来源类型判定（任务列表筛选用）。
 *
 * Metalink 任务创建后与普通 HTTP 任务没有区别（aria2 只保留最终 URI），
 * 因此不单列类型；磁力任务在元数据下载完成前还没有 bittorrent 字段，
 * 先按 magnet 归类，拿到元数据后自然变成 bt。
 */

import type { Aria2Task } from '@/types/aria2'

export type TaskKind = 'http' | 'ftp' | 'bt' | 'magnet' | 'stream'

export function detectTaskKind(task: Aria2Task, isStreamTask = false): TaskKind {
  if (isStreamTask) return 'stream'
  if (task.bittorrent) return 'bt'

  const uris = (task.files ?? []).flatMap(file => (file.uris ?? []).map(item => item.uri))
  if (uris.some(uri => uri.startsWith('magnet:'))) return 'magnet'
  if (uris.some(uri => /^(ftp|sftp):/i.test(uri))) return 'ftp'
  return 'http'
}
