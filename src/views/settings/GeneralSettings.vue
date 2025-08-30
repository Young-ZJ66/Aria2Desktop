<template>
  <div class="general-settings">
    <div class="settings-header">
      <h2>常规设置</h2>
      <p class="settings-description">配置应用程序的基本行为和外观</p>
    </div>

    <el-form
      ref="formRef"
      :model="form"
      label-width="150px"
      style="max-width: 600px"
      v-loading="settingsStore.isLoading"
    >
      <el-form-item label="语言">
        <el-select v-model="form.language" style="width: 100%" @change="handleLanguageChange">
          <el-option label="简体中文" value="zh-CN" />
          <el-option label="繁体中文" value="zh-TW" />
          <el-option label="English" value="en" />
        </el-select>
      </el-form-item>

      <el-form-item label="主题">
        <el-select v-model="form.theme" style="width: 100%" @change="handleThemeChange">
          <el-option label="浅色主题" value="light" />
          <el-option label="深色主题" value="dark" />
          <el-option label="跟随系统" value="auto" />
        </el-select>
      </el-form-item>

      <el-form-item label="自动刷新间隔">
        <el-select v-model="form.refreshInterval" style="width: 100%" @change="handleRefreshIntervalChange">
          <el-option label="1秒" :value="1000" />
          <el-option label="2秒" :value="2000" />
          <el-option label="5秒" :value="5000" />
          <el-option label="10秒" :value="10000" />
        </el-select>
        <div class="form-tip">设置任务列表和统计信息的自动刷新频率</div>
      </el-form-item>

      <el-form-item label="启动时自动连接">
        <el-switch v-model="form.autoConnect" @change="handleAutoConnectChange" />
        <div class="form-tip">应用启动时自动连接到上次使用的 Aria2 服务器</div>
      </el-form-item>

      <el-form-item label="最小化到系统托盘">
        <el-switch v-model="form.minimizeToTray" @change="handleTraySettingChange" />
        <div class="form-tip">关闭窗口时最小化到系统托盘而不是退出程序</div>
      </el-form-item>

      <el-divider />


      <el-form-item>
        <el-space>
          <el-button @click="resetSettings" :disabled="settingsStore.isLoading">
            重置设置
          </el-button>
          <el-button @click="exportSettings">
            导出设置
          </el-button>
          <el-button @click="showImportDialog = true">
            导入设置
          </el-button>
        </el-space>
      </el-form-item>
    </el-form>

    <!-- 导入设置对话框 -->
    <el-dialog
      v-model="showImportDialog"
      title="导入设置"
      width="500px"
    >
      <el-form>
        <el-form-item label="设置文件">
          <el-input
            v-model="importText"
            type="textarea"
            :rows="10"
            placeholder="请粘贴设置 JSON 内容..."
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="showImportDialog = false">取消</el-button>
        <el-button type="primary" @click="importSettings" :loading="importing">
          导入
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, watch } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance } from 'element-plus'

import { useSettingsStore } from '@/stores/settingsStore'

const settingsStore = useSettingsStore()
const formRef = ref<FormInstance>()
const importing = ref(false)
const showImportDialog = ref(false)
const importText = ref('')


// 表单数据
const form = reactive({
  language: 'zh-CN',
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
    ElMessage.success('刷新间隔已更新')
  } catch (error) {
    console.error('Refresh interval change error:', error)
    ElMessage.error('刷新间隔更新失败：' + (error instanceof Error ? error.message : '未知错误'))
  }
}

// 自动连接变化处理
async function handleAutoConnectChange() {
  try {
    await settingsStore.updateSetting('autoConnect', form.autoConnect)
    ElMessage.success(form.autoConnect ? '已启用启动时自动连接' : '已禁用启动时自动连接')
  } catch (error) {
    console.error('Auto connect change error:', error)
    ElMessage.error('自动连接设置失败：' + (error instanceof Error ? error.message : '未知错误'))
  }
}

async function resetSettings() {
  try {
    await ElMessageBox.confirm(
      '确定要重置所有设置为默认值吗？此操作不可撤销。',
      '确认重置设置',
      {
        confirmButtonText: '确定重置',
        cancelButtonText: '取消',
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

    ElMessage.success('设置已重置为默认值')
  } catch (error) {
    if (error !== 'cancel') {
      console.error('Reset settings error:', error)
      ElMessage.error('重置设置失败：' + (error instanceof Error ? error.message : '未知错误'))
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

    ElMessage.success('设置已导出')
  } catch (error) {
    ElMessage.error('导出设置失败')
  }
}

async function importSettings() {
  if (!importText.value.trim()) {
    ElMessage.warning('请输入设置内容')
    return
  }

  importing.value = true
  try {
    await settingsStore.importSettings(importText.value)
    showImportDialog.value = false
    importText.value = ''
    ElMessage.success('设置已导入')
  } catch (error) {
    ElMessage.error('导入设置失败：' + (error instanceof Error ? error.message : '未知错误'))
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

    ElMessage.success('主题已切换并保存')
  } catch (error) {
    console.error('Theme change error:', error)
    ElMessage.error('主题切换失败：' + (error instanceof Error ? error.message : '未知错误'))
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
      console.log(`窗口主题已更新为: ${isDark ? 'dark' : 'light'}`)
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
    await settingsStore.updateSetting('language', form.language)
    ElMessage.info('语言设置已保存，将在重启应用后生效')
  } catch (error) {
    console.error('Language change error:', error)
    ElMessage.error('语言设置失败：' + (error instanceof Error ? error.message : '未知错误'))
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

    ElMessage.success(form.minimizeToTray ? '已启用系统托盘' : '已禁用系统托盘')
  } catch (error) {
    console.error('Tray setting change error:', error)
    ElMessage.error('托盘设置失败：' + (error instanceof Error ? error.message : '未知错误'))
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

/* 深色主题下的下拉选择框样式 */
[data-theme="dark"] :deep(.el-select .el-input__wrapper) {
  background-color: transparent !important;
  border: 1px solid var(--border-base) !important;
}

[data-theme="dark"] :deep(.el-select .el-input__wrapper:hover) {
  border-color: var(--border-dark) !important;
}

[data-theme="dark"] :deep(.el-select .el-input__wrapper.is-focus) {
  border-color: var(--color-primary) !important;
}

[data-theme="dark"] :deep(.el-select .el-input__inner) {
  color: var(--text-primary) !important;
  background-color: transparent !important;
}

[data-theme="dark"] :deep(.el-select .el-input__suffix) {
  color: var(--text-secondary) !important;
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
</style>
