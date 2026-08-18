<template>
  <SettingsPage
    :title="t('generalSettings.title')"
    :description="t('generalSettings.description')"
  >
    <!-- 通用设置 -->
    <n-card :title="t('generalSettings.groupGeneral')" class="setting-group">
      <n-form
        :model="form"
        label-placement="left"
        :label-width="180"
        label-align="left"
        :show-feedback="false"
        class="general-form"
      >
        <n-form-item>
          <template #label>
            <TipLabel :label="t('generalSettings.language')" />
          </template>
          <n-select
            v-model:value="form.language"
            :options="languageOptions"
            @update:value="handleLanguageChange"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('generalSettings.theme')" />
          </template>
          <n-select
            v-model:value="form.theme"
            :options="themeOptions"
            @update:value="handleThemeChange"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('generalSettings.refreshInterval')" :tip="t('generalSettings.refreshIntervalTip')" />
          </template>
          <n-select
            v-model:value="form.refreshInterval"
            :options="refreshIntervalOptions"
            @update:value="handleRefreshIntervalChange"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('generalSettings.autoConnect')" :tip="t('generalSettings.autoConnectTip')" />
          </template>
          <AppSwitch
            v-model:value="form.autoConnect"
            @update:value="handleAutoConnectChange"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('generalSettings.minimizeToTray')" :tip="t('generalSettings.minimizeToTrayTip')" />
          </template>
          <AppSwitch
            v-model:value="form.minimizeToTray"
            @update:value="handleTraySettingChange"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('generalSettings.autoLaunch')" :tip="t('generalSettings.autoLaunchTip')" />
          </template>
          <AppSwitch
            v-model:value="form.autoLaunch"
            :disabled="!isElectronAvailable"
            @update:value="handleAutoLaunchChange"
          />
        </n-form-item>

        <n-form-item>
          <template #label>
            <TipLabel :label="t('generalSettings.checkForUpdates')" :tip="t('generalSettings.updateCheckTooltip')" />
          </template>
          <div class="update-section">
            <div class="update-control">
              <n-button
                size="small"
                :type="updateState === 'downloaded' ? 'primary' : 'default'"
                :loading="updating"
                :disabled="!isElectronAvailable || updateState === 'downloading'"
                @click="handleUpdateAction"
              >
                <template #icon>
                  <n-icon><RefreshOutline /></n-icon>
                </template>
                {{ updateState === 'downloaded' ? t('generalSettings.restartToUpdate') : t('generalSettings.checkForUpdates') }}
              </n-button>
              <n-tag
                v-if="updateState && updateState !== 'idle' && updateState !== 'error'"
                :type="updateTagType"
                size="small"
                :bordered="false"
                round
              >
                {{ updateStatusText }}
              </n-tag>
            </div>
            <div class="current-version">
              {{ t('generalSettings.currentVersion', { version: currentVersion || '—' }) }}
            </div>
          </div>
        </n-form-item>
      </n-form>
    </n-card>

    <!-- 重置与备份 -->
    <n-card :title="t('generalSettings.groupResetBackup')" class="setting-group">
      <div class="backup-actions">
        <n-tooltip trigger="hover">
          <template #trigger>
            <n-button :disabled="settingsStore.isLoading" @click="resetSettings">
              {{ t('generalSettings.resetSettings') }}
            </n-button>
          </template>
          {{ t('generalSettings.resetSettingsTip') }}
        </n-tooltip>
        <n-button @click="exportSettings">
          {{ t('generalSettings.backupSettings') }}
        </n-button>
        <n-button @click="openImportDialog">
          {{ t('generalSettings.importSettings') }}
        </n-button>
      </div>
    </n-card>

    <!-- 导入设置对话框 -->
    <n-modal
      v-model:show="showImportDialog"
      preset="card"
      :title="t('generalSettings.importDialogTitle')"
      style="width: 540px"
    >
      <n-form>
        <n-form-item :label="t('generalSettings.settingsFile')">
          <n-input-group>
            <n-input
              :value="selectedFileName"
              :placeholder="t('generalSettings.selectFilePlaceholder')"
              readonly
            />
            <n-button @click="selectImportFile">
              <template #icon>
                <n-icon><FolderOpenOutline /></n-icon>
              </template>
              {{ t('generalSettings.selectFile') }}
            </n-button>
          </n-input-group>
        </n-form-item>
        <n-form-item :label="t('generalSettings.fileContent')">
          <n-input
            v-model:value="importText"
            type="textarea"
            :rows="10"
            :placeholder="t('generalSettings.importPlaceholder')"
          />
        </n-form-item>
      </n-form>

      <template #footer>
        <n-space justify="end">
          <n-button @click="showImportDialog = false">{{ t('common.cancel') }}</n-button>
          <n-button type="primary" :loading="importing" @click="importSettings">
            {{ t('generalSettings.importButton') }}
          </n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- 隐藏的文件选择器 -->
    <input
      ref="fileInputRef"
      type="file"
      accept=".json,application/json"
      class="hidden-file-input"
      @change="handleFileSelected"
    />
  </SettingsPage>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { FolderOpenOutline, RefreshOutline } from '@vicons/ionicons5'
import { message, confirm } from '@/utils/feedback'
import type { UpdateStatus } from '@/types/electron'

import SettingsPage from '@/components/settings/SettingsPage.vue'
import TipLabel from '@/components/settings/TipLabel.vue'
import AppSwitch from '@/components/AppSwitch.vue'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'
import { setLocale, type AppLocale } from '@/i18n'

const settingsStore = useSettingsStore()
const uiStore = useUiStore()
const { t } = useI18n()
const importing = ref(false)
const showImportDialog = ref(false)
const importText = ref('')
const selectedFileName = ref('')
const fileInputRef = ref<HTMLInputElement | null>(null)

// Electron 环境可用性
const isElectronAvailable = !!window.electronAPI

// 表单数据
const form = reactive({
  language: 'zh-CN' as 'zh-CN' | 'en-US',
  theme: 'light' as 'light' | 'dark' | 'auto',
  refreshInterval: 1000,
  autoConnect: true,
  minimizeToTray: true,
  autoLaunch: false
})

// 自动更新状态
const updating = ref(false)
const updateState = ref<'idle' | UpdateStatus['state']>('idle')
const updateVersion = ref('')
const updatePercent = ref(0)
const currentVersion = ref('')

const updateTagType = computed<'info' | 'success' | 'warning'>(() => {
  switch (updateState.value) {
    case 'available':
    case 'downloading':
      return 'info'
    case 'downloaded':
      return 'success'
    case 'not-available':
      return 'success'
    default:
      return 'info'
  }
})

const updateStatusText = computed(() => {
  switch (updateState.value) {
    case 'checking':
      return t('generalSettings.checkingForUpdates')
    case 'available':
      return t('generalSettings.updateAvailable', { version: updateVersion.value })
    case 'not-available':
      return t('generalSettings.updateNotAvailable')
    case 'downloading':
      return t('generalSettings.updateDownloading', { percent: Math.round(updatePercent.value) })
    case 'downloaded':
      return t('generalSettings.updateDownloaded')
    default:
      return ''
  }
})

const languageOptions = [
  { label: '简体中文', value: 'zh-CN' },
  { label: 'English', value: 'en-US' }
]

// 选项标签跟随语言实时切换，避免切换语言后下拉框文案不更新
const themeOptions = computed(() => [
  { label: t('generalSettings.themeLight'), value: 'light' },
  { label: t('generalSettings.themeDark'), value: 'dark' },
  { label: t('generalSettings.themeAuto'), value: 'auto' }
])

const refreshIntervalOptions = computed(() => [
  { label: t('generalSettings.refreshInterval1s'), value: 1000 },
  { label: t('generalSettings.refreshInterval2s'), value: 2000 },
  { label: t('generalSettings.refreshInterval5s'), value: 5000 },
  { label: t('generalSettings.refreshInterval10s'), value: 10000 }
])

// 监听设置变化
watch(() => settingsStore.settings, (newSettings) => {
  Object.assign(form, {
    language: newSettings.language,
    theme: newSettings.theme,
    refreshInterval: newSettings.refreshInterval,
    autoConnect: newSettings.autoConnect,
    minimizeToTray: newSettings.minimizeToTray,
    autoLaunch: newSettings.autoLaunch
  })
}, { immediate: true, deep: true })

// 加载表单数据
function loadFormData() {
  Object.assign(form, {
    language: settingsStore.settings.language,
    theme: settingsStore.settings.theme,
    refreshInterval: settingsStore.settings.refreshInterval,
    autoConnect: settingsStore.settings.autoConnect,
    minimizeToTray: settingsStore.settings.minimizeToTray,
    autoLaunch: settingsStore.settings.autoLaunch
  })
}

// 监听主进程推送的更新状态
let unsubscribeUpdateStatus: (() => void) | null = null

onMounted(async () => {
  await settingsStore.initialize()

  // 获取当前应用版本
  if (window.electronAPI?.getAppVersion) {
    try {
      currentVersion.value = await window.electronAPI.getAppVersion()
    } catch (error) {
      console.warn('Failed to get app version:', error)
    }
  }

  // 同步系统实际的开机自启状态，避免设置与系统不一致
  if (window.electronAPI?.getAutoLaunch) {
    try {
      const result = await window.electronAPI.getAutoLaunch()
      if (result && result.success) {
        form.autoLaunch = result.enabled ?? form.autoLaunch
      }
    } catch (error) {
      console.warn('Failed to get auto launch state:', error)
    }
  }

  // 注册更新状态监听
  if (window.electronAPI?.onUpdateStatus) {
    unsubscribeUpdateStatus = window.electronAPI.onUpdateStatus((status: UpdateStatus) => {
      if (status.state === 'error') {
        // 网络错误等问题静默视为已是最新版本，不提示用户更新出错
        updateState.value = 'not-available'
        updating.value = false
        return
      }
      updateState.value = status.state
      updateVersion.value = status.version ?? ''
      if (typeof status.percent === 'number') {
        updatePercent.value = status.percent
      }
      if (status.state === 'not-available') {
        updating.value = false
      }
    })
  }
})

// 关闭更新弹窗（点击"稍后"）时清理设置页的更新状态，
// 避免残留"正在下载"等提示，或卡在加载态
watch(() => uiStore.showUpdateDialog, (show) => {
  if (!show && updateState.value !== 'idle') {
    updateState.value = 'idle'
    updateVersion.value = ''
    updating.value = false
  }
})

onUnmounted(() => {
  unsubscribeUpdateStatus?.()
})

// 自动刷新间隔变化处理
async function handleRefreshIntervalChange() {
  try {
    await settingsStore.updateSetting('refreshInterval', form.refreshInterval)
    message.success(t('generalSettings.refreshIntervalUpdated'))
  } catch (error) {
    console.error('Refresh interval change error:', error)
    message.error(t('generalSettings.refreshIntervalUpdateFailed', { error: error instanceof Error ? error.message : t('settings.unknownError') }))
  }
}

// 自动连接变化处理
async function handleAutoConnectChange() {
  try {
    await settingsStore.updateSetting('autoConnect', form.autoConnect)
    message.success(form.autoConnect ? t('generalSettings.autoConnectEnabled') : t('generalSettings.autoConnectDisabled'))
  } catch (error) {
    console.error('Auto connect change error:', error)
    message.error(t('generalSettings.autoConnectFailed', { error: error instanceof Error ? error.message : t('settings.unknownError') }))
  }
}

async function resetSettings() {
  confirm({
    title: t('generalSettings.resetConfirmTitle'),
    content: t('generalSettings.resetConfirmMsg'),
    positiveText: t('generalSettings.resetConfirmBtn'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      try {
        // 重置设置到默认值
        await settingsStore.resetSettings()

        // 重新加载表单数据
        loadFormData()

        // 应用主题（因为主题可能被重置了）
        settingsStore.applyTheme()

        // 控制托盘（根据重置后的设置）
        if (window.electronAPI?.setTrayEnabled) {
          await window.electronAPI.setTrayEnabled(settingsStore.settings.minimizeToTray)
        }

        // 同步开机自启（重置后默认关闭）
        if (window.electronAPI?.setAutoLaunch) {
          await window.electronAPI.setAutoLaunch(settingsStore.settings.autoLaunch)
        }

        message.success(t('generalSettings.resetDone'))
      } catch (error) {
        console.error('Reset settings error:', error)
        message.error(t('generalSettings.resetFailed', { error: error instanceof Error ? error.message : t('settings.unknownError') }))
      }
    }
  })
}

function exportSettings() {
  try {
    const settingsJson = settingsStore.exportSettings()

    // 创建下载链接
    const blob = new Blob([settingsJson], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `aria2-desktop-settings-${new Date().toISOString().split('T')[0]}.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)

    message.success(t('generalSettings.exportDone'))
  } catch (_error) {
    message.error(t('generalSettings.exportFailed'))
  }
}

// 打开导入对话框（清空上一次选择）
function openImportDialog() {
  selectedFileName.value = ''
  importText.value = ''
  showImportDialog.value = true
}

// 触发文件选择
function selectImportFile() {
  fileInputRef.value?.click()
}

// 读取选中的设置文件内容
function handleFileSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  const reader = new FileReader()
  reader.onload = () => {
    importText.value = String(reader.result ?? '')
    selectedFileName.value = file.name
  }
  reader.readAsText(file)
  // 允许重复选择同一个文件
  input.value = ''
}

async function importSettings() {
  if (!importText.value.trim()) {
    message.warning(t('generalSettings.importEmpty'))
    return
  }

  importing.value = true
  try {
    await settingsStore.importSettings(importText.value)
    showImportDialog.value = false
    importText.value = ''
    message.success(t('generalSettings.importDone'))
  } catch (error) {
    message.error(t('generalSettings.importFailed', { error: error instanceof Error ? error.message : t('settings.unknownError') }))
  } finally {
    importing.value = false
  }
}

async function handleThemeChange() {
  try {
    // 立即应用主题（直接使用当前选择的主题值）
    await applyThemeDirectly(form.theme)

    // 保存主题设置
    await settingsStore.updateSetting('theme', form.theme)

    message.success(t('generalSettings.themeSwitched'))
  } catch (error) {
    console.error('Theme change error:', error)
    message.error(t('generalSettings.themeSwitchFailed', { error: error instanceof Error ? error.message : t('settings.unknownError') }))
  }
}

// 直接应用主题的辅助函数
async function applyThemeDirectly(theme: 'light' | 'dark' | 'auto') {
  const isDark = theme === 'dark' ||
    (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  document.documentElement.classList.toggle('dark', isDark)
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light')

  // 通知 Electron 主进程更新窗口主题
  if (window.electronAPI?.setWindowTheme) {
    try {
      await window.electronAPI.setWindowTheme(isDark)
    } catch (error) {
      console.error('更新窗口主题失败:', error)
    }
  }

  // 自动模式的系统主题监听由 settingsStore.applyTheme 统一管理（稳定引用，只注册一次）
  if (theme === 'auto') {
    await settingsStore.applyTheme()
  }
}

async function handleLanguageChange() {
  try {
    // 立即切换 i18n 语言
    setLocale(form.language as AppLocale)

    // 保存设置
    await settingsStore.updateSetting('language', form.language)

    const langName = languageOptions.find(o => o.value === form.language)?.label ?? form.language
    message.info(t('generalSettings.languageSwitched', { language: langName }))
  } catch (error) {
    console.error('Language change error:', error)
    message.error(t('generalSettings.languageFailed', { error: error instanceof Error ? error.message : t('settings.unknownError') }))
  }
}

async function handleTraySettingChange() {
  try {
    // 立即控制托盘的创建/销毁
    if (window.electronAPI?.setTrayEnabled) {
      await window.electronAPI.setTrayEnabled(form.minimizeToTray)
    }

    // 自动保存设置
    await settingsStore.updateSetting('minimizeToTray', form.minimizeToTray)

    message.success(form.minimizeToTray ? t('generalSettings.trayEnabled') : t('generalSettings.trayDisabled'))
  } catch (error) {
    console.error('Tray setting change error:', error)
    message.error(t('generalSettings.trayFailed', { error: error instanceof Error ? error.message : t('settings.unknownError') }))
  }
}

// 开机自启变化处理
async function handleAutoLaunchChange() {
  try {
    // 调用主进程设置开机自启（返回实际状态）
    const result = await window.electronAPI?.setAutoLaunch(form.autoLaunch)
    if (result && result.success) {
      // 同步实际状态
      form.autoLaunch = result.enabled ?? form.autoLaunch
      await settingsStore.updateSetting('autoLaunch', form.autoLaunch)
      message.success(form.autoLaunch ? t('generalSettings.autoLaunchEnabled') : t('generalSettings.autoLaunchDisabled'))
    } else {
      throw new Error(result?.error || 'Unknown error')
    }
  } catch (error) {
    console.error('Auto launch change error:', error)
    // 恢复开关状态
    form.autoLaunch = settingsStore.settings.autoLaunch
    message.error(t('generalSettings.autoLaunchFailed', { error: error instanceof Error ? error.message : t('settings.unknownError') }))
  }
}

// 检查更新：发现新版本时不自动下载，弹窗展示更新日志（与启动检查行为一致）
async function checkForUpdates() {
  if (!window.electronAPI?.checkForUpdates) return
  // 防止检查进行中重复点击导致状态错乱
  if (updating.value) return
  updating.value = true
  updateState.value = 'checking'
  try {
    const result = await window.electronAPI.checkForUpdates()
    if (result.success && result.hasUpdate) {
      updateState.value = 'available'
      updateVersion.value = result.version ?? ''
      uiStore.openUpdateDialog({
        version: result.version || '',
        notes: result.notes,
        state: result.alreadyDownloaded ? 'downloaded' : 'prompt'
      })
    } else {
      // 无新版本或网络错误：统一静默提示已是最新版本
      updateState.value = 'not-available'
    }
  } catch (_error) {
    updateState.value = 'not-available'
  } finally {
    updating.value = false
  }
}

// 更新动作：下载完成后按钮变为"重启更新"
function handleUpdateAction() {
  if (updateState.value === 'downloaded') {
    restartAndInstall()
  } else {
    checkForUpdates()
  }
}

// 重启更新：启动安装程序并退出应用
async function restartAndInstall() {
  const result = await window.electronAPI?.restartAndInstall?.()
  if (result && !result.success) {
    message.error(t('generalSettings.updateError', { error: result.error || t('settings.unknownError') }))
  }
}
</script>

<style scoped>
.setting-group {
  margin-bottom: 16px;
}

.general-form {
  max-width: 720px;
}

.backup-actions {
  display: flex;
  gap: 12px;
}

.update-section {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  width: 100%;
}

.update-control {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.current-version {
  font-size: 12px;
  color: var(--text-tertiary, #999);
  user-select: text;
}

.hidden-file-input {
  display: none;
}
</style>
