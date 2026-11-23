<template>
  <div>
    <!-- 任务信息卡片 -->
    <n-card class="info-card" size="small" :bordered="false">
      <n-descriptions :column="2" label-placement="left" class="task-descriptions">
        <n-descriptions-item :label="t('task.gid')">
          <span class="gid-text">{{ task.gid }}</span>
        </n-descriptions-item>

        <n-descriptions-item v-if="displayFilePaths.length" :label="t('task.fileName')">
          <span class="file-name-text">{{ getFileName(firstFilePath) }}</span>
        </n-descriptions-item>

        <n-descriptions-item :label="t('task.size')">{{ formatSize(task.totalLength) }}</n-descriptions-item>
        <n-descriptions-item :label="t('taskDetail.downloaded')">{{ formatSize(task.completedLength) }}</n-descriptions-item>
        <n-descriptions-item :label="t('task.downloadSpeed')">
          <span v-if="task.status === 'active' && Number(task.downloadSpeed) > 0" class="speed-download">{{ formatSpeed(task.downloadSpeed) }}</span>
          <span v-else class="muted-value">--</span>
        </n-descriptions-item>
        <n-descriptions-item :label="t('task.uploadSpeed')">
          <span v-if="task.status === 'active' && Number(task.uploadSpeed) > 0" class="speed-upload">{{ formatSpeed(task.uploadSpeed) }}</span>
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

        <!-- D-11：多文件（流媒体播放列表、多输出）逐条列出，每条都能打开所在位置或直接打开文件。
             单文件时保持原来的紧凑一行，不为最常见的场景增加视觉噪音。 -->
        <n-descriptions-item v-if="displayFilePaths.length" :label="t('taskDetail.filePath')" :span="2">
          <div v-if="multiFilePaths" class="file-list">
            <div v-for="(path, index) in displayFilePaths" :key="path" class="file-entry">
              <span class="file-entry__index">{{ index + 1 }}</span>
              <div class="mono-block file-entry__path" :title="path">{{ path }}</div>
              <div class="file-entry__actions">
                <n-button
                  v-if="isElectron"
                  size="tiny"
                  quaternary
                  circle
                  :title="t('task.openFile')"
                  :aria-label="t('task.openFile')"
                  @click="openFile(path)"
                >
                  <template #icon>
                    <n-icon><DocumentOutline /></n-icon>
                  </template>
                </n-button>
                <n-button
                  v-if="isElectron"
                  size="tiny"
                  quaternary
                  circle
                  :title="t('task.openLocation')"
                  :aria-label="t('task.openLocation')"
                  @click="openFileInFolder(path)"
                >
                  <template #icon>
                    <n-icon><FolderOpenOutline /></n-icon>
                  </template>
                </n-button>
              </div>
            </div>
          </div>
          <div v-else class="path-with-action">
            <div class="mono-block">{{ firstFilePath }}</div>
            <n-button
              v-if="isElectron"
              size="tiny"
              quaternary
              circle
              :title="t('task.openFile')"
              :aria-label="t('task.openFile')"
              @click="openFile(firstFilePath)"
            >
              <template #icon>
                <n-icon><DocumentOutline /></n-icon>
              </template>
            </n-button>
            <n-button
              v-if="isElectron"
              size="tiny"
              quaternary
              circle
              :title="t('task.openLocation')"
              :aria-label="t('task.openLocation')"
              @click="openFileInFolder(firstFilePath)"
            >
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

      <!-- 失败任务操作：已完成文件统一走上方路径行的图标按钮 -->
      <div v-if="displayFilePaths.length && task.status === 'error' && firstUri" class="file-actions">
        <n-button size="small" @click="retryWithOptions">
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
      <DismissibleAlert v-if="btHealthWarning" storage-key="task.btHealth" type="warning" class="bt-health-alert">
        {{ btHealthWarning }}
      </DismissibleAlert>

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
        <n-descriptions-item v-if="magnetUri" :label="t('taskDetail.magnetUri')" :span="2">
          <div class="field-with-action">
            <span class="gid-text magnet-text">{{ magnetUri }}</span>
            <n-button size="tiny" quaternary circle :title="t('taskDetail.copyMagnet')" :aria-label="t('taskDetail.copyMagnet')" @click="copyMagnet">
              <template #icon>
                <n-icon><CopyOutline /></n-icon>
              </template>
            </n-button>
          </div>
        </n-descriptions-item>
      </n-descriptions>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { classifyAria2Error } from '@/shared/aria2Error'
import { CopyOutline, DocumentOutline, FolderOpenOutline } from '@vicons/ionicons5'
import { message } from '@/utils/feedback'
import { useUiStore } from '@/stores/uiStore'
import DismissibleAlert from '@/components/common/DismissibleAlert.vue'
import type { Aria2Task, Aria2Uri } from '@/types/aria2'
import {
  formatSize,
  formatSpeed,
  formatRemainingTime,
  formatDateTime,
  getProgress,
  getFileName
} from '@/utils/taskFormatters'

interface Props {
  task: Aria2Task
  taskUris: Aria2Uri[]
  isElectron: boolean
  /**
   * 流媒体任务的全部输出文件（D-11）。
   * 这类任务不在 aria2 队列里，转成 Aria2Task 形状时只保留了首个文件（见 streamTaskUtils），
   * 播放列表会产出多个文件，因此由抽屉把完整列表传进来。普通 aria2 任务不传。
   */
  streamFilePaths?: string[]
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
const firstUri = computed(() => props.taskUris[0]?.uri ?? '')

/**
 * 详情里要展示的全部文件路径（D-11）。
 *
 * 数据来源有两个：aria2 任务的 files 列表，以及流媒体任务由抽屉传入的 filePaths。
 * 两者都去重、去空，避免播放列表场景下同一个文件出现两遍。
 */
const displayFilePaths = computed<string[]>(() => {
  const collected: string[] = []
  const pushPath = (value: string | undefined) => {
    const trimmed = (value ?? '').trim()
    if (trimmed && !collected.includes(trimmed)) collected.push(trimmed)
  }
  for (const filePath of props.streamFilePaths ?? []) pushPath(filePath)
  for (const file of props.task.files ?? []) pushPath(file?.path)
  return collected
})

/** 多于一个文件才切换成列表布局；单文件保持原来的一行展示 */
const multiFilePaths = computed(() => displayFilePaths.value.length > 1)

/** 首个文件路径：优先取统一路径列表，兼容只有 files 的普通任务与只有 filePaths 的流媒体任务 */
const firstFilePath = computed(() => displayFilePaths.value[0] ?? '')

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

/** 磁力链接：infoHash + 显示名 + tracker（有 tracker 才追加 tr 参数，方便其他客户端直连） */
const magnetUri = computed(() => {
  const infoHash = props.task.infoHash
  if (!infoHash) return ''
  const params = new URLSearchParams()
  params.set('xt', 'urn:btih:' + infoHash)
  const name = props.task.bittorrent?.info?.name
  if (name) params.set('dn', name)
  for (const announce of props.task.bittorrent?.announceList ?? []) {
    const url = announce?.[0]
    if (url && /^((https?|udp):\/\/)/.test(url)) params.append('tr', url)
  }
  return 'magnet:?' + params.toString()
})

async function copyMagnet() {
  if (!magnetUri.value) return
  const ok = await copyText(magnetUri.value)
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
  if (!Number.isFinite(ts)) return t('common.unknown')
  // D-28：统一走 taskFormatters 的 locale 日期函数，不再用不带 locale 的 toLocaleString()
  const formatted = formatDateTime(new Date(ts * 1000))
  return formatted === '--' ? t('common.unknown') : formatted
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

/** D-11：用系统默认程序打开文件（主进程会校验路径确实在下载目录内） */
async function openFile(filePath: string) {
  if (!filePath) return
  if (!window.electronAPI?.openFile) {
    message.warning(t('task.desktopOnly'))
    return
  }

  try {
    const result = await window.electronAPI.openFile(filePath)
    if (result?.success) {
      message.success(t('task.openedFile'))
    } else {
      message.error(t('task.openFileFailed', { error: result?.error || t('common.unknown') }))
    }
  } catch (error) {
    console.error('Failed to open file:', error)
    message.error(t('task.openFileFailed', { error: t('common.unknown') }))
  }
}
</script>

<style scoped>
.info-card {
  margin-bottom: 16px;
  background: var(--ds-bg-surface);
  border: 1px solid var(--ds-border-subtle);
  border-radius: var(--ds-radius-lg);
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
  color: var(--ds-text-muted);
  font-size: var(--ds-text-body-size);
}

.task-descriptions :deep(.n-descriptions-table-content) {
  padding: 6px 0;
  font-size: var(--ds-text-body-size);
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
  color: var(--ds-text-strong);
}

.field-with-action {
  display: flex;
  align-items: center;
  gap: 4px;
}

.magnet-text {
  word-break: break-all;
  font-size: var(--ds-text-micro-size);
  color: var(--ds-text-muted);
}

.gid-text {
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: var(--ds-text-small-size);
}

.muted-value {
  color: var(--ds-text-faint);
}

.speed-download {
  color: var(--ds-status-success-solid);
  font-weight: 500;
}

.speed-upload {
  color: var(--ds-status-info-solid);
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
  background-color: var(--ds-bg-sunken);
  border: 1px solid var(--ds-border-subtle);
  border-radius: var(--ds-radius-xs);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: var(--ds-radius-xs);
  background-color: var(--ds-accent);
  transition: width var(--ds-motion-dur-4);
}

.progress-fill.complete {
  background-color: var(--ds-status-success-solid);
}

.progress-fill.error {
  background-color: var(--ds-status-danger-solid);
}

.progress-fill.pending {
  background-color: var(--ds-text-faint);
}

.progress-text {
  flex-shrink: 0;
  min-width: 42px;
  text-align: right;
  font-size: var(--ds-text-small-size);
  color: var(--ds-text-muted);
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
  background-color: var(--ds-bg-sunken);
  border: 1px solid var(--ds-border-subtle);
  border-radius: var(--ds-radius-sm);
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: var(--ds-text-small-size);
  color: var(--ds-text-base);
  word-break: break-all;
  line-height: 1.5;
}

.file-actions {
  display: flex;
  justify-content: flex-start;
  gap: 8px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--ds-border-subtle);
}

/* D-11：多文件列表（播放列表/多输出）。每条一行，路径可换行，操作按钮固定在右侧 */
.file-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}

.file-entry {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.file-entry__index {
  flex-shrink: 0;
  min-width: 18px;
  text-align: right;
  font-size: var(--ds-text-small-size);
  color: var(--ds-text-faint);
  font-variant-numeric: tabular-nums;
}

.file-entry__path {
  /* 与 .mono-block 共用等宽/底色，只是不再需要 flex:1 之外的自适应 */
  max-height: 4.6em;
  overflow-y: auto;
}

.file-entry__actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 2px;
}

.announce-list {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.and-more {
  font-size: var(--ds-text-small-size);
  color: var(--ds-text-muted);
  margin-left: 4px;
}

.bt-health-alert {
  margin-bottom: 12px;
}

/* 引擎原话：保留给排查用，但不跟"人话"抢注意力 */
.error-raw {
  margin-top: 4px;
  font-size: var(--ds-text-small-size);
  color: var(--ds-text-muted);
  word-break: break-all;
}
</style>
