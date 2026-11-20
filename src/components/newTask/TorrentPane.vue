<template>
  <n-form ref="formRef" :model="form" :rules="rules">
    <div class="pane-section">
      <n-form-item path="torrentFile">
        <div
          class="file-drop-area"
          :class="{ 'drag-active': dragging }"
          role="button"
          tabindex="0"
          :aria-label="t('newTask.selectTorrentFile')"
          @click="pickFile"
          @keydown.enter="pickFile"
          @dragover.prevent="dragging = true"
          @dragleave.prevent="dragging = false"
          @drop.prevent="handleDrop"
        >
          <n-icon size="34"><CloudUploadOutline /></n-icon>
          <div class="drop-text">
            {{ form.torrentFile ? form.torrentFile.name : t('newTask.dropTorrentHint') }}
          </div>
        </div>
      </n-form-item>
    </div>

    <!-- 下载前勾选文件：索引直接对应 aria2 的 select-file 选项 -->
    <div
      v-if="parsingTorrent || torrentParseState.fileCount > 0 || torrentParseState.error"
      class="pane-section"
    >
      <div v-if="parsingTorrent" class="torrent-parsing">
        <n-spin size="small" />
        <span>{{ t('newTask.torrentParsing') }}</span>
      </div>
      <div v-else-if="torrentParseState.fileCount > 0" class="torrent-files">
        <div class="torrent-files-header">
          <span>
            {{ t('newTask.torrentFiles', { count: torrentParseState.fileCount }) }}
            · {{ formatSize(torrentParseState.totalSize) }}
          </span>
          <span class="torrent-files-summary ds-tnum">
            {{ t('newTask.torrentSelected', { count: selectedFileCount, size: formatSize(selectedFileBytes) }) }}
          </span>
        </div>
        <div class="torrent-file-actions">
          <n-button size="tiny" secondary @click="selectAllFiles">{{ t('newTask.selectAllFiles') }}</n-button>
          <n-button size="tiny" secondary @click="clearFileSelection">{{ t('newTask.clearFileSelection') }}</n-button>
          <n-button
            v-for="filter in quickFilters"
            :key="filter.id"
            size="tiny"
            quaternary
            @click="selectQuickCategory(filter.id)"
          >
            {{ filter.label }}
          </n-button>
        </div>
        <div class="torrent-file-list">
          <div v-for="item in torrentFiles" :key="item.index" class="torrent-file-row" :title="item.path">
            <n-checkbox
              :checked="selectedFiles.has(item.index)"
              @update:checked="(checked: boolean) => toggleFile(item.index, checked)"
            />
            <span class="torrent-file-name">{{ item.path }}</span>
            <span class="torrent-file-size ds-tnum">{{ formatSize(item.length) }}</span>
          </div>
        </div>
      </div>
      <div v-else-if="torrentParseState.error" class="torrent-parse-error">
        <span class="torrent-parse-error-title">{{ t('newTask.torrentParseFailed') }}</span>
        <span class="torrent-parse-error-reason" :title="torrentParseState.error">{{ torrentParseState.error }}</span>
      </div>
    </div>

    <div class="pane-section">
      <n-form-item :label="t('newTask.categoryLabel')" label-placement="top">
        <n-select v-model:value="form.category" :options="categoryOptions" />
      </n-form-item>
      <div v-if="targetDirPreview" class="dir-tip">
        {{ t('newTask.saveTo') }}：{{ targetDirPreview }}
        <span v-if="freeBytes >= 0" class="dir-free-space"> · {{ t('newTask.diskFree', { size: formatSize(freeBytes) }) }}</span>
      </div>
    </div>
  </n-form>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CloudUploadOutline } from '@vicons/ionicons5'
import type { FormInst, FormRules } from 'naive-ui'
import { message } from '@/utils/feedback'
import { useTaskStore } from '@/stores/taskStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useNewTaskSubmit } from '@/composables/useNewTaskSubmit'
import { useDiskFreeSpace } from '@/composables/useDiskFreeSpace'
import { pushRecentSaveDir } from '@/shared/recentSaveDirs'
import { CATEGORY_AUTO, resolveCategory } from '@/shared/fileCategories'
import { formatSize } from '@/utils/taskFormatters'
import { parseTorrentFiles, type TorrentFileEntry } from '@/utils/torrentFileList'
import { confirm } from '@/utils/feedback'
import { isDiskSpaceSufficient } from '@/utils/diskSpace'
import type { Aria2Option } from '@/types/aria2'
import type { CategoryOption, ComputeTargetDir, RequestPickFile } from './types'

interface Props {
  categoryOptions: CategoryOption[]
  computeTargetDir: ComputeTargetDir
  /** 壳注入：超过 aria2 RPC 上限的文件直接拒绝（内部已提示并返回 false） */
  checkFileSize: (file: File) => boolean
  /** 壳注入：读取文件为 base64（上传给 aria2 需要） */
  readFileAsBase64: (file: File) => Promise<string>
  /** 壳注入：请求打开隐藏的 file input */
  requestPickFile: RequestPickFile
  /** 拖拽 .torrent 到主窗口时的预填文件（由壳筛过类型，非空即应填入） */
  prefilledFile: File | null
}

const props = defineProps<Props>()

const { t } = useI18n()
const taskStore = useTaskStore()
const settingsStore = useSettingsStore()
const { submitting, runSubmit } = useNewTaskSubmit()

const formRef = ref<FormInst>()

const form = reactive({
  torrentFile: null as File | null,
  category: CATEGORY_AUTO
})

const rules: FormRules = {
  torrentFile: [
    { required: true, message: () => t('newTask.requireTorrent'), trigger: 'change' }
  ]
}

const dragging = ref(false)

/**
 * 种子解析结果：结构化保存文件清单、文件数与总大小，失败时保存原因。
 * 创建任务前用它展示「会下载什么」，解析失败时阻止提交并给出原因，
 * 而不是像旧实现那样只留一个布尔标记、静默退回「全部文件下载」。
 */
interface TorrentParseState {
  fileCount: number
  totalSize: number
  files: TorrentFileEntry[]
  /** 解析失败原因（空串=解析成功） */
  error: string
}

const EMPTY_TORRENT_PARSE: TorrentParseState = { fileCount: 0, totalSize: 0, files: [], error: '' }

const torrentParseState = ref<TorrentParseState>({ ...EMPTY_TORRENT_PARSE })
const selectedFiles = ref<Set<number>>(new Set())
const parsingTorrent = ref(false)

/** 已解析出的文件清单（模板与提交逻辑共用） */
const torrentFiles = computed(() => torrentParseState.value.files)

const selectedFileCount = computed(() => selectedFiles.value.size)
const selectedFileBytes = computed(() =>
  torrentFiles.value
    .filter(file => selectedFiles.value.has(file.index))
    .reduce((total, file) => total + file.length, 0)
)

const quickFilters = computed(() => [
  { id: 'video', label: t('newTask.category.video') },
  { id: 'music', label: t('newTask.category.music') },
  { id: 'images', label: t('newTask.category.images') },
  { id: 'documents', label: t('newTask.category.documents') }
])

function fileCategoryId(path: string): string {
  const name = path.split(/[\\/]/).pop() || path
  return resolveCategory(name, settingsStore.categoryConfig.categories ?? []).id
}

/** 将保存到的目录预览（种子名作为文件名提示参与分类）与目标盘剩余空间 */
const targetDirPreview = computed(() =>
  props.computeTargetDir(settingsStore.taskBaseDir, form.category, form.torrentFile?.name || '')
)
const freeBytes = useDiskFreeSpace(targetDirPreview)

/** 提交成功后把实际目标目录记入最近列表（失败静默） */
async function recordRecentSaveDir(dir: string) {
  if (!dir) return
  try {
    const recent = settingsStore.settings.download?.recentSaveDirs ?? []
    await settingsStore.updateDownloadConfig({ recentSaveDirs: pushRecentSaveDir(recent, dir) })
  } catch { /* 记录失败不影响提交结果 */ }
}

/** 解析种子内容并把结果结构化保存；失败时记录具体原因供界面展示 */
async function loadTorrentFiles(file: File) {
  parsingTorrent.value = true
  torrentParseState.value = { ...EMPTY_TORRENT_PARSE }
  selectedFiles.value = new Set()
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const list = parseTorrentFiles(bytes)
    const totalSize = list.files.reduce((sum, item) => sum + item.length, 0)
    torrentParseState.value = {
      fileCount: list.files.length,
      totalSize,
      files: list.files,
      error: ''
    }
    // 默认全选：与「全部文件下载」的旧行为保持一致
    selectedFiles.value = new Set(list.files.map(item => item.index))
  } catch (error) {
    // 解析失败的原始原因（bencode 结构错误等）直接展示，便于用户判断文件是否损坏
    const reason = error instanceof Error ? error.message : String(error)
    console.warn('[TorrentPane] Failed to parse torrent file:', error)
    torrentParseState.value = { ...EMPTY_TORRENT_PARSE, error: reason }
  } finally {
    parsingTorrent.value = false
  }
}

function setTorrentFile(file: File) {
  form.torrentFile = file
  void loadTorrentFiles(file)
}

function toggleFile(index: number, checked: boolean) {
  const next = new Set(selectedFiles.value)
  if (checked) next.add(index)
  else next.delete(index)
  selectedFiles.value = next
}

function selectAllFiles() {
  selectedFiles.value = new Set(torrentFiles.value.map(item => item.index))
}

function clearFileSelection() {
  selectedFiles.value = new Set()
}

function selectQuickCategory(categoryId: string) {
  const matched = torrentFiles.value.filter(item => fileCategoryId(item.path) === categoryId)
  if (matched.length === 0) {
    message.info(t('newTask.noFilesInCategory'))
    return
  }
  selectedFiles.value = new Set(matched.map(item => item.index))
}

// 拖拽文件到主窗口时自动填入（标签页切换由壳负责）。
// immediate：本页挂载时若预填值已存在，也要消费掉，不能只等变化。
watch(() => props.prefilledFile, (file) => {
  if (file) setTorrentFile(file)
}, { immediate: true })

function pickFile() {
  props.requestPickFile((file) => setTorrentFile(file))
}

function handleDrop(event: DragEvent) {
  dragging.value = false
  const file = event.dataTransfer?.files?.[0]
  if (!file) return
  setTorrentFile(file)
  message.success(t('newTask.torrentDropped', { name: file.name }))
}

async function handleSubmit() {
  // 保留旧实现的守卫：表单未挂载时不提交
  if (!formRef.value) return

  await runSubmit<File>({
    validate: async () => await formRef.value?.validate(),

    precheck: () => {
      const file = form.torrentFile
      if (!file) {
        message.error(t('newTask.invalidTorrent'))
        return null
      }
      // 超过 aria2 RPC 大小上限的文件直接拒绝，避免大文件上传失败
      if (!props.checkFileSize(file)) return null
      // 解析失败（结构损坏/非种子文件）时阻止提交：无法确认要下载什么，
      // 静默退回「全部文件下载」只会把错误留到 aria2 端
      if (torrentParseState.value.error) {
        message.error(t('newTask.torrentParseFailed'))
        return null
      }
      // 已解析出文件列表时，至少选择一个文件（aria2 会按 select-file 只下选中的）
      if (torrentFiles.value.length > 0 && selectedFiles.value.size === 0) {
        message.error(t('newTask.selectAtLeastOneFile'))
        return null
      }
      return file
    },

    perform: async (file) => {
      const torrentData = await props.readFileAsBase64(file)

      const options: Aria2Option = {}
      const downloadConfig = settingsStore.downloadConfig
      const targetDir = props.computeTargetDir(settingsStore.taskBaseDir, form.category, file.name)
      if (targetDir) options.dir = targetDir

      // 磁盘空间预检：种子内文件大小精确已知，提交前查一次目标盘剩余空间，
      // 不足时让用户确认（文件系统压缩/去重等场景仍可选择继续；查询失败静默跳过）
      if (
        selectedFileBytes.value > 0 &&
        targetDir &&
        window.electronAPI?.getDiskFreeSpace
      ) {
        const space = await window.electronAPI.getDiskFreeSpace(targetDir)
        if (!isDiskSpaceSufficient(space.free, selectedFileBytes.value)) {
          const proceed = await askInsufficientSpace(targetDir, space.free)
          if (!proceed) return ''
        }
      }
      // 注意：是否暂停由「下载设置」的 autoStart 决定（URI 页则是表单上的开关）
      if (downloadConfig && !downloadConfig.autoStart) options.pause = 'true'
      // 只下载勾选的文件；未解析成功时不传，保持“全部文件”的旧行为
      if (torrentFiles.value.length > 0) {
        options['select-file'] = [...selectedFiles.value].sort((a, b) => a - b).join(',')
      }

      await taskStore.addTorrent(torrentData, [], options)
      void recordRecentSaveDir(targetDir)
      return t('newTask.torrentAdded')
    },

    fallbackError: t('newTask.addTorrentFailed'),
    logLabel: 'TorrentPane'
  })
}

/**
 * 空间不足确认：与 URI 页重名确认同样的 Promise 包装（feedback.confirm 无返回值），
 * onClose / onEsc 必须同样 resolve(false)——X 与 ESC 等同于取消，否则提交流程挂起。
 * 返回 true=仍然添加；false=取消本次提交。
 */
function askInsufficientSpace(targetDir: string, freeBytes: number): Promise<boolean> {
  return new Promise((resolve) => {
    confirm({
      title: t('newTask.diskSpaceTitle'),
      content: t('newTask.diskSpaceContent', {
        required: formatSize(selectedFileBytes.value),
        free: formatSize(freeBytes),
        dir: targetDir
      }),
      type: 'warning',
      positiveText: t('newTask.diskSpaceContinue'),
      negativeText: t('common.cancel'),
      onPositiveClick: () => resolve(true),
      onNegativeClick: () => resolve(false),
      onClose: () => resolve(false),
      onEsc: () => resolve(false)
    })
  })
}

function handleReset() {
  formRef.value?.restoreValidation()
  form.torrentFile = null
  torrentParseState.value = { ...EMPTY_TORRENT_PARSE }
  selectedFiles.value = new Set()
}

// 按钮由弹窗 footer 统一渲染（滚动内容时始终可见）
defineExpose({
  submit: handleSubmit,
  reset: handleReset,
  submitting,
  actionVisible: true,
  actionDisabled: false,
  actionLabel: computed(() => t('newTask.startDownload'))
})
</script>

<style scoped>
/* 分组节奏（.pane-section / .field-helper）由 NewTaskDialog 统一提供，四个 tab 共用一套 */
.dir-tip {
  font-size: var(--ds-text-small-size);
  line-height: var(--ds-text-small-leading);
  color: var(--ds-text-muted);
  margin: var(--ds-space-4) 0 0;
  word-break: break-all;
}

.dir-free-space {
  color: var(--ds-text-faint);
}

/* 拖拽/点击选区：sunken 底 + 1px 虚线描边；hover 与拖入态统一成主色高亮 */
.file-drop-area {
  width: 100%;
  height: 148px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--ds-space-8);
  border: 1px dashed var(--ds-border-base);
  border-radius: var(--ds-radius-lg);
  background-color: var(--ds-bg-sunken);
  color: var(--ds-text-muted);
  cursor: pointer;
  transition:
    border-color var(--ds-motion-dur-2) var(--ds-motion-ease-in-out),
    background-color var(--ds-motion-dur-2) var(--ds-motion-ease-in-out),
    color var(--ds-motion-dur-2) var(--ds-motion-ease-in-out);
}

.file-drop-area:hover,
.file-drop-area.drag-active {
  border-color: var(--ds-accent);
  background-color: var(--ds-accent-subtle);
  color: var(--ds-accent-text);
}

/* 键盘焦点环：可聚焦的拖拽区不能因为自定义背景而丢掉焦点指示 */
.file-drop-area:focus-visible {
  outline: 2px solid var(--ds-focus-ring);
  outline-offset: 2px;
}

.drop-text {
  font-size: var(--ds-text-body-size);
  line-height: var(--ds-text-body-leading);
  text-align: center;
  padding: 0 var(--ds-space-16);
  word-break: break-all;
}

.torrent-parsing {
  display: flex;
  align-items: center;
  gap: var(--ds-space-8);
  padding: 0 0 var(--ds-space-12);
  font-size: var(--ds-text-small-size);
  color: var(--ds-text-muted);
}

/* 文件勾选面板：sunken 容器把「可选项」与表单字段分开 */
.torrent-files {
  margin-bottom: var(--ds-space-16);
  padding: var(--ds-space-12);
  border: 1px solid var(--ds-border-subtle);
  border-radius: var(--ds-radius-lg);
  background: var(--ds-bg-sunken);
}

.torrent-files-header {
  display: flex;
  justify-content: space-between;
  gap: var(--ds-space-8);
  margin-bottom: var(--ds-space-8);
  font-size: var(--ds-text-small-size);
  color: var(--ds-text-muted);
}

.torrent-files-summary {
  flex: none;
}

.torrent-file-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ds-space-6);
  margin-bottom: var(--ds-space-8);
}

.torrent-file-list {
  max-height: 180px;
  overflow-y: auto;
}

.torrent-file-row {
  display: flex;
  align-items: center;
  gap: var(--ds-space-8);
  padding: var(--ds-space-4) var(--ds-space-6);
  border-radius: var(--ds-radius-sm);
  font-size: var(--ds-text-body-size);
}

.torrent-file-row:hover {
  background: var(--ds-bg-hover);
}

.torrent-file-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ds-text-base);
}

.torrent-file-size {
  flex: none;
  font-size: var(--ds-text-small-size);
  color: var(--ds-text-muted);
}

/* 解析失败：结论 + 具体原因两行，原因过长时省略但可 hover 看全文 */
.torrent-parse-error {
  display: flex;
  flex-direction: column;
  gap: var(--ds-space-2);
  margin-bottom: var(--ds-space-12);
  font-size: var(--ds-text-small-size);
  color: var(--ds-status-danger-text);
}

.torrent-parse-error-reason {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ds-text-muted);
}
</style>
