<template>
  <n-card class="info-card" size="small" :bordered="false">
    <template v-if="task.numPieces && parseInt(task.numPieces, 10) > 0">
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
          <span class="pieces-stat-value">{{ completedPiecesCount }}</span>
        </div>
      </div>

      <div class="pieces-visual" role="img" :aria-label="piecesSummaryLabel">
        <div class="pieces-visual-header">
          <h4>{{ t('taskPeer.pieceStatus') }}</h4>
          <span class="pieces-count">{{ piecesStatus.length }}/{{ task.numPieces }}</span>
        </div>
        <!-- 用 canvas 绘制区块网格，避免 1000+ 个 DOM 节点导致卡顿 -->
        <div ref="piecesGridRef" class="pieces-grid">
          <canvas
            ref="canvasRef"
            aria-hidden="true"
            @mousemove="handleCanvasMouseMove"
            @mouseleave="handleCanvasMouseLeave"
          />
          <div
            v-show="hoverState.visible"
            class="pieces-tooltip"
            :style="{ left: hoverState.left + 'px', top: hoverState.top + 'px' }"
          >
            {{ t('taskPeer.piece', { index: hoverState.index }) }}: {{ pieceStateText(hoverState.state) }}
          </div>
        </div>
        <div v-if="piecesLimitExceeded" class="pieces-limit-hint">
          {{ t('taskPeer.piecesShown', { count: MAX_DISPLAY_PIECES }) }}
        </div>
        <div class="pieces-legend">
          <span class="legend-item">
            <span class="legend-color completed" />
            {{ t('taskPeer.pieceDone') }}
          </span>
          <span class="legend-item">
            <span class="legend-color downloading" />
            {{ t('taskPeer.pieceDownloading') }}
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
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Aria2Task } from '@/types/aria2'
import { formatSize } from '@/utils/taskFormatters'

interface Props {
  task: Aria2Task
}

const { t } = useI18n()
const props = defineProps<Props>()

// 限制显示的区块数量，避免 canvas 绘制过多而失去可读性
const MAX_DISPLAY_PIECES = 1000

// canvas 区块布局常量（与原先 DOM 版 grid 视觉一致）
const CELL_SIZE = 12
const CELL_GAP = 2
const GRID_PADDING = 12

const canvasRef = ref<HTMLCanvasElement | null>(null)
const piecesGridRef = ref<HTMLDivElement | null>(null)
// 当前 canvas 的实际列数（绘制与 mousemove 共用，保持一致）
const canvasCols = ref(0)

// 完成区块数（基于 bitfield 全量统计）
const completedPiecesCount = computed<string>(() => {
  if (!props.task?.bitfield) return '0'

  const bitfield = props.task.bitfield
  let completed = 0
  for (let i = 0; i < bitfield.length; i++) {
    const byte = parseInt(bitfield.substring(i * 2, i * 2 + 2), 16) || 0
    for (let j = 0; j < 8; j++) {
      if (byte & (1 << (7 - j))) completed++
    }
  }

  return completed.toString()
})

// 需展示的区块状态（截断到 MAX_DISPLAY_PIECES，避免绘制过多节点）
const piecesStatus = computed<boolean[]>(() => {
  if (!props.task?.bitfield || !props.task?.numPieces) return []

  const numPieces = parseInt(props.task.numPieces, 10)
  const bitfield = props.task.bitfield
  const pieces: boolean[] = []

  const maxDisplay = Math.min(numPieces, MAX_DISPLAY_PIECES)

  for (let i = 0; i < maxDisplay; i++) {
    const byteIndex = Math.floor(i / 8)
    const bitIndex = i % 8

    if (byteIndex * 2 + 1 < bitfield.length) {
      const byte = parseInt(bitfield.substring(byteIndex * 2, byteIndex * 2 + 2), 16) || 0
      pieces.push(!!(byte & (1 << (7 - bitIndex))))
    } else {
      pieces.push(false)
    }
  }

  return pieces
})

// 当前"下载中"的区块索引：按已下载字节数 / 单块大小估算写入位置（仅 active 状态有意义）
const inProgressIndex = computed<number>(() => {
  if (props.task?.status !== 'active') return -1
  const pieceLength = Number(props.task.pieceLength)
  const completed = Number(props.task.completedLength)
  if (!pieceLength || pieceLength <= 0) return -1
  const index = Math.floor(completed / pieceLength)
  return index >= 0 && index < piecesStatus.value.length ? index : -1
})

// 区块总数超过展示上限时提示"仅显示前 N 块"
const piecesLimitExceeded = computed<boolean>(() => {
  const numPieces = parseInt(props.task?.numPieces || '0', 10)
  return Number.isFinite(numPieces) && numPieces > MAX_DISPLAY_PIECES
})

// 区块网格的语义标签（屏幕阅读器可见，替代逐块 aria-label）
const piecesSummaryLabel = computed<string>(() =>
  `${t('taskPeer.completedPieces')}: ${completedPiecesCount.value}/${props.task?.numPieces || 0}`
)

// ── hover tooltip 状态 ──
type PieceState = 'done' | 'downloading' | 'pending'

const hoverState = ref<{
  visible: boolean
  index: number
  state: PieceState
  left: number
  top: number
}>({
  visible: false,
  index: 0,
  state: 'pending',
  left: 0,
  top: 0
})

function pieceStateText(state: PieceState): string {
  switch (state) {
    case 'done': return t('taskPeer.pieceDone')
    case 'downloading': return t('taskPeer.pieceDownloading')
    default: return t('taskPeer.piecePending')
  }
}

// 读取当前主题下的 CSS 变量颜色（跟随 data-theme 切换）
function getCssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888888'
}

// 将区块状态绘制到 canvas（含 DPR 缩放保证高清屏清晰）
function drawPiecesCanvas(): void {
  const canvas = canvasRef.value
  if (!canvas) return

  const status = piecesStatus.value
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const dpr = window.devicePixelRatio || 1
  const containerWidth = canvas.clientWidth || 0
  if (containerWidth <= 0) return

  const cols = Math.max(1, Math.floor((containerWidth - GRID_PADDING * 2 + CELL_GAP) / (CELL_SIZE + CELL_GAP)))
  const rows = Math.ceil(status.length / cols)
  const cssWidth = containerWidth
  const cssHeight = GRID_PADDING * 2 + Math.max(rows, 0) * (CELL_SIZE + CELL_GAP) - CELL_GAP

  canvas.width = Math.max(1, Math.round(cssWidth * dpr))
  canvas.height = Math.max(1, Math.round(cssHeight * dpr))
  canvas.style.height = `${cssHeight}px`
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  canvasCols.value = cols

  const doneColor = getCssVar('--color-success')
  const downloadingColor = getCssVar('--color-warning')
  const pendingColor = getCssVar('--text-placeholder')

  ctx.clearRect(0, 0, cssWidth, cssHeight)

  const inProgress = inProgressIndex.value
  for (let i = 0; i < status.length; i++) {
    const col = i % cols
    const row = Math.floor(i / cols)
    const x = GRID_PADDING + col * (CELL_SIZE + CELL_GAP)
    const y = GRID_PADDING + row * (CELL_SIZE + CELL_GAP)

    if (status[i]) {
      ctx.fillStyle = doneColor
      ctx.globalAlpha = 1
    } else if (i === inProgress) {
      ctx.fillStyle = downloadingColor
      ctx.globalAlpha = 1
    } else {
      ctx.fillStyle = pendingColor
      // 未完成块沿用 DOM 版的半透明弱化效果
      ctx.globalAlpha = 0.6
    }
    ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE)
    ctx.globalAlpha = 1
  }
}

function handleCanvasMouseMove(e: MouseEvent): void {
  const canvas = canvasRef.value
  if (!canvas || canvasCols.value <= 0) return

  const rect = canvas.getBoundingClientRect()
  const x = e.clientX - rect.left - GRID_PADDING
  const y = e.clientY - rect.top - GRID_PADDING
  const col = Math.floor(x / (CELL_SIZE + CELL_GAP))
  const row = Math.floor(y / (CELL_SIZE + CELL_GAP))
  const index = row * canvasCols.value + col

  if (col < 0 || row < 0 || index < 0 || index >= piecesStatus.value.length) {
    hoverState.value.visible = false
    return
  }

  const state: PieceState = piecesStatus.value[index]
    ? 'done'
    : index === inProgressIndex.value
      ? 'downloading'
      : 'pending'

  hoverState.value = {
    visible: true,
    index: index + 1,
    state,
    left: e.clientX + 14,
    top: e.clientY - 10
  }
}

function handleCanvasMouseLeave(): void {
  hoverState.value.visible = false
}

let resizeObserver: ResizeObserver | null = null
let themeObserver: MutationObserver | null = null

watch(
  [piecesStatus, inProgressIndex],
  () => {
    nextTick(drawPiecesCanvas)
  }
)

onMounted(() => {
  nextTick(() => {
    drawPiecesCanvas()
    // 容器宽度变化（窗口缩放/侧栏展开）时重绘
    if (piecesGridRef.value && 'ResizeObserver' in window) {
      resizeObserver = new ResizeObserver(() => drawPiecesCanvas())
      resizeObserver.observe(piecesGridRef.value)
    }
    // 主题切换（data-theme 变化）时重绘，保证三色与主题一致
    if ('MutationObserver' in window) {
      themeObserver = new MutationObserver(() => drawPiecesCanvas())
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme']
      })
    }
  })
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  themeObserver?.disconnect()
  themeObserver = null
})
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

/* canvas 网格容器：背景与圆角保持与原先 DOM 版 grid 一致，内边距由 canvas 绘制时补偿 */
.pieces-grid {
  position: relative;
  max-width: 100%;
  margin-bottom: 16px;
  background-color: var(--bg-tertiary);
  padding: 0;
  border-radius: 8px;
  overflow: hidden;
}

.pieces-grid canvas {
  display: block;
  width: 100%;
  cursor: default;
}

/* 悬停提示：跟随鼠标的 fixed 定位小浮层 */
.pieces-tooltip {
  position: fixed;
  z-index: 20;
  padding: 4px 8px;
  border-radius: 4px;
  background: var(--bg-primary);
  border: 1px solid var(--border-light);
  box-shadow: var(--shadow-base);
  font-size: 12px;
  color: var(--text-primary);
  pointer-events: none;
  white-space: nowrap;
}

.pieces-limit-hint {
  margin-bottom: 12px;
  font-size: 12px;
  color: var(--text-secondary);
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

.legend-color.downloading {
  background-color: var(--color-warning);
}

.legend-color.pending {
  background-color: var(--text-placeholder);
  opacity: 0.6;
}
</style>
