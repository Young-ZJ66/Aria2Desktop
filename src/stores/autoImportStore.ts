/**
 * 自动导入（RSS/Atom 订阅 + 监听文件夹）的渲染层状态。
 *
 * 主进程引擎不向渲染层主动推送事件（没有 onXxx 通道），列表与日志的唯一
 * 获取方式就是这 9 个 invoke；本 store 把它们收敛成"读列表 + 三组写操作"
 * 的形状，页面只需挂载时 loadAll、可见期间定时轮询。
 *
 * 写操作（save/delete/fetchNow/scanNow）一律把主进程的返回原样交还给调用方：
 * 成功与否、错误文本、条目预览都由 UI 决定怎么展示；这里只负责成功后刷新
 * 对应列表，并把失败文本记进 lastError 供页面顶栏提示。
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { AutoImportLogEntry, RssSubscription, WatchFolderConfig } from '@/shared/autoImport'

/** 'rss-subs-save' 的返回形状（与 rssSubscriptionService.RssSaveResult 对齐） */
export interface RssSaveOutcome {
  success: boolean
  subscription?: RssSubscription
  error?: string
}

/** 'rss-subs-fetch-now' 的返回形状（items 为 ≤20 条匹配预览） */
export interface RssFetchNowOutcome {
  success: boolean
  added: number
  error?: string
  items?: { title: string; link: string }[]
}

export interface WatchSaveOutcome {
  success: boolean
  folder?: WatchFolderConfig
  error?: string
}

/** 'watch-folders-scan-now' 的返回形状 */
export interface WatchScanOutcome {
  success: boolean
  imported: number
  error?: string
}

export const useAutoImportStore = defineStore('autoImport', () => {
  const subscriptions = ref<RssSubscription[]>([])
  const watchFolders = ref<WatchFolderConfig[]>([])
  const logEntries = ref<AutoImportLogEntry[]>([])
  const loading = ref(false)
  const lastError = ref<string | null>(null)

  /** invoke 抛异常（IPC 层失败）统一归一成 success:false 结果，让调用方只有一条展示路径 */
  function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  // 统一取桥接对象：preload 未注入（纯浏览器调试）时抛可读错误，避免每处重复判空
  function bridge(): NonNullable<Window['electronAPI']> {
    if (!window.electronAPI) {
      throw new Error('window.electronAPI is not available')
    }
    return window.electronAPI
  }

  async function loadSubscriptions(): Promise<void> {
    const result = await bridge().rssSubsList()
    subscriptions.value = result.subscriptions
  }

  async function loadFolders(): Promise<void> {
    const result = await bridge().watchFoldersList()
    watchFolders.value = result.folders
  }

  /** 读取导入日志（新→旧，上限 200 条） */
  async function refreshLog(): Promise<void> {
    const result = await bridge().autoImportLogList()
    logEntries.value = result.entries
  }

  /** 三列表一起拉（页面挂载 / 手动刷新用；loading 只在这里置位，轮询静默刷新不打扰界面） */
  async function loadAll(): Promise<void> {
    loading.value = true
    lastError.value = null
    try {
      await Promise.all([loadSubscriptions(), loadFolders(), refreshLog()])
    } catch (error) {
      lastError.value = errorMessage(error)
    } finally {
      loading.value = false
    }
  }

  /** 静默轮询：任何一条失败只记 lastError，绝不让未捕获异常打断后续轮次 */
  async function pollRefresh(): Promise<void> {
    try {
      await Promise.all([loadSubscriptions(), loadFolders(), refreshLog()])
      lastError.value = null
    } catch (error) {
      lastError.value = errorMessage(error)
    }
  }

  /** 按 id upsert 订阅；成功后刷新列表（新订阅的 id 由主进程生成） */
  async function saveSubscription(subscription: RssSubscription): Promise<RssSaveOutcome> {
    try {
      const result = await bridge().rssSubsSave(subscription)
      if (!result.success) lastError.value = result.error ?? ''
      else await loadSubscriptions()
      return result
    } catch (error) {
      const text = errorMessage(error)
      lastError.value = text
      return { success: false, error: text }
    }
  }

  async function deleteSubscription(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await bridge().rssSubsDelete(id)
      if (!result.success) lastError.value = ''
      else await loadSubscriptions()
      return result
    } catch (error) {
      const text = errorMessage(error)
      lastError.value = text
      return { success: false, error: text }
    }
  }

  /** 立即拉取：结果原样返回（added / error / items 预览由 UI 展示），成功后顺带刷新订阅行与日志 */
  async function fetchNow(id: string): Promise<RssFetchNowOutcome> {
    try {
      const result = await bridge().rssSubsFetchNow(id)
      if (!result.success) lastError.value = result.error ?? ''
      else await Promise.all([loadSubscriptions(), refreshLog()])
      return result
    } catch (error) {
      const text = errorMessage(error)
      lastError.value = text
      return { success: false, added: 0, error: text }
    }
  }

  async function saveFolder(folder: WatchFolderConfig): Promise<WatchSaveOutcome> {
    try {
      const result = await bridge().watchFoldersSave(folder)
      if (!result.success) lastError.value = result.error ?? ''
      else await loadFolders()
      return result
    } catch (error) {
      const text = errorMessage(error)
      lastError.value = text
      return { success: false, error: text }
    }
  }

  async function deleteFolder(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await bridge().watchFoldersDelete(id)
      if (!result.success) lastError.value = ''
      else await loadFolders()
      return result
    } catch (error) {
      const text = errorMessage(error)
      lastError.value = text
      return { success: false, error: text }
    }
  }

  /** 立即扫描：imported 数原样返回，成功后刷新文件夹行与日志 */
  async function scanNow(id: string): Promise<WatchScanOutcome> {
    try {
      const result = await bridge().watchFoldersScanNow(id)
      if (!result.success) lastError.value = result.error ?? ''
      else await Promise.all([loadFolders(), refreshLog()])
      return result
    } catch (error) {
      const text = errorMessage(error)
      lastError.value = text
      return { success: false, imported: 0, error: text }
    }
  }

  return {
    subscriptions,
    watchFolders,
    logEntries,
    loading,
    lastError,
    loadAll,
    pollRefresh,
    refreshLog,
    saveSubscription,
    deleteSubscription,
    fetchNow,
    saveFolder,
    deleteFolder,
    scanNow
  }
})
