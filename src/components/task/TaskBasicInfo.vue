<template>
  <div>
    <!-- 任务信息卡片 -->
    <n-card class="info-card" size="small">
      <div class="info-section">
        <n-descriptions :column="2" bordered label-placement="left" class="task-descriptions">
          <n-descriptions-item :label="t('task.gid')">
            <div class="field-with-action">
              <span>{{ task.gid }}</span>
              <n-button size="tiny" quaternary circle :title="t('taskDetail.copyGid')" @click="copyGid">
                <template #icon>
                  <n-icon><CopyOutline /></n-icon>
                </template>
              </n-button>
            </div>
          </n-descriptions-item>
          <n-descriptions-item :label="t('task.status')">
            <n-tag :type="(getStatusType(task.status) as any) || 'default'">
              {{ t('status.' + task.status) }}
            </n-tag>
          </n-descriptions-item>

          <n-descriptions-item v-if="task.files?.length" :label="t('task.fileName')">
            <span>{{ getFileName(task.files[0].path) }}</span>
          </n-descriptions-item>

          <n-descriptions-item :label="t('task.size')">{{ formatSize(task.totalLength) }}</n-descriptions-item>
          <n-descriptions-item :label="t('taskDetail.downloaded')">{{ formatSize(task.completedLength) }}</n-descriptions-item>
          <n-descriptions-item :label="t('task.progress')">
            <n-progress
              type="line"
              :percentage="getProgress(task)"
              :status="task.status === 'complete' ? 'success' : 'default'"
              :height="8"
              style="width: 200px"
            />
          </n-descriptions-item>
          <n-descriptions-item :label="t('task.remainingTime')">{{ formatRemainingTime(task) }}</n-descriptions-item>
          <n-descriptions-item :label="t('task.downloadSpeed')">{{ formatSpeed(task.downloadSpeed) }}</n-descriptions-item>
          <n-descriptions-item :label="t('taskDetail.numPieces')">{{ task.numPieces || 0 }}</n-descriptions-item>
          <n-descriptions-item :label="t('taskDetail.pieceLength')">{{ formatSize(task.pieceLength || '0') }}</n-descriptions-item>

          <n-descriptions-item v-if="task.files?.length" :label="t('taskDetail.filePath')" :span="2">
            <div class="path-with-action">
              <span>{{ task.files[0].path }}</span>
              <n-button v-if="isElectron" size="tiny" quaternary circle :title="t('task.openLocation')" style="margin-left: 8px;" @click="openFileInFolder(task.files[0].path)">
                <template #icon>
                  <n-icon><FolderOpenOutline /></n-icon>
                </template>
              </n-button>
            </div>
          </n-descriptions-item>

          <n-descriptions-item v-if="taskUris.length" :label="t('taskDetail.downloadUrl')" :span="2">
            <div class="field-with-action">
              <div class="uri-content-full">
                <span class="uri-text-full">{{ taskUris[0].uri }}</span>
              </div>
              <n-button size="tiny" quaternary circle :title="t('taskDetail.copyLink')" @click="copyUri(taskUris[0].uri)">
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
          <n-button v-if="isElectron" size="small" @click="openFile(task.files[0].path)">
            <template #icon>
              <n-icon><DocumentTextOutline /></n-icon>
            </template>
            {{ t('task.openLocation') }}
          </n-button>
        </div>
      </div>
    </n-card>

    <!-- BitTorrent 信息 -->
    <n-card v-if="task.bittorrent" class="info-card" size="small">
      <template #header>
        <span>BitTorrent {{ t('common.info') }}</span>
      </template>

      <n-descriptions :column="2" bordered label-placement="left">
        <n-descriptions-item :label="t('taskDetail.torrentName')">{{ task.bittorrent.info?.name || t('common.unknown') }}</n-descriptions-item>
        <n-descriptions-item :label="t('taskDetail.createdBy')">{{ task.bittorrent.createdBy || t('common.unknown') }}</n-descriptions-item>
        <n-descriptions-item :label="t('taskDetail.creationDate')">{{ formatDate(task.bittorrent.creationDate) }}</n-descriptions-item>
        <n-descriptions-item :label="t('taskDetail.comment')">{{ task.bittorrent.comment || t('common.none') }}</n-descriptions-item>
        <n-descriptions-item :label="t('taskDetail.mode')">{{ task.bittorrent.mode || t('common.unknown') }}</n-descriptions-item>
        <n-descriptions-item :label="t('taskDetail.announceList')">
          <div v-if="task.bittorrent.announceList?.length">
            <n-tag
              v-for="(announce, index) in task.bittorrent.announceList.slice(0, 3)"
              :key="index"
              size="small"
              style="margin: 2px;"
            >
              {{ announce[0] }}
            </n-tag>
            <span v-if="task.bittorrent.announceList.length > 3">
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
import { useI18n } from 'vue-i18n'
import { CopyOutline, FolderOpenOutline, DocumentTextOutline } from '@vicons/ionicons5'
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

function copyGid() {
  if (props.task?.gid) {
    navigator.clipboard.writeText(props.task.gid)
    message.success(t('common.copied'))
  }
}

function copyUri(uri: string) {
  navigator.clipboard.writeText(uri)
  message.success(t('common.copied'))
}

function formatDate(timestamp: string | number | undefined): string {
  if (!timestamp || timestamp === '0' || timestamp === 0) return t('common.unknown')
  const ts = typeof timestamp === 'string' ? parseInt(timestamp) : timestamp
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

async function openFile(filePath: string) {
  if (!window.electronAPI) {
    message.warning(t('task.desktopOnly'))
    return
  }

  try {
    const result = await window.electronAPI.openPath(filePath)
    if (result?.success) {
      message.success(t('task.openedLocation'))
    } else {
      message.error(t('task.openDirFailed', { error: result?.error || t('common.unknown') }))
    }
  } catch (error) {
    console.error('Failed to open file:', error)
    message.error(t('taskDetail.openFileFailed'))
  }
}
</script>

<style scoped>
.info-card {
  margin-bottom: 20px;
}

.info-section {
  margin-bottom: 32px;
}

.info-section:last-child {
  margin-bottom: 0;
}

.file-actions {
  display: flex;
  justify-content: flex-start;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--border-light);
}

.task-descriptions :deep(.n-descriptions-table-label) {
  min-width: 120px !important;
  width: 120px !important;
  white-space: nowrap !important;
  text-align: left !important;
  padding-right: 16px !important;
}

.field-with-action {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.path-with-action {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0;
  width: 100%;
}

.path-with-action span {
  word-break: break-all;
  line-height: 1.5;
}

.field-with-action .uri-content-full {
  display: flex;
  align-items: flex-start;
  padding: 12px;
  background-color: var(--bg-tertiary);
  border-radius: 4px;
  border: 1px solid var(--border-light);
  flex: 1;
  min-width: 0;
  max-height: 120px;
  overflow-y: auto;
}

.field-with-action .uri-text-full {
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 11px;
  color: var(--text-regular);
  word-break: break-all;
  line-height: 1.5;
  white-space: pre-wrap;
  width: 100%;
}
</style>
