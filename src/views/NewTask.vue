<template>
  <div class="new-task" :class="{ 'drag-active': isDragging }" @dragover.prevent="handleDragOver" @drop.prevent="handleDrop" @dragleave.prevent="handleDragLeave">
    <div class="new-task-header">
      <h2>{{ t('newTask.title') }}</h2>
      <p class="header-description">{{ t('newTask.description') }}</p>
      <p v-if="isDragging" class="drag-hint">{{ t('newTask.dropReleaseHint') }}</p>
    </div>

    <el-tabs v-model="activeTab" class="task-tabs">
      <!-- URI 下载 -->
      <el-tab-pane :label="t('newTask.uriTab')" name="uri">
        <el-form
          ref="uriFormRef"
          :model="uriForm"
          :rules="uriRules"
          label-width="120px"
          style="max-width: 800px"
        >
          <el-form-item :label="t('newTask.urls')" prop="uris">
            <el-input
              v-model="uriForm.uris"
              type="textarea"
              :rows="6"
              :placeholder="t('newTask.urlsPlaceholder')"
            />
          </el-form-item>

          <el-row :gutter="20">
            <el-col :span="12">
              <el-form-item :label="t('newTask.downloadDir')" prop="dir">
                <el-input v-model="uriForm.dir" :placeholder="t('newTask.dirPlaceholder')">
                  <template #append>
                    <el-button :disabled="!isElectron" @click="selectDirectory('uri')">
                      <el-icon><Folder /></el-icon>
                    </el-button>
                  </template>
                </el-input>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item :label="t('newTask.fileName')" prop="out">
                <el-input v-model="uriForm.out" :placeholder="t('newTask.fileNamePlaceholder')" />
              </el-form-item>
            </el-col>
          </el-row>

          <el-row :gutter="20">
            <el-col :span="8">
              <el-form-item :label="t('newTask.maxConnectionPerServer')">
                <el-input-number
                  v-model="uriForm.maxConnectionPerServer"
                  :min="1"
                  :max="16"
                  style="width: 100%"
                />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item :label="t('newTask.minSplitSize')">
                <el-select v-model="uriForm.minSplitSize" style="width: 100%">
                  <el-option label="1M" value="1M" />
                  <el-option label="5M" value="5M" />
                  <el-option label="10M" value="10M" />
                  <el-option label="20M" value="20M" />
                  <el-option label="50M" value="50M" />
                  <el-option label="100M" value="100M" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item :label="t('newTask.autoStart')">
                <el-switch v-model="uriForm.autoStart" />
              </el-form-item>
            </el-col>
          </el-row>

          <el-form-item>
            <el-space>
              <el-button type="primary" :loading="submitting" @click="handleUriSubmit">
                {{ t('newTask.startDownload') }}
              </el-button>
              <el-button @click="handleUriReset">{{ t('newTask.reset') }}</el-button>
            </el-space>
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <!-- 种子文件下载 -->
      <el-tab-pane :label="t('newTask.torrentTab')" name="torrent">
        <el-form
          ref="torrentFormRef"
          :model="torrentForm"
          :rules="torrentRules"
          label-width="120px"
          style="max-width: 800px"
        >
          <el-form-item :label="t('newTask.torrentFile')" prop="torrentFile">
            <el-upload
              ref="uploadRef"
              :auto-upload="false"
              :show-file-list="true"
              :limit="1"
              accept=".torrent"
              @change="handleTorrentFileChange"
            >
              <el-button type="primary">
                <el-icon><Upload /></el-icon>
                {{ t('newTask.selectTorrentFile') }}
              </el-button>
              <template #tip>
                <div class="el-upload__tip">
                  {{ t('newTask.torrentTip') }}
                </div>
              </template>
            </el-upload>
          </el-form-item>

          <el-row :gutter="20">
            <el-col :span="12">
              <el-form-item :label="t('newTask.downloadDir')" prop="dir">
                <el-input v-model="torrentForm.dir" :placeholder="t('newTask.dirPlaceholder')">
                  <template #append>
                    <el-button :disabled="!isElectron" @click="selectDirectory('torrent')">
                      <el-icon><Folder /></el-icon>
                    </el-button>
                  </template>
                </el-input>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item :label="t('newTask.autoStart')">
                <el-switch v-model="torrentForm.autoStart" />
              </el-form-item>
            </el-col>
          </el-row>

          <el-form-item>
            <el-space>
              <el-button type="primary" :loading="submitting" @click="handleTorrentSubmit">
                {{ t('newTask.startDownload') }}
              </el-button>
              <el-button @click="handleTorrentReset">{{ t('newTask.reset') }}</el-button>
            </el-space>
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <!-- Metalink 下载 -->
      <el-tab-pane :label="t('newTask.metalinkTab')" name="metalink">
        <el-form
          ref="metalinkFormRef"
          :model="metalinkForm"
          :rules="metalinkRules"
          label-width="120px"
          style="max-width: 800px"
        >
          <el-form-item :label="t('newTask.metalinkFile')" prop="metalinkFile">
            <el-upload
              ref="metalinkUploadRef"
              :auto-upload="false"
              :show-file-list="true"
              :limit="1"
              accept=".metalink,.meta4"
              @change="handleMetalinkFileChange"
            >
              <el-button type="primary">
                <el-icon><Upload /></el-icon>
                {{ t('newTask.selectMetalinkFile') }}
              </el-button>
              <template #tip>
                <div class="el-upload__tip">
                  {{ t('newTask.metalinkTip') }}
                </div>
              </template>
            </el-upload>
          </el-form-item>

          <el-row :gutter="20">
            <el-col :span="12">
              <el-form-item :label="t('newTask.downloadDir')" prop="dir">
                <el-input v-model="metalinkForm.dir" :placeholder="t('newTask.dirPlaceholder')">
                  <template #append>
                    <el-button :disabled="!isElectron" @click="selectDirectory('metalink')">
                      <el-icon><Folder /></el-icon>
                    </el-button>
                  </template>
                </el-input>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item :label="t('newTask.autoStart')">
                <el-switch v-model="metalinkForm.autoStart" />
              </el-form-item>
            </el-col>
          </el-row>

          <el-form-item>
            <el-space>
              <el-button type="primary" :loading="submitting" @click="handleMetalinkSubmit">
                {{ t('newTask.startDownload') }}
              </el-button>
              <el-button @click="handleMetalinkReset">{{ t('newTask.reset') }}</el-button>
            </el-space>
          </el-form-item>
        </el-form>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ElMessage, type FormInstance, type FormRules, type UploadFile } from 'element-plus'
import { Upload, Folder } from '@element-plus/icons-vue'
import { useTaskStore } from '@/stores/taskStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { useSettingsStore } from '@/stores/settingsStore'

const router = useRouter()
const { t } = useI18n()
const taskStore = useTaskStore()
const connectionStore = useConnectionStore()
const settingsStore = useSettingsStore()

const activeTab = ref('uri')
const submitting = ref(false)
const isDragging = ref(false)

const isElectron = computed(() => !!window.electronAPI)

// 表单引用
const uriFormRef = ref<FormInstance>()
const torrentFormRef = ref<FormInstance>()
const metalinkFormRef = ref<FormInstance>()

// URI 下载表单
const uriForm = reactive({
  uris: '',
  dir: '',
  out: '',
  maxConnectionPerServer: 5,
  minSplitSize: '10M',
  autoStart: true
})

// 种子下载表单
const torrentForm = reactive({
  torrentFile: null as File | null,
  dir: '',
  autoStart: true
})

// Metalink 下载表单
const metalinkForm = reactive({
  metalinkFile: null as File | null,
  dir: '',
  autoStart: true
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
      ElMessage.error(t('newTask.connectFirst'))
      return
    }

    console.warn('Aria2 connection status:', {
      isConnected: connectionStore.isConnected,
      service: !!connectionStore.service
    })

    submitting.value = true

    const uris = uriForm.uris.split('\n')
      .map(uri => uri.trim())
      .filter(uri => uri.length > 0)

    if (uris.length === 0) {
      ElMessage.error(t('newTask.invalidUrl'))
      return
    }

    const options: Record<string, string> = {}
    if (uriForm.dir && uriForm.dir.trim()) {
      options.dir = uriForm.dir.trim()
    }
    if (uriForm.out && uriForm.out.trim()) {
      options.out = uriForm.out.trim()
    }
    options['max-connection-per-server'] = uriForm.maxConnectionPerServer.toString()
    options['min-split-size'] = uriForm.minSplitSize
    if (!uriForm.autoStart) {
      options.pause = 'true'
    }

    console.warn('URI download options:', options)

    const gid = await taskStore.addUri(uris, options)
    console.warn('Task added with GID:', gid)

    ElMessage.success(t('newTask.addedCount', { count: uris.length }))
    router.push('/downloading')

  } catch (error) {
    console.error('Failed to add URI task:', error)
    const errorMessage = error instanceof Error ? error.message : t('newTask.addFailed')
    ElMessage.error(`${t('newTask.addFailed')}: ${errorMessage}`)
  } finally {
    submitting.value = false
  }
}

// 种子文件处理
function handleTorrentFileChange(file: UploadFile) {
  if (file.raw) {
    torrentForm.torrentFile = file.raw
  }
}

async function handleTorrentSubmit() {
  if (!torrentFormRef.value) return

  try {
    await torrentFormRef.value.validate()

    if (!connectionStore.isConnected) {
      ElMessage.error(t('newTask.connectFirst'))
      return
    }

    if (!torrentForm.torrentFile) {
      ElMessage.error(t('newTask.invalidTorrent'))
      return
    }

    submitting.value = true

    // 读取种子文件内容
    const torrentData = await readFileAsBase64(torrentForm.torrentFile)

    const options: unknown = {}
    if (torrentForm.dir) options.dir = torrentForm.dir
    if (!torrentForm.autoStart) options.pause = 'true'

    const gid = await taskStore.addTorrent(torrentData, [], options)
    console.warn('Torrent task added with GID:', gid)

    ElMessage.success(t('newTask.torrentAdded'))
    router.push('/downloading')

  } catch (error) {
    console.error('Failed to add torrent task:', error)
    const errorMessage = error instanceof Error ? error.message : t('newTask.addTorrentFailed')
    ElMessage.error(`${t('newTask.addTorrentFailed')}: ${errorMessage}`)
  } finally {
    submitting.value = false
  }
}

// 重置表单
function handleUriReset() {
  uriFormRef.value?.resetFields()
}

function handleTorrentReset() {
  torrentFormRef.value?.resetFields()
  torrentForm.torrentFile = null
}

// Metalink 文件处理
function handleMetalinkFileChange(file: UploadFile) {
  if (file.raw) {
    metalinkForm.metalinkFile = file.raw
  }
}

async function handleMetalinkSubmit() {
  if (!metalinkFormRef.value) return

  try {
    await metalinkFormRef.value.validate()

    if (!connectionStore.isConnected) {
      ElMessage.error(t('newTask.connectFirst'))
      return
    }

    if (!metalinkForm.metalinkFile) {
      ElMessage.error(t('newTask.invalidMetalink'))
      return
    }

    submitting.value = true

    const metalinkData = await readFileAsBase64(metalinkForm.metalinkFile)

    const options: unknown = {}
    if (metalinkForm.dir) options.dir = metalinkForm.dir
    if (!metalinkForm.autoStart) options.pause = 'true'

    const gids = await taskStore.addMetalink(metalinkData, options)
    console.warn('Metalink tasks added with GIDs:', gids)

    ElMessage.success(t('newTask.metalinkAdded', { count: gids.length }))
    router.push('/downloading')

  } catch (error) {
    console.error('Failed to add metalink task:', error)
    const errorMessage = error instanceof Error ? error.message : t('newTask.addMetalinkFailed')
    ElMessage.error(`${t('newTask.addMetalinkFailed')}: ${errorMessage}`)
  } finally {
    submitting.value = false
  }
}

function handleMetalinkReset() {
  metalinkFormRef.value?.resetFields()
  metalinkForm.metalinkFile = null
}

// 目录选择
async function selectDirectory(formType: 'uri' | 'torrent' | 'metalink') {
  if (!window.electronAPI) {
    ElMessage.warning(t('newTask.desktopOnly'))
    return
  }

  try {
    const result = await window.electronAPI.showOpenDialog({
      properties: ['openDirectory'],
      title: t('newTask.selectDirTitle')
    })

    if (!result.canceled && result.filePaths.length > 0) {
      if (formType === 'uri') {
        uriForm.dir = result.filePaths[0]
      } else if (formType === 'torrent') {
        torrentForm.dir = result.filePaths[0]
      } else if (formType === 'metalink') {
        metalinkForm.dir = result.filePaths[0]
      }
    }
  } catch (error) {
    ElMessage.error(t('newTask.selectDirFailed'))
  }
}

// 拖拽处理
function handleDragOver() {
  isDragging.value = true
}

function handleDragLeave() {
  isDragging.value = false
}

function handleDrop(event: DragEvent) {
  isDragging.value = false
  if (!event.dataTransfer) return

  // 处理拖入的文本（链接）
  const text = event.dataTransfer.getData('text/plain')
  if (text) {
    // 自动切换到 URI 标签页并填充链接
    activeTab.value = 'uri'
    const existingUris = uriForm.uris.trim()
    uriForm.uris = existingUris ? `${existingUris}\n${text}` : text
    ElMessage.success(t('newTask.linkDropped'))
    return
  }

  // 处理拖入的文件
  const files = event.dataTransfer.files
  if (files && files.length > 0) {
    const file = files[0]
    const fileName = file.name.toLowerCase()

    if (fileName.endsWith('.torrent')) {
      activeTab.value = 'torrent'
      torrentForm.torrentFile = file
      ElMessage.success(t('newTask.torrentDropped', { name: file.name }))
    } else if (fileName.endsWith('.metalink') || fileName.endsWith('.meta4')) {
      activeTab.value = 'metalink'
      metalinkForm.metalinkFile = file
      ElMessage.success(t('newTask.metalinkDropped', { name: file.name }))
    } else {
      ElMessage.warning(t('newTask.unsupportedFileType'))
    }
  }
}

// 读取文件为 Base64
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // 移除 data:xxx;base64, 前缀
      const base64 = result.split(',')[1]
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

onMounted(async () => {
  await settingsStore.initialize()
  const downloadConfig = settingsStore.downloadConfig

  // 设置默认值
  uriForm.dir = downloadConfig.defaultDir
  uriForm.maxConnectionPerServer = downloadConfig.maxConnectionPerServer
  uriForm.minSplitSize = downloadConfig.minSplitSize
  uriForm.autoStart = downloadConfig.autoStart

  torrentForm.dir = downloadConfig.defaultDir
  torrentForm.autoStart = downloadConfig.autoStart
})
</script>

<style scoped>
.new-task {
  padding: 20px;
}

.new-task-header {
  margin-bottom: 24px;
}

.new-task-header h2 {
  margin: 0 0 8px 0;
  font-size: 20px;
  font-weight: 600;
}

.header-description {
  margin: 0;
  color: var(--text-secondary);
  font-size: 14px;
}

.task-tabs {
  margin-top: 20px;
}

:deep(.el-tabs__content) {
  padding-top: 20px;
}

:deep(.el-upload__tip) {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
