<template>
  <SettingsPage
    :title="t('nav.engineSettings')"
    :description="t('localService.description')"
  >
    <!-- 服务状态 -->
    <n-card :title="t('localService.serviceStatus')" class="section-card">
      <template #header-extra>
        <n-button
          size="small"
          quaternary
          circle
          :loading="isRefreshing"
          @click="refreshStatus"
        >
          <n-icon><RefreshOutline /></n-icon>
        </n-button>
      </template>

      <div class="status-content">
        <div class="status-row">
          <span class="status-label">{{ t('localService.runStatus') }}</span>
          <n-tag
            v-if="isElectronAvailable && processInfo.isAria2Available !== false"
            :type="isRunning ? 'success' : 'error'"
            size="large"
          >
            {{ isRunning ? t('localService.running') : t('localService.stopped') }}
          </n-tag>
          <n-tag v-else type="warning" size="large">
            {{ t('settings.engine.unavailable') }}
          </n-tag>
        </div>

        <div v-if="isRunning && processInfo.pid" class="status-row">
          <span class="status-label">{{ t('settings.engine.pid') }}</span>
          <span class="status-value">{{ processInfo.pid }}</span>
        </div>

        <div v-if="isElectronAvailable" class="status-row">
          <span class="status-label">{{ t('settings.engine.aria2cAvailable') }}</span>
          <n-tag :type="processInfo.isAria2Available ? 'success' : 'warning'" size="small">
            {{ processInfo.isAria2Available ? t('common.yes') : t('common.no') }}
          </n-tag>
        </div>

        <div v-if="hasError" class="status-row">
          <span class="status-label">{{ t('localService.errorLabel') }}</span>
          <n-tag type="error">{{ processInfo.error }}</n-tag>
        </div>
      </div>

      <div class="control-buttons">
        <n-space>
          <n-button
            :type="isRunning ? 'error' : 'primary'"
            :loading="isStarting || isStopping"
            :disabled="!canStart && !canStop"
            @click="isRunning ? stopService() : startService()"
          >
            <template #icon>
              <n-icon><PlayOutline v-if="!isRunning" /><PauseOutline v-else /></n-icon>
            </template>
            {{ isRunning ? t('localService.stop') : t('localService.start') }}
          </n-button>

          <n-button
            type="warning"
            :loading="isStarting || isStopping"
            :disabled="!canRestart"
            @click="restartService"
          >
            <template #icon>
              <n-icon><RefreshOutline /></n-icon>
            </template>
            {{ t('localService.restart') }}
          </n-button>

          <n-button
            :disabled="!isRunning"
            @click="handleSaveSession"
          >
            <template #icon>
              <n-icon><SaveOutline /></n-icon>
            </template>
            {{ t('settings.engine.saveSession') }}
          </n-button>
        </n-space>
      </div>
    </n-card>

    <!-- 服务配置 -->
    <n-card :title="t('localService.serviceConfig')" class="section-card">
      <n-form
        ref="configFormRef"
        :model="localConfig"
        :rules="configRules"
        label-placement="left"
        :label-width="180"
        label-align="left"
        :show-feedback="false"
      >
        <n-form-item path="port">
          <template #label>
            <TipLabel :label="t('localService.listenPort')" :tip="t('localService.listenPortTip')" />
          </template>
          <n-input-number
            v-model:value="localConfig.port"
            :min="1024"
            :max="65535"
          />
        </n-form-item>

        <n-form-item path="secret">
          <template #label>
            <TipLabel :label="t('localService.accessSecret')" :tip="t('localService.accessSecretTip')" />
          </template>
          <n-input
            v-model:value="localConfig.secret"
            type="password"
            :placeholder="t('localService.accessSecretPlaceholder')"
            show-password-on="click"
            clearable
          />
        </n-form-item>

        <n-form-item path="downloadDir">
          <template #label>
            <TipLabel :label="t('localService.downloadDir')" :tip="t('localService.downloadDirTip')" />
          </template>
          <n-input
            v-model:value="localConfig.downloadDir"
            :placeholder="t('localService.downloadDirPlaceholder')"
          >
            <template #suffix>
              <n-button text @click="selectDownloadDir">
                <template #icon>
                  <n-icon><FolderOutline /></n-icon>
                </template>
              </n-button>
            </template>
          </n-input>
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('localService.autoStart')" :tip="t('localService.autoStartTip')" />
          </template>
          <AppSwitch
            v-model:value="localConfig.autoStart"
            @update:value="updateAutoStart"
          />
        </n-form-item>

        <div class="config-actions">
          <n-button
            type="primary"
            :loading="isSavingConfig"
            @click="saveConfig"
          >
            {{ t('localService.saveConfig') }}
          </n-button>
          <n-tooltip trigger="hover">
            <template #trigger>
              <n-button @click="resetConfig">
                {{ t('localService.resetConfig') }}
              </n-button>
            </template>
            {{ t('localService.resetConfigTip') }}
          </n-tooltip>
        </div>
      </n-form>
    </n-card>

    <!-- 内置 Aria2 不可用提示 -->
    <n-card v-if="isElectronAvailable && processInfo.isAria2Available === false" class="section-card">
      <n-alert :title="t('localService.aria2Unavailable')" type="warning" :bordered="false">
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
      </n-alert>
    </n-card>

    <!-- 桌面版提示 -->
    <n-card v-if="!isElectronAvailable" class="section-card">
      <n-alert :title="t('localService.desktopOnlyTitle')" type="info" :bordered="false">
        <p>{{ t('localService.desktopOnlyDesc1') }}</p>
        <p>{{ t('localService.desktopOnlyDesc2') }}</p>
      </n-alert>
    </n-card>
  </SettingsPage>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { NIcon } from 'naive-ui'
import {
  RefreshOutline,
  PlayOutline,
  PauseOutline,
  SaveOutline,
  FolderOutline
} from '@vicons/ionicons5'
import { message, dialog } from '@/utils/feedback'
import type { FormRules, FormInst } from 'naive-ui'

import SettingsPage from '@/components/settings/SettingsPage.vue'
import TipLabel from '@/components/settings/TipLabel.vue'
import AppSwitch from '@/components/AppSwitch.vue'
import { useAria2LocalService, type Aria2LocalConfig } from '@/composables/useAria2LocalService'

const { t } = useI18n()
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
  updateConfig
} = useAria2LocalService()

const configFormRef = ref<FormInst | null>(null)
const isRefreshing = ref(false)
const isSavingConfig = ref(false)

// 本地配置表单
const localConfig = reactive<Aria2LocalConfig>({
  port: 0,
  secret: '',
  downloadDir: '',
  autoStart: false
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
    loadCurrentConfig()
    message.success(t('localService.statusRefreshed'))
  } catch (_error) {
    message.error(t('localService.refreshFailed'))
  } finally {
    isRefreshing.value = false
  }
}

// 启动服务
async function startService() {
  const success = await start()
  if (success) {
    loadCurrentConfig()
    message.success(t('localService.serviceStarted'))
  }
}

// 停止服务
async function stopService() {
  const confirmed = await dialog.warning({
    title: t('localService.confirmStopTitle'),
    content: t('localService.confirmStop'),
    positiveText: t('common.ok'),
    negativeText: t('common.cancel')
  })
  if (confirmed !== true) return

  await stop()
}

// 重启服务
async function restartService() {
  const confirmed = await dialog.warning({
    title: t('localService.confirmRestartTitle'),
    content: t('localService.confirmRestart'),
    positiveText: t('common.ok'),
    negativeText: t('common.cancel')
  })
  if (confirmed !== true) return

  await restart()
}

// 保存会话
async function handleSaveSession() {
  if (!window.electronAPI?.saveSession) {
    message.warning(t('localService.desktopOnly'))
    return
  }
  try {
    const result = await window.electronAPI.saveSession()
    if (result.success) {
      message.success(t('settings.engine.sessionSaved'))
    } else {
      message.error(t('settings.engine.sessionSaveFailed', { error: result.error || t('settings.unknownError') }))
    }
  } catch (error) {
    message.error(t('settings.engine.sessionSaveFailed', { error: error instanceof Error ? error.message : t('settings.unknownError') }))
  }
}

// 选择下载目录
async function selectDownloadDir() {
  if (!window.electronAPI) {
    message.error(t('localService.desktopOnly'))
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
    message.error(t('localService.selectDirFailed'))
    console.error('选择目录失败:', error)
  }
}

// 保存配置
async function saveConfig() {
  if (!configFormRef.value) return

  try {
    await configFormRef.value.validate()
  } catch (errors) {
    const msg = Array.isArray(errors) && errors[0]?.message ? errors[0].message : t('localService.configSaveFailed', { error: t('settings.unknownError') })
    message.error(msg)
    return
  }

  isSavingConfig.value = true

  try {
    if (isRunning.value) {
      const confirmed = await dialog.warning({
        title: t('localService.confirmSaveTitle'),
        content: t('localService.confirmSaveRestart'),
        positiveText: t('localService.saveAndRestart'),
        negativeText: t('common.cancel')
      })
      if (confirmed !== true) {
        message.info(t('localService.saveCancelled'))
        return
      }

      const success = await updateConfig(localConfig)
      if (success) {
        message.success(t('localService.configSavedRestarting'))
        await restart()
      }
    } else {
      const success = await updateConfig(localConfig)
      if (success) {
        message.success(t('localService.configSaved'))
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('保存配置失败:', error)

    if (errorMessage.includes('下载目录验证失败')) {
      message.error(t('localService.invalidDir'))
    } else if (errorMessage.includes('启动失败')) {
      message.error(t('localService.restartFailed'))
    } else {
      message.error(t('localService.configSaveFailed', { error: errorMessage }))
    }
  } finally {
    isSavingConfig.value = false
  }
}

// 更新自动启动设置
function updateAutoStart(value: boolean) {
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
  message.success(t('localService.configReset'))
}

// 加载当前配置到表单
function loadCurrentConfig() {
  getStatus().then(() => {
    if (processInfo.value.config) {
      localConfig.port = processInfo.value.config.port
      localConfig.secret = processInfo.value.config.secret
      localConfig.autoStart = processInfo.value.config.autoStart
      localConfig.downloadDir = processInfo.value.config.downloadDir
    } else {
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
    await getStatus()
    loadCurrentConfig()
  }
})
</script>

<style scoped>
.section-card {
  margin-bottom: 16px;
}

.status-content {
  margin-bottom: 16px;
}

.status-row {
  display: flex;
  align-items: center;
  margin-bottom: 10px;
}

.status-label {
  min-width: 100px;
  font-weight: 500;
  color: var(--text-primary);
}

.status-value {
  color: var(--text-regular);
}

.control-buttons {
  padding-top: 16px;
  border-top: 1px solid var(--border-light);
}

.config-actions {
  display: flex;
  justify-content: center;
  gap: 12px;
  padding-top: 8px;
}
</style>
