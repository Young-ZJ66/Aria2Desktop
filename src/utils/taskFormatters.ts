/**
 * 任务显示相关的共享格式化工具函数
 * 统一 TaskList 和 TaskDetail 中重复的格式化逻辑
 */

import type { Aria2Task } from '@/types/aria2'
import i18n, { getLocale } from '@/i18n'
import {
  formatSize as utilFormatSize,
  formatSpeed as utilFormatSpeed,
  formatTime,
  getTaskProgress,
  getTaskRemainingTime,
  getTaskName
} from '@/utils/taskUtils'

/** Naive UI 组件（NTag 等）的状态类型联合 */
export type StatusTagType = 'primary' | 'success' | 'warning' | 'info' | 'error' | 'default'

/**
 * 格式化字节大小字符串为人类可读格式（委托 taskUtils 统一实现）
 */
export function formatSize(bytes: string | number): string {
  const size = typeof bytes === 'string' ? parseInt(bytes, 10) : bytes
  return utilFormatSize(size)
}

/**
 * 格式化下载速度
 */
export function formatSpeed(speed: string | number): string {
  const speedNum = typeof speed === 'string' ? parseInt(speed, 10) : speed
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
 * 获取任务进度百分比（委托 taskUtils 统一实现）
 */
export function getProgress(task: Aria2Task): number {
  return getTaskProgress(task)
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
 * 获取状态标签类型（返回类型与 Naive UI NTag 的 type prop 对齐）
 */
export function getStatusType(status: string): StatusTagType {
  switch (status) {
    case 'active': return 'primary'
    case 'waiting': return 'warning'
    case 'paused': return 'info'
    case 'complete': return 'success'
    case 'error': return 'error'
    default: return 'default'
  }
}

/**
 * 获取任务显示名称（委托 taskUtils 的 getTaskName，含空值守卫，避免多处实现行为不一致）
 */
export function getTaskDisplayName(task: Aria2Task): string {
  return getTaskName(task)
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
  // 守卫无效时间戳（NaN/Infinity），避免 Invalid Date 渲染乱码
  if (!Number.isFinite(timestamp)) return '--'

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

  // 如果是昨天（"昨天"文案走 i18n，避免硬编码绕过 locale）
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)
  if (taskDate.getTime() === yesterday.getTime()) {
    return i18n.global.t('common.yesterday') + ' ' + date.toLocaleTimeString(locale, {
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
