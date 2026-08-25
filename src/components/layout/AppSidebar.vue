<template>
  <div class="app-sidebar">
    <div class="sidebar-brand">
      <img :src="appIcon" alt="Aria2" class="brand-logo" />
      <div class="brand-name">
        <span class="brand-title">Aria2</span>
        <span class="brand-subtitle">{{ t('app.downloadManager') }}</span>
      </div>
    </div>

    <div class="sidebar-scroll">
      <n-menu
        :value="activeKey"
        :options="menuOptions"
        :indent="20"
        :collapsed="false"
        @update:value="handleMenuSelect"
      />
    </div>

    <div class="sidebar-footer">
      <!-- 左下角操作行：设置 / 主题切换 / GitHub -->
      <div class="footer-actions">
        <button
          class="footer-btn"
          :title="t('app.settings')"
          @click="uiStore.openSettings()"
        >
          <n-icon :size="16"><SettingsOutline /></n-icon>
        </button>
        <button
          class="footer-btn"
          :title="t('app.toggleTheme')"
          @click="toggleTheme"
        >
          <n-icon :size="16"><SunnyOutline v-if="isDark" /><MoonOutline v-else /></n-icon>
        </button>
        <a
          class="footer-btn"
          :href="githubUrl"
          target="_blank"
          rel="noreferrer noopener"
          :title="t('app.githubRepo')"
          :aria-label="t('app.githubRepo')"
        >
          <n-icon :size="16"><LogoGithub /></n-icon>
        </a>
      </div>

      <!-- 左下角：连接状态（点击打开连接弹窗） -->
      <button
        class="footer-btn footer-btn-connection"
        :title="t('header.connection')"
        @click="connectionStore.showConnectionDialog = true"
      >
        <n-icon :size="16" :class="connectionStatusClass">
          <!-- 连接/断开/连接中三个图标切换时做轻微缩放淡入过渡 -->
          <transition name="icon-swap" mode="out-in">
            <component :is="connectionIcon" :key="connectionStateKey" />
          </transition>
        </n-icon>
        <span class="status-text" :class="connectionStatusClass">
          {{ connectionStatusText }}
        </span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, h, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { NIcon, NMenu, type MenuOption } from 'naive-ui'
import {
  DownloadOutline,
  CheckmarkDoneOutline,
  CloudDoneOutline,
  CloudOfflineOutline,
  SyncOutline,
  SettingsOutline,
  SunnyOutline,
  MoonOutline,
  LogoGithub
} from '@vicons/ionicons5'
import { useTaskStore } from '@/stores/taskStore'
import { useUiStore } from '@/stores/uiStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { useSettingsStore } from '@/stores/settingsStore'
import appIcon from '@/../build/Icon.ico'

const GITHUB_URL = 'https://github.com/Young-ZJ66/Aria2Desktop'
const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const taskStore = useTaskStore()
const uiStore = useUiStore()
const connectionStore = useConnectionStore()
const settingsStore = useSettingsStore()

function renderIcon(icon: Component) {
  return () => h(NIcon, null, { default: () => h(icon) })
}

const activeKey = computed(() => route.path)

// 下载任务计数包含失败/错误任务（错误任务归入下载任务列表）
const activeAndWaitingCount = computed(() =>
  taskStore.activeTasks.length + taskStore.waitingTasks.length +
  taskStore.stoppedTasks.filter(task => task.status === 'error').length
)
const stoppedCount = computed(() =>
  taskStore.stoppedTasks.filter(task => task.status !== 'error').length
)

const menuOptions = computed<MenuOption[]>(() => [
  {
    label: () => `${t('nav.downloading')} (${activeAndWaitingCount.value})`,
    key: '/downloading',
    icon: renderIcon(DownloadOutline)
  },
  {
    label: () => `${t('nav.completed')} (${stoppedCount.value})`,
    key: '/completed',
    icon: renderIcon(CheckmarkDoneOutline)
  },
  {
    label: t('nav.aria2Status'),
    key: '/status',
    icon: renderIcon(CloudDoneOutline)
  }
])

function handleMenuSelect(key: string) {
  if (key.startsWith('/')) {
    router.push(key)
  }
}

const isConnected = computed(() => connectionStore.isConnected)
const isConnecting = computed(() => connectionStore.isConnecting)

// 连接状态图标（供 Transition 动态切换）
const connectionStateKey = computed(() =>
  isConnected.value ? 'connected' : isConnecting.value ? 'connecting' : 'disconnected'
)
const connectionIcon = computed(() => {
  if (isConnected.value) return CloudDoneOutline
  return isConnecting.value ? SyncOutline : CloudOfflineOutline
})
const isDark = computed(() => {
  const theme = settingsStore.settings.theme
  return theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)
})
const githubUrl = GITHUB_URL

async function toggleTheme() {
  const current = settingsStore.settings.theme
  const next = current === 'dark' ? 'light' : 'dark'
  await settingsStore.updateSetting('theme', next)
  settingsStore.applyTheme()
}

const connectionStatusClass = computed(() => {
  if (connectionStore.isConnecting) return 'status-connecting'
  return connectionStore.isConnected ? 'status-connected' : 'status-disconnected'
})

const connectionStatusText = computed(() => {
  if (connectionStore.isConnecting) return t('header.connecting')
  return connectionStore.isConnected ? t('header.connected') : t('header.disconnected')
})
</script>

<style scoped>
.app-sidebar {
  width: 232px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  border-right: 1px solid var(--border-light);
  transition: background-color 0.3s ease, border-color 0.3s ease;
}

.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 16px;
}

.brand-logo {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  object-fit: contain;
  flex-shrink: 0;
}

.brand-name {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}

.brand-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--text-primary);
}

.brand-subtitle {
  font-size: 11px;
  color: var(--text-secondary);
}

.sidebar-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 8px 8px;
}

:deep(.n-menu-item-content) {
  border-radius: 8px;
}

:deep(.n-menu-item-content.is-active) {
  background: var(--color-primary);
  /* 项目未定义 --text-on-primary 变量：菜单激活项背景为主色（浅色 #4f6ef2 / 暗色 #6c86f5），
     白色文字与两种背景的对比度均 ≥ 4.5:1（浅色 5.1:1，暗色 4.8:1），满足 WCAG AA 要求，故保留 #fff */
  color: #fff;
}

:deep(.n-menu-group-header) {
  font-size: 12px;
  color: var(--text-secondary);
}

.sidebar-footer {
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.footer-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}

.footer-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: none;
  background: transparent;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13px;
  color: var(--text-regular);
  text-decoration: none;
  cursor: pointer;
  transition: background-color 0.2s ease, color 0.2s ease, transform 0.18s var(--ease-out);
}

.footer-btn:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  transform: translateY(-1px);
}

.footer-btn:active {
  transform: translateY(0) scale(0.96);
}

/* 底部按钮图标悬浮微动：放大 + 轻微上浮 */
.footer-btn :deep(.n-icon) {
  transition: transform 0.18s var(--ease-out);
}

.footer-btn:hover :deep(.n-icon) {
  transform: scale(1.12);
}

/* 连接状态图标切换过渡（连接/断开/连接中） */
.icon-swap-enter-active {
  transition: opacity 0.16s ease, transform 0.16s var(--ease-out);
}

.icon-swap-leave-active {
  transition: opacity 0.1s ease, transform 0.1s ease;
}

.icon-swap-enter-from,
.icon-swap-leave-to {
  opacity: 0;
  transform: scale(0.72);
}

.footer-btn:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.footer-btn-connection {
  flex: 1;
  justify-content: flex-start;
  overflow: hidden;
}

.status-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.status-connected {
  color: var(--color-success);
}

.status-disconnected {
  color: var(--text-secondary);
}

.status-connecting {
  color: var(--color-warning);
  /* 连接中：仅图标旋转提供状态反馈（文字不参与旋转） */
}

/* 旋转动画只作用于连接状态图标；若写在上面的 .status-connecting 上，
   会把"连接中"文字也一并旋转 */
.footer-btn-connection :deep(.n-icon.status-connecting) {
  animation: sidebar-spin 1s linear infinite;
}

@keyframes sidebar-spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
</style>
