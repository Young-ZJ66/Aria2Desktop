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
        type="warning"
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
  gap: 8px;
}

.selected-count {
  font-size: 14px;
  color: var(--color-primary);
  font-weight: 500;
  margin-left: 16px;
}
</style>
