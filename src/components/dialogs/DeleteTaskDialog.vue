<template>
  <el-dialog
    v-model="visible"
    title="删除任务"
    width="500px"
    :before-close="handleClose"
  >
    <div class="delete-dialog-content">
      <div class="warning-icon">
        <el-icon size="48" color="#f56c6c">
          <WarningFilled />
        </el-icon>
      </div>
      
      <div class="delete-message">
        <h3>确定要删除{{ taskCount > 1 ? `这 ${taskCount} 个` : '这个' }}任务吗？</h3>
        <p v-if="taskCount === 1 && taskName" class="task-name">{{ taskName }}</p>
        <p v-else-if="taskCount > 1" class="task-count">已选择 {{ taskCount }} 个任务</p>
      </div>

      <!-- 文件删除选项 -->
      <div v-if="showFileDeleteOption" class="file-delete-option">
        <el-divider />
        <div class="option-section">
          <div style="margin-top: 16px;">
            <el-checkbox v-model="deleteFiles" :disabled="fileList.length === 0">
              同时删除文件
            </el-checkbox>
          </div>
        </div>


      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="handleClose">取消</el-button>
        <el-button
          type="danger"
          @click="handleConfirm"
          :loading="deleting"
        >
          {{ deleteFiles ? '删除任务和文件' : '删除任务' }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { WarningFilled } from '@element-plus/icons-vue'
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
  console.log('DeleteTaskDialog - Analyzing tasks for file deletion:', {
    taskType: props.taskType,
    taskCount: props.tasks.length,
    tasks: props.tasks
  })

  props.tasks.forEach((task, index) => {
    console.log(`Task ${index} (${task.gid}):`, {
      status: task.status,
      files: task.files,
      filesLength: task.files?.length || 0,
      dir: task.dir
    })

    if (props.taskType === 'stopped') {
      // 已完成任务使用专门的服务获取文件路径
      const taskFiles = completedTaskDeleteService.getTaskFilePaths(task)
      files.push(...taskFiles)
      console.log(`  Completed task ${task.gid} files:`, taskFiles)
    } else {
      // 其他任务使用原有逻辑，但也包含.aria2文件
      if (task.files && task.files.length > 0) {
        const taskFiles: string[] = []
        task.files.forEach((file, fileIndex) => {
          console.log(`  File ${fileIndex}:`, {
            path: file.path,
            selected: file.selected,
            length: file.length,
            completedLength: file.completedLength
          })

          if (file.path && file.path.trim()) {
            taskFiles.push(file.path)
          }
        })

        // 添加对应的.aria2文件
        const aria2Files = taskFiles
          .filter(path => !path.endsWith('.aria2')) // 避免重复添加
          .map(path => path + '.aria2')

        files.push(...taskFiles, ...aria2Files)
        console.log(`  Task ${task.gid} files (including .aria2):`, [...taskFiles, ...aria2Files])
      } else {
        console.log(`  Task ${task.gid} has no files or empty files array`)
      }
    }
  })

  console.log('DeleteTaskDialog - Final file list:', files)
  return files
})

// 重置选项当对话框打开时
watch(visible, (newVisible) => {
  if (newVisible) {
    deleteFiles.value = false
    deleting.value = false
  }
})

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
  color: #303133;
  font-size: 18px;
}

.task-name {
  color: #606266;
  font-size: 14px;
  margin: 0;
  word-break: break-all;
}

.task-count {
  color: #606266;
  font-size: 14px;
  margin: 0;
}

.file-delete-option {
  text-align: left;
  margin-top: 20px;
}

.option-section h4 {
  margin: 0 0 15px 0;
  color: #303133;
  font-size: 16px;
}

.delete-options {
  width: 100%;
}

.option-item {
  width: 100%;
  margin-bottom: 15px;
  padding: 15px;
  border: 1px solid #dcdfe6;
  border-radius: 8px;
  transition: all 0.3s;
}

.option-item:hover {
  border-color: #409eff;
  background-color: #f0f9ff;
}

.option-item.is-checked {
  border-color: #409eff;
  background-color: #f0f9ff;
}

.option-content {
  margin-left: 10px;
}

.option-title {
  font-weight: 500;
  color: #303133;
  margin-bottom: 5px;
}

.option-description {
  font-size: 12px;
  color: #909399;
}

.dialog-footer {
  text-align: right;
}

:deep(.el-radio) {
  width: 100%;
  margin-right: 0;
}

:deep(.el-radio__input) {
  align-self: flex-start;
  margin-top: 2px;
}

:deep(.el-radio__label) {
  width: 100%;
  padding-left: 10px;
}
</style>
