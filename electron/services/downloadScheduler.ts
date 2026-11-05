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
    const method = action === 'pause-all' ? 'aria2.pauseAll' : 'aria2.unpauseAll'
    callAria2Rpc({ port, secret, method })
      .then(() => {
        // 只有真正下发成功才记住状态；失败时保持原值，下一分钟自动重试
        this.lastState = current
        logger.info(`[DownloadScheduler] ${action === 'pause-all' ? '窗口结束，已暂停全部任务' : '窗口开始，已恢复全部任务'}`)
      })
      .catch(err => {
        // 引擎没运行/重启中：不动记忆，一分钟后重试（早期版本在这里丢掉翻转，
        // 导致整个窗口作废）
        logger.warn(`[DownloadScheduler] ${action} 下发失败，将在一分钟后重试（引擎未运行？）:`, err)
      })
  }
}
