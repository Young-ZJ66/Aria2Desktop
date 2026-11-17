<template>
  <n-config-provider
    :theme="currentTheme"
    :theme-overrides="themeOverrides"
    :locale="naiveLocale"
    :component-options="componentOptions"
  >
    <n-message-provider placement="top">
      <n-dialog-provider>
        <n-notification-provider placement="bottom-right">
          <div
            class="app-container"
            :class="{ 'windows-titlebar': isWindowsPlatform }"
            @dragenter.prevent="onDragEnter"
            @dragover.prevent="onDragOver"
            @dragleave.prevent="onDragLeave"
            @drop.prevent="onDrop"
          >
            <div class="main-container" :class="{ 'is-entered': appEntered }">
              <AppSidebar />

              <div class="content-container">
                <div class="page-host">
                  <!--
                    keep-alive：切页时保留各页实例，避免每次进入都重新挂载 + 重新拉数据
                    （这是「像刷新页面」的根源）。页面重新激活时各自按需刷新，见各页的 onActivated。
                    :key 用 route.path 而不是组件类型——/downloading 与 /completed 复用同一个 TaskList，
                    不区分 key 的话两个列表会共用一个实例（排序记忆、筛选条件互相串）。

                    这里刻意不包 <transition>：页面根节点背景是透明的，任何淡入淡出/交叉过渡都会让
                    新旧两页的内容在过渡期间叠加成残影（用户反馈「切换页面有残影，不丝滑」）。
                    配合 keep-alive 后页面本来就已经渲染好，直接瞬时切换是最干净、最跟手的效果。
                  -->
                  <router-view v-slot="{ Component, route }">
                    <keep-alive>
                      <component :is="Component" :key="route.path" />
                    </keep-alive>
                  </router-view>
                </div>
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

            <!-- 应用内通知中心 -->
            <NotificationDrawer />

            <!-- 全局更新弹窗（启动检查与设置页手动检查共用） -->
            <UpdateDialog />

            <!-- 拖拽下载覆盖层 -->
            <transition name="fade-in">
              <div v-if="isDragging" class="drop-overlay">
                <div class="drop-overlay__inner">
                  <span class="drop-overlay__icon">
                    <n-icon :size="26"><CloudDownloadOutline /></n-icon>
                  </span>
                  <span class="drop-overlay__text">{{ t('task.dropToDownload') }}</span>
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
import { computed, ref, onMounted, h } from 'vue'
import { useI18n } from 'vue-i18n'
import { NIcon } from 'naive-ui'
import { CloudDownloadOutline, FileTrayOutline } from '@vicons/ionicons5'
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
import NotificationDrawer from '@/components/dialogs/NotificationDrawer.vue'
import UpdateDialog from '@/components/dialogs/UpdateDialog.vue'

const connectionStore = useConnectionStore()
const uiStore = useUiStore()
const { t } = useI18n()

// Naive UI 主题 / 语言（跟随设置与系统深浅色）
const themeManager = useThemeManager()
const { currentTheme, themeOverrides, naiveLocale } = themeManager

// 全局空态图标：naive 默认的 EmptyIcon 是「方框 + 叉号」，浅色主题下很容易被误读成
// 「图片损坏」而不是「这里还没有内容」。统一换成文件托盘图标——语义更贴切，
// 且全部 n-empty 自动一致，不需要逐个页面写 #icon 插槽。
const componentOptions = {
  Empty: {
    renderIcon: () => h(NIcon, null, { default: () => h(FileTrayOutline) })
  }
}

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

function onDragEnter(event: DragEvent) {
  // dragenter/dragleave 会在经过每个子元素时各触发一次，必须成对计数；
  // 只在真正带着文件/文本进入时统计，避免页内普通拖拽把覆盖层算出来。
  const types = event.dataTransfer?.types
  if (types && (types.includes('Files') || types.includes('text/plain'))) {
    dragCounter++
  }
}

function onDragOver(event: DragEvent) {
  // 仅在拖入了文件或文本时显示覆盖层
  const types = event.dataTransfer?.types
  if (types && (types.includes('Files') || types.includes('text/plain'))) {
    event.dataTransfer.dropEffect = 'copy'
    if (!isDragging.value) {
      isDragging.value = true
      if (dragCounter <= 0) dragCounter = 1
    }
  }
}

function onDragLeave() {
  if (!isDragging.value) return
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
  background: var(--ds-bg-app);
  color: var(--ds-text-base);
  transition:
    background-color var(--ds-motion-dur-4) var(--ds-motion-ease-in-out),
    color var(--ds-motion-dur-4) var(--ds-motion-ease-in-out);
}

/* Windows 标题栏按钮预留空间 */
.app-container.windows-titlebar .main-container {
  position: relative;
}

.app-container.windows-titlebar .content-container {
  padding-right: 32px;
}

.main-container {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
  /* 首载淡入上移（由 appEntered 触发，悬挂在 is-entered 上避免启动白屏） */
  opacity: 0;
  transform: translateY(4px);
  transition:
    opacity 0.4s var(--ds-motion-ease-out),
    transform 0.4s var(--ds-motion-ease-out);
}

.main-container.is-entered {
  opacity: 1;
  transform: none;
}

.content-container {
  flex: 1;
  min-width: 0;
  overflow: auto;
  padding: var(--ds-space-24) var(--ds-space-24) var(--ds-space-24) var(--ds-space-24);
  /* 内容区不再自己刷底色：表面层级由 --ds-bg-app 与面板的 --ds-bg-surface 拉开，
     中间那层 --bg-secondary 是 v1 灰白打架的根源 */
  background: transparent;
  scrollbar-gutter: stable;
}

@media (max-width: 900px) {
  .content-container {
    padding: var(--ds-space-16);
  }
}

/* 页面容器：撑满内容区，供各页根节点的 height:100% 生效 */
.page-host {
  height: 100%;
  min-height: 0;
}

/* 拖拽下载覆盖层：整屏压暗 + 中心一张悬浮卡片，不再用 3px 虚线框住整个窗口 */
.drop-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--ds-bg-app) 68%, transparent);
  backdrop-filter: blur(6px);
}

.drop-overlay__inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--ds-space-12);
  padding: var(--ds-space-32) var(--ds-space-48);
  border-radius: var(--ds-radius-xl);
  border: 1px dashed var(--ds-accent-border);
  background: var(--ds-bg-surface);
  box-shadow: var(--ds-elev-3);
}

.drop-overlay__icon {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  border-radius: var(--ds-radius-lg);
  background: var(--ds-accent-subtle);
  color: var(--ds-accent-text);
}

.drop-overlay__text {
  font-size: var(--ds-text-bodyLg-size);
  font-weight: 600;
  color: var(--ds-text-strong);
}

.fade-in-enter-active {
  transition: opacity var(--ds-motion-dur-3) var(--ds-motion-ease-out);
}

.fade-in-leave-active {
  transition: opacity var(--ds-motion-dur-2) var(--ds-motion-ease-in-out);
}

.fade-in-enter-from,
.fade-in-leave-to {
  opacity: 0;
}
</style>
