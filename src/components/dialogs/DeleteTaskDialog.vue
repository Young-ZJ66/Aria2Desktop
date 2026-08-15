<template>
  <n-modal
    v-model:show="visible"
    :title="t('delete.title')"
    preset="card"
    style="width: 500px"
    :bordered="false"
    :on-after-leave="resetState"
  >
    <div class="delete-dialog-content">
      <div class="warning-icon">
        <n-icon size="48" color="#e88080">
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
          <n-button @click="handleClose">{{ t('common.cancel') }}</n-button>
          <n-button
            type="error"
            :loading="deleting"
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

const deleting = ref(false)
const deleteFiles = ref(false)

const taskCount = computed(() => props.tasks.length)

// 检查是否在桌面环境中且有文件可删除
const showFileDeleteOption = computed(() => {
  return !!window.electronAPI?.deleteFiles && fileList.value.length > 0
})

// 获取所有任务的文件列表
const fileList = computed(() => {
  const files: string[] = []

  props.tasks.forEach((task) => {
    if (props.taskType === 'stopped') {
      // 已完成任务使用专门的服务获取文件路径
      const taskFiles = completedTaskDeleteService.getTaskFilePaths(task)
      files.push(...taskFiles)
    } else {
      // 其他任务使用原有逻辑，但也包含.aria2文件
      if (task.files && task.files.length > 0) {
        const taskFiles: string[] = []
        task.files.forEach((file) => {
          if (file.path && file.path.trim()) {
            taskFiles.push(file.path)
          }
        })

        // 添加对应的.aria2文件
        const aria2Files = taskFiles
          .filter(path => !path.endsWith('.aria2')) // 避免重复添加
          .map(path => path + '.aria2')

        files.push(...taskFiles, ...aria2Files)
      }
    }
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
  if (!deleting.value) {
    visible.value = false
  }
}

async function handleConfirm() {
  try {
    deleting.value = true
    emit('confirm', deleteFiles.value)
  } finally {
    deleting.value = false
  }
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
