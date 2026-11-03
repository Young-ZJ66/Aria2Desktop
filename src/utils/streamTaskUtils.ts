/**
 * 流媒体任务（yt-dlp 下载模式）的纯数据与列表映射。
 *
 * 独立成文件便于单测：把主进程进度事件收敛成 aria2 任务形状后，
 * 现有任务列表的排序/进度/名称/打开目录等逻辑可以直接复用。
 */

import type { Aria2Task } from '@/types/aria2'

export interface StreamTask {
  /** 主进程返回的下载 id（sd-xxx），同时用作列表 gid */
  gid: string
  url: string
  formatId: string
  merge: boolean
  outputDir: string
  /** 视频标题（列表展示名） */
  title: string
  status: 'active' | 'complete' | 'error'
  percent: number
  speedBytes: number
  speedText: string
  eta: string
  totalBytes: number
  downloadedBytes: number
  filePath?: string
  error?: string
  createdAt: number
  completedAt?: number
}

/** 转成与 aria2 任务同形状（列表按 totalLength/completedLength/downloadSpeed 展示） */
export function streamTaskToAria2Task(task: StreamTask): Aria2Task {
  const total = task.totalBytes
  // 防御性收敛：主进程侧已 clamp（streamDownloadService.ts），这里兜住 NaN/越界，
  // 避免进度条出现 NaN%（与 aria2 任务的 getTaskProgress 修复同一类问题）
  const safePercent = Number.isFinite(task.percent) ? Math.min(100, Math.max(0, task.percent)) : 0
  const completed = total > 0
    ? Math.min(total, Math.round(total * safePercent / 100))
    : task.downloadedBytes
  return {
    gid: task.gid,
    status: task.status,
    totalLength: String(total),
    completedLength: String(completed),
    uploadLength: '0',
    downloadSpeed: String(task.speedBytes),
    uploadSpeed: '0',
    connections: '1',
    dir: task.outputDir,
    files: [{
      index: '1',
      path: task.filePath || task.title,
      length: String(total),
      completedLength: String(completed),
      selected: 'true',
      uris: [{ uri: task.url, status: 'used' }]
    }],
    creationTime: String(Math.floor(task.createdAt / 1000)),
    completionTime: task.completedAt ? String(Math.floor(task.completedAt / 1000)) : undefined
  }
}
