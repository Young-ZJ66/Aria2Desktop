<template>
  <aside class="sidebar" :class="{ 'is-rail': collapsed }">
    <!-- 品牌区：logo 与名称。折叠后只留 logo，宽度由 rail 变量控制 -->
    <div class="sidebar__brand">
      <img :src="appIcon" alt="" class="sidebar__logo" />
      <div v-if="!collapsed" class="sidebar__brand-text">
        <span class="sidebar__name">Aria2</span>
        <span class="sidebar__subtitle">{{ t('app.downloadManager') }}</span>
      </div>
    </div>

    <nav class="sidebar__nav" :aria-label="t('app.downloadManager')">
      <n-tooltip
        v-for="item in navItems"
        :key="item.path"
        :delay="350"
        :disabled="!collapsed"
        placement="right"
      >
        <template #trigger>
          <router-link
            :to="item.path"
            class="nav-item"
            :class="{ 'is-active': isActive(item.path) }"
            :aria-current="isActive(item.path) ? 'page' : undefined"
          >
            <n-icon :size="18" class="nav-item__icon"><component :is="item.icon" /></n-icon>
            <template v-if="!collapsed">
              <span class="nav-item__label">{{ t(item.labelKey) }}</span>
              <span v-if="item.count > 0" class="nav-item__count ds-tnum">{{ item.count }}</span>
            </template>
            <span v-else-if="item.count > 0" class="nav-item__dot" aria-hidden="true" />
          </router-link>
        </template>
        {{ t(item.labelKey) }}
      </n-tooltip>
    </nav>

    <div class="sidebar__footer">
      <!-- 连接状态：整行可点，打开连接弹窗 -->
      <n-tooltip :delay="350" :disabled="!collapsed" placement="right">
        <template #trigger>
          <button
            type="button"
            class="conn"
            :class="connectionStatusClass"
            :aria-label="`${t('header.connection')}: ${connectionStatusText}`"
            @click="connectionStore.showConnectionDialog = true"
          >
            <span class="conn__dot" aria-hidden="true" />
            <span v-if="!collapsed" class="conn__text">{{ connectionStatusText }}</span>
          </button>
        </template>
        {{ t('header.connection') }}: {{ connectionStatusText }}
      </n-tooltip>

      <div class="sidebar__actions">
        <UiIconButton
          v-if="!narrow"
          :icon="collapsed ? ChevronForwardOutline : ChevronBackOutline"
          :label="collapsed ? t('app.expandSidebar') : t('app.collapseSidebar')"
          size="sm"
          @click="toggleCollapsed"
        />
        <n-badge
          dot
          :show="notificationStore.unreadCount > 0"
          :offset="[-2, 2]"
          type="error"
        >
          <UiIconButton
            :icon="NotificationsOutline"
            :label="t('notificationCenter.title')"
            size="sm"
            @click="uiStore.openNotifications()"
          />
        </n-badge>
        <UiIconButton
          :icon="SettingsOutline"
          :label="t('app.settings')"
          size="sm"
          @click="uiStore.openSettings()"
        />
        <UiIconButton
          :icon="isDark ? SunnyOutline : MoonOutline"
          :label="t('app.toggleTheme')"
          size="sm"
          @click="toggleTheme"
        />
        <a
          class="icon-link"
          :href="GITHUB_URL"
          target="_blank"
          rel="noreferrer noopener"
          :title="t('app.githubRepo')"
          :aria-label="t('app.githubRepo')"
        >
          <n-icon :size="15"><LogoGithub /></n-icon>
        </a>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { NBadge, NIcon, NTooltip } from 'naive-ui'
import {
  DownloadOutline,
  ListOutline,
  CheckmarkDoneOutline,
  CloudDoneOutline,
  SettingsOutline,
  SunnyOutline,
  MoonOutline,
  LogoGithub,
  NotificationsOutline,
  ServerOutline,
  GlobeOutline,
  FlashOutline,
  GitBranchOutline,
  ChevronBackOutline,
  ChevronForwardOutline
} from '@vicons/ionicons5'
import { useTaskStore } from '@/stores/taskStore'
import { useUiStore } from '@/stores/uiStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useStreamTaskStore } from '@/stores/streamTaskStore'
import { useNotificationStore } from '@/stores/notificationStore'
import { useThemeManager } from '@/composables/useThemeManager'
import { UiIconButton } from '@/components/ui'
import appIcon from '@/../build/Icon.ico'

const GITHUB_URL = 'https://github.com/Young-ZJ66/Aria2Desktop'
const COLLAPSE_KEY = 'aria2.sidebarCollapsed'
/** 低于该宽度强制折叠为图标栏：960px 窗口下 236px 侧栏要吃掉四分之一屏幕 */
const NARROW_WIDTH = 1100

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const taskStore = useTaskStore()
const uiStore = useUiStore()
const connectionStore = useConnectionStore()
const settingsStore = useSettingsStore()
const streamTaskStore = useStreamTaskStore()
const notificationStore = useNotificationStore()
const { isDark } = useThemeManager()

// ── 折叠状态 ──
const manualCollapsed = ref(false)
const narrow = ref(false)

const collapsed = computed(() => manualCollapsed.value || narrow.value)

function readPref() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    return false
  }
}

function toggleCollapsed() {
  manualCollapsed.value = !manualCollapsed.value
  try {
    localStorage.setItem(COLLAPSE_KEY, manualCollapsed.value ? '1' : '0')
  } catch {
    // 隐私模式下 localStorage 不可用：只影响记忆，不影响本次折叠
  }
}

function syncNarrow() {
  narrow.value = window.innerWidth < NARROW_WIDTH
}

onMounted(() => {
  manualCollapsed.value = readPref()
  syncNarrow()
  window.addEventListener('resize', syncNarrow)
})

onBeforeUnmount(() => window.removeEventListener('resize', syncNarrow))

// ── 导航 ──
// 计数不再拼进 label 字符串（v1 的做法会让「下载任务 (6)」整句被读屏连读，
// 折叠成图标栏后更是只剩数字），改成独立的小徽章。
const activeAndWaitingCount = computed(
  () =>
    taskStore.activeTasks.length +
    taskStore.waitingTasks.length +
    taskStore.stoppedTasks.filter(task => task.status === 'error').length +
    streamTaskStore.activeTasks.length +
    streamTaskStore.errorTasks.length
)

const stoppedCount = computed(
  () =>
    taskStore.stoppedTasks.filter(task => task.status !== 'error').length +
    streamTaskStore.completedTasks.length
)

interface NavItem {
  path: string
  labelKey: string
  icon: Component
  count: number
}

const navItems = computed<NavItem[]>(() => [
  { path: '/downloading', labelKey: 'nav.downloading', icon: DownloadOutline, count: activeAndWaitingCount.value },
  { path: '/completed', labelKey: 'nav.completed', icon: CheckmarkDoneOutline, count: stoppedCount.value },
  { path: '/queue', labelKey: 'nav.queue', icon: ListOutline, count: 0 },
  { path: '/status', labelKey: 'nav.aria2Status', icon: CloudDoneOutline, count: 0 },
  { path: '/instances', labelKey: 'nav.instances', icon: ServerOutline, count: 0 },
  { path: '/bt-insights', labelKey: 'nav.btInsights', icon: GlobeOutline, count: 0 },
  { path: '/automation', labelKey: 'nav.automation', icon: FlashOutline, count: 0 },
  { path: '/workflow', labelKey: 'nav.workflowSettings', icon: GitBranchOutline, count: 0 }
])

function isActive(path: string) {
  return route.path === path || route.path.startsWith(path + '/')
}

// 兜底：/stopped 会重定向到 /completed，这里不需要额外映射
void router

// ── 连接状态 ──
const connectionStatusClass = computed(() => {
  if (connectionStore.isConnecting) return 'is-connecting'
  return connectionStore.isConnected ? 'is-connected' : 'is-offline'
})

const connectionStatusText = computed(() => {
  if (connectionStore.isConnecting) return t('header.connecting')
  return connectionStore.isConnected ? t('header.connected') : t('header.disconnected')
})


async function toggleTheme() {
  const next = settingsStore.settings.theme === 'dark' ? 'light' : 'dark'
  await settingsStore.updateSetting('theme', next)
  settingsStore.applyTheme()
}
</script>

<style scoped>
.sidebar {
  --sidebar-width: var(--ds-control-sidebar-width);
  width: var(--sidebar-width);
  flex: none;
  display: flex;
  flex-direction: column;
  background: var(--ds-bg-surface);
  border-right: 1px solid var(--ds-border-subtle);
  transition:
    width var(--ds-motion-dur-3) var(--ds-motion-ease-out),
    background-color var(--ds-motion-dur-4) var(--ds-motion-ease-in-out),
    border-color var(--ds-motion-dur-4) var(--ds-motion-ease-in-out);
}

.sidebar.is-rail {
  --sidebar-width: var(--ds-control-sidebar-rail-width);
}

.sidebar__brand {
  display: flex;
  align-items: center;
  gap: var(--ds-space-10);
  height: 64px;
  padding: 0 var(--ds-space-16);
  flex: none;
}

.is-rail .sidebar__brand {
  padding: 0;
  justify-content: center;
}

.sidebar__logo {
  width: 30px;
  height: 30px;
  border-radius: var(--ds-radius-md);
  object-fit: contain;
  flex: none;
}

.sidebar__brand-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.25;
}

.sidebar__name {
  font-size: var(--ds-text-title-size);
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--ds-text-strong);
}

.sidebar__subtitle {
  font-size: var(--ds-text-micro-size);
  color: var(--ds-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar__nav {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--ds-space-8) var(--ds-space-10);
}

.is-rail .sidebar__nav {
  padding: var(--ds-space-8) var(--ds-space-8);
  align-items: center;
}

.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--ds-space-10);
  height: var(--ds-control-nav-item);
  padding: 0 var(--ds-space-10);
  border-radius: var(--ds-radius-md);
  color: var(--ds-text-base);
  text-decoration: none;
  font-size: var(--ds-text-body-size);
  font-weight: 450;
  white-space: nowrap;
  transition:
    background-color var(--ds-motion-dur-2) var(--ds-motion-ease-in-out),
    color var(--ds-motion-dur-2) var(--ds-motion-ease-in-out);
}

.is-rail .nav-item {
  width: 40px;
  height: 40px;
  padding: 0;
  justify-content: center;
}

.nav-item:hover {
  background: var(--ds-bg-hover);
  color: var(--ds-text-strong);
}

/* 选中项：淡底 + 主色文字 + 左侧 3px 指示条。
   v1 是整块主色实心药丸，8 项里任何一项选中都会把侧栏拽成两块色，太重。 */
.nav-item.is-active {
  background: var(--ds-accent-subtle);
  color: var(--ds-accent-text);
  font-weight: 550;
}

.nav-item.is-active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  width: 3px;
  height: 18px;
  transform: translateY(-50%);
  border-radius: var(--ds-radius-pill);
  background: var(--ds-accent);
}

.nav-item.is-active .nav-item__icon {
  color: var(--ds-accent-text);
}

.nav-item:focus-visible {
  outline: 2px solid var(--ds-focus-ring);
  outline-offset: 2px;
}

.nav-item__icon {
  flex: none;
  color: var(--ds-text-muted);
  transition: color var(--ds-motion-dur-2) var(--ds-motion-ease-in-out);
}

.nav-item:hover .nav-item__icon {
  color: var(--ds-text-strong);
}

.nav-item__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nav-item__count {
  flex: none;
  min-width: 20px;
  height: 18px;
  padding: 0 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--ds-radius-pill);
  background: var(--ds-bg-sunken);
  color: var(--ds-text-muted);
  font-size: var(--ds-text-micro-size);
  font-weight: 500;
}

.nav-item.is-active .nav-item__count {
  background: color-mix(in srgb, var(--ds-accent) 16%, transparent);
  color: var(--ds-accent-text);
}

.nav-item__dot {
  position: absolute;
  top: 9px;
  right: 9px;
  width: 5px;
  height: 5px;
  border-radius: var(--ds-radius-pill);
  background: var(--ds-accent);
}

.sidebar__footer {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: var(--ds-space-6);
  padding: var(--ds-space-8) var(--ds-space-10) var(--ds-space-10);
  border-top: 1px solid var(--ds-border-subtle);
}

.is-rail .sidebar__footer {
  align-items: center;
  padding: var(--ds-space-8) var(--ds-space-8);
}

.conn {
  display: flex;
  align-items: center;
  gap: var(--ds-space-8);
  height: 32px;
  padding: 0 var(--ds-space-8);
  border: none;
  border-radius: var(--ds-radius-md);
  background: transparent;
  font-size: var(--ds-text-small-size);
  color: var(--ds-text-muted);
  cursor: pointer;
  transition: background-color var(--ds-motion-dur-2) var(--ds-motion-ease-in-out);
}

.conn:hover {
  background: var(--ds-bg-hover);
}

.conn:focus-visible {
  outline: 2px solid var(--ds-focus-ring);
  outline-offset: 2px;
}

.is-rail .conn {
  width: 40px;
  height: 40px;
  justify-content: center;
  padding: 0;
}

.conn__dot {
  width: 7px;
  height: 7px;
  border-radius: var(--ds-radius-pill);
  background: var(--ds-text-faint);
  flex: none;
}

.conn__text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.conn.is-connected {
  color: var(--ds-status-success-text);
}

.conn.is-connected .conn__dot {
  background: var(--ds-status-success-solid);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ds-status-success-solid) 18%, transparent);
}

.conn.is-connecting {
  color: var(--ds-status-warning-text);
}

.conn.is-connecting .conn__dot {
  background: var(--ds-status-warning-solid);
  animation: conn-pulse 1.2s var(--ds-motion-ease-in-out) infinite;
}

.sidebar__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 2px;
}

.is-rail .sidebar__actions {
  flex-direction: column;
  gap: var(--ds-space-4);
}

.icon-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: var(--ds-radius-sm);
  color: var(--ds-text-muted);
  transition:
    background-color var(--ds-motion-dur-2) var(--ds-motion-ease-in-out),
    color var(--ds-motion-dur-2) var(--ds-motion-ease-in-out);
}

.icon-link:hover {
  background: var(--ds-bg-hover);
  color: var(--ds-text-strong);
}

.icon-link:focus-visible {
  outline: 2px solid var(--ds-focus-ring);
  outline-offset: 2px;
}

@keyframes conn-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
</style>
