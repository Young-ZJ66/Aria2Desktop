<template>
  <n-checkbox
    :checked="isSelected"
    :aria-label="getTaskName(task)"
    @update:checked="handleChange"
    @click.stop
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useTaskSelection } from '@/composables/useTaskSelection'
import { getTaskName } from '@/utils/taskUtils'
import type { Aria2Task } from '@/types/aria2'

interface Props {
  task: Aria2Task
  /** 与所属 TaskList 的 props.taskType 一致，隔离下载页与完成页的勾选状态 */
  selectionScope?: string
}

const props = withDefaults(defineProps<Props>(), { selectionScope: 'default' })

const { isTaskSelected, toggleTask } = useTaskSelection(props.selectionScope)

// 计算是否选中
const isSelected = computed(() => isTaskSelected(props.task.gid))

// 处理勾选变化
function handleChange() {
  toggleTask(props.task)
}
</script>
