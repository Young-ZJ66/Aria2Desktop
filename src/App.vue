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
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useAria2Store } from '@/stores/aria2Store'
import { useSettingsStore } from '@/stores/settingsStore'
import AppHeader from '@/components/layout/AppHeader.vue'
import AppSidebar from '@/components/layout/AppSidebar.vue'
import AppFooter from '@/components/layout/AppFooter.vue'
import ConnectionDialog from '@/components/dialogs/ConnectionDialog.vue'

const aria2Store = useAria2Store()
const settingsStore = useSettingsStore()
const showConnectionDialog = ref(false)

// {{ AURA: Add - 检测是否为 Windows 平台以调整标题栏布局 }}
const isWindowsPlatform = computed(() => {
  return typeof window !== 'undefined' && window.navigator.platform.toLowerCase().includes('win')
})

onMounted(async () => {
  // 初始化设置
  await settingsStore.initialize()

  // 应用主题
  settingsStore.applyTheme()

  // 如果启用了自动连接，尝试连接
  if (settingsStore.getSetting('autoConnect')) {
    try {
      const aria2Config = settingsStore.aria2Config
      await aria2Store.connect(aria2Config)
      aria2Store.startAutoUpdate(settingsStore.getSetting('refreshInterval'))
    } catch (error) {
      console.error('Auto connection failed:', error)
      showConnectionDialog.value = true
    }
  }
})

onUnmounted(() => {
  aria2Store.stopAutoUpdate()
  aria2Store.disconnect()
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
