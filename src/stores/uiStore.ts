import { defineStore } from 'pinia'
import { ref } from 'vue'

/** 更新弹窗所处的阶段 */
export type UpdateDialogState = 'prompt' | 'downloading' | 'downloaded'

/**
 * 全局 UI 状态：控制跨页面的弹窗与抽屉（新建下载弹窗、任务详情抽屉、更新弹窗）
 * 避免通过路由跳转独立页面，改为页内浮层交互
 */
export const useUiStore = defineStore('ui', () => {
  // 新建下载弹窗
  const showNewTask = ref(false)

  // 设置弹窗（页内弹窗承载全部设置页面）
  const showSettings = ref(false)

  // 任务详情抽屉
  const showTaskDetail = ref(false)
  const taskDetailGid = ref<string | null>(null)

  // 更新弹窗（启动检查与设置页手动检查共用）
  const showUpdateDialog = ref(false)
  const updateDialogState = ref<UpdateDialogState>('prompt')
  const updateVersion = ref('')
  const updateNotes = ref('')
  const updatePercent = ref(0)

  function openNewTask() {
    showNewTask.value = true
  }

  function closeNewTask() {
    showNewTask.value = false
  }

  function openSettings() {
    showSettings.value = true
  }

  function closeSettings() {
    showSettings.value = false
  }

  function openTaskDetail(gid: string) {
    taskDetailGid.value = gid
    showTaskDetail.value = true
  }

  function closeTaskDetail() {
    showTaskDetail.value = false
    taskDetailGid.value = null
  }

  /** 打开更新弹窗（已知新版本时），initialState 用于跳过已完成的下载环节 */
  function openUpdateDialog(options: { version: string; notes?: string; state?: UpdateDialogState }) {
    updateVersion.value = options.version
    updateNotes.value = options.notes || ''
    updateDialogState.value = options.state || 'prompt'
    updatePercent.value = 0
    showUpdateDialog.value = true
  }

  function closeUpdateDialog() {
    showUpdateDialog.value = false
  }

  return {
    showNewTask,
    showSettings,
    showTaskDetail,
    taskDetailGid,
    showUpdateDialog,
    updateDialogState,
    updateVersion,
    updateNotes,
    updatePercent,
    openNewTask,
    closeNewTask,
    openSettings,
    closeSettings,
    openTaskDetail,
    closeTaskDetail,
    openUpdateDialog,
    closeUpdateDialog
  }
})
