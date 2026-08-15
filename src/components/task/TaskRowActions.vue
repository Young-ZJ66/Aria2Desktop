<template>
  <div class="action-buttons">
    <!-- 开始按钮 - 暂停状态 -->
    <button
      v-if="status === 'paused'"
      :title="t('task.startDownload')"
      class="task-action-btn"
      :disabled="operating"
      @click.stop="$emit('unpause', gid)"
    >
      <div v-if="operating" class="loading-spinner" />
      <n-icon v-else class="action-icon"><PlayOutline /></n-icon>
    </button>

    <!-- 重试按钮 - 错误状态（与开始按钮使用不同图标） -->
    <button
      v-else-if="status === 'error'"
      :title="t('task.retryDownload')"
      class="task-action-btn"
      :disabled="operating"
      @click.stop="$emit('retry', gid)"
    >
      <div v-if="operating" class="loading-spinner" />
      <n-icon v-else class="action-icon"><RefreshOutline /></n-icon>
    </button>

    <!-- 暂停按钮 - 活跃状态 -->
    <button
      v-else-if="status === 'active'"
      :title="t('task.pauseDownload')"
      class="task-action-btn"
      :disabled="operating"
      @click.stop="$emit('pause', gid)"
    >
      <div v-if="operating" class="loading-spinner" />
      <n-icon v-else class="action-icon"><PauseOutline /></n-icon>
    </button>

    <!-- 打开位置按钮 - 仅已完成任务页面 -->
    <button
      v-if="showOpenLocation"
      :title="t('task.openLocation')"
      class="task-action-btn"
      @click.stop="$emit('open-location', task)"
    >
      <n-icon class="action-icon"><FolderOpenOutline /></n-icon>
    </button>

    <!-- 删除按钮 -->
    <button
      :title="t('task.deleteTask')"
      class="task-action-btn"
      @click.stop="$emit('remove', gid)"
    >
      <n-icon class="action-icon"><TrashOutline /></n-icon>
    </button>

    <!-- 详情按钮 -->
    <button
      :title="t('task.viewDetail')"
      class="task-action-btn"
      @click.stop="$emit('view-detail', gid)"
    >
      <n-icon class="action-icon"><EyeOutline /></n-icon>
    </button>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import {
  PlayOutline,
  RefreshOutline,
  PauseOutline,
  FolderOpenOutline,
  TrashOutline,
  EyeOutline
} from '@vicons/ionicons5'
import type { Aria2Task } from '@/types/aria2'

interface Props {
  gid: string
  status: string
  operating: boolean
  showOpenLocation: boolean
  task: Aria2Task
}

interface Emits {
  (e: 'unpause', gid: string): void
  (e: 'retry', gid: string): void
  (e: 'pause', gid: string): void
  (e: 'open-location', task: Aria2Task): void
  (e: 'remove', gid: string): void
  (e: 'view-detail', gid: string): void
}

const { t } = useI18n()
defineProps<Props>()
defineEmits<Emits>()
</script>

<style scoped>
.action-buttons {
  display: flex;
  gap: 4px;
  align-items: center;
  justify-content: center;
}

.task-action-btn {
  border: none;
  background: transparent;
  padding: 8px;
  margin: 0 3px;
  border-radius: 6px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s ease;
  min-width: 32px;
  min-height: 32px;
}

.task-action-btn:hover {
  background: var(--bg-tertiary);
}

.task-action-btn:hover .action-icon {
  color: var(--color-primary);
}

.task-action-btn:focus {
  outline: none;
  background: var(--bg-tertiary);
}

.task-action-btn:focus .action-icon {
  color: var(--color-primary);
}

.action-icon {
  font-size: 18px;
  color: var(--text-secondary);
  transition: color 0.2s ease;
}

.task-action-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.loading-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid #e4e7ed;
  border-top: 2px solid #409eff;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
</style>
