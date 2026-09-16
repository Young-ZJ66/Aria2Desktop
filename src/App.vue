<template>
  <n-config-provider :theme="currentTheme" :theme-overrides="themeOverrides" :locale="naiveLocale">
    <n-message-provider placement="top">
      <n-dialog-provider>
        <n-notification-provider placement="bottom-right">
          <div
            class="app-container"
            :class="{ 'windows-titlebar': isWindowsPlatform }"
            @dragover.prevent="onDragOver"
            @dragleave.prevent="onDragLeave"
            @drop.prevent="onDrop"
          >
            <!-- 主要内容区域 -->
            <div class="main-container" :class="{ 'is-entered': appEntered }">
              <!-- 侧边栏 -->
              <AppSidebar />

              <!-- 内容区域（路由切换时淡入上移过渡，见 theme.css 的 .page-fade） -->
              <div class="content-container">
                <router-view v-slot="{ Component }">
                  <transition name="page-fade" mode="out-in">
                    <component :is="Component" />
                  </transition>
                </router-view>
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

            <!-- 拖拽下载覆盖层 -->
            <transition name="fade-in">
              <div v-if="isDragging" class="drop-overlay">
                <div class="drop-overlay-content">
                  <n-icon :size="48"><CloudDownloadOutline /></n-icon>
                  <span>{{ t('task.dropToDownload') }}</span>
                </div>
              </div>
            </transition>
          </div>
        </n-notification-provider>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { CloudDownloadOutline } from '@vicons/ionicons5'
import { useConnectionStore } from '@/stores/connectionStore'
import { useUiStore } from '@/stores/uiStore'
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
const uiStore = useUiStore()
const { t } = useI18n()

// Naive UI 主题 / 语言（跟随设置与系统深浅色）
const themeManager = useThemeManager()
const { currentTheme, themeOverrides, naiveLocale } = themeManager

// 应用生命周期编排：设置初始化、更新检查、自动刷新、配置热重载、连接管理
useAppLifecycle(themeManager)

// 首载内容淡入：挂载后下一帧标记为已入场，驱动 .main-container 的淡入上移过渡
// （用 JS 控制而非纯 CSS animation，避免 HMR/热刷新反复重播）
const appEntered = ref(false)
onMounted(() => {
  requestAnimationFrame(() => {
    appEntered.value = true
  })
})

// 检测是否为 Windows 平台以调整标题栏布局
const isWindowsPlatform = computed(() => {
  if (typeof window === 'undefined') return false
  const platform = window.electronAPI?.platform
  if (platform) return platform === 'win32'
  return navigator.userAgent.toLowerCase().includes('win')
})

// ── 全局拖拽下载 ──

const isDragging = ref(false)
let dragCounter = 0 // 嵌套 dragenter/leave 计数，避免子元素触发闪烁

function onDragOver(event: DragEvent) {
  // 仅在拖入了文件或文本时显示覆盖层
  const types = event.dataTransfer?.types
  if (types && (types.includes('Files') || types.includes('text/plain'))) {
    event.dataTransfer.dropEffect = 'copy'
    if (!isDragging.value) isDragging.value = true
  }
}

function onDragLeave() {
  dragCounter--
  if (dragCounter <= 0) {
    isDragging.value = false
    dragCounter = 0
  }
}

function onDrop(event: DragEvent) {
  isDragging.value = false
  dragCounter = 0

  const dt = event.dataTransfer
  if (!dt) return

  // 优先处理文件拖拽（.torrent / .metalink）
  if (dt.files.length > 0) {
    const file = dt.files[0]
    if (file) {
      uiStore.openNewTaskWithFile(file)
      return
    }
  }

  // 处理文本拖拽（URL）
  const text = dt.getData('text/plain')?.trim()
  if (text && /^(https?|ftp|magnet):/.test(text)) {
    uiStore.openNewTaskWithUrl(text)
  }
}
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
  /* 首载淡入上移（由 appEntered 触发，悬挂在 is-entered 上避免启动白屏） */
  opacity: 0;
  transform: translateY(6px);
  transition: opacity 0.45s var(--ease-smooth), transform 0.45s var(--ease-out);
}

.main-container.is-entered {
  opacity: 1;
  transform: none;
}

.content-container {
  flex: 1;
  overflow: auto;
  padding: 16px;
  background-color: var(--bg-secondary);
}

/* 拖拽下载覆盖层 */
.drop-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--color-primary) 12%, var(--bg-primary));
  backdrop-filter: blur(4px);
  border: 3px dashed var(--color-primary);
  border-radius: 12px;
  margin: 8px;
}

.drop-overlay-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: var(--color-primary);
  font-size: 16px;
  font-weight: 600;
}

/* 覆盖层淡入动画 */
.fade-in-enter-active {
  transition: opacity 0.2s ease;
}

.fade-in-leave-active {
  transition: opacity 0.15s ease;
}

.fade-in-enter-from,
.fade-in-leave-to {
  opacity: 0;
}
</style>
