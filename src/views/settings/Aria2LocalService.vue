<template>
  <div class="aria2-local-service settings-page">
    <div class="settings-header">
      <h2>{{ t('localService.title') }}</h2>
      <p class="settings-description">{{ t('localService.description') }}</p>
    </div>

    <!-- 服务状态卡片 -->
    <el-card class="status-card">
      <template #header>
        <div class="card-header">
          <span class="header-title">{{ t('localService.serviceStatus') }}</span>
          <el-button
            size="small"
            :loading="isRefreshing"
            circle
            @click="refreshStatus"
          >
            <el-icon><Refresh /></el-icon>
          </el-button>
        </div>
      </template>

      <div class="status-content">
        <div class="status-row">
          <span class="status-label">{{ t('localService.runStatus') }}</span>
          <el-tag
            :type="isRunning ? 'success' : 'danger'"
            size="large"
          >
            {{ isRunning ? t('localService.running') : t('localService.stopped') }}
          </el-tag>
        </div>

        <div v-if="hasError" class="status-row">
          <span class="status-label">{{ t('localService.errorLabel') }}</span>
          <el-tag type="danger">{{ processInfo.error }}</el-tag>
        </div>
      </div>

      <div class="control-buttons">
        <el-space size="large">
          <el-button
            :type="isRunning ? 'danger' : 'primary'"
            :loading="isStarting || isStopping"
            :disabled="!canStart && !canStop"
            @click="isRunning ? stopService() : startService()"
          >
            <el-icon><VideoPlay v-if="!isRunning" /><VideoPause v-else /></el-icon>
            {{ isRunning ? t('localService.stop') : t('localService.start') }}
          </el-button>

          <el-button
            type="warning"
            :loading="isStarting || isStopping"
            :disabled="!canRestart"
            @click="restartService"
          >
            <el-icon><Refresh /></el-icon>
            {{ t('localService.restart') }}
          </el-button>

          <el-button
            :type="connectionStore.isConnected ? 'warning' : 'success'"
            :loading="isConnecting"
            :disabled="!isRunning"
            @click="connectionStore.isConnected ? disconnectFromLocal() : connectToLocal()"
          >
            <el-icon><Link v-if="!connectionStore.isConnected" /><Close v-else /></el-icon>
            {{ connectionStore.isConnected ? t('localService.disconnect') : t('localService.connect') }}
          </el-button>
        </el-space>
      </div>
    </el-card>

    <!-- 服务配置 -->
    <el-card class="config-card">
      <template #header>
        <span class="header-title">{{ t('localService.serviceConfig') }}</span>
      </template>

      <el-form
        ref="configFormRef"
        :model="localConfig"
        :rules="configRules"
        label-width="150px"
        style="max-width: 600px"
      >
        <el-form-item :label="t('localService.listenPort')" prop="port">
          <el-input-number
            v-model="localConfig.port"
            :min="1024"
            :max="65535"
          />
          <div class="form-tip">{{ t('localService.listenPortTip') }}</div>
        </el-form-item>

        <el-form-item :label="t('localService.accessSecret')" prop="secret">
          <el-input
            v-model="localConfig.secret"
            type="password"
            :placeholder="t('localService.accessSecretPlaceholder')"
            show-password
            clearable
          />
          <div class="form-tip">{{ t('localService.accessSecretTip') }}</div>
        </el-form-item>

        <el-form-item :label="t('localService.downloadDir')" prop="downloadDir">
          <el-input
            v-model="localConfig.downloadDir"
            :placeholder="t('localService.downloadDirPlaceholder')"
          >
            <template #append>
              <el-button @click="selectDownloadDir">
                <el-icon><Folder /></el-icon>
              </el-button>
            </template>
          </el-input>
          <div class="form-tip">{{ t('localService.downloadDirTip') }}</div>
        </el-form-item>

        <el-form-item :label="t('localService.autoStart')">
          <el-switch
            v-model="localConfig.autoStart"
            @change="updateAutoStart"
          />
          <div class="form-tip">{{ t('localService.autoStartTip') }}</div>
        </el-form-item>

        <el-form-item>
          <el-space>
            <el-button
              type="primary"
              :loading="isSavingConfig"
              @click="saveConfig"
            >
              {{ t('localService.saveConfig') }}
            </el-button>
            <el-button @click="resetConfig">{{ t('localService.resetConfig') }}</el-button>
          </el-space>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 内置 Aria2 不可用提示 -->
    <el-card v-if="isElectronAvailable && processInfo.isAria2Available === false" class="guide-card">
      <template #header>
        <span class="header-title">{{ t('localService.aria2Unavailable') }}</span>
      </template>

      <el-alert
        :title="t('localService.aria2NotFound')"
        type="warning"
        :closable="false"
        show-icon
      >
        <template #default>
          <p>{{ t('localService.aria2NotFoundDesc1') }}</p>
          <p><strong>{{ t('localService.solution') }}</strong></p>
          <ol>
            <li>{{ t('localService.solution1') }}</li>
            <li>{{ t('localService.solution2') }}</li>
            <li>{{ t('localService.solution3') }}</li>
          </ol>
          <p v-if="processInfo.resourceInfo">
            <strong>{{ t('localService.userDataDir') }}</strong><br />
            <code>{{ processInfo.resourceInfo.userDataPath }}</code>
          </p>
        </template>
      </el-alert>
    </el-card>

    <!-- 安装指南 -->
    <el-card v-if="!isElectronAvailable" class="guide-card">
      <template #header>
        <span class="header-title">{{ t('localService.installGuide') }}</span>
      </template>

      <el-alert
        :title="t('localService.desktopOnlyTitle')"
        type="info"
        :closable="false"
        show-icon
      >
        <template #default>
          <p>{{ t('localService.desktopOnlyDesc1') }}</p>
          <p>{{ t('localService.desktopOnlyDesc2') }}</p>
        </template>
      </el-alert>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import {
  Refresh,
  VideoPlay,
  VideoPause,
  Folder,
  Link,
  Close
} from '@element-plus/icons-vue'
import { useAria2LocalService, type Aria2LocalConfig } from '@/composables/useAria2LocalService'
import { useConnectionStore } from '@/stores/connectionStore'
import { useSettingsStore } from '@/stores/settingsStore'

const { t } = useI18n()
const connectionStore = useConnectionStore()
const settingsStore = useSettingsStore()
const {
  processInfo,
  isRunning,
  hasError,
  canStart,
  canStop,
  canRestart,
  isStarting,
  isStopping,
  isElectronAvailable,
  start,
  stop,
  restart,
  getStatus,
  updateConfig,
  getConnectionConfig
} = useAria2LocalService()

const configFormRef = ref<FormInstance>()
const isRefreshing = ref(false)
const isSavingConfig = ref(false)
const isConnecting = ref(false)

// 本地配置表单 - 所有值都将从配置文件加载
const localConfig = reactive<Aria2LocalConfig>({
  port: 0, // 将从配置文件读取
  secret: '', // 将从配置文件读取
  downloadDir: '', // 将从配置文件读取
  autoStart: false // 将从配置文件读取
})

// 表单验证规则
const configRules = computed<FormRules>(() => ({
  port: [
    { type: 'number', min: 1024, max: 65535, message: t('localService.portRangeError'), trigger: 'blur' }
  ]
}))

// 刷新状态
async function refreshStatus() {
  isRefreshing.value = true
  try {
    await getStatus()
    // 刷新状态后重新加载配置到表单
    loadCurrentConfig()
    ElMessage.success(t('localService.statusRefreshed'))
  } catch (_error) {
    ElMessage.error(t('localService.refreshFailed'))
  } finally {
    isRefreshing.value = false
  }
}

// 启动服务
async function startService() {
  const success = await start()
  if (success) {
    // 启动成功后重新加载配置到表单
    loadCurrentConfig()
    ElMessage.success(t('localService.serviceStarted'))
  }
}

// 停止服务
async function stopService() {
  try {
    await ElMessageBox.confirm(
      t('localService.confirmStop'),
      t('localService.confirmStopTitle'),
      {
        confirmButtonText: t('common.ok'),
        cancelButtonText: t('common.cancel'),
        type: 'warning'
      }
    )

    await stop()
  } catch (_error) {
    // 用户取消
  }
}

// 重启服务
async function restartService() {
  try {
    await ElMessageBox.confirm(
      t('localService.confirmRestart'),
      t('localService.confirmRestartTitle'),
      {
        confirmButtonText: t('common.ok'),
        cancelButtonText: t('common.cancel'),
        type: 'warning'
      }
    )

    await restart()
  } catch (_error) {
    // 用户取消
  }
}

// 选择下载目录
async function selectDownloadDir() {
  if (!window.electronAPI) {
    ElMessage.error(t('localService.desktopOnly'))
    return
  }

  try {
    const result = await window.electronAPI.showOpenDialog({
      title: t('localService.selectDirTitle'),
      properties: ['openDirectory'],
      defaultPath: localConfig.downloadDir
    })

    if (!result.canceled && result.filePaths.length > 0) {
      localConfig.downloadDir = result.filePaths[0]
    }
  } catch (error) {
    ElMessage.error(t('localService.selectDirFailed'))
    console.error('选择目录失败:', error)
  }
}

// 保存配置
async function saveConfig() {
  if (!configFormRef.value) return

  try {
    await configFormRef.value.validate()
  } catch {
    return
  }

  isSavingConfig.value = true

  try {
    // 如果服务正在运行，先询问用户是否要保存并重启
    if (isRunning.value) {
      try {
        await ElMessageBox.confirm(
          t('localService.confirmSaveRestart'),
          t('localService.confirmSaveTitle'),
          {
            confirmButtonText: t('localService.saveAndRestart'),
            cancelButtonText: t('common.cancel'),
            type: 'warning'
          }
        )

        // 用户确认后，保存配置并重启服务
        const success = await updateConfig(localConfig)
        if (success) {
          ElMessage.success(t('localService.configSavedRestarting'))
          await restart()
        }
      } catch {
        // 用户取消，不保存配置
        ElMessage.info(t('localService.saveCancelled'))
        return
      }
    } else {
      // 服务未运行，直接保存配置
      const success = await updateConfig(localConfig)
      if (success) {
        ElMessage.success(t('localService.configSaved'))
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('保存配置失败:', error)

    if (errorMessage.includes('下载目录验证失败')) {
      ElMessage.error(t('localService.invalidDir'))
    } else if (errorMessage.includes('启动失败')) {
      ElMessage.error(t('localService.restartFailed'))
    } else {
      ElMessage.error(t('localService.configSaveFailed', { error: errorMessage }))
    }
  } finally {
    isSavingConfig.value = false
  }
}

// 更新自动启动设置
const updateAutoStart = (value: boolean) => {
  localConfig.autoStart = value
  updateConfig(localConfig)
}

// 重置配置
function resetConfig() {
  Object.assign(localConfig, {
    port: 6800,
    secret: '',
    downloadDir: 'D:/Downloads/Aria2Downloads',
    autoStart: true
  })
  ElMessage.success(t('localService.configReset'))
}

// 连接到本地服务
async function connectToLocal() {
  if (!isRunning.value) {
    ElMessage.warning(t('localService.startServiceFirst'))
    return
  }

  isConnecting.value = true

  try {
    const config = getConnectionConfig.value

    // 构建连接配置
    const connectionConfig = {
      host: config.host,
      port: config.port,
      protocol: config.protocol as 'http' | 'https' | 'ws' | 'wss',
      secret: config.secret,
      path: '/jsonrpc' // 默认路径
    }

    // 更新设置并连接
    await settingsStore.updateAria2Config(connectionConfig)
    await connectionStore.connect(connectionConfig)

    ElMessage.success(t('localService.connectedToLocal'))
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    ElMessage.error(t('localService.connectLocalFailed', { error: errorMessage }))
    console.error('连接失败详情:', error)
    console.error('连接配置:', getConnectionConfig.value)
  } finally {
    isConnecting.value = false
  }
}

// 断开连接
function disconnectFromLocal() {
  try {
    connectionStore.disconnect()
    ElMessage.success(t('localService.disconnectedFromLocal'))
  } catch (error) {
    ElMessage.error(t('localService.disconnectFailed'))
    console.error('断开连接失败:', error)
  }
}

// 加载当前配置到表单
function loadCurrentConfig() {
  // 每次都重新获取最新状态，确保配置是最新的
  getStatus().then(() => {
    if (processInfo.value.config) {
      // 完全使用配置文件中的值，不使用任何默认值
      localConfig.port = processInfo.value.config.port
      localConfig.secret = processInfo.value.config.secret
      localConfig.autoStart = processInfo.value.config.autoStart
      localConfig.downloadDir = processInfo.value.config.downloadDir
    } else {
      // 如果没有配置信息，使用默认值
      Object.assign(localConfig, {
        port: 6800,
        secret: '',
        downloadDir: 'D:/Downloads/Aria2Downloads',
        autoStart: true
      })
    }
  })
}

// 初始化
onMounted(async () => {
  if (isElectronAvailable.value) {
    // 先获取当前状态
    await getStatus()
    // 然后加载配置到表单
    loadCurrentConfig()
  }
})
</script>

<style scoped>
.aria2-local-service {
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

.status-card,
.config-card,
.connection-card,
.guide-card {
  margin-bottom: 20px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-title {
  font-weight: 600;
  color: var(--text-primary);
}

.status-content {
  margin-bottom: 20px;
}

.status-row {
  display: flex;
  align-items: center;
  margin-bottom: 12px;
}

.status-label {
  min-width: 100px;
  font-weight: 500;
  color: var(--text-primary);
}

.path-tag {
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.control-buttons {
  padding-top: 16px;
  border-top: 1px solid var(--border-light);
}

.form-tip {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 4px;
  line-height: 1.4;
}

.connection-info {
  line-height: 1.6;
}

.connection-details {
  margin: 16px 0;
  padding: 12px;
  background-color: var(--bg-tertiary);
  border-radius: 6px;
}

.detail-row {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}

.detail-row:last-child {
  margin-bottom: 0;
}

.detail-label {
  min-width: 100px;
  font-weight: 500;
  color: var(--text-primary);
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

/* 确保禁用按钮显示为正确的灰色状态 */
:deep(.el-button.is-disabled) {
  cursor: default !important;
  opacity: 0.6;
  background-color: var(--color-info-light-9, #f4f4f5) !important;
  border-color: var(--color-info-light-8, #e9e9eb) !important;
  color: var(--color-info, #909399) !important;
}

:deep(.el-button.is-disabled:hover) {
  cursor: default !important;
  background-color: var(--color-info-light-9, #f4f4f5) !important;
  border-color: var(--color-info-light-8, #e9e9eb) !important;
  color: var(--color-info, #909399) !important;
}

/* 深色主题下的禁用按钮样式已统一在 theme.css 中 */
</style>
