<template>
  <div class="action-buttons">
    <!-- 主操作：开始 / 重试 / 暂停。v2 里它是这一行唯一「重」的按钮，
         其余动作退成同尺寸但更轻的图标，悬停才显色。 -->
    <button
      v-if="status === 'paused'"
      :title="isPausedSeeding ? t('task.resumeSeeding') : t('task.startDownload')"
      :aria-label="isPausedSeeding ? t('task.resumeSeeding') : t('task.startDownload')"
      class="task-action-btn task-action-btn--primary"
      :disabled="operating"
      @click.stop="$emit('unpause', gid)"
    >
      <div v-if="operating" class="loading-spinner" />
      <n-icon v-else class="action-icon"><PlayOutline /></n-icon>
    </button>

    <button
      v-else-if="status === 'error'"
      :title="t('task.retryDownload')"
      :aria-label="t('task.retryDownload')"
      class="task-action-btn task-action-btn--primary task-action-btn--warning"
      :disabled="operating"
      @click.stop="$emit('retry', gid)"
    >
      <div v-if="operating" class="loading-spinner" />
      <n-icon v-else class="action-icon"><RefreshOutline /></n-icon>
    </button>

    <button
      v-else-if="status === 'active'"
      :title="isSeeding ? t('task.stopSeeding') : t('task.pauseDownload')"
      :aria-label="isSeeding ? t('task.stopSeeding') : t('task.pauseDownload')"
      class="task-action-btn task-action-btn--primary"
      :disabled="operating"
      @click.stop="$emit('pause', gid)"
    >
      <div v-if="operating" class="loading-spinner" />
      <n-icon v-else class="action-icon"><PauseOutline /></n-icon>
    </button>

    <!-- 等待队列排序：仅等待中的任务（aria2 changePosition）。等待态没有开始/暂停按钮，
         这三个箭头就是该行的主操作，所以保持常显而不是塞进「更多」。 -->
    <template v-if="status === 'waiting' && showQueueActions">
      <button
        :title="t('task.moveUp')"
        :aria-label="t('task.moveUp')"
        class="task-action-btn"
        :disabled="operating"
        @click.stop="$emit('move-up', gid)"
      >
        <n-icon class="action-icon"><ArrowUpOutline /></n-icon>
      </button>
      <button
        :title="t('task.moveDown')"
        :aria-label="t('task.moveDown')"
        class="task-action-btn"
        :disabled="operating"
        @click.stop="$emit('move-down', gid)"
      >
        <n-icon class="action-icon"><ArrowDownOutline /></n-icon>
      </button>
      <button
        :title="t('task.moveToTop')"
        :aria-label="t('task.moveToTop')"
        class="task-action-btn"
        :disabled="operating"
        @click.stop="$emit('move-top', gid)"
      >
        <n-icon class="action-icon"><ChevronUpCircleOutline /></n-icon>
      </button>
    </template>

    <!-- 打开文件：已完成且能定位到实际文件时显示 -->
    <button
      v-if="showOpenFile"
      :title="t('task.openFile')"
      :aria-label="t('task.openFile')"
      class="task-action-btn"
      :disabled="operating"
      @click.stop="$emit('open-file', task)"
    >
      <n-icon class="action-icon"><DocumentOutline /></n-icon>
    </button>

    <!-- 打开位置：仅已完成任务页面 -->
    <button
      v-if="showOpenLocation"
      :title="t('task.openLocation')"
      :aria-label="t('task.openLocation')"
      class="task-action-btn"
      :disabled="operating"
      @click.stop="$emit('open-location', task)"
    >
      <n-icon class="action-icon"><FolderOpenOutline /></n-icon>
    </button>

    <!-- 保存 .torrent：低频操作，收进「更多」菜单，避免行尾图标堆成一片同权重灰点 -->
    <n-dropdown
      v-if="showTorrentExport"
      trigger="click"
      placement="bottom-end"
      size="small"
      :options="moreOptions"
      @select="handleMoreSelect"
    >
      <button
        :title="t('task.actions')"
        :aria-label="t('task.actions')"
        class="task-action-btn"
        :disabled="operating"
        @click.stop
      >
        <n-icon class="action-icon"><EllipsisHorizontalOutline /></n-icon>
      </button>
    </n-dropdown>

    <!-- 详情：眼睛图标曾经和删除同色同权重，现在把删除隔到分隔线之后 -->
    <button
      v-if="showDetail"
      :title="t('task.viewDetail')"
      :aria-label="t('task.viewDetail')"
      class="task-action-btn"
      :disabled="operating"
      @click.stop="$emit('view-detail', gid)"
    >
      <n-icon class="action-icon"><EyeOutline /></n-icon>
    </button>

    <span class="action-sep" aria-hidden="true" />

    <!-- 删除：破坏性操作独立成组，只在悬停时染成危险色，不与其他动作争注意力 -->
    <button
      :title="t('task.deleteTask')"
      :aria-label="t('task.deleteTask')"
      class="task-action-btn task-action-btn--danger"
      :disabled="operating"
      @click.stop="$emit('remove', gid)"
    >
      <n-icon class="action-icon"><TrashOutline /></n-icon>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, h } from 'vue'
import { useI18n } from 'vue-i18n'
import { NIcon, NDropdown } from 'naive-ui'
import {
  PlayOutline,
  RefreshOutline,
  PauseOutline,
  FolderOpenOutline,
  TrashOutline,
  EyeOutline,
  DocumentOutline,
  SaveOutline,
  ArrowUpOutline,
  ArrowDownOutline,
  ChevronUpCircleOutline,
  EllipsisHorizontalOutline
} from '@vicons/ionicons5'
import type { Aria2Task } from '@/types/aria2'

interface Props {
  gid: string
  status: string
  operating: boolean
  showOpenLocation: boolean
  /** 是否显示“打开文件”按钮（仅当任务有可定位的已完成文件） */
  showOpenFile?: boolean
  /** 是否显示详情按钮（流媒体任务无 aria2 详情） */
  showDetail?: boolean
  /** 是否显示等待队列排序按钮（下载任务页显示，完成页无此概念） */
  showQueueActions?: boolean
  /** 是否显示“保存 .torrent”按钮（BT 任务） */
  showTorrentExport?: boolean
  task: Aria2Task
}

interface Emits {
  (e: 'unpause', gid: string): void
  (e: 'retry', gid: string): void
  (e: 'pause', gid: string): void
  (e: 'open-location', task: Aria2Task): void
  (e: 'open-file', task: Aria2Task): void
  (e: 'remove', gid: string): void
  (e: 'view-detail', gid: string): void
  (e: 'move-up', gid: string): void
  (e: 'move-down', gid: string): void
  (e: 'move-top', gid: string): void
  (e: 'export-torrent', gid: string): void
}

const { t } = useI18n()
const props = withDefaults(defineProps<Props>(), { showDetail: true, showQueueActions: false, showOpenFile: false, showTorrentExport: false })
const emit = defineEmits<Emits>()

/** 正在做种（aria2 只对 BT 任务返回 seeder） */
const isSeeding = computed(() => props.task.seeder === 'true')

/** 已完成但处于暂停状态的 BT 任务：开始按钮语义是“重新做种” */
const isPausedSeeding = computed(() => {
  if (!props.task.bittorrent || props.task.status !== 'paused') return false
  const total = Number(props.task.totalLength) || 0
  const completed = Number(props.task.completedLength) || 0
  return total > 0 && completed >= total
})

/** 「更多」菜单：目前只有保存种子，后续低频动作都往这里加 */
const moreOptions = computed(() => [
  {
    key: 'export-torrent',
    label: t('task.saveTorrent'),
    icon: () => h(NIcon, null, { default: () => h(SaveOutline) })
  }
])

function handleMoreSelect(key: string): void {
  if (key === 'export-torrent') emit('export-torrent', props.gid)
}
</script>

<style scoped>
.action-buttons {
  display: flex;
  gap: 0;
  align-items: center;
  justify-content: center;
}

.task-action-btn {
  border: none;
  background: transparent;
  padding: 0;
  margin: 0;
  width: 26px;
  height: 26px;
  border-radius: var(--ds-radius-sm);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background-color var(--ds-motion-dur-1) var(--ds-motion-ease-out),
    color var(--ds-motion-dur-1) var(--ds-motion-ease-out);
}

.task-action-btn:hover:not(:disabled) {
  background: var(--ds-bg-hover);
}

.task-action-btn:active:not(:disabled) {
  background: var(--ds-bg-active);
}

.task-action-btn:focus-visible {
  outline: 2px solid var(--ds-accent);
  outline-offset: -1px;
}

.action-icon {
  font-size: var(--ds-text-title-size);
  color: var(--ds-text-muted);
  transition: color var(--ds-motion-dur-1) var(--ds-motion-ease-out);
}

.task-action-btn:hover:not(:disabled) .action-icon {
  color: var(--ds-text-strong);
}

/* 主操作：唯一带底色倾向的按钮，扫视一行时先看到「这个任务能做什么」 */
.task-action-btn--primary {
  background: var(--ds-accent-subtle);
}

.task-action-btn--primary .action-icon {
  color: var(--ds-accent-text);
}

.task-action-btn--primary:hover:not(:disabled) {
  background: var(--ds-accent-border);
}

.task-action-btn--primary:hover:not(:disabled) .action-icon {
  color: var(--ds-accent-text);
}

.task-action-btn--warning {
  background: var(--ds-status-warning-subtle);
}

.task-action-btn--warning .action-icon {
  color: var(--ds-status-warning-text);
}

/* 删除：默认与其他图标同色，悬停才显危险色——避免整行四五个按钮都在喊叫 */
.task-action-btn--danger:hover:not(:disabled) {
  background: var(--ds-status-danger-subtle);
}

.task-action-btn--danger:hover:not(:disabled) .action-icon {
  color: var(--ds-status-danger-text);
}

.action-sep {
  width: 1px;
  height: 14px;
  margin: 0 4px;
  background: var(--ds-border-subtle);
}

.task-action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.loading-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid var(--ds-border-base);
  border-top: 2px solid var(--ds-accent);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
</style>
