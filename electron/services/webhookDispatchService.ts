/**
 * Webhook 投递服务（v1.3.7）
 *
 * 完成规则的 webhook 动作不再在 completionRuleService 里内联 fetch，而是统一入队到这里：
 * 15 秒 ticker + 指数退避重试，超过 maxRetries 的条目留在队列里等人工重试/清空
 * （设置页「Webhook 队列」面板经 IPC 读写）。
 *
 * 设计要点：
 * - 队列持久化在 store 顶层键 webhookQueue（契约见 src/shared/webhookQueue.ts），上限 200；
 *   超限时先淘汰最旧 failed，仍超限再淘汰最旧 pending（在途 delivering 不动）。
 * - secret 存在时按固定契约签名：X-Aria2-Timestamp（epoch 毫秒）+ X-Aria2-Signature（sha256=hex），
 *   签的是 `${timestamp}.${body}`；GET 无 body 时 body 部分为空串。
 * - 载荷随条目落盘（契约里的 payload 字段）：重试时 aria2 可能已清掉任务，队列必须能独立重放；
 *   secret 不落盘（密钥写进 store 的明文 JSON 等于泄露），只在内存缓存，进程重启后
 *   按 url + method 从当前设置反查（见 resolveSecret）。
 */
import { createHmac, randomUUID } from 'crypto'
import { BrowserWindow } from 'electron'
import Store from 'electron-store'
import { registerSecureHandler } from '../utils/ipcSecurity'
import { getSettingsFresh } from '../utils/settingsAccessor'
import { createLogger } from '../utils/logger'
// 注意：主进程产物是 CJS，运行时无法解析 @/ 别名，必须用相对路径引入 src/shared
import type { WebhookQueueEntry } from '../../src/shared/webhookQueue'
import type { CompletionRuleAction } from '../../src/shared/appSettings'
import type { StoreData } from '../types/store'

// 本文件日志文案自带 [Webhook] 前缀（与 rssSubscriptionService 一致），故 scope 传空避免前缀重复
const logger = createLogger('')

/** ticker 步长：15 秒一跳，扫到期（nextAttemptAt ≤ now）的 pending 条目 */
const TICKER_INTERVAL_MS = 15_000

/** 队列容量上限（条）：超出按「最旧 failed → 最旧 pending」淘汰 */
const MAX_QUEUE_SIZE = 200

/** 单轮投递并发上限：同时最多 3 个请求在飞 */
const MAX_CONCURRENCY = 3

/** 单次请求超时（与改造前内联 fetch 的 10 秒保持一致） */
const FETCH_TIMEOUT_MS = 10_000

/** 指数退避上限：6 小时（秒） */
const MAX_BACKOFF_SECONDS = 21_600

/** maxRetries 默认值（不含首次投递）与允许区间 */
const DEFAULT_MAX_RETRIES = 4
const MIN_MAX_RETRIES = 0
const MAX_MAX_RETRIES = 10

/** 退避基准秒数默认值与允许区间 */
const DEFAULT_RETRY_DELAY_SECONDS = 60
const MIN_RETRY_DELAY_SECONDS = 5
const MAX_RETRY_DELAY_SECONDS = 3600

/** 启动时把遗留 delivering 复位为 pending 后的延迟（毫秒）：给上次进程的在途请求留点余量 */
const RESUME_DELAY_MS = 5_000

/** 完成规则 webhook 动作（secret/maxRetries/retryDelaySeconds 是 v1.3.7 新增的可选字段） */
type WebhookAction = Extract<CompletionRuleAction, { type: 'webhook' }>

/** Webhook 载荷：由 completionRuleService 构造，队列原样投递（GET 时不发送） */
export interface WebhookPayload {
  event: string
  gid: string
  status: string
  name: string
  files: string[]
  dir: string
  timestamp: string
}

/** 'webhook-queue-retry' 的返回载荷 */
export interface WebhookQueueRetryResult {
  success: boolean
  error?: string
}

/** 'webhook-queue-clear' 的返回载荷 */
export interface WebhookQueueClearResult {
  success: boolean
  cleared: number
}

/** 数值钳制（NaN/Infinity 一律回落到下界，避免坏配置写成"永不重试"或"永不退避"） */
function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(value, min), max)
}

/**
 * 第 attempts 次失败后的退避时长（毫秒）：min(base * 2^(attempts-1), 21600) 秒。
 *
 * attempts 从 1 开始（首次投递失败后为 1 → 等 base 秒）。纯函数，便于单测穷举。
 */
export function computeBackoffMs(baseDelaySeconds: number, attempts: number): number {
  const base = Number.isFinite(baseDelaySeconds) && baseDelaySeconds > 0 ? baseDelaySeconds : MIN_RETRY_DELAY_SECONDS
  const step = Number.isFinite(attempts) && attempts > 1 ? Math.floor(attempts) : 1
  const seconds = Math.min(base * Math.pow(2, step - 1), MAX_BACKOFF_SECONDS)
  return seconds * 1000
}

/**
 * 构造签名头（纯函数，便于单测用固定向量断言）。
 *
 * hex = HMAC-SHA256(secret, `${timestamp}.${body}`)，body 是实际发送的精确 JSON 字符串；
 * GET 无 body 时传空串（即签 `${timestamp}.`）。接收方用同样的时间戳与原文校验。
 */
export function buildSignatureHeaders(secret: string, timestamp: number, body: string): Record<string, string> {
  const ts = String(timestamp)
  const signature = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')
  return {
    'X-Aria2-Timestamp': ts,
    'X-Aria2-Signature': `sha256=${signature}`
  }
}

/**
 * Webhook 投递队列服务。
 *
 * 单例由 main.ts 经 initWebhookDispatchService(store) 创建并接线；
 * completionRuleService 的 webhook 动作经 getWebhookDispatchService() 入队。
 */
export class WebhookDispatchService {
  private store: Store<StoreData>
  private fetcher: typeof fetch
  private timer: NodeJS.Timeout | null = null
  /** 进行中的一轮调度（ticker 与 kick 重叠时复用它，不并发跑第二轮） */
  private activeRound: Promise<void> | null = null
  /** 调度进行中又被 kick 过：本轮结束后补跑一轮，保证首投不被 15 秒 ticker 拖住 */
  private kickPending = false
  /** 条目 id → 签名密钥（不落盘：密钥写进 store 的明文 JSON 等于泄露） */
  private secrets = new Map<string, string>()
  /**
   * 供 ipcSecurity 工厂使用的窗口取值器。
   *
   * 本服务只需要 store（main.ts 不传 windowController），因此直接取当前窗口：
   * 应用是单窗口结构（只有 WindowController 创建 BrowserWindow），取第一个即可。
   */
  private windowRef = (): BrowserWindow | null => BrowserWindow.getAllWindows()[0] ?? null

  constructor(store: Store<StoreData>, fetcher: typeof fetch = globalThis.fetch) {
    this.store = store
    this.fetcher = fetcher
  }

  /**
   * 启动：先把上次进程中断留下的 delivering 复位为 pending（那些请求永远不会回来），
   * 再挂 15 秒 ticker 并立刻补一跳。
   */
  initialize(): void {
    if (this.timer) return
    const list = this.readQueue()
    const resumeAt = Date.now() + RESUME_DELAY_MS
    let resumed = 0
    for (const entry of list) {
      if (entry.status !== 'delivering') continue
      entry.status = 'pending'
      entry.nextAttemptAt = resumeAt
      resumed += 1
    }
    if (resumed > 0) {
      this.writeQueue(list)
      logger.warn(`[Webhook] 检测到 ${resumed} 条中断的投递，已复位为待投递（${RESUME_DELAY_MS / 1000} 秒后重试）`)
    }
    this.timer = setInterval(() => this.kick(), TICKER_INTERVAL_MS)
    // 纯补投任务，不该阻止进程退出
    this.timer.unref()
    this.kick()
  }

  /** 清理定时器（应用退出时调用） */
  shutdown(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /**
   * 入队并异步触发一轮投递（不阻塞调用方：完成规则的执行链不该等网络）。
   *
   * 入队参数在这里固化：maxRetries 钳到 0-10，退避基准钳到 5-3600 秒，
   * 后续重试只用条目里的值，不受用户中途改配置影响。
   */
  enqueue(action: WebhookAction, payload: WebhookPayload): WebhookQueueEntry {
    const now = Date.now()
    const entry: WebhookQueueEntry = {
      id: randomUUID(),
      url: action.url,
      method: action.method === 'GET' ? 'GET' : 'POST',
      event: payload.event,
      gid: payload.gid,
      attempts: 0,
      maxRetries: clamp(action.maxRetries ?? DEFAULT_MAX_RETRIES, MIN_MAX_RETRIES, MAX_MAX_RETRIES),
      baseDelaySeconds: clamp(
        action.retryDelaySeconds ?? DEFAULT_RETRY_DELAY_SECONDS,
        MIN_RETRY_DELAY_SECONDS,
        MAX_RETRY_DELAY_SECONDS
      ),
      nextAttemptAt: now,
      lastError: '',
      status: 'pending',
      createdAt: now,
      // 载荷随条目落盘：重试时任务状态与文件列表可能已被 aria2 清理，队列要能独立重放
      payload: { ...payload }
    }
    if (action.secret) this.secrets.set(entry.id, action.secret)
    const list = this.readQueue()
    list.push(entry)
    this.writeQueue(this.trimToCapacity(list))
    logger.info(`[Webhook] 入队: ${entry.method} ${entry.url} (gid=${entry.gid}, maxRetries=${entry.maxRetries})`)
    this.kick()
    return entry
  }

  /** 队列快照（新→旧，供设置页展示） */
  listEntries(): WebhookQueueEntry[] {
    return [...this.readQueue()].reverse()
  }

  /** 手动重试一条失败条目：状态/计数复位后立刻投递 */
  retryEntry(id: string): WebhookQueueRetryResult {
    const list = this.readQueue()
    const entry = list.find(item => item.id === id)
    if (!entry) return { success: false, error: '队列条目不存在' }
    entry.status = 'pending'
    entry.attempts = 0
    entry.nextAttemptAt = Date.now()
    this.writeQueue(list)
    logger.info(`[Webhook] 手动重试: ${entry.url} (gid=${entry.gid})`)
    this.kick()
    return { success: true }
  }

  /** 清空队列，返回清掉的条数 */
  clearQueue(): number {
    const cleared = this.readQueue().length
    this.writeQueue([])
    this.secrets.clear()
    if (cleared > 0) logger.info(`[Webhook] 队列已清空，共 ${cleared} 条`)
    return cleared
  }

  /** 等当前（及随后补跑的）调度轮次结束：shutdown 前的收尾与单测都用它 */
  async waitForIdle(): Promise<void> {
    while (this.activeRound) await this.activeRound
  }

  /** 注册设置页「Webhook 队列」面板用的三个通道（通道名与 preload 已定稿的一致） */
  registerIpcHandlers(): void {
    registerSecureHandler('webhook-queue-list', () => ({ entries: this.listEntries() }), {
      getMainWindow: this.windowRef
    })

    registerSecureHandler('webhook-queue-retry', (event, id: string) => this.retryEntry(id), {
      getMainWindow: this.windowRef
    })

    registerSecureHandler('webhook-queue-clear', (): WebhookQueueClearResult => ({ success: true, cleared: this.clearQueue() }), {
      getMainWindow: this.windowRef
    })
  }

  /** 异步触发一轮投递（enqueue/retry/initialize 都调它） */
  private kick(): void {
    if (this.activeRound) {
      this.kickPending = true
      return
    }
    const round = this.runRound()
    this.activeRound = round
    void round.then(() => {
      if (this.activeRound === round) this.activeRound = null
      if (this.kickPending) {
        this.kickPending = false
        this.kick()
      }
    })
  }

  /**
   * 一轮调度：取出所有到期 pending，按并发上限 3 分批投递完。
   *
   * 分批而不是只取前 3 条：一次到期 6 条时，剩下的 3 条不该再等 15 秒。
   */
  private async runRound(): Promise<void> {
    try {
      const now = Date.now()
      const due = this.readQueue().filter(entry => entry.status === 'pending' && entry.nextAttemptAt <= now)
      for (let index = 0; index < due.length; index += MAX_CONCURRENCY) {
        const batch = due.slice(index, index + MAX_CONCURRENCY)
        await Promise.all(batch.map(entry => this.deliver(entry.id)))
      }
    } catch (error) {
      // 兜底：单条投递的异常在 deliver 内已收敛，这里只防调度层意外把 ticker 打死
      logger.warn('[Webhook] 投递轮次异常', error)
    }
  }

  /** 投递单条（失败在这里收敛成条目状态，绝不抛出） */
  private async deliver(id: string): Promise<void> {
    // 重新读一次：调度用的快照可能已被 retry/clear/淘汰改动
    const entry = this.readQueue().find(item => item.id === id)
    if (!entry || entry.status !== 'pending') return
    // 先置 delivering 并落盘：进程若此刻被杀，重启后 initialize() 会把它复位重投
    this.patchEntry(id, { status: 'delivering' })

    const payload = (entry.payload as unknown as WebhookPayload | undefined) ?? this.reconstructPayload(entry)
    const body = entry.method === 'GET' ? '' : JSON.stringify(payload)
    const secret = this.secrets.get(id) || this.resolveSecret(entry)
    const headers: Record<string, string> = {}
    if (entry.method !== 'GET') headers['Content-Type'] = 'application/json'
    if (secret) {
      // 时间戳与签名必须成对生成：签名覆盖的就是这个时间戳
      Object.assign(headers, buildSignatureHeaders(secret, Date.now(), body))
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    let failure = ''
    try {
      const response = await this.fetcher(entry.url, {
        method: entry.method,
        headers,
        body: entry.method === 'GET' ? undefined : body,
        signal: controller.signal
      })
      if (response.ok) {
        this.removeEntry(id)
        return
      }
      failure = `HTTP ${response.status}`
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error)
    } finally {
      clearTimeout(timer)
    }
    this.recordFailure(id, failure)
  }

  /** 记录一次失败：推进计数与下次投递时间，超过 maxRetries 转 failed 等人工处理 */
  private recordFailure(id: string, message: string): void {
    const list = this.readQueue()
    const entry = list.find(item => item.id === id)
    if (!entry) return
    const now = Date.now()
    entry.attempts += 1
    entry.lastAttemptAt = now
    entry.lastError = message
    if (entry.attempts > entry.maxRetries) {
      entry.status = 'failed'
      entry.nextAttemptAt = now
      logger.warn(`[Webhook] 投递失败已达上限，转入失败队列: ${entry.url} (gid=${entry.gid}, attempts=${entry.attempts})`)
    } else {
      entry.status = 'pending'
      entry.nextAttemptAt = now + computeBackoffMs(entry.baseDelaySeconds, entry.attempts)
      logger.warn(`[Webhook] 投递失败，${computeBackoffMs(entry.baseDelaySeconds, entry.attempts) / 1000} 秒后重试: ${entry.url} (${message})`)
    }
    this.writeQueue(list)
  }

  /** 投递成功：移出队列并落盘，顺手丢掉内存里的载荷与密钥 */
  private removeEntry(id: string): void {
    const list = this.readQueue()
    const index = list.findIndex(item => item.id === id)
    if (index < 0) return
    list.splice(index, 1)
    this.writeQueue(list)
    this.secrets.delete(id)
  }

  /** 容量裁剪：先淘汰最旧 failed，仍超限再淘汰最旧 pending；在途 delivering 不动 */
  private trimToCapacity(list: WebhookQueueEntry[]): WebhookQueueEntry[] {
    while (list.length > MAX_QUEUE_SIZE) {
      const victim = this.pickOldest(list, 'failed') ?? this.pickOldest(list, 'pending')
      if (!victim) {
        // 全在投递中：宁可短暂超限，也不丢在途条目（它们马上就出结果）
        logger.warn(`[Webhook] 队列超出上限 ${MAX_QUEUE_SIZE} 条，但无 failed/pending 可淘汰`)
        break
      }
      list.splice(list.indexOf(victim), 1)
      this.secrets.delete(victim.id)
      logger.warn(`[Webhook] 队列已满，淘汰最旧 ${victim.status} 条目: ${victim.url} (gid=${victim.gid})`)
    }
    return list
  }

  /** 取指定状态里 createdAt 最早的条目 */
  private pickOldest(list: WebhookQueueEntry[], status: WebhookQueueEntry['status']): WebhookQueueEntry | undefined {
    let oldest: WebhookQueueEntry | undefined
    for (const entry of list) {
      if (entry.status !== status) continue
      if (!oldest || entry.createdAt < oldest.createdAt) oldest = entry
    }
    return oldest
  }

  /**
   * 反查签名密钥：队列条目契约里没有 secret 字段（密钥不该随队列落盘），
   * 正常路径用入队时缓存在内存里的值；进程重启后内存已空，则按 url + method
   * 到当前设置里的 webhook 动作中找回同一把密钥，保证续投的签名仍然有效。
   */
  private resolveSecret(entry: WebhookQueueEntry): string {
    try {
      for (const rule of getSettingsFresh().completionRules || []) {
        for (const action of rule.actions || []) {
          if (action.type !== 'webhook') continue
          if (action.url !== entry.url) continue
          if ((action.method === 'GET' ? 'GET' : 'POST') !== entry.method) continue
          if (action.secret) return action.secret
        }
      }
    } catch (error) {
      // store 未绑定等异常：视为该条目没有密钥，按无签名投递（接收方会自行拒绝）
      logger.warn('[Webhook] 反查签名密钥失败，本条按无签名投递', error)
    }
    return ''
  }

  /**
   * 兜底载荷：只给没有 payload 字段的历史条目用（旧版本写入或测试构造）。
   * 正常入队的条目都带完整 payload，不会走到这里。
   */
  private reconstructPayload(entry: WebhookQueueEntry): WebhookPayload {
    return {
      event: entry.event,
      gid: entry.gid,
      status: entry.event === 'download.complete' ? 'complete' : 'error',
      name: '',
      files: [],
      dir: '',
      timestamp: new Date(entry.createdAt).toISOString()
    }
  }

  /** 读队列（旧 store 文件没有该键 → 空数组） */
  private readQueue(): WebhookQueueEntry[] {
    return (this.store.get('webhookQueue') as WebhookQueueEntry[] | undefined) ?? []
  }

  /** 覆写队列（每次状态变更立即整体落盘：上限 200 条，写入成本可忽略） */
  private writeQueue(list: WebhookQueueEntry[]): void {
    this.store.set('webhookQueue', list)
  }

  /** 只更新单条目的部分字段 */
  private patchEntry(id: string, patch: Partial<WebhookQueueEntry>): void {
    const list = this.readQueue()
    const index = list.findIndex(item => item.id === id)
    if (index < 0) return
    list[index] = { ...list[index], ...patch }
    this.writeQueue(list)
  }
}

/**
 * 模块级单例（main.ts 在 store 就绪后调用一次）。
 *
 * completionRuleService 里的 webhook 动作没有实例注入点（applyCompletionRules 是模块级函数，
 * 由 IpcController 调用），因此走这个单例访问器，避免把服务实例穿过整条调用链。
 */
let service: WebhookDispatchService | null = null

/** 创建（或复用）单例：main.ts 在 store 创建之后、任何完成规则触发之前调用 */
export function initWebhookDispatchService(
  store: Store<StoreData>,
  fetcher: typeof fetch = globalThis.fetch
): WebhookDispatchService {
  if (!service) service = new WebhookDispatchService(store, fetcher)
  return service
}

/** 取单例；未初始化时返回 null（调用方需自行兜底） */
export function getWebhookDispatchService(): WebhookDispatchService | null {
  return service
}
