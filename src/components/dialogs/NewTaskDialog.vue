<template>
  <n-modal
    v-model:show="visible"
    :title="t('newTask.title')"
    preset="card"
    style="width: 620px"
    :bordered="false"
    :mask-closable="true"
  >
    <n-tabs v-model:value="activeTab" type="line" animated>
      <!-- URI 下载 -->
      <n-tab-pane name="uri" :tab="t('newTask.uriTab')">
        <n-form ref="uriFormRef" :model="uriForm" :rules="uriRules">
          <n-form-item path="uris" :label="t('newTask.urisLabel')" label-placement="top">
            <n-input
              v-model:value="uriForm.uris"
              type="textarea"
              :rows="5"
              :placeholder="t('newTask.urlsPlaceholder')"
            />
          </n-form-item>
          <n-form-item path="dir" :label="t('newTask.downloadDir')" label-placement="top">
            <n-input v-model:value="uriForm.dir" :placeholder="t('newTask.dirPlaceholder')">
              <template #suffix>
                <n-button text :disabled="!isElectron" @click="selectDir">
                  <template #icon><n-icon><FolderOutline /></n-icon></template>
                </n-button>
              </template>
            </n-input>
          </n-form-item>
          <n-form-item path="fileName" :label="t('newTask.fileName')" label-placement="top">
            <n-input v-model:value="uriForm.fileName" :placeholder="t('newTask.fileNamePlaceholder')" />
          </n-form-item>
          <n-form-item>
            <template #label>
              <span class="option-label">{{ t('newTask.options') }}</span>
            </template>
            <div class="option-row">
              <div class="option-item">
                <span class="option-item-label">{{ t('newTask.maxConnectionPerServer') }}</span>
                <n-input-number v-model:value="uriForm.maxConnectionPerServer" :min="1" :max="16" />
              </div>
              <div class="option-item">
                <span class="option-item-label">{{ t('newTask.minSplitSize') }}</span>
                <n-select v-model:value="uriForm.minSplitSize" :options="minSplitSizeOptions" />
              </div>
              <div class="option-item option-item--switch">
                <span class="option-item-label">{{ t('newTask.autoStart') }}</span>
                <AppSwitch v-model:value="uriForm.autoStart" />
              </div>
            </div>
          </n-form-item>
          <div class="form-actions">
            <n-space>
              <n-button type="primary" :loading="submitting" @click="handleUriSubmit">
                {{ t('newTask.startDownload') }}
              </n-button>
              <n-button @click="handleUriReset">{{ t('newTask.reset') }}</n-button>
            </n-space>
          </div>
        </n-form>
      </n-tab-pane>

      <!-- 种子文件下载 -->
      <n-tab-pane name="torrent" :tab="t('newTask.torrentTab')">
        <n-form ref="torrentFormRef" :model="torrentForm" :rules="torrentRules">
          <n-form-item path="torrentFile">
            <div
              class="file-drop-area"
              :class="{ 'drag-active': draggingTorrent }"
              role="button"
              tabindex="0"
              :aria-label="t('newTask.selectTorrentFile')"
              @click="pickFile('torrent')"
              @keydown.enter="pickFile('torrent')"
              @dragover.prevent="draggingTorrent = true"
              @dragleave.prevent="draggingTorrent = false"
              @drop.prevent="handleDrop('torrent', $event)"
            >
              <n-icon size="34"><CloudUploadOutline /></n-icon>
              <div class="drop-text">
                {{ torrentForm.torrentFile ? torrentForm.torrentFile.name : t('newTask.dropTorrentHint') }}
              </div>
            </div>
          </n-form-item>
          <div class="form-actions">
            <n-space>
              <n-button type="primary" :loading="submitting" @click="handleTorrentSubmit">
                {{ t('newTask.startDownload') }}
              </n-button>
              <n-button @click="handleTorrentReset">{{ t('newTask.reset') }}</n-button>
            </n-space>
          </div>
        </n-form>
      </n-tab-pane>

      <!-- Metalink 下载 -->
      <n-tab-pane name="metalink" :tab="t('newTask.metalinkTab')">
        <n-form ref="metalinkFormRef" :model="metalinkForm" :rules="metalinkRules">
          <n-form-item path="metalinkFile">
            <div
              class="file-drop-area"
              :class="{ 'drag-active': draggingMetalink }"
              role="button"
              tabindex="0"
              :aria-label="t('newTask.selectMetalinkFile')"
              @click="pickFile('metalink')"
              @keydown.enter="pickFile('metalink')"
              @dragover.prevent="draggingMetalink = true"
              @dragleave.prevent="draggingMetalink = false"
              @drop.prevent="handleDrop('metalink', $event)"
            >
              <n-icon size="34"><CloudUploadOutline /></n-icon>
              <div class="drop-text">
                {{ metalinkForm.metalinkFile ? metalinkForm.metalinkFile.name : t('newTask.dropMetalinkHint') }}
              </div>
            </div>
          </n-form-item>
          <div class="form-actions">
            <n-space>
              <n-button type="primary" :loading="submitting" @click="handleMetalinkSubmit">
                {{ t('newTask.startDownload') }}
              </n-button>
              <n-button @click="handleMetalinkReset">{{ t('newTask.reset') }}</n-button>
            </n-space>
          </div>
        </n-form>
      </n-tab-pane>
    </n-tabs>

    <input
      ref="fileInputRef"
      type="file"
      hidden
      @change="handleFileInputChange"
    />
  </n-modal>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { CloudUploadOutline, FolderOutline } from '@vicons/ionicons5'
import { message } from '@/utils/feedback'
import type { FormInst, FormRules } from 'naive-ui'
import { useUiStore } from '@/stores/uiStore'
import { useTaskStore } from '@/stores/taskStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { useSettingsStore } from '@/stores/settingsStore'
import AppSwitch from '@/components/AppSwitch.vue'
import type { Aria2Option } from '@/types/aria2'

const uiStore = useUiStore()
const { t } = useI18n()
const taskStore = useTaskStore()
const connectionStore = useConnectionStore()
const settingsStore = useSettingsStore()

const activeTab = ref('uri')
const submitting = ref(false)
const draggingTorrent = ref(false)
const draggingMetalink = ref(false)

const isElectron = computed(() => !!window.electronAPI)

/** aria2 支持的下载协议白名单 */
const SUPPORTED_URI_SCHEMES = ['http:', 'https:', 'ftp:', 'sftp:', 'magnet:']

/** 校验单个下载 URI：协议合法且（http/https/ftp/sftp）能被 URL 解析；magnet 为特殊格式 */
function isSupportedDownloadUri(uri: string): boolean {
  if (uri.startsWith('magnet:')) return true
  try {
    const { protocol } = new URL(uri)
    return SUPPORTED_URI_SCHEMES.includes(protocol)
  } catch {
    return false
  }
}

/** aria2 rpc-max-request-size 默认 1MiB，超出上限的种子/metalink 经 base64 上传必然失败 */
const MAX_UPLOAD_FILE_BYTES = 1 * 1024 * 1024

function checkFileSize(file: File): boolean {
  if (file.size > MAX_UPLOAD_FILE_BYTES) {
    message.error(t('newTask.fileTooLarge'))
    return false
  }
  return true
}

const minSplitSizeOptions = [
  { label: '1M', value: '1M' },
  { label: '5M', value: '5M' },
  { label: '10M', value: '10M' },
  { label: '20M', value: '20M' },
  { label: '50M', value: '50M' },
  { label: '100M', value: '100M' }
]

const visible = computed({
  get: () => uiStore.showNewTask,
  set: (value: boolean) => {
    if (!value) uiStore.closeNewTask()
  }
})

// 隐藏的文件输入框，用于点击选择文件
const fileInputRef = ref<HTMLInputElement>()
let pendingType: 'torrent' | 'metalink' | null = null

// 表单引用
const uriFormRef = ref<FormInst>()
const torrentFormRef = ref<FormInst>()
const metalinkFormRef = ref<FormInst>()

// URI 下载表单
const uriForm = reactive({
  uris: '',
  dir: '',
  fileName: '',
  maxConnectionPerServer: 5,
  minSplitSize: '20M',
  autoStart: true
})

// 种子下载表单
const torrentForm = reactive({
  torrentFile: null as File | null
})

// Metalink 下载表单
const metalinkForm = reactive({
  metalinkFile: null as File | null
})

// 验证规则
const uriRules: FormRules = {
  uris: [
    { required: true, message: () => t('newTask.requireUrl'), trigger: 'blur' }
  ]
}

const torrentRules: FormRules = {
  torrentFile: [
    { required: true, message: () => t('newTask.requireTorrent'), trigger: 'change' }
  ]
}

const metalinkRules: FormRules = {
  metalinkFile: [
    { required: true, message: () => t('newTask.requireMetalink'), trigger: 'change' }
  ]
}

// URI 下载处理
async function handleUriSubmit() {
  if (!uriFormRef.value) return

  try {
    await uriFormRef.value.validate()

    if (!connectionStore.isConnected) {
      message.error(t('newTask.connectFirst'))
      return
    }

    submitting.value = true

    const uris = uriForm.uris.split('\n')
      .map(uri => uri.trim())
      .filter(uri => uri.length > 0)

    if (uris.length === 0) {
      message.error(t('newTask.invalidUrl'))
      return
    }

    // 校验 URL 协议：仅允许 aria2 支持的下载协议，拦截 javascript:/file: 等非法输入
    const invalidUri = uris.find(uri => !isSupportedDownloadUri(uri))
    if (invalidUri) {
      console.warn('[NewTaskDialog] Blocked unsupported URI:', invalidUri)
      message.error(t('newTask.invalidUrl'))
      return
    }

    const options: Record<string, string> = {}
    if (uriForm.dir) options.dir = uriForm.dir
    if (uriForm.fileName) options.out = uriForm.fileName
    options['max-connection-per-server'] = uriForm.maxConnectionPerServer.toString()
    options['min-split-size'] = uriForm.minSplitSize
    if (!uriForm.autoStart) options.pause = 'true'

    await taskStore.addUri(uris, options)

    message.success(t('newTask.addedCount', { count: uris.length }))
    uiStore.closeNewTask()
  } catch (error) {
    console.error('Failed to add URI task:', error)
    const errorMessage = error instanceof Error ? error.message : t('newTask.addFailed')
    message.error(`${t('newTask.addFailed')}: ${errorMessage}`)
  } finally {
    submitting.value = false
  }
}

async function handleTorrentSubmit() {
  if (!torrentFormRef.value) return

  try {
    await torrentFormRef.value.validate()

    if (!connectionStore.isConnected) {
      message.error(t('newTask.connectFirst'))
      return
    }

    if (!torrentForm.torrentFile) {
      message.error(t('newTask.invalidTorrent'))
      return
    }

    // 超过 aria2 RPC 大小上限的文件直接拒绝，避免大文件上传失败
    if (!checkFileSize(torrentForm.torrentFile)) return

    submitting.value = true

    const torrentData = await readFileAsBase64(torrentForm.torrentFile)

    const options: Aria2Option = {}
    const downloadConfig = settingsStore.downloadConfig
    if (downloadConfig?.defaultDir) options.dir = downloadConfig.defaultDir
    if (downloadConfig && !downloadConfig.autoStart) options.pause = 'true'

    await taskStore.addTorrent(torrentData, [], options)

    message.success(t('newTask.torrentAdded'))
    uiStore.closeNewTask()
  } catch (error) {
    console.error('Failed to add torrent task:', error)
    const errorMessage = error instanceof Error ? error.message : t('newTask.addTorrentFailed')
    message.error(`${t('newTask.addTorrentFailed')}: ${errorMessage}`)
  } finally {
    submitting.value = false
  }
}

async function handleMetalinkSubmit() {
  if (!metalinkFormRef.value) return

  try {
    await metalinkFormRef.value.validate()

    if (!connectionStore.isConnected) {
      message.error(t('newTask.connectFirst'))
      return
    }

    if (!metalinkForm.metalinkFile) {
      message.error(t('newTask.invalidMetalink'))
      return
    }

    // 超过 aria2 RPC 大小上限的文件直接拒绝，避免大文件上传失败
    if (!checkFileSize(metalinkForm.metalinkFile)) return

    submitting.value = true

    const metalinkData = await readFileAsBase64(metalinkForm.metalinkFile)

    const options: Aria2Option = {}
    const downloadConfig = settingsStore.downloadConfig
    if (downloadConfig?.defaultDir) options.dir = downloadConfig.defaultDir
    if (downloadConfig && !downloadConfig.autoStart) options.pause = 'true'

    const gids = await taskStore.addMetalink(metalinkData, options)

    message.success(t('newTask.metalinkAdded', { count: gids.length }))
    uiStore.closeNewTask()
  } catch (error) {
    console.error('Failed to add metalink task:', error)
    const errorMessage = error instanceof Error ? error.message : t('newTask.addMetalinkFailed')
    message.error(`${t('newTask.addMetalinkFailed')}: ${errorMessage}`)
  } finally {
    submitting.value = false
  }
}

function handleUriReset() {
  uriFormRef.value?.restoreValidation()
  uriForm.uris = ''
  uriForm.dir = ''
  uriForm.fileName = ''
  uriForm.maxConnectionPerServer = 5
  uriForm.minSplitSize = '20M'
  uriForm.autoStart = true
}

// 选择保存目录
async function selectDir() {
  if (!window.electronAPI) return
  try {
    const result = await window.electronAPI.showOpenDialog({
      title: t('newTask.selectDirTitle'),
      properties: ['openDirectory'],
      defaultPath: uriForm.dir || undefined
    })
    if (!result.canceled && result.filePaths.length > 0) {
      uriForm.dir = result.filePaths[0]
    }
  } catch (_error) {
    message.error(t('newTask.selectDirFailed'))
  }
}

function handleTorrentReset() {
  torrentFormRef.value?.restoreValidation()
  torrentForm.torrentFile = null
}

function handleMetalinkReset() {
  metalinkFormRef.value?.restoreValidation()
  metalinkForm.metalinkFile = null
}

// 点击选择文件
function pickFile(type: 'torrent' | 'metalink') {
  pendingType = type
  fileInputRef.value?.click()
}

// 输入框选择文件
function handleFileInputChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file && pendingType) {
    if (pendingType === 'torrent') {
      torrentForm.torrentFile = file
    } else {
      metalinkForm.metalinkFile = file
    }
  }
  input.value = ''
  pendingType = null
}

// 拖拽文件
function handleDrop(type: 'torrent' | 'metalink', event: DragEvent) {
  if (type === 'torrent') draggingTorrent.value = false
  else draggingMetalink.value = false
  const file = event.dataTransfer?.files?.[0]
  if (!file) return
  if (type === 'torrent') {
    torrentForm.torrentFile = file
    message.success(t('newTask.torrentDropped', { name: file.name }))
  } else {
    metalinkForm.metalinkFile = file
    message.success(t('newTask.metalinkDropped', { name: file.name }))
  }
}

// 读取文件为 Base64
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.split(',')[1]
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

onMounted(async () => {
  await settingsStore.initialize()
})
</script>

<style scoped>
.form-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}

.option-label {
  font-weight: 500;
}

.option-row {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  width: 100%;
}

.option-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1 1 0;
  min-width: 160px;
}

.option-item--switch {
  justify-content: center;
}

.option-item-label {
  font-size: 13px;
  color: var(--text-secondary);
}

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
  transition: border-color 0.2s ease, background-color 0.2s ease, color 0.2s ease, transform 0.18s var(--ease-out);
}

.file-drop-area:hover,
.file-drop-area.drag-active {
  border-color: var(--color-primary);
  background-color: var(--bg-hover);
  color: var(--color-primary);
  transform: scale(1.012);
}

.drop-text {
  font-size: 13px;
  text-align: center;
  padding: 0 16px;
  word-break: break-all;
}
</style>
