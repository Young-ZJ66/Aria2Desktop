<template>
  <div class="batch-actions">
    <div class="action-buttons-group">
      <n-button
        size="small"
        type="primary"
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
        type="info"
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
        type="error"
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

/* 统一现代化批量操作按钮：圆角、语义色光晕、悬停轻微浮起 */
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

.action-buttons-group :deep(.n-button--primary-type) {
  box-shadow: 0 4px 12px color-mix(in srgb, var(--color-primary) 25%, transparent);
}

.action-buttons-group :deep(.n-button--error-type) {
  box-shadow: 0 4px 12px color-mix(in srgb, var(--color-danger) 25%, transparent);
}

.action-buttons-group :deep(.n-button--info-type) {
  box-shadow: 0 4px 12px color-mix(in srgb, var(--color-info) 22%, transparent);
}

.selected-count {
  font-size: 14px;
  color: var(--color-primary);
  font-weight: 500;
  margin-left: 16px;
}
</style>
