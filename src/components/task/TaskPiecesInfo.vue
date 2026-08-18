<template>
  <n-card class="info-card" size="small" :bordered="false">
    <template v-if="task.numPieces && parseInt(task.numPieces) > 0">
      <div class="pieces-summary">
        <div class="pieces-stat">
          <span class="pieces-stat-label">{{ t('taskPeer.totalPieces') }}</span>
          <span class="pieces-stat-value">{{ task.numPieces }}</span>
        </div>
        <div class="pieces-stat">
          <span class="pieces-stat-label">{{ t('taskPeer.pieceSize') }}</span>
          <span class="pieces-stat-value">{{ formatSize(task.pieceLength || '0') }}</span>
        </div>
        <div class="pieces-stat">
          <span class="pieces-stat-label">{{ t('taskPeer.completedPieces') }}</span>
          <span class="pieces-stat-value">{{ getCompletedPieces() }}</span>
        </div>
      </div>

      <div class="pieces-visual">
        <div class="pieces-visual-header">
          <h4>{{ t('taskPeer.pieceStatus') }}</h4>
          <span class="pieces-count">{{ getPiecesStatus().length }}/{{ task.numPieces }}</span>
        </div>
        <div class="pieces-grid">
          <div
            v-for="(piece, index) in getPiecesStatus()"
            :key="index"
            :class="['piece-block', piece ? 'completed' : 'pending']"
            :title="`区块 ${index + 1}: ${piece ? t('taskPeer.pieceDone') : t('taskPeer.piecePending')}`"
          />
        </div>
        <div class="pieces-legend">
          <span class="legend-item">
            <span class="legend-color completed" />
            {{ t('taskPeer.pieceDone') }}
          </span>
          <span class="legend-item">
            <span class="legend-color pending" />
            {{ t('taskPeer.piecePending') }}
          </span>
        </div>
      </div>
    </template>

    <n-empty v-else :description="t('common.none')" />
  </n-card>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { Aria2Task } from '@/types/aria2'
import { formatSize } from '@/utils/taskFormatters'

interface Props {
  task: Aria2Task
}

const { t } = useI18n()
const props = defineProps<Props>()

function getCompletedPieces(): string {
  if (!props.task?.bitfield) return '0'

  const bitfield = props.task.bitfield
  let completed = 0
  for (let i = 0; i < bitfield.length; i++) {
    const byte = parseInt(bitfield.substring(i * 2, i * 2 + 2), 16)
    for (let j = 0; j < 8; j++) {
      if (byte & (1 << (7 - j))) completed++
    }
  }

  return completed.toString()
}

function getPiecesStatus(): boolean[] {
  if (!props.task?.bitfield || !props.task?.numPieces) return []

  const numPieces = parseInt(props.task.numPieces)
  const bitfield = props.task.bitfield
  const pieces: boolean[] = []

  // 限制显示的区块数量，避免页面卡顿
  const maxDisplay = Math.min(numPieces, 1000)

  for (let i = 0; i < maxDisplay; i++) {
    const byteIndex = Math.floor(i / 8)
    const bitIndex = i % 8

    if (byteIndex * 2 + 1 < bitfield.length) {
      const byte = parseInt(bitfield.substring(byteIndex * 2, byteIndex * 2 + 2), 16)
      pieces.push(!!(byte & (1 << (7 - bitIndex))))
    } else {
      pieces.push(false)
    }
  }

  return pieces
}
</script>

<style scoped>
.info-card {
  background: var(--bg-primary);
  border: 1px solid var(--border-light);
  border-radius: 10px;
}

.pieces-summary {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 20px;
}

.pieces-stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 16px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-light);
  border-radius: 8px;
}

.pieces-stat-label {
  font-size: 12px;
  color: var(--text-secondary);
}

.pieces-stat-value {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.pieces-visual-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.pieces-visual-header h4 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.pieces-count {
  font-size: 12px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.pieces-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(12px, 1fr));
  gap: 2px;
  max-width: 100%;
  margin-bottom: 16px;
  background-color: var(--bg-tertiary);
  padding: 12px;
  border-radius: 8px;
}

.piece-block {
  width: 12px;
  height: 12px;
  border-radius: 2px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.piece-block.completed {
  background-color: var(--color-success);
}

.piece-block.pending {
  background-color: var(--text-placeholder);
  opacity: 0.6;
}

[data-theme="dark"] .piece-block.pending {
  background-color: var(--border-dark);
  opacity: 0.6;
}

.piece-block:hover {
  transform: scale(1.5);
  z-index: 1;
  position: relative;
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.2);
}

.pieces-legend {
  display: flex;
  gap: 16px;
  align-items: center;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-regular);
}

.legend-color {
  width: 12px;
  height: 12px;
  border-radius: 2px;
}

.legend-color.completed {
  background-color: var(--color-success);
}

.legend-color.pending {
  background-color: var(--text-placeholder);
  opacity: 0.6;
}
</style>
