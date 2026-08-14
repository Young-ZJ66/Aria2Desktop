<template>
  <div class="batch-actions">
    <div class="action-buttons-group">
      <el-button
        size="default"
        :disabled="totalCount === 0"
        @click="$emit('select-all')"
      >
        <el-icon><Select /></el-icon>
        {{ t('task.selectAll') }}
      </el-button>

      <el-button
        size="default"
        type="primary"
        :disabled="!canBatchStart"
        @click="$emit('batch-start')"
      >
        <el-icon><VideoPlay /></el-icon>
        {{ t('task.batchStart') }}
      </el-button>

      <el-button
        size="default"
        type="warning"
        :disabled="!canBatchPause"
        @click="$emit('batch-pause')"
      >
        <el-icon><VideoPause /></el-icon>
        {{ t('task.batchPause') }}
      </el-button>

      <el-button
        size="default"
        type="danger"
        :disabled="!hasSelection"
        @click="$emit('batch-delete')"
      >
        <el-icon><Delete /></el-icon>
        {{ t('task.batchDelete') }}
      </el-button>

      <el-button
        v-if="hasSelection"
        size="default"
        @click="$emit('clear-selection')"
      >
        {{ t('task.clearSelection') }}
      </el-button>
    </div>

    <span v-if="hasSelection" class="selected-count">{{ t('task.selectedCount', { count: selectedCount }) }}</span>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Select, VideoPlay, VideoPause, Delete } from '@element-plus/icons-vue'

interface Props {
  selectedCount: number
  hasSelection: boolean
  canBatchStart: boolean
  canBatchPause: boolean
  totalCount: number
}

interface Emits {
  (e: 'select-all'): void
  (e: 'batch-start'): void
  (e: 'batch-pause'): void
  (e: 'batch-delete'): void
  (e: 'clear-selection'): void
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
