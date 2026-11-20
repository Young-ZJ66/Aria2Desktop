<template>
  <n-form ref="formRef" :model="form" :rules="rules">
    <div class="pane-section">
      <n-form-item path="metalinkFile">
        <div
          class="file-drop-area"
          :class="{ 'drag-active': dragging }"
          role="button"
          tabindex="0"
          :aria-label="t('newTask.selectMetalinkFile')"
          @click="pickFile"
          @keydown.enter="pickFile"
          @dragover.prevent="dragging = true"
          @dragleave.prevent="dragging = false"
          @drop.prevent="handleDrop"
        >
          <n-icon size="34"><CloudUploadOutline /></n-icon>
          <div class="drop-text">
            {{ form.metalinkFile ? form.metalinkFile.name : t('newTask.dropMetalinkHint') }}
          </div>
        </div>
      </n-form-item>
    </div>

    <!-- 创建前展示解析出的文件清单：Metalink 只是一份镜像/文件清单，先让用户看清要下什么 -->
    <div
      v-if="parsingMetalink || metalinkParseState.fileCount > 0 || metalinkParseState.error"
      class="pane-section"
    >
      <div v-if="parsingMetalink" class="metalink-parsing">
        <n-spin size="small" />
        <span>{{ t('common.loading') }}</span>
      </div>
      <div v-else-if="metalinkParseState.fileCount > 0" class="metalink-files">
        <div class="metalink-files-header">
          <span>
            {{ t('taskDetail.filesInfo') }}：{{ metalinkParseState.fileCount }}
            · {{ formatSize(metalinkParseState.totalSize) }}
          </span>
        </div>
        <div class="metalink-file-list">
          <div
            v-for="(item, index) in metalinkParseState.files"
            :key="index"
            class="metalink-file-row"
            :title="item.name"
          >
            <span class="metalink-file-name">{{ item.name }}</span>
            <span class="metalink-file-size ds-tnum">{{ formatSize(item.size) }}</span>
          </div>
        </div>
      </div>
      <div v-else class="metalink-parse-error">
        <span class="metalink-parse-error-title">{{ t('newTask.invalidMetalink') }}</span>
        <span class="metalink-parse-error-reason" :title="metalinkParseState.error">{{ metalinkParseState.error }}</span>
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
import { formatSize } from '@/utils/taskFormatters'
import { pushRecentSaveDir } from '@/shared/recentSaveDirs'
import { CATEGORY_AUTO } from '@/shared/fileCategories'
import { parseMetalinkFiles, type MetalinkFileEntry } from '@/utils/metalinkFileList'
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
  /** 拖拽 .metalink/.meta4 到主窗口时的预填文件（由壳筛过类型，非空即应填入） */
  prefilledFile: File | null
}

const props = defineProps<Props>()

const { t } = useI18n()
const taskStore = useTaskStore()
const settingsStore = useSettingsStore()
const { submitting, runSubmit } = useNewTaskSubmit()

const formRef = ref<FormInst>()

const form = reactive({
  metalinkFile: null as File | null,
  category: CATEGORY_AUTO
})

const rules: FormRules = {
  metalinkFile: [
    { required: true, message: () => t('newTask.requireMetalink'), trigger: 'change' }
  ]
}

/** 将保存到的目录预览与目标盘剩余空间（与 UriPane/TorrentPane 同款） */
const targetDirPreview = computed(() =>
  props.computeTargetDir(settingsStore.taskBaseDir, form.category, form.metalinkFile?.name || '')
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

const dragging = ref(false)

/** 解析结果：创建前把「要下哪些文件、共多大」摊开给用户确认 */
interface MetalinkParseState {
  fileCount: number
  totalSize: number
  files: MetalinkFileEntry[]
  /** 解析失败原因；空串表示解析成功 */
  error: string
}

/** 空态：换文件时先回到这里，避免上一次的文件清单残留 */
const EMPTY_METALINK_PARSE: MetalinkParseState = { fileCount: 0, totalSize: 0, files: [], error: '' }

const metalinkParseState = ref<MetalinkParseState>({ ...EMPTY_METALINK_PARSE })
const parsingMetalink = ref(false)

/**
 * 解析 Metalink 清单并结构化保存。
 * 失败不抛错：原因写进 state.error，界面展示并在提交前拦截，
 * 避免把「无文件清单」的 Metalink 交给 aria2 后才发现下不了。
 */
async function loadMetalinkFiles(file: File) {
  parsingMetalink.value = true
  metalinkParseState.value = { ...EMPTY_METALINK_PARSE }
  try {
    const text = await file.text()
    const list = parseMetalinkFiles(text)
    metalinkParseState.value = {
      fileCount: list.files.length,
      totalSize: list.totalSize,
      files: list.files,
      error: ''
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.warn('[MetalinkPane] Failed to parse metalink file:', error)
    metalinkParseState.value = { ...EMPTY_METALINK_PARSE, error: reason }
  } finally {
    parsingMetalink.value = false
  }
}

/** 选中文件后立刻解析：拖拽、点选、预填三条入口都走这里 */
function setMetalinkFile(file: File) {
  form.metalinkFile = file
  void loadMetalinkFiles(file)
}

// 拖拽文件到主窗口时自动填入（标签页切换由壳负责）。
// immediate：本页挂载时若预填值已存在，也要消费掉，不能只等变化。
watch(() => props.prefilledFile, (file) => {
  if (file) setMetalinkFile(file)
}, { immediate: true })

function pickFile() {
  props.requestPickFile((file) => { setMetalinkFile(file) })
}

function handleDrop(event: DragEvent) {
  dragging.value = false
  const file = event.dataTransfer?.files?.[0]
  if (!file) return
  setMetalinkFile(file)
  message.success(t('newTask.metalinkDropped', { name: file.name }))
}

async function handleSubmit() {
  // 保留旧实现的守卫：表单未挂载时不提交
  if (!formRef.value) return

  await runSubmit<File>({
    validate: async () => await formRef.value?.validate(),

    precheck: () => {
      const file = form.metalinkFile
      if (!file) {
        message.error(t('newTask.invalidMetalink'))
        return null
      }
      // 超过 aria2 RPC 大小上限的文件直接拒绝，避免大文件上传失败
      if (!props.checkFileSize(file)) return null
      // 解析失败（非 Metalink / 没有 file 声明）时阻止提交：清单不可信就不该开始下载
      if (metalinkParseState.value.error) {
        message.error(t('newTask.invalidMetalink'))
        return null
      }
      return file
    },

    perform: async (file) => {
      const metalinkData = await props.readFileAsBase64(file)

      const options: Aria2Option = {}
      const downloadConfig = settingsStore.downloadConfig
      const targetDir = props.computeTargetDir(settingsStore.taskBaseDir, form.category, file.name)
      if (targetDir) options.dir = targetDir
      // 注意：是否暂停由「下载设置」的 autoStart 决定（URI 页则是表单上的开关）
      if (downloadConfig && !downloadConfig.autoStart) options.pause = 'true'

      const gids = await taskStore.addMetalink(metalinkData, options)
      void recordRecentSaveDir(targetDir)
      return t('newTask.metalinkAdded', { count: gids.length })
    },

    fallbackError: t('newTask.addMetalinkFailed'),
    logLabel: 'MetalinkPane'
  })
}

function handleReset() {
  formRef.value?.restoreValidation()
  form.metalinkFile = null
  metalinkParseState.value = { ...EMPTY_METALINK_PARSE }
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

/* 解析中：与 TorrentPane 同款节奏，避免两个 tab 观感不一致 */
.metalink-parsing {
  display: flex;
  align-items: center;
  gap: var(--ds-space-8);
  padding: 0 0 var(--ds-space-12);
  font-size: var(--ds-text-small-size);
  color: var(--ds-text-muted);
}

/* 文件清单：sunken 容器把「清单」与表单字段分开 */
.metalink-files {
  margin-bottom: var(--ds-space-16);
  padding: var(--ds-space-12);
  border: 1px solid var(--ds-border-subtle);
  border-radius: var(--ds-radius-lg);
  background: var(--ds-bg-sunken);
}

.metalink-files-header {
  display: flex;
  justify-content: space-between;
  gap: var(--ds-space-8);
  margin-bottom: var(--ds-space-8);
  font-size: var(--ds-text-small-size);
  color: var(--ds-text-muted);
}

.metalink-file-list {
  max-height: 180px;
  overflow-y: auto;
}

.metalink-file-row {
  display: flex;
  align-items: center;
  gap: var(--ds-space-8);
  padding: var(--ds-space-4) var(--ds-space-6);
  border-radius: var(--ds-radius-sm);
  font-size: var(--ds-text-body-size);
}

.metalink-file-row:hover {
  background: var(--ds-bg-hover);
}

.metalink-file-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ds-text-base);
}

.metalink-file-size {
  flex: none;
  font-size: var(--ds-text-small-size);
  color: var(--ds-text-muted);
}

/* 解析失败：结论 + 具体原因两行，原因过长时省略但可 hover 看全文 */
.metalink-parse-error {
  display: flex;
  flex-direction: column;
  gap: var(--ds-space-2);
  margin-bottom: var(--ds-space-12);
  font-size: var(--ds-text-small-size);
  color: var(--ds-status-danger-text);
}

.metalink-parse-error-reason {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ds-text-muted);
}
</style>
