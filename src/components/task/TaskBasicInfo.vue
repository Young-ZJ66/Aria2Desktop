<template>
  <div>
    <!-- 任务信息卡片 -->
    <n-card class="info-card" size="small" :bordered="false">
      <template #header>
        <div class="card-header">
          <span>{{ t('taskDetail.basicInfo') }}</span>
          <n-tag v-if="task.status" :type="getStatusType(task.status)" size="small">
            {{ t('status.' + task.status) }}
          </n-tag>
        </div>
      </template>

      <n-descriptions :column="2" label-placement="left" class="task-descriptions">
        <n-descriptions-item :label="t('task.gid')">
          <div class="field-with-action">
            <span class="gid-text">{{ task.gid }}</span>
            <n-button size="tiny" quaternary circle :title="t('taskDetail.copyGid')" :aria-label="t('taskDetail.copyGid')" @click="copyGid">
              <template #icon>
                <n-icon><CopyOutline /></n-icon>
              </template>
            </n-button>
          </div>
        </n-descriptions-item>

        <n-descriptions-item v-if="task.files?.length" :label="t('task.fileName')">
          <span class="file-name-text">{{ getFileName(task.files[0].path) }}</span>
        </n-descriptions-item>

        <n-descriptions-item :label="t('task.size')">{{ formatSize(task.totalLength) }}</n-descriptions-item>
        <n-descriptions-item :label="t('taskDetail.downloaded')">{{ formatSize(task.completedLength) }}</n-descriptions-item>
        <n-descriptions-item :label="t('task.downloadSpeed')">
          <span v-if="Number(task.downloadSpeed) > 0" class="speed-download">{{ formatSpeed(task.downloadSpeed) }}</span>
          <span v-else class="muted-value">--</span>
        </n-descriptions-item>
        <n-descriptions-item :label="t('task.uploadSpeed')">
          <span v-if="Number(task.uploadSpeed) > 0" class="speed-upload">{{ formatSpeed(task.uploadSpeed) }}</span>
          <span v-else class="muted-value">--</span>
        </n-descriptions-item>
        <n-descriptions-item :label="t('task.remainingTime')">{{ formatRemainingTime(task) }}</n-descriptions-item>
        <n-descriptions-item :label="t('taskDetail.piecesInfo')">
          {{ task.numPieces || 0 }} × {{ formatSize(task.pieceLength || '0') }}
        </n-descriptions-item>

        <!-- 进度条：占满整行 -->
        <n-descriptions-item :label="t('task.progress')" :span="2">
          <div class="progress-row">
            <div
              class="progress-track"
              role="progressbar"
              :aria-label="t('task.progress')"
              :aria-valuenow="progressPercent"
              aria-valuemin="0"
              aria-valuemax="100"
            >
              <div
                class="progress-fill"
                :class="progressClass"
                :style="{ width: progressPercent + '%' }"
              />
            </div>
            <span class="progress-text">{{ progressPercent }}%</span>
          </div>
        </n-descriptions-item>

        <n-descriptions-item v-if="task.files?.length" :label="t('taskDetail.filePath')" :span="2">
          <div class="path-with-action">
            <div class="mono-block">{{ task.files[0].path }}</div>
            <n-button v-if="isElectron" size="tiny" quaternary circle :title="t('task.openLocation')" @click="openFileInFolder(task.files[0].path)">
              <template #icon>
                <n-icon><FolderOpenOutline /></n-icon>
              </template>
            </n-button>
          </div>
        </n-descriptions-item>

        <n-descriptions-item v-if="taskUris.length" :label="t('taskDetail.downloadUrl')" :span="2">
          <div class="path-with-action">
            <div class="mono-block uri-text">{{ taskUris[0].uri }}</div>
            <n-button size="tiny" quaternary circle :title="t('taskDetail.copyLink')" :aria-label="t('taskDetail.copyLink')" @click="copyUri(taskUris[0].uri)">
              <template #icon>
                <n-icon><CopyOutline /></n-icon>
              </template>
            </n-button>
          </div>
        </n-descriptions-item>

        <n-descriptions-item v-if="task.errorCode && task.errorCode !== '0'" :label="t('taskDetail.errorMessage')" :span="2">
          <n-text type="error">{{ task.errorMessage || task.errorCode }}</n-text>
        </n-descriptions-item>
      </n-descriptions>

      <!-- 文件操作按钮 -->
      <div v-if="task.files?.length && task.status === 'complete'" class="file-actions">
        <n-button v-if="isElectron" size="small" type="primary" ghost @click="openFileInFolder(task.files[0].path)">
          <template #icon>
            <n-icon><FolderOpenOutline /></n-icon>
          </template>
          {{ t('task.openLocation') }}
        </n-button>
      </div>
    </n-card>

    <!-- BitTorrent 信息 -->
    <n-card v-if="task.bittorrent" class="info-card" size="small" :bordered="false">
      <template #header>
        <div class="card-header">
          <span>BitTorrent {{ t('common.info') }}</span>
        </div>
      </template>

      <n-descriptions :column="2" label-placement="left" class="task-descriptions">
        <n-descriptions-item :label="t('taskDetail.torrentName')">{{ task.bittorrent.info?.name || t('common.unknown') }}</n-descriptions-item>
        <n-descriptions-item :label="t('taskDetail.createdBy')">{{ task.bittorrent.createdBy || t('common.unknown') }}</n-descriptions-item>
        <n-descriptions-item :label="t('taskDetail.creationDate')">{{ formatDate(task.bittorrent.creationDate) }}</n-descriptions-item>
        <n-descriptions-item :label="t('taskDetail.mode')">{{ task.bittorrent.mode || t('common.unknown') }}</n-descriptions-item>
        <n-descriptions-item :label="t('taskDetail.comment')" :span="2">{{ task.bittorrent.comment || t('common.none') }}</n-descriptions-item>
        <n-descriptions-item :label="t('taskDetail.announceList')" :span="2">
          <div v-if="task.bittorrent.announceList?.length" class="announce-list">
            <n-tag
              v-for="(announce, index) in task.bittorrent.announceList.slice(0, 3)"
              :key="index"
              size="small"
              :bordered="false"
              round
            >
              {{ announce[0] }}
            </n-tag>
            <span v-if="task.bittorrent.announceList.length > 3" class="and-more">
              {{ t('taskDetail.andMore', { count: task.bittorrent.announceList.length }) }}
            </span>
          </div>
          <span v-else>{{ t('common.none') }}</span>
        </n-descriptions-item>
      </n-descriptions>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { CopyOutline, FolderOpenOutline } from '@vicons/ionicons5'
import { message } from '@/utils/feedback'
import type { Aria2Task, Aria2Uri } from '@/types/aria2'
import {
  formatSize,
  formatSpeed,
  formatRemainingTime,
  getProgress,
  getStatusType,
  getFileName
} from '@/utils/taskFormatters'

interface Props {
  task: Aria2Task
  taskUris: Aria2Uri[]
  isElectron: boolean
}

const props = defineProps<Props>()
const { t } = useI18n()

const progressPercent = computed(() => getProgress(props.task))

const progressClass = computed(() => {
  switch (props.task.status) {
    case 'complete': return 'complete'
    case 'error': return 'error'
    case 'active': return 'active'
    default: return 'pending'
  }
})

// 复制文本到剪贴板：优先使用 Clipboard API，旧环境/非 HTTPS 降级为 textarea + execCommand
async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      return fallbackCopyText(text)
    }
  }
  return fallbackCopyText(text)
}

function fallbackCopyText(text: string): boolean {
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    // 隐藏 textarea 避免闪现（fixed + 透明 + 移出视口）
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    textarea.style.pointerEvents = 'none'
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}

async function copyGid() {
  if (!props.task?.gid) return
  const ok = await copyText(props.task.gid)
  if (ok) {
    message.success(t('common.copied'))
  } else {
    message.error(t('common.copyFailed'))
  }
}

async function copyUri(uri: string) {
  const ok = await copyText(uri)
  if (ok) {
    message.success(t('common.copied'))
  } else {
    message.error(t('common.copyFailed'))
  }
}

function formatDate(timestamp: string | number | undefined): string {
  if (!timestamp || timestamp === '0' || timestamp === 0) return t('common.unknown')
  const ts = typeof timestamp === 'string' ? parseInt(timestamp, 10) : timestamp
  const date = new Date(ts * 1000)
  return date.toLocaleString()
}

async function openFileInFolder(filePath: string) {
  if (!window.electronAPI) {
    message.warning(t('task.desktopOnly'))
    return
  }

  try {
    if (window.electronAPI.openInExplorer) {
      const result = await window.electronAPI.openInExplorer(filePath)
      if (result?.success) {
        message.success(t('task.openedLocation'))
        return
      }
    }

    const result = await window.electronAPI.showItemInFolder(filePath)
    if (result?.success) {
      message.success(t('task.openedLocation'))
    } else {
      message.error(t('task.openDirFailed', { error: result?.error || t('common.unknown') }))
    }
  } catch (error) {
    console.error('Failed to open file in folder:', error)
    message.error(t('task.openLocationFailed'))
  }
}
</script>

<style scoped>
.info-card {
  margin-bottom: 16px;
  background: var(--bg-primary);
  border: 1px solid var(--border-light);
  border-radius: 10px;
}

.info-card:last-child {
  margin-bottom: 0;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.task-descriptions {
  --label-width: 96px;
}

.task-descriptions :deep(.n-descriptions-table) {
  border-collapse: separate;
  border-spacing: 0 6px;
}

.task-descriptions :deep(.n-descriptions-table-label) {
  width: var(--label-width);
  min-width: var(--label-width);
  white-space: nowrap;
  text-align: left;
  padding: 6px 16px 6px 0;
  color: var(--text-secondary);
  font-size: 13px;
}

.task-descriptions :deep(.n-descriptions-table-content) {
  padding: 6px 0;
  font-size: 13px;
  word-break: break-word;
}

/* 内容 span 为 inline-block 会收缩宽度，导致进度条等宽度失效，改为占满单元格 */
.task-descriptions :deep(.n-descriptions-table-content__content) {
  display: inline-block;
  width: 100%;
}

.file-name-text {
  display: block;
  width: 100%;
  word-break: break-all;
  line-height: 1.5;
  color: var(--text-primary);
}

.field-with-action {
  display: flex;
  align-items: center;
  gap: 4px;
}

.gid-text {
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 12px;
}

.muted-value {
  color: var(--text-placeholder);
}

.speed-download {
  color: var(--color-success);
  font-weight: 500;
}

.speed-upload {
  color: var(--color-info);
  font-weight: 500;
}

.progress-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
}

.progress-track {
  flex: 1;
  height: 8px;
  background-color: var(--bg-tertiary);
  border: 1px solid var(--border-light);
  border-radius: 4px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: 4px;
  background-color: var(--color-primary);
  transition: width 0.3s ease;
}

.progress-fill.complete {
  background-color: var(--color-success);
}

.progress-fill.error {
  background-color: var(--color-danger);
}

.progress-fill.pending {
  background-color: var(--text-placeholder);
}

.progress-text {
  flex-shrink: 0;
  min-width: 42px;
  text-align: right;
  font-size: 12px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.path-with-action {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.mono-block {
  flex: 1;
  min-width: 0;
  padding: 8px 12px;
  background-color: var(--bg-tertiary);
  border: 1px solid var(--border-light);
  border-radius: 6px;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 12px;
  color: var(--text-regular);
  word-break: break-all;
  line-height: 1.5;
}

.file-actions {
  display: flex;
  justify-content: flex-start;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--border-light);
}

.announce-list {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.and-more {
  font-size: 12px;
  color: var(--text-secondary);
  margin-left: 4px;
}
</style>
