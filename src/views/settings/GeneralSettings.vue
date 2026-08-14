<template>
  <div class="general-settings settings-page">
    <div class="settings-header">
      <h2>{{ t('generalSettings.title') }}</h2>
      <p class="settings-description">{{ t('generalSettings.description') }}</p>
    </div>

    <el-form
      ref="formRef"
      v-loading="settingsStore.isLoading"
      :model="form"
      label-width="150px"
    >
      <el-form-item :label="t('generalSettings.language')">
        <el-select v-model="form.language" @change="handleLanguageChange">
          <el-option label="简体中文" value="zh-CN" />
          <el-option label="English" value="en-US" />
        </el-select>
      </el-form-item>

      <el-form-item :label="t('generalSettings.theme')">
        <el-select v-model="form.theme" @change="handleThemeChange">
          <el-option :label="t('generalSettings.themeLight')" value="light" />
          <el-option :label="t('generalSettings.themeDark')" value="dark" />
          <el-option :label="t('generalSettings.themeAuto')" value="auto" />
        </el-select>
      </el-form-item>

      <el-form-item :label="t('generalSettings.refreshInterval')">
        <el-select v-model="form.refreshInterval" @change="handleRefreshIntervalChange">
          <el-option :label="t('generalSettings.refreshInterval1s')" :value="1000" />
          <el-option :label="t('generalSettings.refreshInterval2s')" :value="2000" />
          <el-option :label="t('generalSettings.refreshInterval5s')" :value="5000" />
          <el-option :label="t('generalSettings.refreshInterval10s')" :value="10000" />
        </el-select>
        <div class="form-tip">{{ t('generalSettings.refreshIntervalTip') }}</div>
      </el-form-item>

      <el-form-item :label="t('generalSettings.autoConnect')">
        <el-switch v-model="form.autoConnect" @change="handleAutoConnectChange" />
        <div class="form-tip">{{ t('generalSettings.autoConnectTip') }}</div>
      </el-form-item>

      <el-form-item :label="t('generalSettings.minimizeToTray')">
        <el-switch v-model="form.minimizeToTray" @change="handleTraySettingChange" />
        <div class="form-tip">{{ t('generalSettings.minimizeToTrayTip') }}</div>
      </el-form-item>

      <el-divider />


      <el-form-item>
        <el-space>
          <el-button :disabled="settingsStore.isLoading" @click="resetSettings">
            {{ t('generalSettings.resetSettings') }}
          </el-button>
          <el-button @click="exportSettings">
            {{ t('generalSettings.exportSettings') }}
          </el-button>
          <el-button @click="showImportDialog = true">
            {{ t('generalSettings.importSettings') }}
          </el-button>
        </el-space>
      </el-form-item>
    </el-form>

    <!-- 导入设置对话框 -->
    <el-dialog
      v-model="showImportDialog"
      :title="t('generalSettings.importDialogTitle')"
      width="500px"
    >
      <el-form>
        <el-form-item :label="t('generalSettings.settingsFile')">
          <el-input
            v-model="importText"
            type="textarea"
            :rows="10"
            :placeholder="t('generalSettings.importPlaceholder')"
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="showImportDialog = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="importing" @click="importSettings">
          {{ t('generalSettings.importButton') }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox, type FormInstance } from 'element-plus'

import { useSettingsStore } from '@/stores/settingsStore'
import { setLocale, type AppLocale } from '@/i18n'

const settingsStore = useSettingsStore()
const { t } = useI18n()
const formRef = ref<FormInstance>()
const importing = ref(false)
const showImportDialog = ref(false)
const importText = ref('')


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
    ElMessage.success(t('generalSettings.refreshIntervalUpdated'))
  } catch (error) {
    console.error('Refresh interval change error:', error)
    ElMessage.error(t('generalSettings.refreshIntervalUpdateFailed', { error: error instanceof Error ? error.message : t('settings.unknownError') }))
  }
}

// 自动连接变化处理
async function handleAutoConnectChange() {
  try {
    await settingsStore.updateSetting('autoConnect', form.autoConnect)
    ElMessage.success(form.autoConnect ? t('generalSettings.autoConnectEnabled') : t('generalSettings.autoConnectDisabled'))
  } catch (error) {
    console.error('Auto connect change error:', error)
    ElMessage.error(t('generalSettings.autoConnectFailed', { error: error instanceof Error ? error.message : t('settings.unknownError') }))
  }
}

async function resetSettings() {
  try {
    await ElMessageBox.confirm(
      t('generalSettings.resetConfirmMsg'),
      t('generalSettings.resetConfirmTitle'),
      {
        confirmButtonText: t('generalSettings.resetConfirmBtn'),
        cancelButtonText: t('common.cancel'),
        type: 'warning'
      }
    )

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

    ElMessage.success(t('generalSettings.resetDone'))
  } catch (error) {
    if (error !== 'cancel') {
      console.error('Reset settings error:', error)
      ElMessage.error(t('generalSettings.resetFailed', { error: error instanceof Error ? error.message : t('settings.unknownError') }))
    }
  }
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

    ElMessage.success(t('generalSettings.exportDone'))
  } catch (_error) {
    ElMessage.error(t('generalSettings.exportFailed'))
  }
}

async function importSettings() {
  if (!importText.value.trim()) {
    ElMessage.warning(t('generalSettings.importEmpty'))
    return
  }

  importing.value = true
  try {
    await settingsStore.importSettings(importText.value)
    showImportDialog.value = false
    importText.value = ''
    ElMessage.success(t('generalSettings.importDone'))
  } catch (error) {
    ElMessage.error(t('generalSettings.importFailed', { error: error instanceof Error ? error.message : t('settings.unknownError') }))
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

    ElMessage.success(t('generalSettings.themeSwitched'))
  } catch (error) {
    console.error('Theme change error:', error)
    ElMessage.error(t('generalSettings.themeSwitchFailed', { error: error instanceof Error ? error.message : t('settings.unknownError') }))
  }
}

// 直接应用主题的辅助函数
async function applyThemeDirectly(theme: 'light' | 'dark' | 'auto') {
  const isDark = theme === 'dark' ||
    (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  document.documentElement.classList.toggle('dark', isDark)
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light')

  // {{ AURA: Add - 通知 Electron 主进程更新窗口主题 }}
  if (window.electronAPI?.setWindowTheme) {
    try {
      await window.electronAPI.setWindowTheme(isDark)
      console.warn(`窗口主题已更新为: ${isDark ? 'dark' : 'light'}`)
    } catch (error) {
      console.error('更新窗口主题失败:', error)
    }
  }

  // 如果是自动模式，监听系统主题变化
  if (theme === 'auto') {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => {
      if (settingsStore.settings.theme === 'auto') {
        settingsStore.applyTheme()
      }
    }

    // 移除之前的监听器（如果存在）
    mediaQuery.removeEventListener('change', handleChange)
    // 添加新的监听器
    mediaQuery.addEventListener('change', handleChange)
  }
}

async function handleLanguageChange() {
  try {
    // 立即切换 i18n 语言
    setLocale(form.language as AppLocale)

    // 保存设置
    await settingsStore.updateSetting('language', form.language)

    ElMessage.info(t('generalSettings.languageSaved'))
  } catch (error) {
    console.error('Language change error:', error)
    ElMessage.error(t('generalSettings.languageFailed', { error: error instanceof Error ? error.message : t('settings.unknownError') }))
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

    ElMessage.success(form.minimizeToTray ? t('generalSettings.trayEnabled') : t('generalSettings.trayDisabled'))
  } catch (error) {
    console.error('Tray setting change error:', error)
    ElMessage.error(t('generalSettings.trayFailed', { error: error instanceof Error ? error.message : t('settings.unknownError') }))
  }
}
</script>

<style scoped>
.general-settings {
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

/* 使用全局 .form-tip 样式 */

:deep(.el-divider) {
  margin: 24px 0;
}

/* 深色主题下的输入框/下拉选择框样式已统一在 theme.css 中 */
</style>
