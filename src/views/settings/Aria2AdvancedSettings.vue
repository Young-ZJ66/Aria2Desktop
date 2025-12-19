<template>
  <div class="advanced-settings">
    <div class="settings-header">
      <h2>高级设置</h2>
      <p class="settings-description">配置 Aria2 的高级参数和系统级选项</p>

    </div>

    <el-form
      ref="formRef"
      :model="settings"
      label-width="200px"
      style="max-width: 800px"
      v-loading="loading"
    >
      <el-card class="setting-group">
        <template #header>
          <span class="group-title">性能设置</span>
        </template>

        <el-form-item label="磁盘缓存">
          <el-input-number
            v-model="settings.diskCache"
            :min="0"
            :max="1024"
            style="width: 200px"
          />
          <span style="margin-left: 8px">MB</span>
          <div class="form-tip">磁盘缓存大小，0 表示禁用</div>
        </el-form-item>

        <el-form-item label="文件预分配">
          <el-select v-model="settings.fileAllocation" style="width: 200px">
            <el-option label="无" value="none" />
            <el-option label="预分配" value="prealloc" />
            <el-option label="回退" value="falloc" />
          </el-select>
          <div class="form-tip">文件预分配方法</div>
        </el-form-item>

        <el-form-item label="检查完整性">
          <el-switch v-model="settings.checkIntegrity" />
          <div class="form-tip">下载完成后检查文件完整性</div>
        </el-form-item>

        <el-form-item label="实时检查">
          <el-switch v-model="settings.realtimeChunkChecksum" />
          <div class="form-tip">实时检查数据块校验和</div>
        </el-form-item>
      </el-card>

      <el-card class="setting-group">
        <template #header>
          <span class="group-title">日志设置</span>
        </template>

        <el-form-item label="日志级别">
          <el-select v-model="settings.logLevel" style="width: 200px">
            <el-option label="调试" value="debug" />
            <el-option label="信息" value="info" />
            <el-option label="通知" value="notice" />
            <el-option label="警告" value="warn" />
            <el-option label="错误" value="error" />
          </el-select>
          <div class="form-tip">日志记录级别</div>
        </el-form-item>

        <el-form-item label="日志文件">
          <el-input
            v-model="settings.log"
            placeholder="日志文件路径"
          />
          <div class="form-tip">日志文件保存路径</div>
        </el-form-item>

        <el-form-item label="控制台日志级别">
          <el-select v-model="settings.consoleLogLevel" style="width: 200px">
            <el-option label="调试" value="debug" />
            <el-option label="信息" value="info" />
            <el-option label="通知" value="notice" />
            <el-option label="警告" value="warn" />
            <el-option label="错误" value="error" />
          </el-select>
          <div class="form-tip">控制台日志级别</div>
        </el-form-item>
      </el-card>

      <el-card class="setting-group">
        <template #header>
          <span class="group-title">系统设置</span>
        </template>

        <el-form-item label="摘要算法">
          <el-select v-model="settings.checksumAlgorithm" style="width: 200px">
            <el-option label="SHA-1" value="sha-1" />
            <el-option label="SHA-224" value="sha-224" />
            <el-option label="SHA-256" value="sha-256" />
            <el-option label="SHA-384" value="sha-384" />
            <el-option label="SHA-512" value="sha-512" />
            <el-option label="MD5" value="md5" />
            <el-option label="ADLER32" value="adler32" />
          </el-select>
          <div class="form-tip">文件校验摘要算法</div>
        </el-form-item>

        <el-form-item label="事件轮询">
          <el-select v-model="settings.eventPoll" style="width: 200px">
            <el-option label="epoll" value="epoll" />
            <el-option label="kqueue" value="kqueue" />
            <el-option label="port" value="port" />
            <el-option label="poll" value="poll" />
            <el-option label="select" value="select" />
          </el-select>
          <div class="form-tip">事件轮询方法</div>
        </el-form-item>

        <el-form-item label="摘要检查">
          <el-switch v-model="settings.checksumCheck" />
          <div class="form-tip">启用文件摘要检查</div>
        </el-form-item>
      </el-card>

      <el-form-item style="margin-top: 24px">
        <el-space>
          <el-button
            type="primary"
            @click="saveSettings"
            :disabled="!connectionStore.isConnected"
            :loading="saving"
          >
            保存设置
          </el-button>
          <el-button
            @click="loadSettings"
            :disabled="!connectionStore.isConnected"
          >
            重新加载
          </el-button>
          <el-button @click="resetSettings">
            重置为默认值
          </el-button>
        </el-space>
      </el-form-item>
    </el-form>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, type FormInstance } from 'element-plus'
import { useConnectionStore } from '@/stores/connectionStore'
import { useStatsStore } from '@/stores/statsStore'

const connectionStore = useConnectionStore()
const statsStore = useStatsStore()
const formRef = ref<FormInstance>()
const loading = ref(false)
const saving = ref(false)

// 高级设置
const settings = reactive({
  diskCache: 16,
  fileAllocation: 'prealloc',
  checkIntegrity: false,
  realtimeChunkChecksum: true,
  logLevel: 'warn',
  log: '',
  consoleLogLevel: 'notice',
  checksumAlgorithm: 'sha-1',
  eventPoll: 'epoll',
  checksumCheck: true
})

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
    const options = await statsStore.getGlobalOptions()
    if (options) {
      settings.diskCache = parseInt(options['disk-cache'] || '16')
      settings.fileAllocation = options['file-allocation'] || 'prealloc'
      settings.checkIntegrity = options['check-integrity'] === 'true'
      settings.realtimeChunkChecksum = options['realtime-chunk-checksum'] !== 'false'
      settings.logLevel = options['log-level'] || 'warn'
      settings.log = options['log'] || ''
      settings.consoleLogLevel = options['console-log-level'] || 'notice'
      settings.checksumAlgorithm = options['checksum'] || 'sha-1'
      settings.eventPoll = options['event-poll'] || 'epoll'
      settings.checksumCheck = options['checksum-check'] !== 'false'
    }
  } catch (error) {
    ElMessage.error('加载设置失败')
    console.error('Failed to load advanced settings:', error)
  } finally {
    loading.value = false
  }
}

async function saveSettings() {
  if (!connectionStore.isConnected) {
    ElMessage.warning('请先连接到 Aria2 服务器')
    return
  }

  saving.value = true
  try {
    const options: Record<string, string> = {
      'disk-cache': settings.diskCache.toString() + 'M',
      'file-allocation': settings.fileAllocation,
      'check-integrity': settings.checkIntegrity ? 'true' : 'false',
      'realtime-chunk-checksum': settings.realtimeChunkChecksum ? 'true' : 'false',
      'log-level': settings.logLevel,
      'console-log-level': settings.consoleLogLevel,
      'checksum': settings.checksumAlgorithm,
      'event-poll': settings.eventPoll,
      'checksum-check': settings.checksumCheck ? 'true' : 'false'
    }

    if (settings.log) options['log'] = settings.log

    await statsStore.changeGlobalOptions(options)
    ElMessage.success('设置保存成功')
  } catch (error) {
    ElMessage.error('保存设置失败')
    console.error('Failed to save advanced settings:', error)
  } finally {
    saving.value = false
  }
}

function resetSettings() {
  settings.diskCache = 16
  settings.fileAllocation = 'prealloc'
  settings.checkIntegrity = false
  settings.realtimeChunkChecksum = true
  settings.logLevel = 'warn'
  settings.log = ''
  settings.consoleLogLevel = 'notice'
  settings.checksumAlgorithm = 'sha-1'
  settings.eventPoll = 'epoll'
  settings.checksumCheck = true

  ElMessage.info('已重置为默认值')
}
</script>

<style scoped>
.advanced-settings {
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

/* 使用全局 .form-tip 样式 */

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
