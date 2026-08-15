/**
 * 全局反馈工具：替代 Element Plus 的 ElMessage / ElMessageBox
 * 通过 createDiscreteApi 提供可在组件 setup 之外（store/composable）使用的 message 与 dialog
 */
import { createDiscreteApi } from 'naive-ui'

const { message, dialog } = createDiscreteApi(['message', 'dialog'])

export { message, dialog }
