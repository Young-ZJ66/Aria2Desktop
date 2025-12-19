<template>
  <div id="app" class="app-container" :class="{ 'windows-titlebar': isWindowsPlatform }">
    <!-- 顶部工具栏 -->
    <AppHeader />
    
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
    
    <!-- 全局对话框 -->
    <ConnectionDialog v-model="showConnectionDialog" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { useConnectionStore } from '@/stores/connectionStore'
import { useStatsStore } from '@/stores/statsStore'
import { useTaskStore } from '@/stores/taskStore'
import { useSettingsStore } from '@/stores/settingsStore'
import AppHeader from '@/components/layout/AppHeader.vue'
import AppSidebar from '@/components/layout/AppSidebar.vue'
import AppFooter from '@/components/layout/AppFooter.vue'
import ConnectionDialog from '@/components/dialogs/ConnectionDialog.vue'

const connectionStore = useConnectionStore()
const statsStore = useStatsStore()
const taskStore = useTaskStore()
const settingsStore = useSettingsStore()
const showConnectionDialog = ref(false)

// {{ AURA: Add - 检测是否为 Windows 平台以调整标题栏布局 }}
const isWindowsPlatform = computed(() => {
  return typeof window !== 'undefined' && window.navigator.platform.toLowerCase().includes('win')
})

let updateInterval: any = null

function startAutoUpdate(interval = 1000) {
    if (updateInterval) clearInterval(updateInterval)
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

onMounted(async () => {
  // 初始化设置
  await settingsStore.initialize()

  // 应用主题
  settingsStore.applyTheme()

  // Listen for config changes from main process (hot-reload)
  if (window.electronAPI) {
    window.electronAPI.onConfigChanged((data: { key: string; value: any }) => {
      console.log('[App] Config changed from main process:', data)
      
      if (data.key === 'theme') {
        // Update theme setting and apply
        settingsStore.updateSetting('theme', data.value).then(() => {
          settingsStore.applyTheme()
        })
      } else if (data.key === 'refreshInterval') {
        // Update refresh interval
        stopAutoUpdate()
        startAutoUpdate(data.value)
      }
    })
  }

  // 如果启用了自动连接，尝试连接
  if (settingsStore.getSetting('autoConnect')) {
    try {
      const aria2Config = settingsStore.aria2Config
      await connectionStore.connect(aria2Config)
      
      // 连接成功后立即加载一次数据
      console.log('[App] Auto-connect successful, loading initial data...')
      await Promise.all([
        statsStore.loadGlobalStat(),
        taskStore.loadAllTasks()
      ])
      
      // 然后启动定时更新
      startAutoUpdate(settingsStore.getSetting('refreshInterval'))
    } catch (error) {
      console.error('Auto connection failed:', error)
      showConnectionDialog.value = true
    }
  }
  
  // 通知主进程应用已完全准备好
  if (window.electronAPI) {
    window.electronAPI.send('app-ready')
    console.log('[App] Notified main process: app ready')
  }
})

onUnmounted(() => {
  stopAutoUpdate()
  connectionStore.disconnect()
})

// {{ AURA: Add - 自动关闭连接对话框 }}
// 当连接状态变为已连接时，自动关闭对话框
// 这解决了启动时由于竞态条件导致的对话框弹出但随后连接成功的问题
watch(() => connectionStore.isConnected, (connected) => {
  if (connected) {
    showConnectionDialog.value = false
  }
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

/* {{ AURA: Add - Windows 标题栏按钮预留空间 }} */
.app-container.windows-titlebar .main-container {
  position: relative;
}

/* 确保右上角区域不被内容遮挡 */
.app-container.windows-titlebar .content-container {
  padding-right: 20px; /* 减少右侧间距 */
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
