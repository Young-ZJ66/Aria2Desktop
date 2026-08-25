import { ref, computed } from 'vue'
import type { Aria2Task } from '@/types/aria2'

// 全局选择状态（模块级单例，所有使用该 composable 的组件共享同一份状态）
// 用 ref(new Map()) 替代 reactive(Map)：Vue 3.5 对 reactive Map 的响应式支持不可靠，
// 所有 set/delete 通过"创建新 Map 再整体赋值"触发响应式更新
const selectedTasksMap = ref(new Map<string, Aria2Task>())

export function useTaskSelection() {
  // 计算属性
  const selectedCount = computed(() => selectedTasksMap.value.size)
  const hasSelection = computed(() => selectedTasksMap.value.size > 0)

  // gid 集合由 Map 派生，避免双数据结构同步维护不一致。
  // 使用 Set 语义：调用方（如 TaskList 的 allChecked）以 .has() 查询，
  // 若返回数组会导致渲染期 TypeError（数组无 .has），且查找退化为 O(n)
  const selectedTaskGids = computed(() => new Set(selectedTasksMap.value.keys()))

  const selectedTasks = computed(() => {
    return Array.from(selectedTasksMap.value.values())
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
    // 创建新 Map 再整体赋值，确保浅层引用变化触发响应式
    const next = new Map(selectedTasksMap.value)
    next.set(task.gid, { ...task })
    selectedTasksMap.value = next
  }

  function unselectTask(gid: string) {
    const next = new Map(selectedTasksMap.value)
    next.delete(gid)
    selectedTasksMap.value = next
  }

  function toggleTask(task: Aria2Task) {
    if (isTaskSelected(task.gid)) {
      unselectTask(task.gid)
    } else {
      selectTask(task)
    }
  }

  function clearSelection() {
    selectedTasksMap.value = new Map()
  }

  function isTaskSelected(gid: string): boolean {
    return selectedTasksMap.value.has(gid)
  }

  // 批量选择
  function selectTasks(tasks: Aria2Task[]) {
    const next = new Map(selectedTasksMap.value)
    tasks.forEach(task => next.set(task.gid, { ...task }))
    selectedTasksMap.value = next
  }

  function selectAll(tasks: Aria2Task[]) {
    const next = new Map<string, Aria2Task>()
    tasks.forEach(task => next.set(task.gid, { ...task }))
    selectedTasksMap.value = next
  }

  // 更新选中任务的数据（保持选择状态，只更新任务信息）
  function updateSelectedTaskData(task: Aria2Task) {
    if (isTaskSelected(task.gid)) {
      selectTask(task)
    }
  }

  // 批量更新选中任务的数据
  function updateSelectedTasksData(tasks: Aria2Task[]) {
    tasks.forEach(task => updateSelectedTaskData(task))
  }

  // 清理不存在的任务
  function cleanupNonExistentTasks(existingGids: string[]) {
    const existingGidSet = new Set(existingGids)
    let changed = false
    const next = new Map<string, Aria2Task>()

    for (const [gid, task] of selectedTasksMap.value) {
      if (existingGidSet.has(gid)) {
        next.set(gid, task)
      } else {
        changed = true
      }
    }

    if (changed) {
      selectedTasksMap.value = next
    }
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
