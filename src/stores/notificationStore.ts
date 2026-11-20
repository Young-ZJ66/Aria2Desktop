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
  /** 失败原因（人话）。老记录没有这个字段，渲染时按可选处理 */
  detail?: string
  /** aria2 退出码（失败通知才有）。用于去重与展示，老记录没有该字段 */
  errorCode?: string
  createdAt: number
  read: boolean
}

const STORAGE_KEY = 'aria2-desktop-notifications'
const MAX_ITEMS = 100
/**
 * 去重时间窗（D-50）：同一「任务 + 类型 + 失败码」在该窗口内只记一条。
 *
 * 为什么不是 5 秒：WS 断线重连会重放一批事件，间隔可能拉到十几秒；
 * 而 aria2 对同一个任务会反复上报同一次失败（每次轮询都可能触发），
 * 窗口太短就会刷屏。60 秒足够覆盖重连与轮询重放，又不会把「用户真的又失败一次」吞掉。
 */
const DEDUPE_WINDOW_MS = 60000

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
      .map(item => ({
        ...item,
        read: item.read === true,
        // 历史记录里可能是任意类型，非字符串一律当没有
        detail: typeof item.detail === 'string' && item.detail ? item.detail : undefined,
        errorCode: typeof item.errorCode === 'string' && item.errorCode ? item.errorCode : undefined
      }))
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

  /**
   * 近期已记录事件：key → 记录时刻。
   *
   * 只比较「最新一条」是不够的（D-50）：多个任务同时失败时通知会交错插入，
   * 同一任务的同一次失败在第二次上报时早已不是最新一条，于是又记一条。
   * 这里按 key 记住时间窗内的所有事件，与插入顺序无关。
   */
  const recentKeys = new Map<string, number>()

  /** 去重键：任务 + 类型 + 失败码（失败码区分「换了种错法」，同码才算重复） */
  function dedupeKey(input: { type: AppNotificationType; gid: string; errorCode?: string }): string {
    return `${input.gid}|${input.type}|${input.errorCode || ''}`
  }

  /** 清掉时间窗外的键，避免长期运行后 Map 无限增长 */
  function pruneRecentKeys(now: number) {
    for (const [key, recordedAt] of recentKeys) {
      if (now - recordedAt >= DEDUPE_WINDOW_MS) recentKeys.delete(key)
    }
  }

  function push(input: {
    type: AppNotificationType
    gid: string
    name: string
    detail?: string
    errorCode?: string
  }) {
    if (!input.gid) return
    const now = Date.now()
    pruneRecentKeys(now)

    const key = dedupeKey(input)
    if (recentKeys.has(key)) return
    recentKeys.set(key, now)

    items.value.unshift({
      id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
      type: input.type,
      gid: input.gid,
      name: input.name,
      detail: input.detail || undefined,
      errorCode: input.errorCode || undefined,
      createdAt: now,
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

  /** 删除单条通知；返回是否真的删掉了（id 不存在时 false） */
  function remove(id: string): boolean {
    const index = items.value.findIndex(entry => entry.id === id)
    if (index === -1) return false
    items.value.splice(index, 1)
    persist()
    return true
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
    remove,
    clear
  }
})

// ── 通知标题解析（D-25） ────────────────────────────────────────────────
//
// 问题：失败通知的标题此前直接回退到 aria2 的原始 GID（16 位十六进制），
// 普通用户既认不出是哪个任务、也没法拿去搜索。而「下载失败」的系统通知往往
// 出现在用户没盯着任务列表的时刻，标题是唯一能提供线索的地方。
//
// 回退顺序（与迭代计划 D-25 一致）：
// 1. 任务名（BT 种子名 / 文件名）
// 2. URL 或文件路径里的 basename（含 magnet 的 dn= 参数）
// 3. 「未知任务（gid 前 8 位）」
//
// 刻意做成纯函数并放在 store 模块里：标题是用户唯一能看到的失败线索，
// 值得单测覆盖各种残缺输入（空串、纯目录、URL 尾斜杠、magnet、非法编码）。
// 文案由调用方传入（组件外拿不到 i18n），未知任务用 unknownLabel(gidPrefix) 生成。

const GID_PREFIX_LENGTH = 8

/** magnet 链接的 dn 参数就是种子显示名，比 basename 更贴近用户认知 */
function nameFromMagnet(uri: string): string {
  if (!/^magnet:/i.test(uri)) return ''
  const match = /[?&]dn=([^&]+)/i.exec(uri)
  if (!match?.[1]) return ''
  try {
    const decoded = decodeURIComponent(match[1].replace(/\+/g, ' ')).trim()
    return decoded
  } catch {
    // 非法百分号编码（手写的 magnet）：退回未解码原文，总比丢掉名字好
    return match[1].trim()
  }
}

/** 从 URL 里取文件名；目录型 URL（以 / 结尾）与无路径 URL 返回空串 */
function nameFromUrl(raw: string): string {
  const text = raw.trim()
  if (!text) return ''

  const magnet = nameFromMagnet(text)
  if (magnet) return magnet

  try {
    const parsed = new URL(text)
    const pathname = parsed.pathname
    if (!pathname || pathname.endsWith('/')) return ''
    const last = pathname.split('/').filter(Boolean).pop() || ''
    if (!last) return ''
    try {
      return decodeURIComponent(last)
    } catch {
      return last
    }
  } catch {
    // 不是合法 URL（带空格、未编码的中文等）：当作纯字符串取最后一段
    return nameFromPath(text)
  }
}

/** 从本地路径（Windows 反斜杠或 POSIX 斜杠）里取文件名 */
function nameFromPath(raw: string): string {
  const text = raw.trim().replace(/[\\/]+$/, '')
  if (!text) return ''
  const last = text.split(/[\\/]/).pop() || ''
  return last.trim()
}

export interface NotificationTitleInput {
  /** 任务名（通常来自 bittorrent.info.name 或文件名） */
  name?: string
  /** 任务的文件列表：优先取已保存路径，其次取 uri */
  files?: Array<{ path?: string; uris?: Array<{ uri?: string }> }>
  /** 额外的候选 URI（详情抽屉已拉到的 taskUris 等），在 files 之后尝试 */
  uris?: string[]
  /** aria2 的 gid；只用于兜底文案里的前 8 位 */
  gid: string
}

/**
 * 解析通知标题。
 * @param input 任务相关线索（允许全部缺失）
 * @param unknownLabel 未知任务的兜底文案生成器，参数为 gid 前 8 位
 */
export function resolveNotificationTitle(
  input: NotificationTitleInput,
  unknownLabel: (gidPrefix: string) => string
): string {
  const direct = (input.name || '').trim()
  if (direct) return direct

  for (const file of input.files || []) {
    const fromPath = nameFromPath(file?.path || '')
    if (fromPath) return fromPath
  }

  for (const file of input.files || []) {
    for (const item of file?.uris || []) {
      const fromUri = nameFromUrl(item?.uri || '')
      if (fromUri) return fromUri
    }
  }

  for (const uri of input.uris || []) {
    const fromUri = nameFromUrl(uri)
    if (fromUri) return fromUri
  }

  const gid = (input.gid || '').trim()
  return unknownLabel(gid.slice(0, GID_PREFIX_LENGTH) || gid)
}

/** 供测试与调用方复用：gid 片段 */
export function gidPrefix(gid: string): string {
  return (gid || '').trim().slice(0, GID_PREFIX_LENGTH)
}
