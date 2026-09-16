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
  // 剪贴板检测 / 拖拽填入的预填 URL（由 useClipboardMonitor / App.vue 写入，NewTaskDialog 读取后清空）
  const newTaskPrefilledUrl = ref('')
  // 拖拽 .torrent / .metalink 文件到主窗口时预填的文件对象
  const newTaskPrefilledFile = ref<File | null>(null)

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

  /** 打开新建下载弹窗并预填 URL（剪贴板检测 / 拖拽 URL 调用） */
  function openNewTaskWithUrl(url: string) {
    newTaskPrefilledUrl.value = url
    newTaskPrefilledFile.value = null
    showNewTask.value = true
  }

  /** 打开新建下载弹窗并预填文件（拖拽 .torrent/.metalink 文件调用） */
  function openNewTaskWithFile(file: File) {
    newTaskPrefilledFile.value = file
    newTaskPrefilledUrl.value = ''
    showNewTask.value = true
  }

  function closeNewTask() {
    showNewTask.value = false
    newTaskPrefilledUrl.value = ''
    newTaskPrefilledFile.value = null
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
    newTaskPrefilledUrl,
    newTaskPrefilledFile,
    showSettings,
    showTaskDetail,
    taskDetailGid,
    showUpdateDialog,
    updateDialogState,
    updateVersion,
    updateNotes,
    updatePercent,
    openNewTask,
    openNewTaskWithUrl,
    openNewTaskWithFile,
    closeNewTask,
    openSettings,
    closeSettings,
    openTaskDetail,
    closeTaskDetail,
    openUpdateDialog,
    closeUpdateDialog
  }
})
