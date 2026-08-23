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
import { computed } from 'vue'
import { useConnectionStore } from '@/stores/connectionStore'
import { useThemeManager } from '@/composables/useThemeManager'
import { useAppLifecycle } from '@/composables/useAppLifecycle'
import AppSidebar from '@/components/layout/AppSidebar.vue'
import AppFooter from '@/components/layout/AppFooter.vue'
import ConnectionDialog from '@/components/dialogs/ConnectionDialog.vue'
import NewTaskDialog from '@/components/dialogs/NewTaskDialog.vue'
import SettingsDialog from '@/components/dialogs/SettingsDialog.vue'
import TaskDetailDrawer from '@/components/dialogs/TaskDetailDrawer.vue'
import UpdateDialog from '@/components/dialogs/UpdateDialog.vue'

const connectionStore = useConnectionStore()

// Naive UI 主题 / 语言（跟随设置与系统深浅色）
const themeManager = useThemeManager()
const { currentTheme, themeOverrides, naiveLocale } = themeManager

// 应用生命周期编排：设置初始化、更新检查、自动刷新、配置热重载、连接管理
useAppLifecycle(themeManager)

// 检测是否为 Windows 平台以调整标题栏布局
const isWindowsPlatform = computed(() => {
  if (typeof window === 'undefined') return false
  const platform = window.electronAPI?.platform
  if (platform) return platform === 'win32'
  return navigator.userAgent.toLowerCase().includes('win')
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
