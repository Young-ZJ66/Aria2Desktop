import { ref, computed, reactive } from 'vue'
import type { Aria2Task } from '@/types/aria2'

// 全局选择状态（模块级单例，所有使用该 composable 的组件共享同一份状态）
const selectedTaskGids = ref<Set<string>>(new Set())
const selectedTasksData = reactive<Map<string, Aria2Task>>(new Map())

export function useTaskSelection() {
  // 计算属性
  const selectedCount = computed(() => selectedTaskGids.value.size)
  const hasSelection = computed(() => selectedTaskGids.value.size > 0)

  const selectedTasks = computed(() => {
    return Array.from(selectedTasksData.values())
  })

  const canBatchStart = computed(() => {
    return selectedTasks.value.some(task =>
      task.status === 'paused' || task.status === 'waiting' || task.status === 'error'
    )
  })

  const canBatchPause = computed(() => {
    return selectedTasks.value.some(task => task.status === 'active')
  })

  // 选择操作
  function selectTask(task: Aria2Task) {
    selectedTaskGids.value.add(task.gid)
    selectedTasksData.set(task.gid, { ...task })
  }

  function unselectTask(gid: string) {
    selectedTaskGids.value.delete(gid)
    selectedTasksData.delete(gid)
  }

  function toggleTask(task: Aria2Task) {
    if (selectedTaskGids.value.has(task.gid)) {
      unselectTask(task.gid)
    } else {
      selectTask(task)
    }
  }

  function clearSelection() {
    selectedTaskGids.value.clear()
    selectedTasksData.clear()
  }

  function isTaskSelected(gid: string): boolean {
    return selectedTaskGids.value.has(gid)
  }

  // 批量选择
  function selectTasks(tasks: Aria2Task[]) {
    tasks.forEach(task => selectTask(task))
  }

  function selectAll(tasks: Aria2Task[]) {
    clearSelection()
    selectTasks(tasks)
  }

  // 更新选中任务的数据（保持选择状态，只更新任务信息）
  function updateSelectedTaskData(task: Aria2Task) {
    if (selectedTaskGids.value.has(task.gid)) {
      selectedTasksData.set(task.gid, { ...task })
    }
  }

  // 批量更新选中任务的数据
  function updateSelectedTasksData(tasks: Aria2Task[]) {
    tasks.forEach(task => updateSelectedTaskData(task))
  }

  // 清理不存在的任务
  function cleanupNonExistentTasks(existingGids: string[]) {
    const existingGidSet = new Set(existingGids)
    const toRemove: string[] = []

    selectedTaskGids.value.forEach(gid => {
      if (!existingGidSet.has(gid)) {
        toRemove.push(gid)
      }
    })

    toRemove.forEach(gid => unselectTask(gid))
  }

  return {
    // 状态
    selectedTaskGids,
    selectedTasks,
    selectedCount,
    hasSelection,
    canBatchStart,
    canBatchPause,

    // 操作
    selectTask,
    unselectTask,
    toggleTask,
    clearSelection,
    isTaskSelected,
    selectTasks,
    selectAll,
    updateSelectedTaskData,
    updateSelectedTasksData,
    cleanupNonExistentTasks
  }
}
