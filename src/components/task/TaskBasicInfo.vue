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
          <span class="file-name-text">{{ getFileName(firstFilePath) }}</span>
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
            <div class="mono-block">{{ firstFilePath }}</div>
            <n-button v-if="isElectron" size="tiny" quaternary circle :title="t('task.openLocation')" @click="openFileInFolder(firstFilePath)">
              <template #icon>
                <n-icon><FolderOpenOutline /></n-icon>
              </template>
            </n-button>
          </div>
        </n-descriptions-item>

        <n-descriptions-item v-if="taskUris.length" :label="t('taskDetail.downloadUrl')" :span="2">
          <div class="path-with-action">
            <div class="mono-block uri-text">{{ firstUri }}</div>
            <n-button size="tiny" quaternary circle :title="t('taskDetail.copyLink')" :aria-label="t('taskDetail.copyLink')" @click="copyUri(firstUri)">
              <template #icon>
                <n-icon><CopyOutline /></n-icon>
              </template>
            </n-button>
          </div>
        </n-descriptions-item>

        <n-descriptions-item v-if="hasError" :label="t('taskDetail.errorMessage')" :span="2">
          <!-- 先说人话（按 aria2 退出码分类），引擎原话作为次要信息保留：
               用户既知道该改什么，也留着排查用的原始信息 -->
          <n-text type="error">{{ errorSummary }}</n-text>
          <div v-if="rawErrorMessage" class="error-raw">{{ rawErrorMessage }}</div>
        </n-descriptions-item>
      </n-descriptions>

      <!-- 文件操作按钮 -->
      <div v-if="task.files?.length" class="file-actions">
        <n-button v-if="isElectron && task.status === 'complete'" size="small" type="primary" ghost @click="openFileInFolder(firstFilePath)">
          <template #icon>
            <n-icon><FolderOpenOutline /></n-icon>
          </template>
          {{ t('task.openLocation') }}
        </n-button>
        <!-- 失败任务：带着原链接打开新建弹窗，先改参数再重试 -->
        <n-button v-if="task.status === 'error' && firstUri" size="small" @click="retryWithOptions">
          {{ t('taskDetail.retryWithOptions') }}
        </n-button>
      </div>
    </n-card>

    <!-- BitTorrent 信息 -->
    <n-card v-if="task.bittorrent" class="info-card" size="small" :bordered="false">
      <template #header>
        <div class="card-header">
          <span>BitTorrent {{ t('common.info') }}</span>
          <n-tag v-if="btHealthText" size="small" :type="seederCount > 0 ? 'success' : 'warning'" :bordered="false">
            {{ btHealthText }}
          </n-tag>
        </div>
      </template>

      <!-- 没有任何做种者时速度通常极慢甚至停滞：直接说出来，比让用户盯着 0 KB/s 猜原因强 -->
      <n-alert v-if="btHealthWarning" type="warning" :bordered="false" class="bt-health-alert">
        {{ btHealthWarning }}
      </n-alert>

      <n-descriptions :column="2" label-placement="left" class="task-descriptions">
        <n-descriptions-item :label="t('taskDetail.seeders')">{{ seederCount }}</n-descriptions-item>
        <n-descriptions-item :label="t('taskDetail.connections')">{{ task.connections || '0' }}</n-descriptions-item>
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
import { classifyAria2Error } from '@/shared/aria2Error'
import { CopyOutline, FolderOpenOutline } from '@vicons/ionicons5'
import { message } from '@/utils/feedback'
import { useUiStore } from '@/stores/uiStore'
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
const uiStore = useUiStore()

/** 重试并编辑：把失败任务的原始链接带回新建弹窗 */
function retryWithOptions() {
  if (!firstUri.value) return
  uiStore.closeTaskDetail()
  uiStore.openNewTaskWithUrl(firstUri.value)
}

const hasError = computed(() => !!props.task.errorCode && props.task.errorCode !== '0')

/** aria2 退出码 → 分类；分类由 shared/aria2Error 决定，文案走语言包 */
const aria2ErrorKind = computed(() => classifyAria2Error(props.task.errorCode))

const errorSummary = computed(() => {
  const kind = aria2ErrorKind.value
  if (kind === 'unknown') return props.task.errorMessage || String(props.task.errorCode ?? '')
  return t(`taskDetail.aria2Error.${kind}`)
})

/** 已经翻译成人话时，把引擎原话降级成小字；没有原话或翻译不出来就不重复显示 */
const rawErrorMessage = computed(() => {
  const message = props.task.errorMessage
  if (!message || aria2ErrorKind.value === 'unknown') return ''
  return message
})

const progressPercent = computed(() => getProgress(props.task))

/**
 * BT 健康度（可见的那部分）：
 * aria2 不提供"总做种者数/可用副本数"，能拿到的只有**已连上的**做种者数量（numSeeders）
 * 与本机是否在做种（seeder）。这足以回答用户最关心的问题——"为什么没速度"。
 */
const seederCount = computed(() => {
  const parsed = Number(props.task.numSeeders ?? 0)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
})

const isSeeding = computed(() => props.task.seeder === 'true')

const btHealthText = computed(() => {
  if (isSeeding.value) return t('taskDetail.healthSeeding')
  if (seederCount.value > 0) return t('taskDetail.healthSeeders', { count: seederCount.value })
  return ''
})

const btHealthWarning = computed(() => {
  // 只有"正在下载/等待"时才谈健康度：已完成或已停止的任务没连上种子是正常的
  const downloading = props.task.status === 'active' || props.task.status === 'waiting'
  if (!downloading) return ''
  return seederCount.value === 0 ? t('taskDetail.healthNoSeeder') : ''
})

/**
 * 首个文件路径 / 首个下载链接。
 * 模板里多处引用 `files[0]` / `taskUris[0]`，外层虽已用 v-if 保证存在，
 * 但 noUncheckedIndexedAccess 下直接索引会被判为可能 undefined，故统一在这里兜底空串。
 */
const firstFilePath = computed(() => props.task.files?.[0]?.path ?? '')
const firstUri = computed(() => props.taskUris[0]?.uri ?? '')

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

.bt-health-alert {
  margin-bottom: 12px;
}

/* 引擎原话：保留给排查用，但不跟"人话"抢注意力 */
.error-raw {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-secondary);
  word-break: break-all;
}
</style>
