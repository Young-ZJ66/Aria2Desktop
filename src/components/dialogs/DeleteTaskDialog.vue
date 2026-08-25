<template>
  <n-modal
    v-model:show="visible"
    :title="t('delete.title')"
    preset="card"
    style="width: 500px"
    :bordered="false"
    :mask-closable="!loading"
    :on-after-leave="resetState"
  >
    <div class="delete-dialog-content">
      <div class="warning-icon">
        <n-icon size="48" class="danger-icon" role="img" :aria-label="t('common.warning')">
          <AlertCircleOutline />
        </n-icon>
      </div>

      <div class="delete-message">
        <h3>{{ taskCount > 1 ? t('delete.confirmBatch', { count: taskCount }) : t('delete.confirmSingle') }}</h3>
        <p v-if="taskCount === 1 && taskName" class="task-name">{{ taskName }}</p>
        <p v-else-if="taskCount > 1" class="task-count">{{ t('task.selectedCount', { count: taskCount }) }}</p>
      </div>

      <!-- 文件删除选项 -->
      <div v-if="showFileDeleteOption" class="file-delete-option">
        <n-divider />
        <div class="option-section">
          <div style="margin-top: 16px;">
            <n-checkbox v-model:checked="deleteFiles" :disabled="fileList.length === 0">
              {{ t('delete.deleteFiles') }}
            </n-checkbox>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <n-space justify="end">
          <n-button :disabled="loading" @click="handleClose">{{ t('common.cancel') }}</n-button>
          <!-- 与列表工具栏删除按钮保持一致的"描边红字"危险按钮风格（全局 .btn-danger-outline） -->
          <n-button
            type="default"
            class="btn-danger-outline"
            :loading="loading"
            :disabled="deleting"
            @click="handleConfirm"
          >
            {{ deleteFiles ? t('delete.deleteTaskAndFiles') : t('delete.confirm') }}
          </n-button>
        </n-space>
      </div>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertCircleOutline } from '@vicons/ionicons5'
import { completedTaskDeleteService } from '@/services/completedTaskDeleteService'
import type { Aria2Task } from '@/types/aria2'

interface Props {
  modelValue: boolean
  tasks: Aria2Task[]
  taskName?: string
  taskType?: string
  /** 父组件删除进行中：确认按钮显示 loading 并阻止重复提交/关闭 */
  loading?: boolean
}

interface Emits {
  (e: 'update:modelValue', value: boolean): void
  (e: 'confirm', deleteFiles: boolean): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()
const { t } = useI18n()

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

// deleting 仅用于防止同一轮内重复点击确认（持续 loading 由父组件 loading prop 驱动）
const deleting = ref(false)
const deleteFiles = ref(false)

const taskCount = computed(() => props.tasks.length)

// 检查是否在桌面环境中且有文件可删除
const showFileDeleteOption = computed(() => {
  return !!window.electronAPI?.deleteFiles && fileList.value.length > 0
})

// 获取所有任务的文件列表（统一走删除服务的路径处理逻辑，避免两份实现漂移）
const fileList = computed(() => {
  const files: string[] = []
  props.tasks.forEach((task) => {
    files.push(...completedTaskDeleteService.getTaskFilePaths(task))
  })
  return files
})

// 重置选项当对话框打开时
watch(visible, (newVisible) => {
  if (newVisible) {
    deleteFiles.value = false
    deleting.value = false
  }
})

function resetState() {
  deleteFiles.value = false
  deleting.value = false
}

function handleClose() {
  // 父组件删除进行中不允许关闭
  if (!props.loading) {
    visible.value = false
  }
}

function handleConfirm() {
  // 防重复点击：父组件处理完成后会关闭对话框并复位状态
  if (deleting.value || props.loading) return
  deleting.value = true
  emit('confirm', deleteFiles.value)
}
</script>

<style scoped>
.delete-dialog-content {
  text-align: center;
  padding: 20px 0;
}

.warning-icon {
  margin-bottom: 20px;
}

.danger-icon {
  color: var(--color-danger);
}

.delete-message h3 {
  margin: 0 0 10px 0;
  color: var(--text-primary);
  font-size: 18px;
}

.task-name {
  color: var(--text-regular);
  font-size: 14px;
  margin: 0;
  word-break: break-all;
}

.task-count {
  color: var(--text-regular);
  font-size: 14px;
  margin: 0;
}

.file-delete-option {
  text-align: left;
  margin-top: 20px;
}

.option-section h4 {
  margin: 0 0 15px 0;
  color: var(--text-primary);
  font-size: 16px;
}

.dialog-footer {
  text-align: right;
}
</style>
