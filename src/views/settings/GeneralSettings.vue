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
import { ref, reactive, onMounted, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { NIcon } from 'naive-ui'
import { FolderOpenOutline } from '@vicons/ionicons5'
import { message, dialog } from '@/utils/feedback'

import SettingsPage from '@/components/settings/SettingsPage.vue'
import TipLabel from '@/components/settings/TipLabel.vue'
import AppSwitch from '@/components/AppSwitch.vue'
import { useSettingsStore } from '@/stores/settingsStore'
import { setLocale, type AppLocale } from '@/i18n'

const settingsStore = useSettingsStore()
const { t } = useI18n()
const importing = ref(false)
const showImportDialog = ref(false)
const importText = ref('')
const selectedFileName = ref('')
const fileInputRef = ref<HTMLInputElement | null>(null)

// 表单数据
const form = reactive({
  language: 'zh-CN' as 'zh-CN' | 'en-US',
  theme: 'light' as 'light' | 'dark' | 'auto',
  refreshInterval: 1000,
  autoConnect: true,
  minimizeToTray: true,
  ui: {
    showStatusBar: true,
    showToolbar: true,
    taskListColumns: ['name', 'size', 'progress', 'status', 'speed'],
    defaultView: 'downloading' as 'downloading' | 'waiting' | 'stopped'
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
    ui: { ...newSettings.ui }
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
    ui: { ...settingsStore.settings.ui }
  })
}

onMounted(async () => {
  await settingsStore.initialize()
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
  dialog.warning({
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

.hidden-file-input {
  display: none;
}
</style>
