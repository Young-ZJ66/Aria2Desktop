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
        <el-select v-model="form.refreshInterval" style="width: 100%">
          <el-option label="1秒" :value="1000" />
          <el-option label="2秒" :value="2000" />
          <el-option label="5秒" :value="5000" />
          <el-option label="10秒" :value="10000" />
        </el-select>
        <div class="form-tip">设置任务列表和统计信息的自动刷新频率</div>
      </el-form-item>

      <el-form-item label="启动时自动连接">
        <el-switch v-model="form.autoConnect" />
        <div class="form-tip">应用启动时自动连接到上次使用的 Aria2 服务器</div>
      </el-form-item>

      <el-form-item label="最小化到系统托盘">
        <el-switch v-model="form.minimizeToTray" />
        <div class="form-tip">关闭窗口时最小化到系统托盘而不是退出程序</div>
      </el-form-item>

      <el-divider />

      <el-form-item label="界面设置">
        <el-space direction="vertical" style="width: 100%">
          <el-checkbox v-model="form.ui.showStatusBar">显示状态栏</el-checkbox>
          <el-checkbox v-model="form.ui.showToolbar">显示工具栏</el-checkbox>
        </el-space>
      </el-form-item>

      <el-form-item label="默认视图">
        <el-radio-group v-model="form.ui.defaultView">
          <el-radio label="downloading">正在下载</el-radio>
          <el-radio label="waiting">等待中</el-radio>
          <el-radio label="stopped">已完成</el-radio>
        </el-radio-group>
      </el-form-item>

      <el-divider />

      <el-form-item>
        <el-space>
          <el-button type="primary" @click="saveSettings" :loading="saving">
            保存设置
          </el-button>
          <el-button @click="resetSettings" :disabled="settingsStore.isLoading">
            重置为默认
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
const saving = ref(false)
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

onMounted(async () => {
  await settingsStore.initialize()
})

async function saveSettings() {
  saving.value = true
  try {
    // 创建纯 JavaScript 对象，避免 Vue 响应式对象的序列化问题
    const allSettings = {
      language: form.language,
      theme: form.theme,
      refreshInterval: form.refreshInterval,
      autoConnect: form.autoConnect,
      minimizeToTray: form.minimizeToTray,
      ui: {
        showStatusBar: form.ui.showStatusBar,
        showToolbar: form.ui.showToolbar,
        taskListColumns: [...form.ui.taskListColumns],
        defaultView: form.ui.defaultView
      }
    }

    await settingsStore.updateSettings(allSettings)
    ElMessage.success('设置已保存')
  } catch (error) {
    console.error('Save settings error:', error)
    ElMessage.error('保存设置失败：' + (error instanceof Error ? error.message : '未知错误'))
  } finally {
    saving.value = false
  }
}

async function resetSettings() {
  try {
    await ElMessageBox.confirm(
      '确定要重置所有设置为默认值吗？此操作不可撤销。',
      '确认重置',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )

    await settingsStore.resetSettings()
    ElMessage.success('设置已重置为默认值')
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error('重置设置失败')
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

function handleThemeChange() {
  settingsStore.applyTheme()
}

function handleLanguageChange() {
  ElMessage.info('语言设置将在重启应用后生效')
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
  color: #909399;
  font-size: 14px;
}

.form-tip {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
  line-height: 1.4;
}

:deep(.el-divider) {
  margin: 24px 0;
}
</style>
