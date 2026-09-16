import { ipcMain } from 'electron'
import Store from 'electron-store'
import * as https from 'https'
import { Aria2Controller } from '../controllers/Aria2Controller'
import { WindowController } from '../controllers/WindowController'
import { createSenderValidator } from '../utils/ipcSecurity'
// 注意：主进程产物是 CJS，运行时无法解析 @/ 别名，必须用相对路径引入 src/shared
import { parseTrackerText } from '../../src/shared/btTrackers'
import type { StoreData, TrackerSubscriptionState } from '../types/store'

/** 最小同步间隔（小时） */
const MIN_INTERVAL_HOURS = 12

/** 最大同步间隔（小时） */
const MAX_INTERVAL_HOURS = 168

/** 订阅源拉取超时（毫秒） */
const FETCH_TIMEOUT_MS = 20000

/** 自动跟随的重定向次数上限 */
const MAX_REDIRECTS = 3

/** 默认自定义来源 */
const DEFAULT_CUSTOM_SOURCES = [
  'https://cdn.jsdelivr.net/gh/ngosang/trackerslist/trackers_best.txt',
  'https://cdn.jsdelivr.net/gh/ngosang/trackerslist/trackers_best_ip.txt',
  'https://cdn.jsdelivr.net/gh/ngosang/trackerslist/trackers_all.txt',
  'https://cdn.jsdelivr.net/gh/ngosang/trackerslist/trackers_all_ip.txt',
  'https://cdn.jsdelivr.net/gh/XIU2/TrackersListCollection/best.txt',
  'https://cdn.jsdelivr.net/gh/XIU2/TrackersListCollection/all.txt',
  'https://cdn.jsdelivr.net/gh/XIU2/TrackersListCollection/http.txt'
]

export interface TrackerUpdateResult {
  success: boolean
  csv?: string
  count?: number
  lastUpdate?: string | null
  lastSource?: string
  error?: string
}

/**
 * Tracker 订阅服务：从公共源每日拉取最新 tracker 列表，
 * 写入 aria2 配置并尽力通过 RPC 立即生效。
 */
export class TrackerSubscriptionService {
  private store: Store<StoreData>
  private aria2Controller: Aria2Controller
  private windowController: WindowController
  private timer: NodeJS.Timeout | null = null
  private updating = false

  constructor(
    store: Store<StoreData>,
    aria2Controller: Aria2Controller,
    windowController: WindowController
  ) {
    this.store = store
    this.aria2Controller = aria2Controller
    this.windowController = windowController
  }

  /** 读取订阅状态（合并默认值） */
  getState(): TrackerSubscriptionState {
    const saved = this.store.get('trackerSubscription') as Partial<TrackerSubscriptionState> | undefined
    return {
      autoUpdate: saved?.autoUpdate ?? true,
      lastUpdate: saved?.lastUpdate ?? null,
      lastSource: saved?.lastSource ?? '',
      lastCount: saved?.lastCount ?? 0,
      customSources: saved?.customSources ?? DEFAULT_CUSTOM_SOURCES,
      syncIntervalHours: saved?.syncIntervalHours ?? 24
    }
  }

  private setState(patch: Partial<TrackerSubscriptionState>): TrackerSubscriptionState {
    const next = { ...this.getState(), ...patch }
    this.store.set('trackerSubscription', next)
    return next
  }

  /** 启动：若启用自动更新，加载时若上次更新超期则立即补拉，并安排每日定时器 */
  initialize(): void {
    const state = this.getState()
    this.scheduleNext()
    if (!state.autoUpdate) return
    const intervalMs = (state.syncIntervalHours || 24) * 60 * 60 * 1000
    const stale = !state.lastUpdate || Date.now() - new Date(state.lastUpdate).getTime() > intervalMs
    if (stale) {
      void this.update(false, state.customSources).catch(() => {})
    }
  }

  /** 设置是否自动更新 */
  setAutoUpdate(enabled: boolean, customSources?: string[], syncIntervalHours?: number): void {
    const patch: Partial<TrackerSubscriptionState> = { autoUpdate: enabled }
    if (customSources) patch.customSources = customSources
    if (syncIntervalHours !== undefined) {
      patch.syncIntervalHours = Math.min(MAX_INTERVAL_HOURS, Math.max(MIN_INTERVAL_HOURS, syncIntervalHours))
    }
    this.setState(patch)
    if (enabled) {
      this.scheduleNext()
      // 开启时立即拉取一次
      void this.update(false, customSources ?? this.getState().customSources).catch(() => {})
    } else if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  /** 清理定时器（应用退出时调用） */
  shutdown(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  /** 安排下一次自动更新（每次触发后重新安排，保持周期） */
  private scheduleNext(): void {
    if (this.timer) clearTimeout(this.timer)
    const state = this.getState()
    const intervalMs = state.syncIntervalHours * 60 * 60 * 1000
    this.timer = setTimeout(() => {
      void this.update(false, state.customSources).catch(() => {})
      this.scheduleNext()
    }, intervalMs)
  }

  /** 拉取并应用最新 Tracker 列表。manual=true 表示用户手动触发 */
  async update(_manual: boolean, customSources?: string[]): Promise<TrackerUpdateResult> {
    // 防止定时触发与手动触发并发重复拉取
    if (this.updating) return { success: false, error: '正在更新中' }
    this.updating = true

    const sources = customSources ?? this.getState().customSources
    const validSources = sources.filter(s => s.trim())

    if (validSources.length === 0) {
      this.updating = false
      return { success: false, error: '没有可用的订阅源' }
    }

    try {
      // 聚合所有来源的 tracker，去重
      const allTrackers = new Set<string>()
      let lastError = ''

      for (const source of validSources) {
        try {
          const text = await this.fetchText(source)
          const trackers = parseTrackerText(text)
          for (const tracker of trackers) {
            allTrackers.add(tracker)
          }
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error)
          console.warn('[TrackerSubscription] 更新失败（尝试下一个源）:', source, lastError)
        }
      }

      if (allTrackers.size === 0) {
        const result: TrackerUpdateResult = { success: false, error: lastError || '所有订阅源均不可用' }
        this.notifyRenderer(result)
        return result
      }

      const csv = Array.from(allTrackers).join(',')
      const apply = this.aria2Controller.applyTrackerList(csv)
      if (!apply.success) {
        const result: TrackerUpdateResult = { success: false, error: apply.error || '写入 aria2 配置失败' }
        this.notifyRenderer(result)
        return result
      }

      const state = this.setState({
        lastUpdate: new Date().toISOString(),
        lastSource: validSources.join(', '),
        lastCount: allTrackers.size
      })

      const result: TrackerUpdateResult = {
        success: true,
        csv,
        count: allTrackers.size,
        lastUpdate: state.lastUpdate,
        lastSource: state.lastSource
      }
      this.notifyRenderer(result)
      return result
    } finally {
      this.updating = false
    }
  }

  /** 通知渲染层订阅更新结果（供设置页刷新列表与状态） */
  private notifyRenderer(result: TrackerUpdateResult): void {
    const win = this.windowController.getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('tracker:updated', result)
    }
  }

  private fetchText(url: string, redirectCount = 0): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const fail = (err: unknown) => {
        reject(err instanceof Error ? err : new Error(String(err)))
      }
      const req = https.request(this.buildRequestOptions(url), (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          if (redirectCount >= MAX_REDIRECTS) {
            fail(new Error('Too many redirects'))
            return
          }
          const nextUrl = new URL(res.headers.location, url).toString()
          this.fetchText(nextUrl, redirectCount + 1).then(resolve).catch(fail)
          return
        }
        if (!res.statusCode || res.statusCode >= 400) {
          res.resume()
          fail(new Error(`Fetch failed: ${res.statusCode}`))
          return
        }
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
        res.on('error', (err) => fail(err))
      })
      req.setTimeout(FETCH_TIMEOUT_MS, () => req.destroy(new Error('Fetch timed out')))
      req.on('error', (err) => fail(err))
      req.end()
    })
  }

  private buildRequestOptions(url: string): https.RequestOptions {
    const parsed = new URL(url)
    return {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: { 'User-Agent': 'Aria2Desktop-TrackerUpdate' }
    }
  }

  registerIpcHandlers(): void {
    const validateSender = createSenderValidator(() => this.windowController.getMainWindow())

    ipcMain.handle('tracker-subscription-status', (event) => {
      if (!validateSender(event)) return { success: false, error: 'Unauthorized' }
      return { success: true, ...this.getState() }
    })

    ipcMain.handle('tracker-set-auto-update', (event, enabled: boolean, customSources?: string[], syncIntervalHours?: number) => {
      if (!validateSender(event)) return { success: false, error: 'Unauthorized' }
      this.setAutoUpdate(!!enabled, customSources, syncIntervalHours)
      return { success: true, ...this.getState() }
    })

    ipcMain.handle('tracker-update-now', async (event, customSources?: string[]) => {
      if (!validateSender(event)) return { success: false, error: 'Unauthorized' }
      return this.update(true, customSources)
    })
  }
}
