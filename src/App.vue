<template>
  <n-config-provider :theme="currentTheme" :theme-overrides="themeOverrides" :locale="naiveLocale">
    <n-message-provider placement="top">
      <n-dialog-provider>
        <n-notification-provider placement="bottom-right">
          <div class="app-container" :class="{ 'windows-titlebar': isWindowsPlatform }">
            <!-- 主要内容区域 -->
            <div class="main-container">
              <!-- 侧边栏 -->
              <AppSidebar />

              <!-- 内容区域 -->
              <div class="content-container">
                <router-view />
              </div>
            </div>

            <!-- 底部状态栏 -->
            <AppFooter />

            <!-- 全局连接对话框（唯一实例，左下角连接按钮通过 store 控制显示） -->
            <ConnectionDialog v-model="connectionStore.showConnectionDialog" />

            <!-- 全局新建下载弹窗 -->
            <NewTaskDialog />

            <!-- 全局设置弹窗（左下角设置按钮打开） -->
            <SettingsDialog />

            <!-- 全局任务详情抽屉 -->
            <TaskDetailDrawer />

            <!-- 启动时发现新版本弹窗 -->
            <n-modal
              v-model:show="updateDialogVisible"
              preset="card"
              :title="t('generalSettings.startupUpdatePrompt', { version: updateVersion })"
              style="width: 480px"
            >
              <div class="update-dialog">
                <template v-if="updateDialogState === 'prompt'">
                  <div v-if="updateNotes" class="update-notes">
                    <div class="update-notes-title">{{ t('generalSettings.updateNotesTitle') }}</div>
                    <pre class="update-notes-body">{{ updateNotes }}</pre>
                  </div>
                  <div class="update-dialog-actions">
                    <n-button @click="updateDialogVisible = false">{{ t('generalSettings.updateLater') }}</n-button>
                    <n-button type="primary" @click="startUpdateDownload">{{ t('generalSettings.updateNow') }}</n-button>
                  </div>
                </template>
                <template v-else-if="updateDialogState === 'downloading'">
                  <n-progress type="line" :percentage="updatePercent" :show-indicator="true" />
                  <div class="update-downloading-text">
                    {{ t('generalSettings.updateDownloading', { percent: updatePercent }) }}
                  </div>
                </template>
                <template v-else>
                  <div class="update-downloaded-text">{{ t('generalSettings.updateDownloaded') }}</div>
                  <div class="update-dialog-actions">
                    <n-button @click="updateDialogVisible = false">{{ t('generalSettings.updateLater') }}</n-button>
                    <n-button type="primary" @click="restartToUpdate">{{ t('generalSettings.restartToUpdate') }}</n-button>
                  </div>
                </template>
              </div>
            </n-modal>
          </div>
        </n-notification-provider>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  darkTheme,
  zhCN,
  dateZhCN,
  enUS,
  dateEnUS,
  type GlobalThemeOverrides
} from 'naive-ui'
import { useConnectionStore } from '@/stores/connectionStore'
import { useStatsStore } from '@/stores/statsStore'
import { useTaskStore } from '@/stores/taskStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { setLocale, getLocale, type AppLocale } from '@/i18n'
import { useI18n } from 'vue-i18n'
import { message } from '@/utils/feedback'
import { useTrafficMonitor } from '@/composables/useTrafficMonitor'
import { initLocalService } from '@/composables/useAria2LocalService'
import type { UpdateStatus } from '@/types/electron'
import AppSidebar from '@/components/layout/AppSidebar.vue'
import AppFooter from '@/components/layout/AppFooter.vue'
import ConnectionDialog from '@/components/dialogs/ConnectionDialog.vue'
import NewTaskDialog from '@/components/dialogs/NewTaskDialog.vue'
import SettingsDialog from '@/components/dialogs/SettingsDialog.vue'
import TaskDetailDrawer from '@/components/dialogs/TaskDetailDrawer.vue'

const connectionStore = useConnectionStore()
const statsStore = useStatsStore()
const taskStore = useTaskStore()
const settingsStore = useSettingsStore()
const trafficMonitor = useTrafficMonitor()
const { t } = useI18n()

// 启动更新弹窗状态
const updateDialogVisible = ref(false)
const updateDialogState = ref<'prompt' | 'downloading' | 'downloaded'>('prompt')
const updateVersion = ref('')
const updateNotes = ref('')
const updatePercent = ref(0)
let unsubscribeStartupUpdate: (() => void) | null = null

// 检测是否为 Windows 平台以调整标题栏布局
const isWindowsPlatform = computed(() => {
  if (typeof window === 'undefined') return false
  const platform = window.electronAPI?.platform
  if (platform) return platform === 'win32'
  return navigator.userAgent.toLowerCase().includes('win')
})

// Naive UI 主题（跟随 data-theme）
const isDark = computed(() => {
  const theme = settingsStore.settings.theme
  if (theme === 'dark') return true
  if (theme === 'light') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
})
const currentTheme = computed(() => (isDark.value ? darkTheme : null))

// 主题覆盖：主色与圆角
// 注意：Naive UI 内部会解析主题色（如计算 hover/按下等衍生色），必须传入具体的可解析色值，
// 不能使用 var(--xxx) 这类 CSS 变量，否则 seemly/rgba 解析会抛错导致渲染崩溃。
const themeOverrides = computed<GlobalThemeOverrides>(() => ({
  common: {
    primaryColor: isDark.value ? '#6c86f5' : '#4f6ef2',
    primaryColorHover: isDark.value ? '#8499f7' : '#6279f4',
    primaryColorPressed: isDark.value ? '#5465d8' : '#3d56d0',
    primaryColorSuppl: isDark.value ? '#6c86f5' : '#4f6ef2',
    borderRadius: '8px'
  },
  Card: {
    borderRadius: '10px'
  }
}))

const naiveLocale = computed(() => (getLocale() === 'zh-CN' ? zhCN : enUS))
const naiveDateLocale = computed(() => (getLocale() === 'zh-CN' ? dateZhCN : dateEnUS))

let updateInterval: ReturnType<typeof setInterval> | null = null

function startAutoUpdate(interval = 1000) {
  stopAutoUpdate()
  updateInterval = setInterval(() => {
    if (connectionStore.isConnected) {
      statsStore.loadGlobalStat()
      taskStore.loadAllTasks()
    }
  }, interval)
}

function stopAutoUpdate() {
  if (updateInterval) {
    clearInterval(updateInterval)
    updateInterval = null
  }
}

// 连接状态统一管理自动刷新：无论自动连接还是手动连接，连接成功即启动刷新
watch(() => connectionStore.isConnected, (connected) => {
  if (connected) {
    startAutoUpdate(settingsStore.getSetting('refreshInterval'))
    // 连接成功后立即加载一次数据
    statsStore.loadGlobalStat()
    statsStore.loadVersion()
    // 全局配置缓存由 connectionStore.connect 连接成功后预热，设置页直接使用缓存，避免切换页面时重复请求闪烁
    taskStore.loadAllTasks()
    // 后台持续采集流量数据（不依赖状态页是否打开）
    trafficMonitor.startMonitor()
  } else {
    stopAutoUpdate()
    trafficMonitor.stopMonitor()
  }
})

// 连接成功时自动关闭对话框（处理启动时竞态导致的对话框未关闭问题）
watch(() => connectionStore.isConnected, (connected) => {
  if (connected) {
    connectionStore.showConnectionDialog = false
  }
})

let unsubscribeConfig: (() => void) | null = null

onMounted(async () => {
  // 初始化设置
  await settingsStore.initialize()

  // 同步语言设置到 i18n
  const savedLang = settingsStore.getSetting('language') as string
  if (savedLang === 'zh-CN' || savedLang === 'en-US') {
    setLocale(savedLang as AppLocale)
  }

  // 应用主题
  settingsStore.applyTheme()

  // 后台预加载本地引擎状态（让设置页直接渲染最新状态，避免闪烁）
  initLocalService()

  // 加载多连接配置预设（在自动连接之前）
  connectionStore.loadProfiles()

  // Listen for config changes from main process (hot-reload)
  if (window.electronAPI) {
    unsubscribeConfig = window.electronAPI.onConfigChanged((data: { key: string; value: unknown }) => {
      if (data.key === 'theme') {
        // Update theme setting and apply
        settingsStore.updateSetting('theme', data.value as 'light' | 'dark' | 'auto').then(() => {
          settingsStore.applyTheme()
        })
      } else if (data.key === 'refreshInterval') {
        // Update refresh interval
        stopAutoUpdate()
        if (connectionStore.isConnected) {
          startAutoUpdate(Number(data.value))
        }
      }
    })
  }

  // 如果启用了自动连接，尝试连接（使用当前激活的配置预设）
  if (settingsStore.getSetting('autoConnect')) {
    try {
      await connectionStore.connect()
    } catch (error) {
      console.error('Auto connection failed:', error)
      connectionStore.showConnectionDialog = true
    }
  }

  // 启动时后台检查更新（有新版则弹窗提醒）
  if (window.electronAPI?.checkUpdatesOnStartup) {
    try {
      const result = await window.electronAPI.checkUpdatesOnStartup()
      if (result?.success && result.hasUpdate) {
        updateVersion.value = result.version || ''
        updateNotes.value = result.notes || ''
        updateDialogState.value = 'prompt'
        updateDialogVisible.value = true
      }
    } catch (error) {
      console.warn('Startup update check failed:', error)
    }
  }

  // 监听下载进度，驱动启动更新弹窗状态
  if (window.electronAPI?.onUpdateStatus) {
    unsubscribeStartupUpdate = window.electronAPI.onUpdateStatus((status: UpdateStatus) => {
      if (!updateDialogVisible.value) return
      if (status.state === 'downloading') {
        updateDialogState.value = 'downloading'
        updatePercent.value = Math.round(status.percent ?? 0)
      } else if (status.state === 'downloaded') {
        updateDialogState.value = 'downloaded'
      } else if (status.state === 'error') {
        updateDialogVisible.value = false
        message.error(t('generalSettings.updateError', { error: status.error || t('settings.unknownError') }))
      }
    })
  }

  // 通知主进程应用已完全准备好
  window.electronAPI?.notifyAppReady()
})

// 从启动弹窗发起下载更新
async function startUpdateDownload() {
  if (!window.electronAPI?.checkForUpdates) return
  const result = await window.electronAPI.checkForUpdates()
  if (!result.success) {
    updateDialogVisible.value = false
    message.error(t('generalSettings.updateError', { error: result.error || t('settings.unknownError') }))
  }
}

// 重启更新
function restartToUpdate() {
  window.electronAPI?.restartAndInstall?.()
}

onUnmounted(() => {
  stopAutoUpdate()
  unsubscribeConfig?.()
  unsubscribeStartupUpdate?.()
  connectionStore.disconnect()
})
</script>

<style scoped>
.app-container {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background-color: var(--bg-primary);
  color: var(--text-primary);
  transition: background-color 0.3s ease, color 0.3s ease;
}

/* Windows 标题栏按钮预留空间 */
.app-container.windows-titlebar .main-container {
  position: relative;
}

.app-container.windows-titlebar .content-container {
  padding-right: 20px;
}

.main-container {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.content-container {
  flex: 1;
  overflow: auto;
  padding: 16px;
  background-color: var(--bg-secondary);
}

.update-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 16px;
}

.update-notes-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
  color: var(--text-primary);
}

.update-notes-body {
  margin: 0;
  padding: 10px 12px;
  max-height: 260px;
  overflow: auto;
  font-size: 12px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  border: 1px solid var(--border-light);
  border-radius: 8px;
}

.update-downloading-text,
.update-downloaded-text {
  margin-top: 12px;
  color: var(--text-secondary);
  font-size: 13px;
}
</style>
