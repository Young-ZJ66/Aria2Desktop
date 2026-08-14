<template>
  <div class="aria2-basic-settings">
    <div class="settings-header">
      <h2>{{ t('aria2Basic.title') }}</h2>
      <p class="settings-description">{{ t('aria2Basic.description') }}</p>
    </div>

    <el-alert
      v-if="!connectionStore.isConnected"
      :title="t('settings.notConnectedTitle')"
      :description="t('settings.notConnectedDesc')"
      type="warning"
      :closable="false"
      style="margin-bottom: 20px"
    />

    <el-form
      ref="formRef"
      v-loading="loading"
      :model="settings"
      :rules="rules"
      label-width="200px"
      style="max-width: 800px"
      :disabled="!connectionStore.isConnected"
    >
      <el-card class="setting-group">
        <template #header>
          <span class="group-title">{{ t('aria2Basic.downloadSettings') }}</span>
        </template>

        <el-form-item :label="t('aria2Basic.downloadDir')" prop="dir">
          <el-input
            v-model="settings.dir"
            :placeholder="t('aria2Basic.downloadDirPlaceholder')"
          >
            <template #append>
              <el-button :disabled="!isElectron" @click="selectDirectory">
                <el-icon><Folder /></el-icon>
              </el-button>
            </template>
          </el-input>
          <div class="form-tip">{{ t('aria2Basic.downloadDirTip') }}</div>
        </el-form-item>

        <el-form-item :label="t('aria2Basic.maxConcurrentDownloads')" prop="maxConcurrentDownloads">
          <el-input-number
            v-model="settings.maxConcurrentDownloads"
            :min="1"
            :max="16"
            style="width: 200px"
          />
          <div class="form-tip">{{ t('aria2Basic.maxConcurrentDownloadsTip') }}</div>
        </el-form-item>

        <el-form-item :label="t('aria2Basic.maxConnectionPerServer')" prop="maxConnectionPerServer">
          <el-input-number
            v-model="settings.maxConnectionPerServer"
            :min="1"
            :max="16"
            style="width: 200px"
          />
          <div class="form-tip">{{ t('aria2Basic.maxConnectionPerServerTip') }}</div>
        </el-form-item>

        <el-form-item :label="t('aria2Basic.minSplitSize')" prop="minSplitSize">
          <el-select v-model="settings.minSplitSize" style="width: 200px">
            <el-option label="1M" value="1M" />
            <el-option label="5M" value="5M" />
            <el-option label="10M" value="10M" />
            <el-option label="20M" value="20M" />
            <el-option label="50M" value="50M" />
            <el-option label="100M" value="100M" />
          </el-select>
          <div class="form-tip">{{ t('aria2Basic.minSplitSizeTip') }}</div>
        </el-form-item>
      </el-card>

      <el-card class="setting-group">
        <template #header>
          <span class="group-title">{{ t('aria2Basic.downloadOptions') }}</span>
        </template>

        <el-form-item :label="t('aria2Basic.resumeDownload')" prop="continue">
          <el-switch v-model="settings.continue" />
          <div class="form-tip">{{ t('aria2Basic.resumeDownloadTip') }}</div>
        </el-form-item>
      </el-card>

      <el-card class="setting-group">
        <template #header>
          <span class="group-title">{{ t('aria2Basic.otherSettings') }}</span>
        </template>

        <el-form-item :label="t('aria2Basic.autoSaveSession')" prop="saveSession">
          <el-switch v-model="settings.saveSession" />
          <div class="form-tip">{{ t('aria2Basic.autoSaveSessionTip') }}</div>
        </el-form-item>

        <el-form-item :label="t('aria2Basic.sessionSaveInterval')" prop="saveSessionInterval">
          <el-input-number
            v-model="settings.saveSessionInterval"
            :min="60"
            :max="3600"
            :disabled="!settings.saveSession"
            style="width: 200px"
          />
          <span style="margin-left: 8px">{{ t('aria2Basic.seconds') }}</span>
          <div class="form-tip">{{ t('aria2Basic.sessionSaveIntervalTip') }}</div>
        </el-form-item>
      </el-card>

      <el-form-item style="margin-top: 24px">
        <el-space>
          <el-button
            type="primary"
            :loading="saving"
            :disabled="!connectionStore.isConnected"
            @click="saveSettings"
          >
            {{ t('settings.save') }}
          </el-button>
          <el-button
            :disabled="!connectionStore.isConnected"
            @click="loadSettings"
          >
            {{ t('settings.reload') }}
          </el-button>
          <el-button
            :disabled="!connectionStore.isConnected"
            @click="resetToDefaults"
          >
            {{ t('settings.restoreDefaults') }}
          </el-button>
        </el-space>
      </el-form-item>
    </el-form>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { Folder } from '@element-plus/icons-vue'
import { useConnectionStore } from '@/stores/connectionStore'
import { useStatsStore } from '@/stores/statsStore'

const connectionStore = useConnectionStore()
const statsStore = useStatsStore()
const { t } = useI18n()
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
    { required: true, message: () => t('aria2Basic.requireMaxConcurrent'), trigger: 'blur' },
    { type: 'number', min: 1, max: 16, message: () => t('settings.valueRange', { min: 1, max: 16 }), trigger: 'blur' }
  ],
  maxConnectionPerServer: [
    { required: true, message: () => t('aria2Basic.requireMaxConnection'), trigger: 'blur' },
    { type: 'number', min: 1, max: 16, message: () => t('settings.valueRange', { min: 1, max: 16 }), trigger: 'blur' }
  ],
  saveSessionInterval: [
    { type: 'number', min: 60, max: 3600, message: () => t('settings.valueRange', { min: 60, max: 3600 }), trigger: 'blur' }
  ]
}

onMounted(() => {
  if (connectionStore.isConnected) {
    loadSettings()
  }
})

async function loadSettings() {
  if (!connectionStore.isConnected) {
    ElMessage.warning(t('settings.connectFirst'))
    return
  }

  loading.value = true
  try {
    console.warn('Loading Aria2 global settings...')
    const options = await statsStore.getGlobalOptions()
    console.warn('Received options:', options)

    if (options && typeof options === 'object') {
      // 安全地解析选项值
      settings.dir = options.dir || ''
      settings.maxConcurrentDownloads = parseInt(options['max-concurrent-downloads'] || '5')
      settings.maxConnectionPerServer = parseInt(options['max-connection-per-server'] || '5')
      settings.minSplitSize = options['min-split-size'] || '10M'
      settings.continue = options.continue === 'true'
      settings.saveSession = options['save-session'] !== 'false'
      settings.saveSessionInterval = parseInt(options['save-session-interval'] || '60')

      console.warn('Parsed settings:', settings)
    } else {
      throw new Error('Invalid options format received')
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : t('settings.unknownError')
    ElMessage.error(t('aria2Basic.loadFailed', { error: errorMessage }))
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
    ElMessage.warning(t('settings.connectFirst'))
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
    ElMessage.success(t('settings.saved'))
  } catch (error) {
    ElMessage.error(t('settings.saveFailedShort'))
    console.error('Failed to save settings:', error)
  } finally {
    saving.value = false
  }
}

async function resetToDefaults() {
  try {
    await ElMessageBox.confirm(
      t('settings.restoreConfirm'),
      t('settings.restoreConfirmTitle'),
      {
        confirmButtonText: t('common.ok'),
        cancelButtonText: t('common.cancel'),
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

    ElMessage.success(t('settings.restored'))
  } catch (error) {
    // 用户取消
  }
}

async function selectDirectory() {
  if (!window.electronAPI) {
    ElMessage.warning(t('task.desktopOnly'))
    return
  }

  try {
    const result = await window.electronAPI.showOpenDialog({
      properties: ['openDirectory'],
      title: t('aria2Basic.selectDownloadDir')
    })

    if (!result.canceled && result.filePaths.length > 0) {
      settings.dir = result.filePaths[0]
    }
  } catch (error) {
    ElMessage.error(t('newTask.selectDirFailed'))
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

/* 深色主题下的输入框/下拉选择框/附加按钮样式已统一在 theme.css 中 */
</style>
