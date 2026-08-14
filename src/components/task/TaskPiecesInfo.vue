<template>
  <el-card class="info-card">
    <div v-if="task.numPieces && parseInt(task.numPieces) > 0">
      <div class="pieces-info">
        <el-descriptions :column="3" border>
          <el-descriptions-item label="总区块数">{{ task.numPieces }}</el-descriptions-item>
          <el-descriptions-item label="区块大小">{{ formatSize(task.pieceLength || '0') }}</el-descriptions-item>
          <el-descriptions-item label="完成区块">{{ getCompletedPieces() }}</el-descriptions-item>
        </el-descriptions>
      </div>

      <div class="pieces-visual" style="margin-top: 20px;">
        <h4>区块完成状态</h4>
        <div class="pieces-grid">
          <div
            v-for="(piece, index) in getPiecesStatus()"
            :key="index"
            :class="['piece-block', piece ? 'completed' : 'pending']"
            :title="`区块 ${index}: ${piece ? '已完成' : '未完成'}`"
          />
        </div>
        <div class="pieces-legend">
          <span class="legend-item">
            <span class="legend-color completed" />
            {{ t('status.complete') }}
          </span>
          <span class="legend-item">
            <span class="legend-color pending" />
            {{ t('task.waiting') }}
          </span>
        </div>
      </div>
    </div>

    <el-empty v-else :description="t('common.none')" />
  </el-card>
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
    const byte = parseInt(bitfield.substr(i * 2, 2), 16)
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
      const byte = parseInt(bitfield.substr(byteIndex * 2, 2), 16)
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
  margin-bottom: 20px;
}

.pieces-info {
  margin-bottom: 20px;
}

.pieces-visual h4 {
  margin: 0 0 16px 0;
  font-size: 16px;
  font-weight: 600;
}

.pieces-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(12px, 1fr));
  gap: 2px;
  max-width: 100%;
  margin-bottom: 16px;
  background-color: var(--bg-tertiary);
  padding: 12px;
  border-radius: 6px;
}

.piece-block {
  width: 12px;
  height: 12px;
  border-radius: 2px;
  cursor: pointer;
  transition: all 0.2s;
}

.piece-block.completed {
  background-color: var(--color-success);
}

.piece-block.pending {
  background-color: var(--text-placeholder);
}

[data-theme="dark"] .piece-block.pending {
  background-color: var(--border-dark);
}

.piece-block:hover {
  transform: scale(1.5);
  z-index: 1;
  position: relative;
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
  font-size: 14px;
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
  background-color: var(--border-light);
}
</style>
