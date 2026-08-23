// 设置页 schema 驱动重构的公共类型定义
// 各设置页以声明式描述「表单字段 <-> aria2 选项」的映射，
// 由 useSettingSchema 统一生成双向转换函数，消除逐字段手写转换的重复逻辑。
import type { SizeUnit } from '@/utils/size'

/** 表单值类型：决定默认的双向转换规则 */
export type SettingValueType = 'boolean' | 'number' | 'size' | 'string' | 'select'

export interface SettingField {
  /** 表单字段名（reactive 对象键） */
  key: string
  /** aria2 选项名（如 'max-concurrent-downloads'） */
  aria2Key: string
  /** 字段类型，决定默认的双向转换规则 */
  type: SettingValueType
  /** 表单侧默认值（重置表单 / aria2 未返回该选项时使用） */
  default?: unknown
  /** size 类型的单位（K/M/G/T），仅 type === 'size' 时生效 */
  unit?: SizeUnit
  /** 自定义 aria2 选项 → 表单值 转换，默认按 type 转换 */
  optionToValue?: (raw: string | undefined) => unknown
  /** 自定义 表单值 → aria2 选项字符串 转换，返回 undefined 表示不写入（让 aria2 保留旧值） */
  valueToOption?: (value: unknown) => string | undefined
}

export interface SettingSchema {
  /** 字段映射配置 */
  fields: SettingField[]
}
