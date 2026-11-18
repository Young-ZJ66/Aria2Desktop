<template>
  <n-drawer v-model:show="visible" :width="360" placement="right">
    <n-drawer-content closable>
      <!-- 批量操作放在标题栏：不管列表多长滚到哪，都始终可见 -->
      <template #header>
        <div class="notification-header">
          <span>{{ t('notificationCenter.title') }}</span>
          <div class="notification-actions">
            <!-- 无未读/无通知时也不置灰：保持按钮外观一致，点击为空操作 -->
            <n-button size="small" @click="notificationStore.markAllRead()">
              {{ t('notificationCenter.markAllRead') }}
            </n-button>
            <n-button size="small" @click="notificationStore.clear()">
              {{ t('notificationCenter.clear') }}
            </n-button>
          </div>
        </div>
      </template>

      <div v-if="notificationStore.items.length === 0" class="notification-empty">
        <UiEmpty
          :title="t('notificationCenter.empty')"
          :icon="NotificationsOffOutline"
          size="sm"
        />
      </div>

      <div v-else class="notification-list">
        <button
          v-for="item in notificationStore.items"
          :key="item.id"
          type="button"
          class="notification-item"
          :class="{ 'is-unread': !item.read }"
          @click="openItem(item)"
        >
          <n-icon
            :size="18"
            class="notification-icon"
            :class="item.type === 'error' ? 'is-error' : 'is-success'"
          >
            <AlertCircleOutline v-if="item.type === 'error'" />
            <CheckmarkCircleOutline v-else />
          </n-icon>
          <span class="notification-meta">
            <span class="notification-name" :title="item.name">{{ item.name }}</span>
            <span class="notification-sub">
              {{ item.type === 'error' ? t('notification.downloadFailed') : t('notification.downloadComplete') }}
              · {{ formatTime(item.createdAt) }}
            </span>
            <span v-if="item.detail" class="notification-detail" :title="item.detail">
              {{ item.detail }}
            </span>
          </span>
          <span v-if="!item.read" class="notification-dot" aria-hidden="true" />
        </button>
      </div>
    </n-drawer-content>
  </n-drawer>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import dayjs from 'dayjs'
import { AlertCircleOutline, CheckmarkCircleOutline, NotificationsOffOutline } from '@vicons/ionicons5'
import { useUiStore } from '@/stores/uiStore'
import { useNotificationStore, type AppNotification } from '@/stores/notificationStore'
import UiEmpty from '@/components/ui/UiEmpty.vue'

const { t } = useI18n()
const uiStore = useUiStore()
const notificationStore = useNotificationStore()

const visible = computed({
  get: () => uiStore.showNotifications,
  set: (value: boolean) => {
    if (value) uiStore.openNotifications()
    else uiStore.closeNotifications()
  }
})

function formatTime(timestamp: number): string {
  return dayjs(timestamp).format('MM-DD HH:mm')
}

function openItem(item: AppNotification) {
  notificationStore.markRead(item.id)
  uiStore.closeNotifications()
  uiStore.openTaskDetail(item.gid)
}
</script>

<style scoped>
.notification-empty {
  padding: var(--ds-space-48) 0;
}

.notification-list {
  display: flex;
  flex-direction: column;
  gap: var(--ds-space-8);
}

.notification-item {
  display: flex;
  align-items: center;
  gap: var(--ds-space-10);
  width: 100%;
  padding: var(--ds-space-10) var(--ds-space-12);
  border: 1px solid var(--ds-border-subtle);
  border-radius: var(--ds-radius-md);
  background: var(--ds-bg-surface);
  color: inherit;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--ds-motion-dur-2) var(--ds-motion-ease-out);
}

.notification-item:hover {
  background: var(--ds-bg-hover);
}

/* 未读用左侧 3px 指示条 + 淡底，和侧栏导航的选中语言保持一致 */
.notification-item.is-unread {
  border-color: var(--ds-accent-border);
  background: var(--ds-accent-subtle);
  box-shadow: inset 3px 0 0 var(--ds-accent);
}

.notification-icon {
  flex: none;
}

.notification-icon.is-success {
  color: var(--ds-status-success-text);
}

.notification-icon.is-error {
  color: var(--ds-status-danger-text);
}

.notification-meta {
  display: flex;
  flex-direction: column;
  gap: var(--ds-space-2);
  min-width: 0;
  flex: 1;
}

.notification-name {
  font-size: var(--ds-text-body-size);
  color: var(--ds-text-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notification-sub {
  font-size: var(--ds-text-micro-size);
  color: var(--ds-text-muted);
}

/* 失败原因常是一整句，单行截断 + 悬停看全，避免撑高整条通知 */
.notification-detail {
  font-size: var(--ds-text-micro-size);
  color: var(--ds-status-warning-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notification-dot {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ds-accent);
}

/* 标题 + 批量操作（标题栏内两端对齐，关闭按钮由 n-drawer-content 负责） */
.notification-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ds-space-12);
  width: 100%;
}

.notification-actions {
  display: flex;
  align-items: center;
  gap: var(--ds-space-6);
  flex: none;
}
</style>
