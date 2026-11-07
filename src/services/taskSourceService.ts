/**
 * 任务原始来源存储
 *
 * 为什么需要：aria2 的 tellStatus 对种子/磁力任务不会返回原始 magnet/torrent
 * （files[].uris 为空），失败后「重试」只靠 tellStatus 必然拼不出可重新提交的请求。
 * 这里在添加任务时记录原始来源（URI 列表 / .torrent 内容 / metalink 内容）与提交选项，
 * 重试时优先用原始来源重建任务；应用重启后仍可从主进程存储恢复。
 */
import { devLog } from '@/utils/devLog'

export type TaskSource =
  | { kind: 'uri'; uris: string[] }
  | { kind: 'torrent'; torrent: string; uris?: string[] }
  | { kind: 'metalink'; metalink: string }

export interface TaskSourceRecord {
  source: TaskSource
  options?: Record<string, string | string[]>
  createdAt: number
}

const STORAGE_KEY = 'taskSources'
const MAX_RECORDS = 2000

class TaskSourceService {
  private records = new Map<string, TaskSourceRecord>()
  private loaded = false
  private loadPromise: Promise<void> | null = null
  private persistTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const data = JSON.parse(raw)
        if (data && typeof data === 'object' && !Array.isArray(data)) {
          this.records = new Map(Object.entries(data) as [string, TaskSourceRecord][])
        }
      }
    } catch {
      // 损坏的本地缓存不应影响任务列表
      try { localStorage.removeItem(STORAGE_KEY) } catch { /* 忽略 */ }
    }
  }

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    if (this.loadPromise) return this.loadPromise
    this.loadPromise = (async () => {
      try {
        const data = window.electronAPI?.getStoreValue
          ? await window.electronAPI.getStoreValue(STORAGE_KEY)
          : null
        if (data && typeof data === 'object' && !Array.isArray(data)) {
          this.records = new Map(Object.entries(data) as [string, TaskSourceRecord][])
          devLog(`Loaded ${this.records.size} task sources from backend`)
        }
      } catch (error) {
        console.warn('Failed to load task sources:', error)
      } finally {
        this.loaded = true
      }
    })()
    try { await this.loadPromise } finally { this.loadPromise = null }
  }

  record(gid: string, source: TaskSource, options?: Record<string, string | string[]>): void {
    this.records.set(gid, { source, options, createdAt: Date.now() })
    while (this.records.size > MAX_RECORDS) {
      const oldest = this.records.keys().next()
      if (oldest.done) break
      this.records.delete(oldest.value)
    }
    this.schedulePersist()
  }

  get(gid: string): TaskSourceRecord | undefined {
    return this.records.get(gid)
  }

  remove(gid: string): void {
    if (!this.records.delete(gid)) return
    this.schedulePersist()
  }

  /** 清空某个连接之外的来源记录由调用方决定；这里提供全量清理用于诊断/重置 */
  clear(): void {
    this.records.clear()
    this.schedulePersist()
  }

  private schedulePersist(): void {
    if (this.persistTimer) return
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      void this.persist()
    }, 300)
  }

  private async persist(): Promise<void> {
    const data = Object.fromEntries(this.records)
    try {
      if (window.electronAPI?.setStoreValue) {
        await window.electronAPI.setStoreValue(STORAGE_KEY, data)
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
      }
    } catch (error) {
      console.warn('Failed to persist task sources:', error)
    }
  }
}

export const taskSourceService = new TaskSourceService()
