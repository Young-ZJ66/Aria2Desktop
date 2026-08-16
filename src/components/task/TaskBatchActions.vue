<template>
  <div class="batch-actions">
    <div class="action-buttons-group">
      <n-button
        size="small"
        type="default"
        :disabled="!canBatchStart"
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
        :disabled="!canBatchPause"
        @click="$emit('batch-pause')"
      >
        <template #icon>
          <n-icon><PauseOutline /></n-icon>
        </template>
        {{ t('task.batchPause') }}
      </n-button>

      <n-button
        v-if="hasSelection"
        size="small"
        type="default"
        class="batch-delete-btn"
        @click="$emit('batch-delete')"
      >
        <template #icon>
          <n-icon><TrashOutline /></n-icon>
        </template>
        {{ t('task.batchDelete') }}
      </n-button>
    </div>

    <span v-if="hasSelection" class="selected-count">{{ t('task.selectedCount', { count: selectedCount }) }}</span>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { PlayOutline, PauseOutline, TrashOutline } from '@vicons/ionicons5'

interface Props {
  selectedCount: number
  hasSelection: boolean
  canBatchStart: boolean
  canBatchPause: boolean
}

interface Emits {
  (e: 'batch-start'): void
  (e: 'batch-pause'): void
  (e: 'batch-delete'): void
}

const { t } = useI18n()
defineProps<Props>()
defineEmits<Emits>()
</script>

<style scoped>
.batch-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 1;
}

.action-buttons-group {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* 统一现代化批量操作按钮：圆角、悬停轻微浮起。
   开始/暂停为默认样式（灰边框+黑字，悬浮时边框与字体自动变蓝）；
   删除按钮为灰边框+红字，悬浮时边框与字体变红 */
.action-buttons-group :deep(.n-button) {
  height: 32px;
  border-radius: 8px;
  font-weight: 500;
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}

.action-buttons-group :deep(.n-button:hover:not([disabled])) {
  transform: translateY(-1px);
}

.action-buttons-group :deep(.n-button:active:not([disabled])) {
  transform: translateY(0);
}

/* 删除按钮：默认红字，悬浮时红字红框 */
.action-buttons-group :deep(.batch-delete-btn) {
  color: var(--color-danger) !important;
}

.action-buttons-group :deep(.batch-delete-btn:hover:not([disabled])) {
  color: var(--color-danger) !important;
}

.action-buttons-group :deep(.batch-delete-btn:hover:not([disabled]) .n-button__state-border) {
  border-color: var(--color-danger);
}

/* 删除按钮点击后的 focus 状态不显示蓝色边框，仅悬浮时边框变红 */
.action-buttons-group :deep(.batch-delete-btn:focus:not(:hover) .n-button__state-border) {
  border-color: transparent;
}

.selected-count {
  font-size: 14px;
  color: var(--color-primary);
  font-weight: 500;
  margin-left: 16px;
}
</style>
