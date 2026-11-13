import { randomUUID } from 'crypto'
import * as http from 'http'
import * as https from 'https'
import * as path from 'path'
import Store from 'electron-store'
import { WindowController } from '../controllers/WindowController'
import { registerSecureHandler } from '../utils/ipcSecurity'
import { callAria2Rpc } from '../utils/aria2Rpc'
import { activeRpcOptions } from '../utils/activeRpcConfig'
import { createLogger } from '../utils/logger'
import { parseFeed } from '../utils/feedParser'
import type { FeedItem } from '../utils/feedParser'
// 注意：主进程产物是 CJS，运行时无法解析 @/ 别名，必须用相对路径引入 src/shared
import type { AutoImportLogEntry, RssFeedItemPreview, RssSubscription } from '../../src/shared/autoImport'
import type { StoreData } from '../types/store'

// 本文件日志文案自带 [RssSubscription] 前缀（历史风格），故 scope 传空避免前缀重复
const logger = createLogger('')

/** ticker 步长：固定 60 秒，订阅各自按 intervalMinutes 判断是否到期 */
const TICKER_INTERVAL_MS = 60_000

/** 未配置 intervalMinutes 时的默认拉取间隔（分钟） */
const DEFAULT_INTERVAL_MINUTES = 30

/** intervalMinutes 的合法区间（保存时钳制） */
const MIN_INTERVAL_MINUTES = 5
const MAX_INTERVAL_MINUTES = 10_080

/** 未配置 maxPerFetch 时单次拉取最多添加的条数 */
const DEFAULT_MAX_PER_FETCH = 5

/** maxPerFetch 的合法区间（保存时钳制） */
const MIN_MAX_PER_FETCH = 1
const MAX_MAX_PER_FETCH = 50

/** include/exclude 正则的长度上限：超长模式几乎必是误粘贴，编译开销也大 */
const MAX_PATTERN_LENGTH = 200

/** 每个订阅的去重键上限（FIFO）：足够覆盖订阅源翻页回看，又不至于无限膨胀 */
const MAX_SEEN_KEYS = 500

/** 导入日志上限（条）：两条隧道共用，超出裁最旧 */
const MAX_LOG_ENTRIES = 200

/** feed-now 返回给 UI 的条目预览上限 */
const PREVIEW_LIMIT = 20

/** 拉取超时（毫秒），文本与二进制共用同一助手 */
const FETCH_TIMEOUT_MS = 20_000

/** 自动跟随的重定向次数上限 */
const MAX_REDIRECTS = 3

/** 响应体大小上限：订阅源是被信任拉取的，但失控源不能拖垮内存 */
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024

/** 'rss-subs-fetch-now' 的返回载荷 */
export interface RssFetchNowResult {
  success: boolean
  added: number
  error?: string
  items?: RssFeedItemPreview[]
}

/** 'rss-subs-save' 的返回载荷 */
export interface RssSaveResult {
  success: boolean
  subscription?: RssSubscription
  error?: string
}

/**
 * RSS/Atom 订阅自动下载服务。
 *
 * 60 秒一跳的单一 ticker 轮询所有订阅：到期（enabled 且距上次拉取超过
 * intervalMinutes）才真正拉取。拉取 → parseFeed → include/exclude 过滤 →
 * 已见去重 → maxPerFetch 截断 → 通过活动 RPC 端点添加到 aria2，全程逐条
 * 容错：单条失败只写日志，绝不让 ticker 崩掉。
 */
export class RssSubscriptionService {
  private store: Store<StoreData>
  private windowController: WindowController
  private timer: NodeJS.Timeout | null = null
  /** 进行中的拉取（按订阅 id）：ticker 与 fetch-now 并发时共享同一次请求 */
  private pendingFetches = new Map<string, Promise<RssFetchNowResult>>()
  /** 供 ipcSecurity 工厂使用的窗口取值器（与 trackerSubscriptionService 口径一致） */
  private windowRef = () => this.windowController.getMainWindow()

  constructor(store: Store<StoreData>, windowController: WindowController) {
    this.store = store
    this.windowController = windowController
  }

  /** 启动：立即补一跳（应用刚启动时过期的订阅不用等 60 秒），随后固定 60 秒一跳 */
  initialize(): void {
    if (this.timer) return
    this.tick()
    this.timer = setInterval(() => this.tick(), TICKER_INTERVAL_MS)
  }

  /** 清理定时器（应用退出时调用） */
  shutdown(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** 读取全部订阅（旧 store 文件没有该键 → 空列表） */
  getSubscriptions(): RssSubscription[] {
    return (this.store.get('rssSubscriptions') as RssSubscription[] | undefined) ?? []
  }

  /** 读指定订阅 */
  private findSubscription(id: string): RssSubscription | undefined {
    return this.getSubscriptions().find(sub => sub.id === id)
  }

  /** 覆写订阅列表 */
  private saveSubscriptions(list: RssSubscription[]): void {
    this.store.set('rssSubscriptions', list)
  }

  /** 只更新单个订阅的运行时字段（拉取状态写回） */
  private patchSubscription(id: string, patch: Partial<RssSubscription>): void {
    const list = this.getSubscriptions()
    const index = list.findIndex(sub => sub.id === id)
    if (index < 0) return
    list[index] = { ...list[index], ...patch }
    this.saveSubscriptions(list)
  }

  /**
   * 手动/定时拉取统一入口：同一订阅的并发调用共享同一个 Promise，
   * 避免 ticker 与用户手点在同一毫秒双拉。
   */
  fetchNow(id: string): Promise<RssFetchNowResult> {
    const pending = this.pendingFetches.get(id)
    if (pending) return pending
    const promise = this.performFetch(id).finally(() => {
      this.pendingFetches.delete(id)
    })
    this.pendingFetches.set(id, promise)
    return promise
  }

  private tick(): void {
    for (const sub of this.getSubscriptions()) {
      if (!this.isDue(sub)) continue
      // 不 await：单订阅的网络慢不该拖住其它订阅；异常在 performFetch 内已兜住
      void this.fetchNow(sub.id).catch(error => {
        logger.warn('[RssSubscription] 自动拉取异常:', sub.name, error)
      })
    }
  }

  /** 到期判定：enabled 且距上次拉取已超过 intervalMinutes（默认 30） */
  private isDue(sub: RssSubscription): boolean {
    if (!sub.enabled) return false
    const intervalMinutes = sub.intervalMinutes ?? DEFAULT_INTERVAL_MINUTES
    const last = sub.lastFetchAt ? new Date(sub.lastFetchAt).getTime() : Number.NaN
    // 从未拉取（或时间损坏）视为到期：宁可多拉一次，也不能让新订阅永远不出声
    if (Number.isNaN(last)) return true
    return Date.now() - last >= intervalMinutes * 60_000
  }

  /**
   * 拉取管线。feed 拉取失败只更新订阅状态；条目添加失败逐条写日志。
   */
  private async performFetch(id: string): Promise<RssFetchNowResult> {
    const sub = this.findSubscription(id)
    if (!sub) return { success: false, added: 0, error: '订阅不存在' }

    let xmlText: string
    try {
      xmlText = await this.fetchText(sub.url)
    } catch (error) {
      // 拉取失败也推进 lastFetchAt：否则坏源会在每个 60 秒跳都重试一次（intervalMinutes 形同虚设）
      const message = error instanceof Error ? error.message : String(error)
      this.patchSubscription(id, {
        lastFetchAt: new Date().toISOString(),
        lastStatus: 'error',
        lastError: message
      })
      return { success: false, added: 0, error: message }
    }

    const feed = parseFeed(xmlText)
    const matched = feed.items.filter(item => this.matchesFilters(item.title, sub))
    // 预览只描述"本次匹配到什么"，供 UI 提示，不参与后续流程
    const items: RssFeedItemPreview[] = matched
      .slice(0, PREVIEW_LIMIT)
      .map(item => ({ title: item.title, link: item.link }))

    // 去重键优先级 guid > enclosureUrl > link：guid 最稳定，链接可能被 CDN 改查询串
    const seen = new Set(this.getSeenKeys(id))
    const logEntries: AutoImportLogEntry[] = []
    const candidates: FeedItem[] = []
    for (const item of matched) {
      const key = this.itemKey(item)
      if (!key || seen.has(key)) {
        logEntries.push(this.buildLogEntry(sub, item, 'skipped', '重复条目，已跳过'))
        continue
      }
      candidates.push(item)
    }

    const maxPerFetch = Math.max(MIN_MAX_PER_FETCH, Math.min(MAX_MAX_PER_FETCH, sub.maxPerFetch ?? DEFAULT_MAX_PER_FETCH))
    const chosen = candidates.slice(0, maxPerFetch)
    // 命中即记为"已见"（先于 RPC）：永久坏链的条目不会每个周期都重试一遍刷爆日志；
    // 被 maxPerFetch 截断的条目保持未见，下个周期接着处理（自然形成排队）
    for (const item of chosen) seen.add(this.itemKey(item))

    let added = 0
    for (const item of chosen) {
      try {
        const gid = await this.addFeedItem(sub, item)
        added += 1
        logEntries.push(this.buildLogEntry(sub, item, 'added', undefined, gid))
      } catch (error) {
        // RPC 失败只影响这一条：整个 ticker 与本次拉取继续
        const message = error instanceof Error ? error.message : String(error)
        logEntries.push(this.buildLogEntry(sub, item, 'error', message))
        logger.warn('[RssSubscription] 添加失败:', sub.name, item.title, message)
      }
    }

    this.setSeenKeys(id, Array.from(seen))
    this.appendLog(logEntries)
    this.patchSubscription(id, {
      lastFetchAt: new Date().toISOString(),
      lastStatus: 'ok',
      lastError: null,
      lastAddedCount: added
    })
    return { success: true, added, items }
  }

  /** 条目的去重键（guid 优先，其次 enclosure，最后 link） */
  private itemKey(item: FeedItem): string {
    return item.guid || item.enclosureUrl || item.link || ''
  }

  /** include/exclude 过滤：只对 title 匹配；模式编译失败按"无此过滤"处理 */
  private matchesFilters(title: string, sub: RssSubscription): boolean {
    const include = this.compilePattern(sub.includePattern)
    if (include && !include.test(title)) return false
    const exclude = this.compilePattern(sub.excludePattern)
    if (exclude && exclude.test(title)) return false
    return true
  }

  /** 编译过滤正则：空/超长/非法一律返回 null（保存时已挡非法正则，这里是双保险） */
  private compilePattern(pattern: string | undefined): RegExp | null {
    if (!pattern || pattern.length > MAX_PATTERN_LENGTH) return null
    try {
      return new RegExp(pattern, 'i')
    } catch {
      return null
    }
  }

  /**
   * 把一条 feed 条目添加进 aria2：
   * 1) magnet: 链接 → addUri；
   * 2) 以 .torrent 结尾或 enclosure 声明为 bittorrent 的 http(s) → 拉二进制 → addTorrent；
   * 3) 其余 http(s) → addUri。
   */
  private async addFeedItem(sub: RssSubscription, item: FeedItem): Promise<string> {
    // 目标地址参数：订阅配置了 dir 才下发（aria2 端的缺省目录由全局配置决定）
    const options = sub.dir && sub.dir.trim() !== '' ? { dir: sub.dir } : {}

    const magnetUrl = [item.link, item.enclosureUrl].find((url): url is string => url !== undefined && /^magnet:/i.test(url))
    if (magnetUrl) {
      return this.rpc('aria2.addUri', [[magnetUrl], options])
    }

    const binaryUrl = item.enclosureUrl || item.link
    if (/^https?:\/\//i.test(binaryUrl) && (this.isTorrentUrl(binaryUrl) || item.enclosureType === 'application/x-bittorrent')) {
      const bytes = await this.fetchBinary(binaryUrl)
      const base64 = bytes.toString('base64')
      return this.rpc('aria2.addTorrent', [base64, [], options])
    }

    const plainUrl = item.link || item.enclosureUrl
    if (plainUrl !== undefined && /^https?:\/\//i.test(plainUrl)) {
      return this.rpc('aria2.addUri', [[plainUrl], options])
    }
    throw new Error('条目没有可下载的 magnet/http(s) 链接')
  }

  /** .torrent 后缀判定（大小写不敏感，含查询串前的路径） */
  private isTorrentUrl(url: string): boolean {
    const withoutQuery = url.split('?')[0] ?? url
    return withoutQuery.toLowerCase().endsWith('.torrent')
  }

  /** 经活动连接端点执行 RPC；返回 gid（aria2 各 add 方法的成功返回都是 gid 字符串） */
  private async rpc(method: string, params: unknown[], timeoutMs = 10_000): Promise<string> {
    // 端点必须每次现解析：用户随时可能切到远程 aria2，写死 127.0.0.1 会操作错引擎
    const result = await callAria2Rpc({ ...activeRpcOptions(), method, params, timeoutMs })
    return typeof result === 'string' ? result : String(result)
  }

  /** 拉取订阅源文本（utf-8） */
  private async fetchText(url: string): Promise<string> {
    return (await this.fetchBinary(url)).toString('utf-8')
  }

  /**
   * 通用 http(s) 拉取：重定向 ≤3、超时 20s、响应 ≤5MB，返回原始字节。
   * 与 tracker 服务不同，这里允许 http://：RSS 校验本来就放行明文源，
   * 且下载目标是 torrent 文件而非要写进配置的 tracker 列表，篡改风险面不同。
   */
  private fetchBinary(url: string, redirectCount = 0): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const fail = (err: unknown) => {
        reject(err instanceof Error ? err : new Error(String(err)))
      }
      if (!/^https?:\/\//i.test(url)) {
        fail(new Error(`仅支持 http(s) 地址: ${url}`))
        return
      }
      const parsed = new URL(url)
      const isHttps = parsed.protocol === 'https:'
      const transport = isHttps ? https : http
      const req = transport.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || (isHttps ? 443 : 80),
          path: parsed.pathname + parsed.search,
          method: 'GET',
          headers: { 'User-Agent': 'Aria2Desktop-AutoImport' }
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume()
            if (redirectCount >= MAX_REDIRECTS) {
              fail(new Error('Too many redirects'))
              return
            }
            const nextUrl = new URL(res.headers.location, url).toString()
            // 重定向目标同样必须落在 http(s) 上，防协议降级到 file:// 等异常源
            if (!/^https?:\/\//i.test(nextUrl)) {
              fail(new Error('重定向目标不是 http(s) 地址'))
              return
            }
            this.fetchBinary(nextUrl, redirectCount + 1).then(resolve).catch(fail)
            return
          }
          if (!res.statusCode || res.statusCode >= 400) {
            res.resume()
            fail(new Error(`Fetch failed: ${res.statusCode}`))
            return
          }
          const chunks: Buffer[] = []
          let total = 0
          res.on('data', (chunk: Buffer) => {
            total += chunk.length
            if (total > MAX_RESPONSE_BYTES) {
              // 超限立即掐断连接：继续收只会白耗带宽（订阅源正常不超过几百 KB）
              res.destroy()
              fail(new Error('Response too large'))
              return
            }
            chunks.push(chunk)
          })
          res.on('end', () => resolve(Buffer.concat(chunks)))
          res.on('error', fail)
        }
      )
      req.setTimeout(FETCH_TIMEOUT_MS, () => req.destroy(new Error('Fetch timed out')))
      req.on('error', fail)
      req.end()
    })
  }

  /** 读取订阅的已见键（FIFO 语义由写入侧维护） */
  private getSeenKeys(subId: string): string[] {
    const seenMap = (this.store.get('rssSeenItems') as Record<string, string[]> | undefined) ?? {}
    return Array.isArray(seenMap[subId]) ? seenMap[subId] : []
  }

  /** 写回已见键，FIFO 上限 500：最旧的先被挤掉（订阅源改版后旧键自然失忆） */
  private setSeenKeys(subId: string, keys: string[]): void {
    const seenMap = (this.store.get('rssSeenItems') as Record<string, string[]> | undefined) ?? {}
    seenMap[subId] = keys.slice(-MAX_SEEN_KEYS)
    this.store.set('rssSeenItems', seenMap)
  }

  /** 构造一条导入日志 */
  private buildLogEntry(
    sub: RssSubscription,
    item: FeedItem,
    status: AutoImportLogEntry['status'],
    message?: string,
    gid?: string
  ): AutoImportLogEntry {
    return {
      id: randomUUID(),
      kind: 'rss',
      sourceId: sub.id,
      sourceName: sub.name,
      title: item.title || item.link || item.enclosureUrl || '（无标题）',
      ...(gid !== undefined ? { gid } : {}),
      status,
      ...(message !== undefined ? { message } : {}),
      importedAt: new Date().toISOString()
    }
  }

  /** 追加日志（新→旧排序，超过 200 条裁最旧）；按批一次写盘，避免拉取中途反复触发持久化 */
  private appendLog(entries: AutoImportLogEntry[]): void {
    if (entries.length === 0) return
    const existing = (this.store.get('autoImportLog') as AutoImportLogEntry[] | undefined) ?? []
    // entries 是时间正序（旧→新），存储是新→旧：整批反转后头插
    const merged = [...entries.slice().reverse(), ...existing].slice(0, MAX_LOG_ENTRIES)
    this.store.set('autoImportLog', merged)
  }

  /** 读取导入日志（新→旧，与存储顺序一致） */
  getLogEntries(): AutoImportLogEntry[] {
    return (this.store.get('autoImportLog') as AutoImportLogEntry[] | undefined) ?? []
  }

  /**
   * 校验并归一化订阅（upsert 前调用）。
   * 返回 error 字符串表示拒绝保存；intervalMinutes/maxPerFetch 一律钳到合法区间。
   */
  private validateSubscription(sub: RssSubscription): { ok: true; subscription: RssSubscription } | { ok: false; error: string } {
    if (!sub || typeof sub !== 'object') return { ok: false, error: '订阅数据无效' }
    const name = typeof sub.name === 'string' ? sub.name.trim() : ''
    if (name === '') return { ok: false, error: '订阅名称不能为空' }
    if (name.length > 100) return { ok: false, error: '订阅名称不能超过 100 字符' }
    const url = typeof sub.url === 'string' ? sub.url.trim() : ''
    if (!/^https?:\/\//i.test(url)) return { ok: false, error: '订阅地址必须以 http:// 或 https:// 开头' }
    for (const pattern of [sub.includePattern, sub.excludePattern]) {
      if (pattern === undefined || pattern === null || pattern === '') continue
      if (typeof pattern !== 'string') return { ok: false, error: '过滤模式必须是字符串' }
      try {
        new RegExp(pattern)
      } catch {
        return { ok: false, error: `过滤正则无效: ${pattern}` }
      }
    }
    const dir = typeof sub.dir === 'string' ? sub.dir.trim() : ''
    if (dir !== '' && !path.isAbsolute(dir)) return { ok: false, error: '下载目录必须是绝对路径' }

    const intervalMinutes = sub.intervalMinutes === undefined
      ? undefined
      : Math.max(MIN_INTERVAL_MINUTES, Math.min(MAX_INTERVAL_MINUTES, Math.round(sub.intervalMinutes)))
    const maxPerFetch = sub.maxPerFetch === undefined
      ? undefined
      : Math.max(MIN_MAX_PER_FETCH, Math.min(MAX_MAX_PER_FETCH, Math.round(sub.maxPerFetch)))

    return {
      ok: true,
      subscription: {
        ...sub,
        name,
        url,
        dir: dir === '' ? undefined : dir,
        intervalMinutes,
        maxPerFetch
      }
    }
  }

  /**
   * 按 id upsert：新订阅（无 id）生成 UUID。
   * 运行时字段（last*）以已存值为准——UI 编辑名称不该把"上次拉取时间"抹掉。
   */
  private upsertSubscription(sub: RssSubscription): RssSaveResult {
    const validated = this.validateSubscription(sub)
    if (!validated.ok) return { success: false, error: validated.error }

    const incoming = validated.subscription
    const id = incoming.id && incoming.id !== '' ? incoming.id : randomUUID()
    const list = this.getSubscriptions()
    const index = list.findIndex(existing => existing.id === id)
    const previous = index >= 0 ? list[index] : undefined
    // 保留历史状态（仅当 UI 没带该字段时）；显式带 null 依然生效（如"重置状态"场景）
    const merged: RssSubscription = {
      ...incoming,
      id,
      enabled: incoming.enabled === true,
      lastFetchAt: incoming.lastFetchAt ?? previous?.lastFetchAt ?? null,
      lastStatus: incoming.lastStatus ?? previous?.lastStatus ?? null,
      lastError: incoming.lastError ?? previous?.lastError ?? null,
      lastAddedCount: incoming.lastAddedCount ?? previous?.lastAddedCount
    }
    if (index >= 0) list[index] = merged
    else list.push(merged)
    this.saveSubscriptions(list)
    return { success: true, subscription: merged }
  }

  /** 删除订阅：连带清掉它的已见键（该订阅的记忆没有复用价值） */
  private deleteSubscription(id: string): { success: boolean } {
    const list = this.getSubscriptions()
    const next = list.filter(sub => sub.id !== id)
    this.saveSubscriptions(next)
    const seenMap = (this.store.get('rssSeenItems') as Record<string, string[]> | undefined) ?? {}
    if (id in seenMap) {
      delete seenMap[id]
      this.store.set('rssSeenItems', seenMap)
    }
    return { success: true }
  }

  registerIpcHandlers(): void {
    registerSecureHandler('rss-subs-list', () => ({ subscriptions: this.getSubscriptions() }), {
      getMainWindow: this.windowRef
    })

    registerSecureHandler('rss-subs-save', (event, sub: RssSubscription) => this.upsertSubscription(sub), {
      getMainWindow: this.windowRef
    })

    registerSecureHandler('rss-subs-delete', (event, id: string) => this.deleteSubscription(id), {
      getMainWindow: this.windowRef
    })

    registerSecureHandler('rss-subs-fetch-now', async (event, id: string) => await this.fetchNow(id), {
      getMainWindow: this.windowRef
    })

    // 日志两条隧道共用，注册一次即可（watchFolderService 只注册自己的四个通道）
    registerSecureHandler('auto-import-log-list', () => ({ entries: this.getLogEntries() }), {
      getMainWindow: this.windowRef
    })
  }
}
