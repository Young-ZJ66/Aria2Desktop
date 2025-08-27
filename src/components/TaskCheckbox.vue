<template>
  <el-checkbox
    :model-value="isSelected"
    @change="handleChange"
    @click.stop
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useTaskSelection } from '@/composables/useTaskSelection'
import type { Aria2Task } from '@/types/aria2'

interface Props {
  task: Aria2Task
}

const props = defineProps<Props>()

const { isTaskSelected, toggleTask } = useTaskSelection()

// 计算是否选中
const isSelected = computed(() => isTaskSelected(props.task.gid))

// 处理勾选变化
function handleChange(checked: boolean) {
  console.log('Checkbox changed for task:', props.task.gid, 'checked:', checked)
  toggleTask(props.task)
}
</script>
