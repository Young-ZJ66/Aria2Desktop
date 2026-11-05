/**
 * 定时下载调度服务
 *
 * 按「常规设置 → 定时下载」的时间规则自动暂停/恢复全部任务：
 * - 窗口开始（out→in）：unpause-all
 * - 窗口结束（in→out）：pause-all
 * - 首次检查（应用启动 / 引擎重启 / 刚开启调度）：按当前状态对齐一次，
 *   否则在窗口外启动应用时整个窗口都不会暂停
 *
 * 记忆只在 RPC 成功后更新：引擎没起来时下一分钟自动重试，不会丢掉这次翻转。
 * 同一窗口内用户手动暂停/恢复不会被覆盖（状态没翻转就不动作）。
 */

import { callAria2Rpc } from '../utils/aria2Rpc'
import { getSettingsFresh } from '../utils/settingsAccessor'
import { createLogger } from '../utils/logger'
import {
  formatClockTime,
  pickUserPausedGids,
  resolveDownloadScheduleState,
  resolveScheduleAction,
  type DownloadScheduleConfig
} from '../utils/downloadScheduleCore'

// 本文件日志文案自带 [DownloadScheduler] 前缀（历史风格），故 scope 传空避免前缀重复
const logger = createLogger('')

/** 检查间隔（1 分钟，与速度调度器一致） */
const CHECK_INTERVAL_MS = 60 * 1000

export class DownloadScheduler {
  private timer: NodeJS.Timeout | null = null
  private lastState: 'in-window' | 'out-window' | null = null
  /** 进入窗口前用户就手动暂停的任务：恢复窗口时要把它们按回暂停 */
  private pausedByUser = new Set<string>()

  start(): void {
    this.stop()
    this.lastState = null
    this.check()
    this.timer = setInterval(() => this.check(), CHECK_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** 引擎（重新）启动后重置记忆并立即检查：引擎重启会把暂停的任务重新拉起来，
   *  窗口外应当立刻重新暂停（记忆清空 → 走"首次检查对齐"分支） */
  reapply(): void {
    this.lastState = null
    this.check()
  }

  private readConfig(): DownloadScheduleConfig {
    const settings = getSettingsFresh()
    const schedule = settings.downloadSchedule
    if (!schedule) return { enabled: false, rules: [] }
    return {
      enabled: schedule.enabled === true,
      rules: (schedule.rules ?? []).map(rule => ({ ...rule, enabled: rule.enabled !== false }))
    }
  }

  check(): void {
    const config = this.readConfig()
    // 调度关闭时清空记忆：重新开启的那一刻按"首次检查"处理，立刻对齐一次，
    // 而不是等下一个窗口边界（否则在窗口外开启调度会一直跑到边界为止）
    if (!config.enabled) {
      this.lastState = null
      return
    }
    const now = new Date()
    const current = resolveDownloadScheduleState(config, now.getDay(), formatClockTime(now))
    const action = resolveScheduleAction(this.lastState, current)
    if (!action) return

    const settings = getSettingsFresh()
    const port = Number(settings.aria2?.port) || 6800
    const secret = String(settings.aria2?.secret || '')
    if (action === 'pause-all') {
      void this.applyPauseAll(port, secret, current)
    } else {
      void this.applyUnpauseAll(port, secret, current)
    }
  }

  /** 窗口结束：暂停全部。先记下用户原本就暂停的任务，恢复时把它们放回去 */
  private async applyPauseAll(
    port: number,
    secret: string,
    current: 'in-window' | 'out-window'
  ): Promise<void> {
    this.pausedByUser = await this.collectUserPausedGids(port, secret)
    try {
      await callAria2Rpc({ port, secret, method: 'aria2.pauseAll' })
      this.lastState = current
      const note = this.pausedByUser.size > 0 ? `（其中 ${this.pausedByUser.size} 个是用户手动暂停，恢复时会保持暂停）` : ''
      logger.info(`[DownloadScheduler] 窗口结束，已暂停全部任务${note}`)
    } catch (err) {
      logger.warn('[DownloadScheduler] pause-all 下发失败，将在一分钟后重试（引擎未运行？）:', err)
    }
  }

  /** 窗口开始：恢复全部，再把用户手动暂停的那些重新暂停回去 */
  private async applyUnpauseAll(
    port: number,
    secret: string,
    current: 'in-window' | 'out-window'
  ): Promise<void> {
    try {
      await callAria2Rpc({ port, secret, method: 'aria2.unpauseAll' })
      this.lastState = current
      logger.info('[DownloadScheduler] 窗口开始，已恢复全部任务')
    } catch (err) {
      logger.warn('[DownloadScheduler] unpause-all 下发失败，将在一分钟后重试（引擎未运行？）:', err)
      return
    }
    // unpauseAll 是全局的，会把用户此前手动暂停的任务一起放行——逐个按回暂停。
    // 任务可能在这期间被删掉：失败就地忽略（不影响已完成的恢复动作）。
    for (const gid of this.pausedByUser) {
      try {
        await callAria2Rpc({ port, secret, method: 'aria2.pause', params: [gid] })
      } catch {
        // 任务已删除 / gid 不存在：无需处理
      }
    }
    if (this.pausedByUser.size > 0) {
      logger.info(`[DownloadScheduler] 已保持 ${this.pausedByUser.size} 个用户手动暂停的任务不被恢复`)
    }
    this.pausedByUser = new Set()
  }

  /** 读取当前用户手动暂停的任务 gid（拿不到就当作没有，不影响暂停动作本身） */
  private async collectUserPausedGids(port: number, secret: string): Promise<Set<string>> {
    try {
      const rows = await callAria2Rpc({
        port,
        secret,
        method: 'aria2.tellWaiting',
        params: [0, 1000, ['gid', 'status']]
      })
      return new Set(pickUserPausedGids(rows))
    } catch (err) {
      logger.warn('[DownloadScheduler] 读取暂停列表失败，本次不区分用户暂停:', err)
      return new Set()
    }
  }
}
