/**
 * 应用内通知（下载完成 / 失败）。
 *
 * 系统通知只在一瞬间可见，关掉就没了；这里保留最近 100 条记录，
 * 侧边栏铃铛展示未读数，点击条目可回到对应任务详情。
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export type AppNotificationType = 'complete' | 'error'

export interface AppNotification {
  id: string
  type: AppNotificationType
  gid: string
  name: string
  createdAt: number
  read: boolean
}

const STORAGE_KEY = 'aria2-desktop-notifications'
const MAX_ITEMS = 100
/** 同一 gid + 类型在该窗口内的重复事件只记一条（WS 重连/重放时避免刷屏） */
const DEDUPE_WINDOW_MS = 5000

function loadItems(): AppNotification[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is AppNotification =>
        !!item
        && typeof item === 'object'
        && typeof (item as AppNotification).id === 'string'
        && typeof (item as AppNotification).gid === 'string'
        && typeof (item as AppNotification).name === 'string'
        && typeof (item as AppNotification).createdAt === 'number'
        && ((item as AppNotification).type === 'complete' || (item as AppNotification).type === 'error')
      )
      .slice(0, MAX_ITEMS)
      .map(item => ({ ...item, read: item.read === true }))
  } catch {
    return []
  }
}

export const useNotificationStore = defineStore('notifications', () => {
  const items = ref<AppNotification[]>(loadItems())

  const unreadCount = computed(() => items.value.filter(item => !item.read).length)

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items.value))
    } catch {
      // 存储不可用时不影响任务本身
    }
  }

  function push(input: { type: AppNotificationType; gid: string; name: string }) {
    if (!input.gid) return
    const latest = items.value[0]
    if (
      latest
      && latest.gid === input.gid
      && latest.type === input.type
      && Date.now() - latest.createdAt < DEDUPE_WINDOW_MS
    ) {
      return
    }
    items.value.unshift({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: input.type,
      gid: input.gid,
      name: input.name,
      createdAt: Date.now(),
      read: false
    })
    if (items.value.length > MAX_ITEMS) items.value.length = MAX_ITEMS
    persist()
  }

  function markRead(id: string) {
    const item = items.value.find(entry => entry.id === id)
    if (!item || item.read) return
    item.read = true
    persist()
  }

  function markAllRead() {
    let changed = false
    for (const item of items.value) {
      if (!item.read) {
        item.read = true
        changed = true
      }
    }
    if (changed) persist()
  }

  function clear() {
    items.value = []
    persist()
  }

  return {
    items,
    unreadCount,
    push,
    markRead,
    markAllRead,
    clear
  }
})
