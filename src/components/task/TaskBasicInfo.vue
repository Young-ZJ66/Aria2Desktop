<template>
  <div>
    <!-- 任务信息卡片 -->
    <el-card class="info-card">
      <div class="info-section">
        <el-descriptions :column="2" border class="task-descriptions">
          <el-descriptions-item :label="t('task.gid')">
            <div class="field-with-action">
              <span>{{ task.gid }}</span>
              <el-button size="small" text title="复制 GID" @click="copyGid">
                <el-icon><CopyDocument /></el-icon>
              </el-button>
            </div>
          </el-descriptions-item>
          <el-descriptions-item :label="t('task.status')">
            <el-tag :type="getStatusType(task.status)">
              {{ t('status.' + task.status) }}
            </el-tag>
          </el-descriptions-item>

          <el-descriptions-item v-if="task.files?.length" :label="t('task.fileName')">
            <span>{{ getFileName(task.files[0].path) }}</span>
          </el-descriptions-item>

          <el-descriptions-item :label="t('task.size')">{{ formatSize(task.totalLength) }}</el-descriptions-item>
          <el-descriptions-item label="已下载">{{ formatSize(task.completedLength) }}</el-descriptions-item>
          <el-descriptions-item :label="t('task.progress')">
            <el-progress
              :percentage="getProgress(task)"
              :status="task.status === 'complete' ? 'success' : undefined"
              style="width: 200px"
            />
          </el-descriptions-item>
          <el-descriptions-item :label="t('task.remainingTime')">{{ formatRemainingTime(task) }}</el-descriptions-item>
          <el-descriptions-item :label="t('task.downloadSpeed')">{{ formatSpeed(task.downloadSpeed) }}</el-descriptions-item>
          <el-descriptions-item label="分片数">{{ task.numPieces || 0 }}</el-descriptions-item>
          <el-descriptions-item label="分片长度">{{ formatSize(task.pieceLength || '0') }}</el-descriptions-item>

          <el-descriptions-item v-if="task.files?.length" label="文件路径" :span="2">
            <div class="path-with-action">
              <span>{{ task.files[0].path }}</span>
              <el-button v-if="isElectron" size="small" text title="打开位置" style="margin-left: 8px;" @click="openFileInFolder(task.files[0].path)">
                <el-icon><FolderOpened /></el-icon>
              </el-button>
            </div>
          </el-descriptions-item>

          <el-descriptions-item v-if="taskUris.length" label="下载链接" :span="2">
            <div class="field-with-action">
              <div class="uri-content-full">
                <span class="uri-text-full">{{ taskUris[0].uri }}</span>
              </div>
              <el-button size="small" text title="复制链接" @click="copyUri(taskUris[0].uri)">
                <el-icon><CopyDocument /></el-icon>
              </el-button>
            </div>
          </el-descriptions-item>

          <el-descriptions-item v-if="task.errorCode && task.errorCode !== '0'" label="错误信息" :span="2">
            <el-text type="danger">{{ task.errorMessage || task.errorCode }}</el-text>
          </el-descriptions-item>
        </el-descriptions>

        <!-- 文件操作按钮 -->
        <div v-if="task.files?.length && task.status === 'complete'" class="file-actions">
          <el-space>
            <el-button v-if="isElectron" size="small" @click="openFile(task.files[0].path)">
              <el-icon><Document /></el-icon>
              {{ t('task.openLocation') }}
            </el-button>
          </el-space>
        </div>
      </div>
    </el-card>

    <!-- BitTorrent 信息 -->
    <el-card v-if="task.bittorrent" class="info-card">
      <template #header>
        <span>BitTorrent {{ t('common.info') }}</span>
      </template>

      <el-descriptions :column="2" border>
        <el-descriptions-item label="种子名称">{{ task.bittorrent.info?.name || t('common.unknown') }}</el-descriptions-item>
        <el-descriptions-item label="创建者">{{ task.bittorrent.createdBy || t('common.unknown') }}</el-descriptions-item>
        <el-descriptions-item label="创建时间">{{ formatDate(task.bittorrent.creationDate) }}</el-descriptions-item>
        <el-descriptions-item label="注释">{{ task.bittorrent.comment || t('common.none') }}</el-descriptions-item>
        <el-descriptions-item label="模式">{{ task.bittorrent.mode || t('common.unknown') }}</el-descriptions-item>
        <el-descriptions-item label="宣布列表">
          <div v-if="task.bittorrent.announceList?.length">
            <el-tag
              v-for="(announce, index) in task.bittorrent.announceList.slice(0, 3)"
              :key="index"
              size="small"
              style="margin: 2px;"
            >
              {{ announce[0] }}
            </el-tag>
            <span v-if="task.bittorrent.announceList.length > 3">
              等 {{ task.bittorrent.announceList.length }} 个
            </span>
          </div>
          <span v-else>{{ t('common.none') }}</span>
        </el-descriptions-item>
      </el-descriptions>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'
import { CopyDocument, FolderOpened, Document } from '@element-plus/icons-vue'
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
    ElMessage.success(t('common.copied'))
  }
}

function copyUri(uri: string) {
  navigator.clipboard.writeText(uri)
  ElMessage.success(t('common.copied'))
}

function formatDate(timestamp: string | number | undefined): string {
  if (!timestamp || timestamp === '0' || timestamp === 0) return t('common.unknown')
  const ts = typeof timestamp === 'string' ? parseInt(timestamp) : timestamp
  const date = new Date(ts * 1000)
  return date.toLocaleString()
}

async function openFileInFolder(filePath: string) {
  if (!window.electronAPI) {
    ElMessage.warning(t('task.desktopOnly'))
    return
  }

  try {
    if (window.electronAPI.openInExplorer) {
      const result = await window.electronAPI.openInExplorer(filePath)
      if (result?.success) {
        ElMessage.success(t('task.openedLocation'))
        return
      }
    }

    const result = await window.electronAPI.showItemInFolder(filePath)
    if (result?.success) {
      ElMessage.success(t('task.openedLocation'))
    } else {
      ElMessage.error(t('task.openDirFailed', { error: result?.error || t('common.unknown') }))
    }
  } catch (error) {
    console.error('Failed to open file in folder:', error)
    ElMessage.error(t('task.openLocationFailed'))
  }
}

async function openFile(filePath: string) {
  if (!window.electronAPI) {
    ElMessage.warning(t('task.desktopOnly'))
    return
  }

  try {
    const result = await window.electronAPI.openPath(filePath)
    if (result?.success) {
      ElMessage.success(t('task.openedLocation'))
    } else {
      ElMessage.error(t('task.openDirFailed', { error: result?.error || t('common.unknown') }))
    }
  } catch (error) {
    console.error('Failed to open file:', error)
    ElMessage.error('打开文件失败')
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

.task-descriptions :deep(.el-descriptions__label) {
  min-width: 120px !important;
  width: 120px !important;
  white-space: nowrap !important;
  text-align: left !important;
  padding-right: 16px !important;
}

.task-descriptions :deep(.el-descriptions__content) {
  min-width: 0;
  flex: 1;
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

.path-with-action .el-button {
  flex-shrink: 0;
  padding: 4px;
  min-width: auto;
  height: auto;
}

.path-with-action .el-button .el-icon {
  margin: 0;
  font-size: 14px;
}

.field-with-action .el-button {
  flex-shrink: 0;
  padding: 4px;
  min-width: auto;
  height: auto;
}

.field-with-action .el-button .el-icon {
  margin: 0;
  font-size: 14px;
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
