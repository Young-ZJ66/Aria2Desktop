/**
 * 流媒体任务（yt-dlp 下载模式）的纯数据与列表映射。
 *
 * 独立成文件便于单测：把主进程进度事件收敛成 aria2 任务形状后，
 * 现有任务列表的排序/进度/名称/打开目录等逻辑可以直接复用。
 */

import type { Aria2Task } from '@/types/aria2'

/**
 * 发起一次流媒体下载的完整入参。
 *
 * 为什么要随任务一起存下来：D-37/D-38 要求「应用重启后仍可重试」与「重试透传全部参数」，
 * 而 yt-dlp 的 playlist/subtitle/cookieFile/extractAudio 一旦丢失，重试出来的任务与
 * 用户当初发起的不是同一个东西（少下几集、没有字幕、会员视频 403）。扩展发起的下载
 * 没有这些字段，全部可选，读取方必须能安全降级。
 */
export interface StreamTaskInput {
  url: string
  formatId: string
  merge: boolean
  outputDir: string
  title: string
  /** 播放列表选中条目 id（--playlist-items 语义） */
  playlist?: { ids: string[] }
  /** 字幕设置（enabled 时写字幕并转 srt） */
  subtitle?: { enabled: boolean; languages: string[]; includeAuto?: boolean }
  /** Cookie 文件绝对路径（会员视频等登录态场景） */
  cookieFile?: string
  /** 提取音频并转 MP3 */
  extractAudio?: boolean
}

export interface StreamTask {
  /** 主进程返回的下载 id（sd-xxx），同时用作列表 gid */
  gid: string
  url: string
  formatId: string
  merge: boolean
  outputDir: string
  /** 视频标题（列表展示名） */
  title: string
  status: 'active' | 'paused' | 'complete' | 'error'
  percent: number
  speedBytes: number
  speedText: string
  eta: string
  totalBytes: number
  downloadedBytes: number
  /** 首个输出文件（历史字段，保留兼容；多文件场景见 filePaths） */
  filePath?: string
  /** 全部输出文件：播放列表/多字幕会产出多个文件（主进程 completed 事件携带） */
  filePaths?: string[]
  error?: string
  createdAt: number
  completedAt?: number
  /** 发起时的完整入参；扩展发起的旧记录没有该字段，读取时必须降级 */
  input?: StreamTaskInput
}

/**
 * 任务实际产出的文件列表（去重、保持顺序）。
 *
 * 优先 filePaths（多文件），回退到历史单文件 filePath；两者都没有时返回空数组，
 * 调用方据此跳过删除而不是拿标题当路径去删。
 */
export function streamTaskFilePaths(task: StreamTask): string[] {
  const paths: string[] = []
  for (const candidate of task.filePaths ?? []) {
    if (typeof candidate === 'string' && candidate && !paths.includes(candidate)) paths.push(candidate)
  }
  if (task.filePath && !paths.includes(task.filePath)) paths.push(task.filePath)
  return paths
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
      // 多文件（播放列表）时展示第一个文件，与删除顺序/通知文案保持一致
      path: task.filePaths?.[0] || task.filePath || task.title,
      length: String(total),
      completedLength: String(completed),
      selected: 'true',
      uris: [{ uri: task.url, status: 'used' }]
    }],
    creationTime: String(Math.floor(task.createdAt / 1000)),
    completionTime: task.completedAt ? String(Math.floor(task.completedAt / 1000)) : undefined
  }
}
