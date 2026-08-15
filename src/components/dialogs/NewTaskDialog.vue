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
          <n-form-item path="uris">
            <n-input
              v-model:value="uriForm.uris"
              type="textarea"
              :rows="6"
              :placeholder="t('newTask.urlsPlaceholder')"
            />
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
              @click="pickFile('torrent')"
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
              @click="pickFile('metalink')"
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
import { CloudUploadOutline } from '@vicons/ionicons5'
import { message } from '@/utils/feedback'
import type { FormInst, FormRules } from 'naive-ui'
import { useUiStore } from '@/stores/uiStore'
import { useTaskStore } from '@/stores/taskStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { useSettingsStore } from '@/stores/settingsStore'
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

// URI 下载表单（仅保留链接输入框）
const uriForm = reactive({
  uris: ''
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

    const options: Record<string, string> = {}
    const downloadConfig = settingsStore.downloadConfig
    if (downloadConfig.defaultDir) options.dir = downloadConfig.defaultDir
    options['max-connection-per-server'] = downloadConfig.maxConnectionPerServer.toString()
    options['min-split-size'] = downloadConfig.minSplitSize
    if (!downloadConfig.autoStart) options.pause = 'true'

    const gid = await taskStore.addUri(uris, options)
    console.warn('Task added with GID:', gid)

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

    submitting.value = true

    const torrentData = await readFileAsBase64(torrentForm.torrentFile)

    const options: Aria2Option = {}
    const downloadConfig = settingsStore.downloadConfig
    if (downloadConfig.defaultDir) options.dir = downloadConfig.defaultDir
    if (!downloadConfig.autoStart) options.pause = 'true'

    const gid = await taskStore.addTorrent(torrentData, [], options)
    console.warn('Torrent task added with GID:', gid)

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

    submitting.value = true

    const metalinkData = await readFileAsBase64(metalinkForm.metalinkFile)

    const options: Aria2Option = {}
    const downloadConfig = settingsStore.downloadConfig
    if (downloadConfig.defaultDir) options.dir = downloadConfig.defaultDir
    if (!downloadConfig.autoStart) options.pause = 'true'

    const gids = await taskStore.addMetalink(metalinkData, options)
    console.warn('Metalink tasks added with GIDs:', gids)

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
  transition: border-color 0.2s ease, background-color 0.2s ease;
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
</style>
