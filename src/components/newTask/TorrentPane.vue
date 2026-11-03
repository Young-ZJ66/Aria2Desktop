<template>
  <n-form ref="formRef" :model="form" :rules="rules">
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

    <!-- 下载前勾选文件：索引直接对应 aria2 的 select-file 选项 -->
    <div v-if="parsingTorrent" class="torrent-parsing">
      <n-spin size="small" />
      <span>{{ t('newTask.torrentParsing') }}</span>
    </div>
    <div v-else-if="torrentFiles.length > 0" class="torrent-files">
      <div class="torrent-files-header">
        <span>{{ t('newTask.torrentFiles', { count: torrentFiles.length }) }}</span>
        <span class="torrent-files-summary">
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
          <span class="torrent-file-size">{{ formatSize(item.length) }}</span>
        </div>
      </div>
    </div>
    <div v-else-if="parseError" class="torrent-parse-error">
      {{ t('newTask.torrentParseFailed') }}
    </div>

    <n-form-item :label="t('newTask.categoryLabel')" label-placement="top">
      <n-select v-model:value="form.category" :options="categoryOptions" />
    </n-form-item>
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

const torrentFiles = ref<TorrentFileEntry[]>([])
const selectedFiles = ref<Set<number>>(new Set())
const parsingTorrent = ref(false)
const parseError = ref(false)

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

/** 解析种子内容；失败时保留“全部文件下载”的旧行为 */
async function loadTorrentFiles(file: File) {
  parsingTorrent.value = true
  parseError.value = false
  torrentFiles.value = []
  selectedFiles.value = new Set()
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const list = parseTorrentFiles(bytes)
    torrentFiles.value = list.files
    selectedFiles.value = new Set(list.files.map(item => item.index))
  } catch {
    parseError.value = true
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
  torrentFiles.value = []
  selectedFiles.value = new Set()
  parseError.value = false
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
.file-drop-area {
  width: 100%;
  height: 150px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px dashed var(--border-base);
  border-radius: 8px;
  background-color: var(--bg-tertiary);
  color: var(--text-secondary);
  cursor: pointer;
  transition: border-color 0.2s ease, background-color 0.2s ease, color 0.2s ease;
}

.file-drop-area:hover,
.file-drop-area.drag-active {
  border-color: var(--color-primary);
  background-color: var(--bg-hover);
  color: var(--color-primary);
}

.drop-text {
  font-size: 13px;
  text-align: center;
  padding: 0 16px;
  word-break: break-all;
}

.torrent-parsing {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0 12px;
  font-size: 12px;
  color: var(--text-secondary);
}

.torrent-files {
  margin-bottom: 16px;
  padding: 10px 12px;
  border: 1px solid var(--border-light);
  border-radius: 8px;
}

.torrent-files-header {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--text-secondary);
}

.torrent-files-summary {
  flex: none;
}

.torrent-file-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.torrent-file-list {
  max-height: 180px;
  overflow-y: auto;
}

.torrent-file-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 2px;
  font-size: 12.5px;
}

.torrent-file-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-regular);
}

.torrent-file-size {
  flex: none;
  font-size: 12px;
  color: var(--text-secondary);
}

.torrent-parse-error {
  margin-bottom: 12px;
  font-size: 12px;
  color: var(--color-warning);
}
</style>
