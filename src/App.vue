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
          </div>
        </n-notification-provider>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue'
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
import { useTrafficMonitor } from '@/composables/useTrafficMonitor'
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

  // 如果启用了自动连接，尝试连接（手动连接场景由上面的 isConnected watch 处理）
  if (settingsStore.getSetting('autoConnect')) {
    try {
      const aria2Config = settingsStore.aria2Config
      await connectionStore.connect(aria2Config)
    } catch (error) {
      console.error('Auto connection failed:', error)
      connectionStore.showConnectionDialog = true
    }
  }

  // 通知主进程应用已完全准备好
  window.electronAPI?.notifyAppReady()
})

onUnmounted(() => {
  stopAutoUpdate()
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
