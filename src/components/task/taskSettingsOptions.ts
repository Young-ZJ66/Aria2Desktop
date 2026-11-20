import type { Aria2Option } from '@/types/aria2'
import { parseSizeToUnit } from '@/utils/size'

/**
 * D-23 任务级设置：表单值与 aria2 option 之间的转换。
 *
 * 抽成纯函数的原因：这些转换有明显的边界情况（"0" 表示不限速、空串表示清除代理、
 * 连接数下限 1），而组件本身在没有 happy-dom 的环境里无法挂载测试。把转换逻辑
 * 放在这里，测试可以直接覆盖 aria2 返回的各种奇怪取值。
 */

/** 任务设置表单（限速统一用 KB/s，与新建任务表单一致） */
export interface TaskSettingsForm {
  maxDownloadLimitKB: number
  maxUploadLimitKB: number
  maxConnectionPerServer: number
  allProxy: string
}

/** aria2 里对应的四个 option 名（与新建任务表单、全局设置保持一致） */
export const TASK_SETTING_OPTION_KEYS = {
  maxDownloadLimit: 'max-download-limit',
  maxUploadLimit: 'max-upload-limit',
  maxConnectionPerServer: 'max-connection-per-server',
  allProxy: 'all-proxy'
} as const

/** aria2 的 max-connection-per-server 上限 */
export const MAX_CONNECTION_PER_SERVER_LIMIT = 16

export const EMPTY_TASK_SETTINGS_FORM: TaskSettingsForm = {
  maxDownloadLimitKB: 0,
  maxUploadLimitKB: 0,
  maxConnectionPerServer: 1,
  allProxy: ''
}

/** option 值可能是数组（header 之类），取第一个 */
function readOption(options: Aria2Option, key: string): string {
  const value = options[key]
  if (Array.isArray(value)) return value[0] || ''
  return value || ''
}

/**
 * aria2 getOption 的返回值 → 表单值。
 * 缺失或非法值一律回落到「不限速 / 1 个连接 / 无代理」，避免表单出现 NaN。
 */
export function parseTaskSettings(options: Aria2Option | null | undefined): TaskSettingsForm {
  if (!options) return { ...EMPTY_TASK_SETTINGS_FORM }

  const download = parseSizeToUnit(readOption(options, TASK_SETTING_OPTION_KEYS.maxDownloadLimit), 'K')
  const upload = parseSizeToUnit(readOption(options, TASK_SETTING_OPTION_KEYS.maxUploadLimit), 'K')
  const connections = Number.parseInt(
    readOption(options, TASK_SETTING_OPTION_KEYS.maxConnectionPerServer),
    10
  )

  return {
    maxDownloadLimitKB: Number.isFinite(download) && download > 0 ? Math.round(download) : 0,
    maxUploadLimitKB: Number.isFinite(upload) && upload > 0 ? Math.round(upload) : 0,
    maxConnectionPerServer:
      Number.isFinite(connections) && connections > 0
        ? Math.min(connections, MAX_CONNECTION_PER_SERVER_LIMIT)
        : 1,
    allProxy: readOption(options, TASK_SETTING_OPTION_KEYS.allProxy)
  }
}

/**
 * 表单值 → 要提交给 changeOption 的 option。
 *
 * 两个容易踩的坑：
 * - 限速 0 必须写成字符串 "0"（aria2 用它表示不限速），不能省略这个 key，
 *   否则原来设过的限速不会被清掉；
 * - all-proxy 同理，空串才是「清除代理」。
 */
export function buildTaskOptions(form: TaskSettingsForm): Aria2Option {
  const download = Math.max(0, Math.round(form.maxDownloadLimitKB || 0))
  const upload = Math.max(0, Math.round(form.maxUploadLimitKB || 0))
  const connections = Math.min(
    MAX_CONNECTION_PER_SERVER_LIMIT,
    Math.max(1, Math.round(form.maxConnectionPerServer || 1))
  )

  return {
    [TASK_SETTING_OPTION_KEYS.maxDownloadLimit]: download > 0 ? `${download}K` : '0',
    [TASK_SETTING_OPTION_KEYS.maxUploadLimit]: upload > 0 ? `${upload}K` : '0',
    [TASK_SETTING_OPTION_KEYS.maxConnectionPerServer]: String(connections),
    [TASK_SETTING_OPTION_KEYS.allProxy]: (form.allProxy || '').trim()
  }
}

/**
 * 合并进任务来源记录：保留来源记录里原有的其他 option（例如 header、referer），
 * 只覆盖这四个键。重试（retryErrorTask）读到的就是合并后的结果。
 */
export function mergeTaskSourceOptions(
  existing: Record<string, string | string[]> | undefined,
  next: Aria2Option
): Record<string, string | string[]> {
  return { ...(existing || {}), ...next }
}
