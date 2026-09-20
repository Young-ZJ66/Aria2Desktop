/**
 * 新建任务各页（UriPane / TorrentPane / MetalinkPane / StreamPane）与壳 NewTaskDialog 之间的契约类型。
 *
 * 抽出来的理由：这些能力（分类选项、目标目录计算、文件大小校验、base64 读取、请求选文件）
 * 由壳持有并由多个 pane 共用，接口写在一处可避免 4 份重复定义将来分叉。
 */

import type { SelectOption } from 'naive-ui'

/** 分类下拉选项（直接沿用 naive-ui 的选项类型，避免与 n-select 的 options 类型不兼容） */
export type CategoryOption = SelectOption

/**
 * 计算最终保存目录（壳注入：闭包了用户的分类规则与自动分类开关，
 * 因此 pane 不需要知道这些设置从哪来）
 */
export type ComputeTargetDir = (
  baseDir: string,
  category: string,
  fileNameHint: string
) => string

/**
 * 请求壳打开隐藏的 file input。
 * 传入回调而非返回值：文件选择是异步事件（change），用回调把选中的文件交回给发起方 pane。
 */
export type RequestPickFile = (onPicked: (file: File) => void) => void
