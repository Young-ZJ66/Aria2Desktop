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
        <n-empty :description="t('notificationCenter.empty')" />
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
import { AlertCircleOutline, CheckmarkCircleOutline } from '@vicons/ionicons5'
import { useUiStore } from '@/stores/uiStore'
import { useNotificationStore, type AppNotification } from '@/stores/notificationStore'

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
  padding: 48px 0;
}

.notification-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.notification-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.notification-item:hover {
  background: var(--bg-tertiary);
}

.notification-item.is-unread {
  background: var(--bg-secondary);
}

.notification-icon {
  flex: none;
}

.notification-icon.is-success {
  color: var(--color-success);
}

.notification-icon.is-error {
  color: var(--color-danger);
}

.notification-meta {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
}

.notification-name {
  font-size: 13px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notification-sub {
  font-size: 11.5px;
  color: var(--text-secondary);
}

/* 失败原因常是一整句，单行截断 + 悬停看全，避免撑高整条通知 */
.notification-detail {
  font-size: 11.5px;
  color: var(--color-warning);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notification-dot {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-primary);
}

/* 标题 + 批量操作（标题栏内两端对齐，关闭按钮由 n-drawer-content 负责） */
.notification-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}

.notification-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
}
</style>
