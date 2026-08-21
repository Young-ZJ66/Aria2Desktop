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

            <!-- 全局更新弹窗（启动检查与设置页手动检查共用） -->
            <UpdateDialog />
          </div>
        </n-notification-provider>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue'
import { darkTheme, zhCN, enUS, type GlobalThemeOverrides } from 'naive-ui'
import { useConnectionStore } from '@/stores/connectionStore'
import { useStatsStore } from '@/stores/statsStore'
import { useTaskStore } from '@/stores/taskStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'
import { setLocale, getLocale, type AppLocale } from '@/i18n'
import { useTrafficMonitor } from '@/composables/useTrafficMonitor'
import { initLocalService, stopStatusCheck } from '@/composables/useAria2LocalService'
import AppSidebar from '@/components/layout/AppSidebar.vue'
import AppFooter from '@/components/layout/AppFooter.vue'
import ConnectionDialog from '@/components/dialogs/ConnectionDialog.vue'
import NewTaskDialog from '@/components/dialogs/NewTaskDialog.vue'
import SettingsDialog from '@/components/dialogs/SettingsDialog.vue'
import TaskDetailDrawer from '@/components/dialogs/TaskDetailDrawer.vue'
import UpdateDialog from '@/components/dialogs/UpdateDialog.vue'

const connectionStore = useConnectionStore()
const statsStore = useStatsStore()
const taskStore = useTaskStore()
const settingsStore = useSettingsStore()
const uiStore = useUiStore()
const trafficMonitor = useTrafficMonitor()

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
// 不能使用 var(--xxx) 这类 CSS 变量，否则 seemless/rgba 解析会抛错导致渲染崩溃。
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

let updateInterval: ReturnType<typeof setInterval> | null = null
let slowInterval: ReturnType<typeof setInterval> | null = null
// 本会话是否已成功连接过一次：用于区分"首次连接"与"自动重连"，避免重连时把用户正在编辑的连接对话框关掉
let hasConnectedOnce = false

// 高频刷新：实时速度 / 活动任务进度（不含 stopped 列表，降低大任务列表开销）
function startAutoUpdate(interval = 1000) {
  stopAutoUpdate()
  updateInterval = setInterval(() => {
    if (connectionStore.isConnected) {
      statsStore.loadGlobalStat()
      taskStore.loadLightTasks()
    }
  }, interval)
}

// 低频全量刷新：补齐 stopped 列表与已完成任务持久化（30s）
function startSlowUpdate() {
  stopSlowUpdate()
  slowInterval = setInterval(() => {
    if (connectionStore.isConnected) {
      taskStore.loadAllTasks()
    }
  }, 30000)
}

function stopAutoUpdate() {
  if (updateInterval) {
    clearInterval(updateInterval)
    updateInterval = null
  }
}

function stopSlowUpdate() {
  if (slowInterval) {
    clearInterval(slowInterval)
    slowInterval = null
  }
}

// 连接状态统一管理自动刷新：连接成功即启动刷新；仅在首次连接时关闭残留对话框，
// 自动重连成功（已连过一次）不触碰对话框，避免打断用户编辑另一个配置
watch(() => connectionStore.isConnected, (connected) => {
  if (connected) {
    startAutoUpdate(settingsStore.getSetting('refreshInterval'))
    startSlowUpdate()
    // 连接成功后立即加载一次数据
    statsStore.loadGlobalStat()
    statsStore.loadVersion()
    // 全局配置缓存由 connectionStore.connect 连接成功后预热，设置页直接使用缓存，避免切换页面时重复请求闪烁
    taskStore.loadAllTasks()
    // 后台持续采集流量数据（不依赖状态页是否打开）
    trafficMonitor.startMonitor()
    if (!hasConnectedOnce) {
      hasConnectedOnce = true
      // 自动关闭对话框（处理启动时竞态导致的对话框未关闭问题）
      connectionStore.showConnectionDialog = false
    }
  } else {
    stopAutoUpdate()
    stopSlowUpdate()
    trafficMonitor.stopMonitor()
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

  // 尽早通知主进程渲染进程已就绪，窗口显示不再依赖后续耗时操作（连接、更新检查）
  window.electronAPI?.notifyAppReady()

  // 启动时后台检查更新：放在自动连接之前执行，确保真实启动（含退出后重开）时
  // 立即触发、不被后续可能耗时的连接流程阻塞
  runStartupUpdateCheck()

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

  // 断开连接后重置"首次连接"标记，使下次真实重连时仍可关闭残留对话框
  const disconnectUnsub = watch(() => connectionStore.isConnected, (connected, old) => {
    if (old && !connected) {
      hasConnectedOnce = false
    }
  })

  // 如果启用了自动连接，尝试连接（使用当前激活的配置预设）
  if (settingsStore.getSetting('autoConnect')) {
    try {
      await connectionStore.connect()
    } catch (error) {
      console.error('Auto connection failed:', error)
      connectionStore.showConnectionDialog = true
    }
  }

})

// 启动时的后台更新检查：检查失败视为已是最新版本（不弹窗打扰）；
// 仅在每次真实启动（onMounted，含退出后重开）时触发一次；
// 托盘驻留期间再次打开 exe（second-instance）或托盘图标打开窗口都不触发
async function runStartupUpdateCheck(): Promise<void> {
  if (!window.electronAPI?.checkUpdatesOnStartup) return
  // 更新弹窗已打开（用户正在查看/下载更新）时不重复检查，避免打断进行中的流程
  if (uiStore.showUpdateDialog) return
  try {
    const result = await window.electronAPI.checkUpdatesOnStartup()
    if (result?.success && result.hasUpdate) {
      uiStore.openUpdateDialog({
        version: result.version || '',
        notes: result.notes,
        state: result.alreadyDownloaded ? 'downloaded' : 'prompt'
      })
    }
  } catch (error) {
    console.warn('Startup update check failed:', error)
  }
}

onUnmounted(() => {
  stopAutoUpdate()
  stopSlowUpdate()
  stopStatusCheck()
  unsubscribeConfig?.()
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
</style>
