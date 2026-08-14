<template>
  <div class="performance-settings">
    <div class="settings-header">
      <h2>{{ t('aria2Perf.title') }}</h2>
      <p class="settings-description">{{ t('aria2Perf.description') }}</p>
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
          <span class="group-title">{{ t('aria2Perf.speedLimit') }}</span>
        </template>

        <el-form-item :label="t('aria2Perf.maxOverallDownloadLimit')" prop="maxOverallDownloadLimit">
          <el-input
            v-model="settings.maxOverallDownloadLimit"
            :placeholder="t('aria2Perf.noLimit')"
            style="width: 200px"
          />
          <span style="margin-left: 8px">KB/s</span>
          <div class="form-tip">{{ t('aria2Perf.maxOverallDownloadLimitTip') }}</div>
        </el-form-item>

        <el-form-item :label="t('aria2Perf.maxOverallUploadLimit')" prop="maxOverallUploadLimit">
          <el-input
            v-model="settings.maxOverallUploadLimit"
            :placeholder="t('aria2Perf.noLimit')"
            style="width: 200px"
          />
          <span style="margin-left: 8px">KB/s</span>
          <div class="form-tip">{{ t('aria2Perf.maxOverallUploadLimitTip') }}</div>
        </el-form-item>

        <el-form-item :label="t('aria2Perf.maxUploadLimit')" prop="maxUploadLimit">
          <el-input
            v-model="settings.maxUploadLimit"
            :placeholder="t('aria2Perf.noLimit')"
            style="width: 200px"
          />
          <span style="margin-left: 8px">KB/s</span>
          <div class="form-tip">{{ t('aria2Perf.maxUploadLimitTip') }}</div>
        </el-form-item>
      </el-card>

      <el-card class="setting-group">
        <template #header>
          <span class="group-title">{{ t('aria2Perf.diskAndMemory') }}</span>
        </template>

        <el-form-item :label="t('aria2Perf.diskCache')" prop="diskCache">
          <el-input-number
            v-model="settings.diskCache"
            :min="0"
            :max="1024"
            style="width: 200px"
          />
          <span style="margin-left: 8px">MB</span>
          <div class="form-tip">{{ t('aria2Perf.diskCacheTip') }}</div>
        </el-form-item>

        <el-form-item :label="t('aria2Perf.fileAllocation')" prop="fileAllocation">
          <el-select v-model="settings.fileAllocation" style="width: 200px">
            <el-option :label="t('aria2Perf.fileAllocNone')" value="none" />
            <el-option :label="t('aria2Perf.fileAllocPrealloc')" value="prealloc" />
            <el-option :label="t('aria2Perf.fileAllocFalloc')" value="falloc" />
          </el-select>
          <div class="form-tip">{{ t('aria2Perf.fileAllocationTip') }}</div>
        </el-form-item>

        <el-form-item :label="t('aria2Perf.maxDownloadResult')" prop="maxDownloadResult">
          <el-input-number
            v-model="settings.maxDownloadResult"
            :min="0"
            :max="10000"
            style="width: 200px"
          />
          <div class="form-tip">{{ t('aria2Perf.maxDownloadResultTip') }}</div>
        </el-form-item>
      </el-card>

      <el-card class="setting-group">
        <template #header>
          <span class="group-title">{{ t('aria2Perf.performanceOptimization') }}</span>
        </template>

        <el-form-item :label="t('aria2Perf.realtimeChunkChecksum')" prop="realtimeChunkChecksum">
          <el-switch v-model="settings.realtimeChunkChecksum" />
          <div class="form-tip">{{ t('aria2Perf.realtimeChunkChecksumTip') }}</div>
        </el-form-item>

        <el-form-item :label="t('aria2Perf.uriSelector')" prop="uriSelector">
          <el-select v-model="settings.uriSelector" style="width: 200px">
            <el-option :label="t('aria2Perf.uriFeedback')" value="feedback" />
            <el-option :label="t('aria2Perf.uriInorder')" value="inorder" />
            <el-option :label="t('aria2Perf.uriAdaptive')" value="adaptive" />
          </el-select>
          <div class="form-tip">{{ t('aria2Perf.uriSelectorTip') }}</div>
        </el-form-item>

        <el-form-item :label="t('aria2Perf.eventPoll')" prop="eventPoll">
          <el-select v-model="settings.eventPoll" style="width: 200px">
            <el-option label="epoll (Linux)" value="epoll" />
            <el-option label="kqueue (BSD)" value="kqueue" />
            <el-option label="port (Solaris)" value="port" />
            <el-option label="poll" value="poll" />
            <el-option label="select" value="select" />
          </el-select>
          <div class="form-tip">{{ t('aria2Perf.eventPollTip') }}</div>
        </el-form-item>

        <el-form-item :label="t('aria2Perf.enableMmap')" prop="enableMmap">
          <el-switch v-model="settings.enableMmap" />
          <div class="form-tip">{{ t('aria2Perf.enableMmapTip') }}</div>
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
import { ref, reactive, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { useConnectionStore } from '@/stores/connectionStore'
import { useStatsStore } from '@/stores/statsStore'

const connectionStore = useConnectionStore()
const statsStore = useStatsStore()
const { t } = useI18n()
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
    { type: 'number', min: 0, max: 1024, message: () => t('settings.valueRange', { min: 0, max: 1024 }), trigger: 'blur' }
  ],
  maxDownloadResult: [
    { type: 'number', min: 0, max: 10000, message: () => t('settings.valueRange', { min: 0, max: 10000 }), trigger: 'blur' }
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
    const options = await statsStore.getGlobalOptions()

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

    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : t('settings.unknownError')
    ElMessage.error(t('aria2Perf.loadFailed', { error: errorMessage }))
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

  if (!connectionStore.isConnected) {
    ElMessage.warning(t('settings.connectFirst'))
    return
  }

  saving.value = true
  try {
    const options: Record<string, string> = {
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

    await statsStore.changeGlobalOptions(options)
    ElMessage.success(t('aria2Perf.saved'))
  } catch (error) {
    ElMessage.error(t('aria2Perf.saveFailed'))
    console.error('Failed to save performance settings:', error)
  } finally {
    saving.value = false
  }
}

async function resetToDefaults() {
  try {
    await ElMessageBox.confirm(
      t('aria2Perf.restoreConfirm'),
      t('aria2Perf.restoreTitle'),
      {
        confirmButtonText: t('common.ok'),
        cancelButtonText: t('common.cancel'),
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

    ElMessage.success(t('aria2Perf.restored'))
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
