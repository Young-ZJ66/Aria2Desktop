/**
 * 流媒体任务持久化服务（D-37）。
 *
 * 为什么需要：yt-dlp 任务不进 aria2 队列，渲染层的记录原本"只活到本次运行"——
 * 关掉 App 再打开，已完成的任务与失败待重试的任务全部消失，用户看不到下载成果，
 * 也没法对失败任务点重试。这里把任务快照落到 localStorage，启动时恢复。
 *
 * 为什么用 localStorage 而不是主进程 electron-store：流媒体任务的全部状态本来
 * 就只在渲染层（主进程的快照表是内存态、重启即弃），走主进程存储需要新增
 * IPC 通道与 preload 接口，而 D-37 的写入范围只包含渲染层服务；localStorage 在
 * 500 条上限下体积可控（单条约 0.5KB，500 条约 250KB，远低于 5MB 配额）。
 *
 * 三个必须守住的性质：
 * 1. **schemaVersion**：将来字段变更时能识别旧数据，而不是把脏结构当新结构读；
 * 2. **损坏容错**：JSON 解析失败 / 顶层结构不对时丢弃并清理，绝不让 App 启动崩在
 *    一条坏记录上；单条记录字段缺失/类型不对时跳过该条，保住其余记录；
 * 3. **上限**：最多保留 500 条（按创建时间淘汰最旧），避免配额打满后写入全部失败。
 */

import type { StreamTask, StreamTaskInput } from '@/utils/streamTaskUtils'
import { devLog } from '@/utils/devLog'

/** 持久化数据结构版本：字段语义变更时递增，旧版本数据按字段级降级读取 */
export const STREAM_TASK_SCHEMA_VERSION = 1

/** 最多保留的任务条数（按 createdAt 新→旧保留），导出给测试断言，避免两边各写一个数字 */
export const MAX_PERSISTED_STREAM_TASKS = 500

/** localStorage 键名（与 aria2 任务持久化的键区分开，互不影响） */
export const STREAM_TASK_STORAGE_KEY = 'aria2desktop.streamTasks'

/** 应用重启时，上一次运行遗留的进行中/暂停任务统一改写成的错误文案 */
export const STREAM_TASK_INTERRUPTED_ERROR = '应用重启，任务已中断，请重试'

/** 落盘合批窗口：进度事件很密（每秒数条），合并成一次写入 */
const PERSIST_DEBOUNCE_MS = 300

/** 只依赖 getItem/setItem/removeItem 三个方法，便于测试注入假存储 */
export interface StreamTaskStorageLike {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

/** 落盘载荷：包一层 envelope，便于识别版本与整体结构 */
interface StreamTaskStorageEnvelope {
  schemaVersion: number
  tasks: unknown[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function toOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * 校验并还原一条持久化的发起参数。
 *
 * 旧版本（扩展发起的下载）根本没有 input 字段，返回 undefined 让重试走降级路径；
 * 部分字段坏掉时只保留可用的部分，而不是整条丢弃——少一个字幕语言也不该丢任务。
 */
function sanitizeInput(raw: unknown): StreamTaskInput | undefined {
  if (!isRecord(raw)) return undefined
  const url = toOptionalString(raw.url)
  const outputDir = toOptionalString(raw.outputDir)
  if (!url || !outputDir) return undefined
  const playlist = isRecord(raw.playlist) && Array.isArray(raw.playlist.ids)
    ? { ids: raw.playlist.ids.filter((id): id is string => typeof id === 'string' && !!id) }
    : undefined
  const subtitle = isRecord(raw.subtitle) && Array.isArray(raw.subtitle.languages)
    ? {
      enabled: raw.subtitle.enabled === true,
      languages: raw.subtitle.languages.filter((lang): lang is string => typeof lang === 'string' && !!lang),
      ...(typeof raw.subtitle.includeAuto === 'boolean' ? { includeAuto: raw.subtitle.includeAuto } : {})
    }
    : undefined
  return {
    url,
    outputDir,
    formatId: typeof raw.formatId === 'string' ? raw.formatId : '',
    merge: raw.merge === true,
    title: typeof raw.title === 'string' ? raw.title : '',
    ...(playlist && playlist.ids.length > 0 ? { playlist } : {}),
    ...(subtitle && subtitle.languages.length > 0 ? { subtitle } : {}),
    ...(toOptionalString(raw.cookieFile) ? { cookieFile: toOptionalString(raw.cookieFile) } : {}),
    ...(raw.extractAudio === true ? { extractAudio: true } : {})
  }
}

/**
 * 把一条原始记录收敛成 StreamTask；无法识别（缺 gid/url/status 或时间戳）时返回 null。
 *
 * 关键行为：上一次运行遗留的 active/paused 在这里就改写为 error + 中断文案。
 * 那些 yt-dlp 子进程随应用退出已被杀掉，恢复成"进行中"只会让用户对着一个永远 0% 的任务，
 * 而恢复成 error 能直接给出重试入口。
 */
export function sanitizePersistedStreamTask(raw: unknown): StreamTask | null {
  if (!isRecord(raw)) return null
  const gid = toOptionalString(raw.gid)
  const url = toOptionalString(raw.url)
  const statusRaw = raw.status
  if (!gid || !url) return null
  if (statusRaw !== 'active' && statusRaw !== 'paused' && statusRaw !== 'complete' && statusRaw !== 'error') {
    return null
  }

  const filePaths = Array.isArray(raw.filePaths)
    ? raw.filePaths.filter((item): item is string => typeof item === 'string' && !!item)
    : undefined
  const filePath = toOptionalString(raw.filePath)
  const interrupted = statusRaw === 'active' || statusRaw === 'paused'
  const error = interrupted ? STREAM_TASK_INTERRUPTED_ERROR : toOptionalString(raw.error)
  const input = sanitizeInput(raw.input)
  const completedAt = toOptionalNumber(raw.completedAt)

  return {
    gid,
    url,
    formatId: typeof raw.formatId === 'string' ? raw.formatId : '',
    merge: raw.merge === true,
    outputDir: typeof raw.outputDir === 'string' ? raw.outputDir : '',
    title: typeof raw.title === 'string' && raw.title ? raw.title : url,
    status: interrupted ? 'error' : statusRaw,
    percent: interrupted ? 0 : toFiniteNumber(raw.percent, 0),
    speedBytes: 0,
    speedText: '',
    eta: '',
    totalBytes: toFiniteNumber(raw.totalBytes, 0),
    downloadedBytes: toFiniteNumber(raw.downloadedBytes, 0),
    ...(filePath ? { filePath } : {}),
    ...(filePaths && filePaths.length > 0 ? { filePaths } : {}),
    ...(error ? { error } : {}),
    createdAt: toFiniteNumber(raw.createdAt, Date.now()),
    ...(completedAt !== undefined ? { completedAt } : {}),
    ...(input ? { input } : {})
  }
}

/** 按创建时间新→旧裁剪到上限（就地返回新数组，不修改入参） */
function pruneToLimit(tasks: StreamTask[]): StreamTask[] {
  if (tasks.length <= MAX_PERSISTED_STREAM_TASKS) return tasks
  return [...tasks]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_PERSISTED_STREAM_TASKS)
}

export class StreamTaskPersistenceService {
  private readonly storageKey: string
  /** 注入的存储；未注入时按需读取 globalThis.localStorage（模块加载阶段不碰 DOM） */
  private readonly injectedStorage: StreamTaskStorageLike | null
  private records: StreamTask[] = []
  private persistTimer: ReturnType<typeof setTimeout> | null = null

  constructor(options: { storageKey?: string; storage?: StreamTaskStorageLike | null } = {}) {
    this.storageKey = options.storageKey ?? STREAM_TASK_STORAGE_KEY
    this.injectedStorage = options.storage ?? null
  }

  /**
   * 解析存储。Electron 渲染进程与测试都通过 globalThis 暴露 localStorage；
   * 拿不到（主进程上下文 / 测试没桩）时返回 null，所有读写静默降级为空操作。
   */
  private getStorage(): StreamTaskStorageLike | null {
    if (this.injectedStorage) return this.injectedStorage
    try {
      const storage = (globalThis as { localStorage?: StreamTaskStorageLike }).localStorage
      return storage ?? null
    } catch {
      return null
    }
  }

  /**
   * 读出并清洗持久化记录（应用启动时由 store 调用一次）。
   *
   * 不做「只读一次」的记忆化：存储不可用（无 localStorage / 测试环境）时内存态必须
   * 跟着清空，否则上一次写入的记录会在下一次加载时"诈尸"进任务列表。
   */
  load(): StreamTask[] {
    this.records = []
    const storage = this.getStorage()
    if (!storage) return this.records

    let raw: string | null = null
    try {
      raw = storage.getItem(this.storageKey)
    } catch {
      return this.records
    }
    if (!raw) return this.records

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      // 损坏的 JSON：清掉，否则每次启动都会重复解析失败
      devLog('流媒体任务持久化数据损坏，已清理:', error)
      this.safeRemove(storage)
      return this.records
    }

    if (!isRecord(parsed) || !Array.isArray(parsed.tasks)) {
      devLog('流媒体任务持久化数据结构非法，已清理')
      this.safeRemove(storage)
      return this.records
    }
    const envelope = parsed as unknown as StreamTaskStorageEnvelope
    const version = toFiniteNumber(envelope.schemaVersion, 0)
    if (version > STREAM_TASK_SCHEMA_VERSION) {
      // 未来版本写的数据：当前代码读不懂字段语义，宁可丢弃也不猜
      devLog('流媒体任务持久化数据版本过新，已忽略:', version)
      return this.records
    }

    const restoredTasks: StreamTask[] = []
    for (const item of envelope.tasks) {
      const task = sanitizePersistedStreamTask(item)
      if (task) restoredTasks.push(task)
    }
    this.records = pruneToLimit(restoredTasks)
    return this.records
  }

  /** 当前内存态快照（副本，外部改动不会污染内部状态） */
  getSnapshot(): StreamTask[] {
    return this.records.map(task => ({ ...task }))
  }

  /** 新增或覆盖一条记录（进度事件会高频调用，写入被合批） */
  upsert(task: StreamTask): void {
    const index = this.records.findIndex(item => item.gid === task.gid)
    const copy = { ...task }
    if (index >= 0) {
      this.records = this.records.map(item => (item.gid === task.gid ? copy : item))
    } else {
      this.records = pruneToLimit([copy, ...this.records])
    }
    this.schedulePersist()
  }

  /** 用完整列表覆盖（恢复后回写归一化结果、批量清理时用） */
  replaceAll(tasks: StreamTask[]): void {
    this.records = pruneToLimit(tasks.map(task => ({ ...task })))
    this.schedulePersist()
  }

  /** 删除一条记录（删除任务时同步删除持久化记录） */
  remove(gid: string): void {
    const next = this.records.filter(task => task.gid !== gid)
    if (next.length === this.records.length) return
    this.records = next
    this.schedulePersist()
  }

  /** 清空全部记录（测试/诊断用） */
  clear(): void {
    this.records = []
    const storage = this.getStorage()
    if (storage) this.safeRemove(storage)
  }

  /** 立即落盘（测试与退出前需要强一致的场景） */
  flush(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    this.persist()
  }

  private schedulePersist(): void {
    if (this.persistTimer) return
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      this.persist()
    }, PERSIST_DEBOUNCE_MS)
    // 渲染层不需要让定时器拖住进程退出（Node 环境下 unref 存在，浏览器里没有）
    const timer = this.persistTimer as unknown as { unref?: () => void }
    timer.unref?.()
  }

  private persist(): void {
    const storage = this.getStorage()
    if (!storage) return
    const envelope: StreamTaskStorageEnvelope = {
      schemaVersion: STREAM_TASK_SCHEMA_VERSION,
      tasks: this.records
    }
    try {
      storage.setItem(this.storageKey, JSON.stringify(envelope))
    } catch (error) {
      // 配额满 / 隐私模式禁用存储：持久化失败不应影响下载本身
      devLog('流媒体任务持久化写入失败:', error)
    }
  }

  private safeRemove(storage: StreamTaskStorageLike): void {
    try {
      storage.removeItem(this.storageKey)
    } catch {
      // 忽略：清理失败不影响启动
    }
  }
}

/** 全局单例（渲染层只用这一个；测试用 new StreamTaskPersistenceService({...}) 注入假存储） */
export const streamTaskPersistence = new StreamTaskPersistenceService()
