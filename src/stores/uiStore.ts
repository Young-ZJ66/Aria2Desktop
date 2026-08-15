import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * 全局 UI 状态：控制跨页面的弹窗与抽屉（新建下载弹窗、任务详情抽屉）
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

  return {
    showNewTask,
    showSettings,
    showTaskDetail,
    taskDetailGid,
    openNewTask,
    closeNewTask,
    openSettings,
    closeSettings,
    openTaskDetail,
    closeTaskDetail
  }
})
