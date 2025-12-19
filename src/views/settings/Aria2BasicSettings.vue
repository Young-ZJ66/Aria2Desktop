<template>
  <div class="aria2-basic-settings">
    <div class="settings-header">
      <h2>Aria2 基本设置</h2>
      <p class="settings-description">配置 Aria2 的基本下载参数</p>

    </div>

    <el-alert
      v-if="!connectionStore.isConnected"
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
      :disabled="!connectionStore.isConnected"
    >
      <el-card class="setting-group">
        <template #header>
          <span class="group-title">下载设置</span>
        </template>

        <el-form-item label="下载目录" prop="dir">
          <el-input
            v-model="settings.dir"
            placeholder="默认下载目录，如：D:\Downloads"
          >
            <template #append>
              <el-button @click="selectDirectory" :disabled="!isElectron">
                <el-icon><Folder /></el-icon>
              </el-button>
            </template>
          </el-input>
          <div class="form-tip">设置新任务的默认保存目录</div>
        </el-form-item>

        <el-form-item label="最大同时下载数" prop="maxConcurrentDownloads">
          <el-input-number
            v-model="settings.maxConcurrentDownloads"
            :min="1"
            :max="16"
            style="width: 200px"
          />
          <div class="form-tip">同时进行的下载任务数量限制（1-16）</div>
        </el-form-item>

        <el-form-item label="每服务器最大连接数" prop="maxConnectionPerServer">
          <el-input-number
            v-model="settings.maxConnectionPerServer"
            :min="1"
            :max="16"
            style="width: 200px"
          />
          <div class="form-tip">对单个服务器的最大连接数（1-16）</div>
        </el-form-item>

        <el-form-item label="最小分片大小" prop="minSplitSize">
          <el-select v-model="settings.minSplitSize" style="width: 200px">
            <el-option label="1M" value="1M" />
            <el-option label="5M" value="5M" />
            <el-option label="10M" value="10M" />
            <el-option label="20M" value="20M" />
            <el-option label="50M" value="50M" />
            <el-option label="100M" value="100M" />
          </el-select>
          <div class="form-tip">文件分片下载的最小大小</div>
        </el-form-item>
      </el-card>

      <el-card class="setting-group">
        <template #header>
          <span class="group-title">下载选项</span>
        </template>

        <el-form-item label="断点续传" prop="continue">
          <el-switch v-model="settings.continue" />
          <div class="form-tip">支持断点续传的下载任务</div>
        </el-form-item>
      </el-card>

      <el-card class="setting-group">
        <template #header>
          <span class="group-title">其他设置</span>
        </template>

        <el-form-item label="自动保存会话" prop="saveSession">
          <el-switch v-model="settings.saveSession" />
          <div class="form-tip">定期保存下载会话，重启后可恢复未完成的任务</div>
        </el-form-item>

        <el-form-item label="会话保存间隔" prop="saveSessionInterval">
          <el-input-number
            v-model="settings.saveSessionInterval"
            :min="60"
            :max="3600"
            :disabled="!settings.saveSession"
            style="width: 200px"
          />
          <span style="margin-left: 8px">秒</span>
          <div class="form-tip">自动保存会话的时间间隔（60-3600秒）</div>
        </el-form-item>
      </el-card>

      <el-form-item style="margin-top: 24px">
        <el-space>
          <el-button
            type="primary"
            @click="saveSettings"
            :loading="saving"
            :disabled="!connectionStore.isConnected"
          >
            保存设置
          </el-button>
          <el-button
            @click="loadSettings"
            :disabled="!connectionStore.isConnected"
          >
            重新加载
          </el-button>
          <el-button
            @click="resetToDefaults"
            :disabled="!connectionStore.isConnected"
          >
            恢复默认
          </el-button>
        </el-space>
      </el-form-item>
    </el-form>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { Folder } from '@element-plus/icons-vue'
import { useConnectionStore } from '@/stores/connectionStore'
import { useStatsStore } from '@/stores/statsStore'

const connectionStore = useConnectionStore()
const statsStore = useStatsStore()
const formRef = ref<FormInstance>()
const loading = ref(false)
const saving = ref(false)

const isElectron = computed(() => !!window.electronAPI)

// 表单数据
const settings = reactive({
  dir: '',
  maxConcurrentDownloads: 5,
  maxConnectionPerServer: 5,
  minSplitSize: '10M',
  continue: true,
  saveSession: true,
  saveSessionInterval: 60
})

// 表单验证规则
const rules: FormRules = {
  maxConcurrentDownloads: [
    { required: true, message: '请输入最大同时下载数', trigger: 'blur' },
    { type: 'number', min: 1, max: 16, message: '值必须在1-16之间', trigger: 'blur' }
  ],
  maxConnectionPerServer: [
    { required: true, message: '请输入每服务器最大连接数', trigger: 'blur' },
    { type: 'number', min: 1, max: 16, message: '值必须在1-16之间', trigger: 'blur' }
  ],
  saveSessionInterval: [
    { type: 'number', min: 60, max: 3600, message: '值必须在60-3600之间', trigger: 'blur' }
  ]
}

onMounted(() => {
  if (connectionStore.isConnected) {
    loadSettings()
  }
})

async function loadSettings() {
  if (!connectionStore.isConnected) {
    ElMessage.warning('请先连接到 Aria2 服务器')
    return
  }

  loading.value = true
  try {
    console.log('Loading Aria2 global settings...')
    const options = await statsStore.getGlobalOptions()
    console.log('Received options:', options)

    if (options && typeof options === 'object') {
      // 安全地解析选项值
      settings.dir = options.dir || ''
      settings.maxConcurrentDownloads = parseInt(options['max-concurrent-downloads'] || '5')
      settings.maxConnectionPerServer = parseInt(options['max-connection-per-server'] || '5')
      settings.minSplitSize = options['min-split-size'] || '10M'
      settings.continue = options.continue === 'true'
      settings.saveSession = options['save-session'] !== 'false'
      settings.saveSessionInterval = parseInt(options['save-session-interval'] || '60')

      console.log('Parsed settings:', settings)
      ElMessage.success('设置加载成功')
    } else {
      throw new Error('Invalid options format received')
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '未知错误'
    ElMessage.error(`加载设置失败: ${errorMessage}`)
    console.error('Failed to load settings:', error)
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

  if (!connectionStore.isConnected) {
    ElMessage.warning('请先连接到 Aria2 服务器')
    return
  }

  saving.value = true
  try {
    const options = {
      'dir': settings.dir,
      'max-concurrent-downloads': settings.maxConcurrentDownloads.toString(),
      'max-connection-per-server': settings.maxConnectionPerServer.toString(),
      'min-split-size': settings.minSplitSize,
      'continue': settings.continue.toString(),
      'save-session': settings.saveSession.toString(),
      'save-session-interval': settings.saveSessionInterval.toString()
    }

    await statsStore.changeGlobalOptions(options)
    ElMessage.success('设置已保存')
  } catch (error) {
    ElMessage.error('保存设置失败')
    console.error('Failed to save settings:', error)
  } finally {
    saving.value = false
  }
}

async function resetToDefaults() {
  try {
    await ElMessageBox.confirm(
      '确定要恢复为默认设置吗？',
      '确认恢复',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )

    // 恢复默认值
    Object.assign(settings, {
      dir: '',
      maxConcurrentDownloads: 5,
      maxConnectionPerServer: 5,
      minSplitSize: '10M',
      continue: true,
      saveSession: true,
      saveSessionInterval: 60
    })

    ElMessage.success('已恢复为默认设置')
  } catch (error) {
    // 用户取消
  }
}

async function selectDirectory() {
  if (!window.electronAPI) {
    ElMessage.warning('此功能仅在桌面版中可用')
    return
  }

  try {
    const result = await window.electronAPI.showOpenDialog({
      properties: ['openDirectory'],
      title: '选择下载目录'
    })

    if (!result.canceled && result.filePaths.length > 0) {
      settings.dir = result.filePaths[0]
    }
  } catch (error) {
    ElMessage.error('选择目录失败')
  }
}
</script>

<style scoped>
.aria2-basic-settings {
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

/* 输入框深色主题样式 */
[data-theme="dark"] :deep(.el-input .el-input__wrapper) {
  background-color: var(--bg-tertiary) !important;
  border: 1px solid var(--border-base) !important;
  box-shadow: none !important;
}

[data-theme="dark"] :deep(.el-input .el-input__wrapper:hover) {
  border-color: var(--border-dark) !important;
  box-shadow: none !important;
}

[data-theme="dark"] :deep(.el-input .el-input__wrapper.is-focus) {
  border-color: var(--color-primary) !important;
  box-shadow: 0 0 0 2px rgba(74, 144, 226, 0.2) !important;
}

[data-theme="dark"] :deep(.el-input .el-input__inner) {
  color: var(--text-light) !important;
  background-color: transparent !important;
}

/* 输入框附加按钮深色主题样式 */
[data-theme="dark"] :deep(.el-input-group__append) {
  background-color: var(--bg-tertiary) !important;
  border: 1px solid var(--border-base) !important;
  border-left: none !important;
}

[data-theme="dark"] :deep(.el-input-group__append .el-button) {
  background-color: var(--bg-tertiary) !important;
  border: 1px solid var(--border-base) !important;
  border-left: none !important;
  color: var(--text-secondary) !important;
  box-shadow: none !important;
}

[data-theme="dark"] :deep(.el-input-group__append .el-button:hover) {
  background-color: var(--bg-secondary) !important;
  border-color: var(--border-dark) !important;
  color: var(--text-primary) !important;
  box-shadow: none !important;
}

/* 下拉选择框边框颜色修复 */
[data-theme="dark"] :deep(.el-select .el-select__wrapper) {
  background-color: var(--bg-tertiary) !important;
  border: 1px solid var(--border-base) !important;
  box-shadow: none !important;
}

[data-theme="dark"] :deep(.el-select .el-select__wrapper:hover) {
  border-color: var(--border-dark) !important;
  box-shadow: none !important;
}

[data-theme="dark"] :deep(.el-select .el-select__wrapper.is-focus),
[data-theme="dark"] :deep(.el-select .el-select__wrapper.is-focused) {
  border-color: var(--color-primary) !important;
  box-shadow: 0 0 0 2px rgba(74, 144, 226, 0.2) !important;
}
</style>
