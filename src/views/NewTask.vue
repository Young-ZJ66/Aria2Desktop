<template>
  <div class="new-task">
    <div class="new-task-header">
      <h2>新建下载任务</h2>
      <p class="header-description">支持 HTTP/HTTPS、FTP/SFTP、BitTorrent、Metalink 等多种协议</p>
    </div>

    <el-tabs v-model="activeTab" class="task-tabs">
      <!-- URI 下载 -->
      <el-tab-pane label="链接下载" name="uri">
        <el-form
          ref="uriFormRef"
          :model="uriForm"
          :rules="uriRules"
          label-width="120px"
          style="max-width: 800px"
        >
          <el-form-item label="下载链接" prop="uris">
            <el-input
              v-model="uriForm.uris"
              type="textarea"
              :rows="6"
              placeholder="请输入下载链接，每行一个&#10;支持协议：HTTP/HTTPS、FTP/SFTP、磁力链接等&#10;&#10;示例：&#10;https://example.com/file.zip&#10;magnet:?xt=urn:btih:..."
            />
          </el-form-item>

          <el-row :gutter="20">
            <el-col :span="12">
              <el-form-item label="保存目录" prop="dir">
                <el-input v-model="uriForm.dir" placeholder="留空使用默认目录" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="文件名" prop="out">
                <el-input v-model="uriForm.out" placeholder="可选，指定文件名" />
              </el-form-item>
            </el-col>
          </el-row>

          <el-row :gutter="20">
            <el-col :span="8">
              <el-form-item label="最大连接数">
                <el-input-number
                  v-model="uriForm.maxConnectionPerServer"
                  :min="1"
                  :max="16"
                  style="width: 100%"
                />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="分片大小">
                <el-select v-model="uriForm.minSplitSize" style="width: 100%">
                  <el-option label="1M" value="1M" />
                  <el-option label="5M" value="5M" />
                  <el-option label="10M" value="10M" />
                  <el-option label="20M" value="20M" />
                  <el-option label="50M" value="50M" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="自动开始">
                <el-switch v-model="uriForm.autoStart" />
              </el-form-item>
            </el-col>
          </el-row>

          <el-form-item>
            <el-space>
              <el-button type="primary" @click="handleUriSubmit" :loading="submitting">
                开始下载
              </el-button>
              <el-button @click="handleUriReset">重置</el-button>
            </el-space>
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <!-- 种子文件下载 -->
      <el-tab-pane label="种子文件" name="torrent">
        <el-form
          ref="torrentFormRef"
          :model="torrentForm"
          :rules="torrentRules"
          label-width="120px"
          style="max-width: 800px"
        >
          <el-form-item label="种子文件" prop="torrentFile">
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
                选择种子文件
              </el-button>
              <template #tip>
                <div class="el-upload__tip">
                  只能上传 .torrent 文件
                </div>
              </template>
            </el-upload>
          </el-form-item>

          <el-form-item>
            <el-space>
              <el-button type="primary" @click="handleTorrentSubmit" :loading="submitting">
                开始下载
              </el-button>
              <el-button @click="handleTorrentReset">重置</el-button>
            </el-space>
          </el-form-item>
        </el-form>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, type FormInstance, type FormRules, type UploadFile } from 'element-plus'
import { Upload } from '@element-plus/icons-vue'
import { useAria2Store } from '@/stores/aria2Store'
import { useSettingsStore } from '@/stores/settingsStore'

const router = useRouter()
const aria2Store = useAria2Store()
const settingsStore = useSettingsStore()

const activeTab = ref('uri')
const submitting = ref(false)

// 表单引用
const uriFormRef = ref<FormInstance>()
const torrentFormRef = ref<FormInstance>()

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

// 验证规则
const uriRules: FormRules = {
  uris: [
    { required: true, message: '请输入下载链接', trigger: 'blur' }
  ]
}

const torrentRules: FormRules = {
  torrentFile: [
    { required: true, message: '请选择种子文件', trigger: 'change' }
  ]
}

// URI 下载处理
async function handleUriSubmit() {
  if (!uriFormRef.value) return

  try {
    await uriFormRef.value.validate()

    if (!aria2Store.isConnected) {
      ElMessage.error('请先连接到 Aria2 服务器')
      return
    }

    console.log('Aria2 connection status:', {
      isConnected: aria2Store.isConnected,
      service: !!aria2Store.service
    })

    submitting.value = true

    const uris = uriForm.uris.split('\n')
      .map(uri => uri.trim())
      .filter(uri => uri.length > 0)

    if (uris.length === 0) {
      ElMessage.error('请输入有效的下载链接')
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

    console.log('URI download options:', options)

    const gid = await aria2Store.addUri(uris, options)
    console.log('Task added with GID:', gid)

    ElMessage.success(`已添加 ${uris.length} 个下载任务`)
    router.push('/downloading')

  } catch (error) {
    console.error('Failed to add URI task:', error)
    const errorMessage = error instanceof Error ? error.message : '添加任务失败'
    ElMessage.error(`添加任务失败: ${errorMessage}`)
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

    if (!aria2Store.isConnected) {
      ElMessage.error('请先连接到 Aria2 服务器')
      return
    }

    if (!torrentForm.torrentFile) {
      ElMessage.error('请选择种子文件')
      return
    }

    submitting.value = true

    // 读取种子文件内容
    const torrentData = await readFileAsBase64(torrentForm.torrentFile)

    const options: any = {}
    if (torrentForm.dir) options.dir = torrentForm.dir
    if (!torrentForm.autoStart) options.pause = 'true'

    const gid = await aria2Store.addTorrent(torrentData, [], options)
    console.log('Torrent task added with GID:', gid)

    ElMessage.success('种子任务已添加')
    router.push('/downloading')

  } catch (error) {
    console.error('Failed to add torrent task:', error)
    const errorMessage = error instanceof Error ? error.message : '添加种子任务失败'
    ElMessage.error(`添加种子任务失败: ${errorMessage}`)
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
  color: #909399;
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
  color: #909399;
}
</style>
