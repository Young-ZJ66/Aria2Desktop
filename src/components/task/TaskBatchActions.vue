<template>
  <div class="batch-actions">
    <div class="action-buttons-group">
      <n-button
        size="small"
        type="default"
        class="btn-loading-keep-icon"
        :disabled="operating || !canBatchStart"
        :loading="operating"
        @click="$emit('batch-start')"
      >
        <template #icon>
          <n-icon><PlayOutline /></n-icon>
        </template>
        {{ t('task.batchStart') }}
      </n-button>

      <n-button
        size="small"
        type="default"
        class="btn-loading-keep-icon"
        :disabled="operating || !canBatchPause"
        :loading="operating"
        @click="$emit('batch-pause')"
      >
        <template #icon>
          <n-icon><PauseOutline /></n-icon>
        </template>
        {{ t('task.batchPause') }}
      </n-button>

      <n-button
        v-if="hasSelection && canBatchOpen"
        size="small"
        type="default"
        :disabled="operating"
        @click="$emit('batch-open')"
      >
        <template #icon>
          <n-icon><FolderOpenOutline /></n-icon>
        </template>
        {{ t('task.batchOpen') }}
      </n-button>

      <n-button
        v-if="hasSelection"
        size="small"
        type="default"
        class="btn-danger-outline btn-loading-keep-icon"
        :disabled="deleting"
        :loading="deleting"
        @click="$emit('batch-delete')"
      >
        <template #icon>
          <n-icon><TrashOutline /></n-icon>
        </template>
        {{ t('task.batchDelete') }}
      </n-button>

      <!-- D-24：失败任务的重试入口。刻意不依赖勾选状态——失败任务往往散落在
           列表各处，要求用户先一个个勾选再重试等于把批量操作的意义抹掉了。 -->
      <n-button
        v-if="failedCount > 0"
        size="small"
        type="default"
        class="btn-loading-keep-icon retry-failed-btn"
        :disabled="operating || retryingFailed"
        :loading="retryingFailed"
        @click="$emit('retry-failed')"
      >
        <template #icon>
          <n-icon><RefreshOutline /></n-icon>
        </template>
        {{ t('task.retryAllFailedSummary', { count: failedCount }) }}
      </n-button>
    </div>

    <span v-if="hasSelection" class="selected-count" aria-live="polite">{{ t('task.selectedCount', { count: selectedCount }) }}</span>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import {
  PlayOutline,
  PauseOutline,
  TrashOutline,
  FolderOpenOutline,
  RefreshOutline
} from '@vicons/ionicons5'

interface Props {
  selectedCount: number
  hasSelection: boolean
  canBatchStart: boolean
  canBatchPause: boolean
  /** 是否允许批量打开文件（完成页有可打开文件时） */
  canBatchOpen?: boolean
  /** 批量开始/暂停等操作进行中：禁用全部批量按钮，防止重复触发 */
  operating?: boolean
  /** 批量删除进行中：删除按钮显示 loading 并禁用 */
  deleting?: boolean
  /** 当前列表里失败任务的数量：>0 时显示「重试全部失败」 */
  failedCount?: number
  /** 「重试全部失败」执行中 */
  retryingFailed?: boolean
}

interface Emits {
  (e: 'batch-start'): void
  (e: 'batch-pause'): void
  (e: 'batch-open'): void
  (e: 'batch-delete'): void
  (e: 'retry-failed'): void
}

const { t } = useI18n()
withDefaults(defineProps<Props>(), {
  operating: false,
  deleting: false,
  canBatchOpen: false,
  failedCount: 0,
  retryingFailed: false
})
defineEmits<Emits>()
</script>

<style scoped>
.batch-actions {
  display: flex;
  align-items: center;
  gap: var(--ds-space-12);
  flex: 1;
  min-width: 0;
}

.action-buttons-group {
  display: flex;
  align-items: center;
  gap: var(--ds-space-6);
}

/* v2：批量操作不再是「会浮起的灰按钮」，而是选中上下文里的次级动作。
   悬停只换表面色，不做位移——位移留给真正的按钮反馈，不留给工具栏。 */
.action-buttons-group :deep(.n-button) {
  height: var(--ds-control-height-sm);
  border-radius: var(--ds-radius-sm);
  font-weight: 500;
}

/* 「重试全部失败」是补救动作，不是主路径：只在失败数 >0 时出现，配色跟随警示色 */
.retry-failed-btn {
  color: var(--ds-status-warning-text, var(--ds-text));
}

.selected-count {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 var(--ds-space-8);
  border-radius: var(--ds-radius-pill);
  background: var(--ds-accent);
  color: var(--ds-text-on-accent);
  font-size: var(--ds-text-micro-size);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>
