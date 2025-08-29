<template>
  <div class="performance-settings">
    <div class="settings-header">
      <h2>性能与限制</h2>
      <p class="settings-description">配置速度限制、磁盘缓存和性能优化参数</p>
    </div>

    <el-alert
      v-if="!aria2Store.isConnected"
      title="未连接到 Aria2 服务器"
      description="请先连接到 Aria2 服务器才能修改设置"
      type="warning"
      :closable="false"
      style="margin-bottom: 20px"
    />

    <el-form
      ref="formRef"
      :model="settings"
      :rules="rules"
      label-width="200px"
      style="max-width: 800px"
      v-loading="loading"
      :disabled="!aria2Store.isConnected"
    >
      <el-card class="setting-group">
        <template #header>
          <span class="group-title">速度限制</span>
        </template>

        <el-form-item label="全局最大下载速度" prop="maxOverallDownloadLimit">
          <el-input
            v-model="settings.maxOverallDownloadLimit"
            placeholder="0 表示无限制"
            style="width: 200px"
          />
          <span style="margin-left: 8px">KB/s</span>
          <div class="form-tip">全局最大下载速度限制</div>
        </el-form-item>

        <el-form-item label="全局最大上传速度" prop="maxOverallUploadLimit">
          <el-input
            v-model="settings.maxOverallUploadLimit"
            placeholder="0 表示无限制"
            style="width: 200px"
          />
          <span style="margin-left: 8px">KB/s</span>
          <div class="form-tip">全局最大上传速度限制</div>
        </el-form-item>

        <el-form-item label="单任务最大上传速度" prop="maxUploadLimit">
          <el-input
            v-model="settings.maxUploadLimit"
            placeholder="0 表示无限制"
            style="width: 200px"
          />
          <span style="margin-left: 8px">KB/s</span>
          <div class="form-tip">单个任务的最大上传速度限制</div>
        </el-form-item>
      </el-card>

      <el-card class="setting-group">
        <template #header>
          <span class="group-title">磁盘和内存</span>
        </template>

        <el-form-item label="磁盘缓存" prop="diskCache">
          <el-input-number
            v-model="settings.diskCache"
            :min="0"
            :max="1024"
            style="width: 200px"
          />
          <span style="margin-left: 8px">MB</span>
          <div class="form-tip">磁盘缓存大小，0 表示禁用缓存</div>
        </el-form-item>

        <el-form-item label="文件预分配" prop="fileAllocation">
          <el-select v-model="settings.fileAllocation" style="width: 200px">
            <el-option label="无预分配" value="none" />
            <el-option label="预分配" value="prealloc" />
            <el-option label="快速预分配" value="falloc" />
          </el-select>
          <div class="form-tip">文件预分配方法，可提高磁盘性能</div>
        </el-form-item>

        <el-form-item label="最大下载结果" prop="maxDownloadResult">
          <el-input-number
            v-model="settings.maxDownloadResult"
            :min="0"
            :max="10000"
            style="width: 200px"
          />
          <div class="form-tip">保存的最大下载结果数量</div>
        </el-form-item>
      </el-card>

      <el-card class="setting-group">
        <template #header>
          <span class="group-title">性能优化</span>
        </template>

        <el-form-item label="实时检查数据块" prop="realtimeChunkChecksum">
          <el-switch v-model="settings.realtimeChunkChecksum" />
          <div class="form-tip">实时检查下载数据块的校验和</div>
        </el-form-item>

        <el-form-item label="URI 选择策略" prop="uriSelector">
          <el-select v-model="settings.uriSelector" style="width: 200px">
            <el-option label="反馈选择" value="feedback" />
            <el-option label="顺序选择" value="inorder" />
            <el-option label="自适应选择" value="adaptive" />
          </el-select>
          <div class="form-tip">URI 选择策略，影响下载源的选择</div>
        </el-form-item>

        <el-form-item label="事件轮询方法" prop="eventPoll">
          <el-select v-model="settings.eventPoll" style="width: 200px">
            <el-option label="epoll (Linux)" value="epoll" />
            <el-option label="kqueue (BSD)" value="kqueue" />
            <el-option label="port (Solaris)" value="port" />
            <el-option label="poll" value="poll" />
            <el-option label="select" value="select" />
          </el-select>
          <div class="form-tip">系统事件轮询方法，影响网络性能</div>
        </el-form-item>

        <el-form-item label="启用 mmap" prop="enableMmap">
          <el-switch v-model="settings.enableMmap" />
          <div class="form-tip">启用内存映射文件，可能提高性能</div>
        </el-form-item>
      </el-card>

      <el-form-item style="margin-top: 24px">
        <el-space>
          <el-button
            type="primary"
            @click="saveSettings"
            :loading="saving"
            :disabled="!aria2Store.isConnected"
          >
            保存设置
          </el-button>
          <el-button
            @click="loadSettings"
            :disabled="!aria2Store.isConnected"
          >
            重新加载
          </el-button>
          <el-button
            @click="resetToDefaults"
            :disabled="!aria2Store.isConnected"
          >
            恢复默认
          </el-button>
        </el-space>
      </el-form-item>
    </el-form>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { useAria2Store } from '@/stores/aria2Store'

const aria2Store = useAria2Store()
const formRef = ref<FormInstance>()
const loading = ref(false)
const saving = ref(false)

// 表单数据
const settings = reactive({
  maxOverallDownloadLimit: '0',
  maxOverallUploadLimit: '0',
  maxUploadLimit: '0',
  diskCache: 16,
  fileAllocation: 'prealloc',
  maxDownloadResult: 1000,
  realtimeChunkChecksum: true,
  uriSelector: 'feedback',
  eventPoll: 'epoll',
  enableMmap: false
})

// 表单验证规则
const rules: FormRules = {
  diskCache: [
    { type: 'number', min: 0, max: 1024, message: '值必须在0-1024之间', trigger: 'blur' }
  ],
  maxDownloadResult: [
    { type: 'number', min: 0, max: 10000, message: '值必须在0-10000之间', trigger: 'blur' }
  ]
}

onMounted(() => {
  if (aria2Store.isConnected) {
    loadSettings()
  }
})

async function loadSettings() {
  if (!aria2Store.isConnected) {
    ElMessage.warning('请先连接到 Aria2 服务器')
    return
  }

  loading.value = true
  try {
    const options = await aria2Store.getGlobalOptions()
    
    if (options && typeof options === 'object') {
      settings.maxOverallDownloadLimit = options['max-overall-download-limit'] || '0'
      settings.maxOverallUploadLimit = options['max-overall-upload-limit'] || '0'
      settings.maxUploadLimit = options['max-upload-limit'] || '0'
      
      // 磁盘缓存值需要去掉单位
      const diskCacheValue = options['disk-cache'] || '16M'
      settings.diskCache = parseInt(diskCacheValue.replace(/[^0-9]/g, '')) || 16
      
      settings.fileAllocation = options['file-allocation'] || 'prealloc'
      settings.maxDownloadResult = parseInt(options['max-download-result'] || '1000')
      settings.realtimeChunkChecksum = options['realtime-chunk-checksum'] !== 'false'
      settings.uriSelector = options['uri-selector'] || 'feedback'
      settings.eventPoll = options['event-poll'] || 'epoll'
      settings.enableMmap = options['enable-mmap'] === 'true'

      ElMessage.success('性能设置加载成功')
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '未知错误'
    ElMessage.error(`加载性能设置失败: ${errorMessage}`)
    console.error('Failed to load performance settings:', error)
  } finally {
    loading.value = false
  }
}

async function saveSettings() {
  if (!formRef.value) return

  try {
    await formRef.value.validate()
  } catch {
    return
  }

  if (!aria2Store.isConnected) {
    ElMessage.warning('请先连接到 Aria2 服务器')
    return
  }

  saving.value = true
  try {
    const options = {
      'max-overall-download-limit': settings.maxOverallDownloadLimit,
      'max-overall-upload-limit': settings.maxOverallUploadLimit,
      'max-upload-limit': settings.maxUploadLimit,
      'disk-cache': settings.diskCache.toString() + 'M',
      'file-allocation': settings.fileAllocation,
      'max-download-result': settings.maxDownloadResult.toString(),
      'realtime-chunk-checksum': settings.realtimeChunkChecksum ? 'true' : 'false',
      'uri-selector': settings.uriSelector,
      'event-poll': settings.eventPoll,
      'enable-mmap': settings.enableMmap ? 'true' : 'false'
    }

    await aria2Store.changeGlobalOptions(options)
    ElMessage.success('性能设置已保存')
  } catch (error) {
    ElMessage.error('保存性能设置失败')
    console.error('Failed to save performance settings:', error)
  } finally {
    saving.value = false
  }
}

async function resetToDefaults() {
  try {
    await ElMessageBox.confirm(
      '确定要恢复为默认性能设置吗？',
      '确认恢复',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )

    // 恢复默认值
    Object.assign(settings, {
      maxOverallDownloadLimit: '0',
      maxOverallUploadLimit: '0',
      maxUploadLimit: '0',
      diskCache: 16,
      fileAllocation: 'prealloc',
      maxDownloadResult: 1000,
      realtimeChunkChecksum: true,
      uriSelector: 'feedback',
      eventPoll: 'epoll',
      enableMmap: false
    })

    ElMessage.success('已恢复为默认性能设置')
  } catch (error) {
    // 用户取消
  }
}
</script>

<style scoped>
.performance-settings {
  padding: 20px;
}

.settings-header {
  margin-bottom: 24px;
}

.settings-header h2 {
  margin: 0 0 8px 0;
  font-size: 20px;
  font-weight: 600;
}

.settings-description {
  margin: 0;
  color: var(--text-secondary);
  font-size: 14px;
}

.setting-group {
  margin-bottom: 20px;
}

.group-title {
  font-weight: 600;
  color: var(--text-primary);
}

.form-tip {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 4px;
  line-height: 1.4;
}

:deep(.el-card__header) {
  padding: 12px 20px;
  background-color: var(--bg-tertiary);
  border-bottom: 1px solid var(--border-light);
}

:deep(.el-card__body) {
  padding: 20px;
  background-color: var(--bg-secondary);
}
</style>
