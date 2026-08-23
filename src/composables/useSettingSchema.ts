// 设置页 schema 驱动转换工具：基于 SettingSchema 统一生成
// aria2 选项 <-> 表单值 的双向转换函数，消除各设置页逐字段手写转换逻辑。
import type { Aria2Option } from '@/types/aria2'
import { parseSizeToUnit, formatSizeWithUnit } from '@/utils/size'
import type { SettingSchema, SettingField } from '@/types/settingSchema'

/**
 * 默认的 aria2 选项 → 表单值 转换（按字段类型）。
 * - boolean：未返回（undefined）时按字段默认值；返回 'true'/'false' 时按真实值。
 *   默认值为 true 的字段（aria2 未设置时即启用）采用 `!== 'false'` 语义，
 *   默认值为 false 的字段采用 `=== 'true'` 语义，与原手写转换一致。
 * - number：Number() 解析，未返回时回退默认值。
 * - size：parseSizeToUnit 换算为目标单位下的数值，未返回时回退默认值。
 * - string/select：空串（aria2 未设置）回退默认值，与原有 `|| default` 行为一致。
 */
function defaultOptionToValue(field: SettingField, raw: string | undefined): unknown {
  switch (field.type) {
    case 'boolean':
      return field.default !== false ? raw !== 'false' : raw === 'true'
    case 'number':
      return Number(raw ?? field.default ?? 0)
    case 'size':
      // 未返回时直接采用表单默认值（数字）；返回时解析为指定单位下的数值
      return raw === undefined ? Number(field.default ?? 0) : parseSizeToUnit(raw, field.unit ?? 'M')
    case 'string':
    case 'select':
      return raw || String(field.default ?? '')
    default:
      return raw ?? field.default
  }
}

/**
 * 默认的 表单值 → aria2 选项字符串 转换（按字段类型）。
 * - boolean/number/size：始终写入（0 用 '0' 表示无限制，让用户能主动清掉限制）。
 * - string/select：空值不写入，让 aria2 保留旧值；需要空串也写入的字段用自定义 valueToOption。
 */
function defaultValueToOption(field: SettingField, value: unknown): string | undefined {
  switch (field.type) {
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number':
      return String(value)
    case 'size':
      return formatSizeWithUnit(Number(value), field.unit ?? 'M')
    case 'string':
    case 'select':
      return value ? String(value) : undefined
    default:
      return value === undefined || value === null ? undefined : String(value)
  }
}

/** 字段未声明 default 时的兜底空值 */
function defaultEmptyValue(field: SettingField): unknown {
  switch (field.type) {
    case 'boolean':
      return false
    case 'number':
    case 'size':
      return 0
    default:
      return ''
  }
}

/**
 * 基于 schema 生成设置页通用的三个转换函数（与 useGlobalSettingsForm 配套使用）：
 * - applyOptions: aria2 选项 → 表单（直接写回传入的 form）
 * - toOptions:    表单 → aria2 选项（空值跳过不写入，保持「不写入让 aria2 保留旧值」的行为）
 * - defaults:     表单默认值对象（重置时使用）
 */
export function useSettingSchema<T extends object>(schema: SettingSchema, form: T) {
  /** aria2 选项 → 表单 */
  function applyOptions(options: Aria2Option): void {
    const target = form as Record<string, unknown>
    for (const field of schema.fields) {
      const raw = options[field.aria2Key]
      target[field.key] = field.optionToValue
        ? field.optionToValue(raw)
        : defaultOptionToValue(field, raw)
    }
  }

  /** 表单 → aria2 选项 */
  function toOptions(): Record<string, string> {
    const options: Record<string, string> = {}
    const source = form as Record<string, unknown>
    for (const field of schema.fields) {
      const value = field.valueToOption
        ? field.valueToOption(source[field.key])
        : defaultValueToOption(field, source[field.key])
      if (value !== undefined) options[field.aria2Key] = value
    }
    return options
  }

  /** 表单默认值对象 */
  function defaults(): T {
    const result: Record<string, unknown> = {}
    for (const field of schema.fields) {
      result[field.key] = field.default ?? defaultEmptyValue(field)
    }
    return result as T
  }

  return { applyOptions, toOptions, defaults }
}
