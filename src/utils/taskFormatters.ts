/**
 * 任务显示相关的共享格式化工具函数
 * 统一 TaskList 和 TaskDetail 中重复的格式化逻辑
 */

import type { Aria2Task } from '@/types/aria2'
import { getLocale } from '@/i18n'
import {
  formatSpeed as utilFormatSpeed,
  formatTime,
  getTaskRemainingTime
} from '@/utils/taskUtils'

/**
 * 格式化字节大小字符串为人类可读格式
 */
export function formatSize(bytes: string | number): string {
  const size = typeof bytes === 'string' ? parseInt(bytes) : bytes
  if (!Number.isFinite(size) || size <= 0) return '0 B'

  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(size) / Math.log(k)), sizes.length - 1)

  return parseFloat((size / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

/**
 * 格式化下载速度
 */
export function formatSpeed(speed: string | number): string {
  const speedNum = typeof speed === 'string' ? parseInt(speed) : speed
  return utilFormatSpeed(speedNum)
}

/**
 * 格式化剩余时间
 */
export function formatRemainingTime(task: Aria2Task): string {
  const remainingSeconds = getTaskRemainingTime(task)
  return formatTime(remainingSeconds)
}

/**
 * 获取任务进度百分比
 */
export function getProgress(task: Aria2Task): number {
  const total = parseInt(task.totalLength)
  const completed = parseInt(task.completedLength)

  if (total === 0) return 0
  return Math.round((completed / total) * 100)
}

/**
 * 获取进度条状态
 */
export function getProgressStatus(task: Aria2Task): string {
  switch (task.status) {
    case 'complete': return 'success'
    case 'error': return 'exception'
    case 'active': return ''
    default: return ''
  }
}

/**
 * 获取状态标签类型
 */
export function getStatusType(status: string): string {
  switch (status) {
    case 'active': return 'primary'
    case 'waiting': return 'warning'
    case 'paused': return 'info'
    case 'complete': return 'success'
    case 'error': return 'error'
    default: return ''
  }
}

/**
 * 获取任务显示名称
 */
export function getTaskDisplayName(task: Aria2Task): string {
  if (task.bittorrent?.info?.name) {
    return task.bittorrent.info.name
  }

  if (task.files && task.files.length > 0) {
    const file = task.files[0]
    const path = file.path
    return path.split('/').pop() || path.split('\\').pop() || 'Unknown'
  }

  return `Task ${task.gid}`
}

/**
 * 从路径中提取文件名
 */
export function getFileName(path: string): string {
  return path.split('/').pop() || path.split('\\').pop() || path
}

/**
 * 格式化完成时间为友好显示
 */
export function formatCompleteTime(timestamp: number): string {
  const locale = getLocale()
  const date = new Date(timestamp)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const taskDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())

  // 如果是今天，只显示时间
  if (taskDate.getTime() === today.getTime()) {
    return date.toLocaleTimeString(locale, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  }

  // 如果是昨天
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)
  if (taskDate.getTime() === yesterday.getTime()) {
    return (locale === 'zh-CN' ? '昨天 ' : 'Yesterday ') + date.toLocaleTimeString(locale, {
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  // 如果是今年，显示月日和时间
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(locale, {
      month: '2-digit',
      day: '2-digit'
    }) + ' ' + date.toLocaleTimeString(locale, {
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  // 其他情况显示完整日期和时间
  return date.toLocaleDateString(locale) + ' ' + date.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit'
  })
}
