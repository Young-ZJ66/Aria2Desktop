<template>
  <el-dialog
    v-model="visible"
    title="删除任务"
    width="400px"
    :before-close="handleClose"
  >
    <div>
      <p>确定要删除这个任务吗？</p>
      <div style="margin-top: 16px;">
        <el-checkbox v-model="deleteFiles">
          同时删除文件
        </el-checkbox>
      </div>
    </div>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="danger" @click="handleConfirm">删除</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'

interface Props {
  modelValue: boolean
}

interface Emits {
  (e: 'update:modelValue', value: boolean): void
  (e: 'confirm', deleteFiles: boolean): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const deleteFiles = ref(false)

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

// 对话框打开时重置选项
watch(visible, (newVisible) => {
  if (newVisible) {
    deleteFiles.value = false
  }
})

function handleClose() {
  visible.value = false
}

function handleConfirm() {
  emit('confirm', deleteFiles.value)
  visible.value = false
}
</script>
