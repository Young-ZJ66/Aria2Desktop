/**
 * 定时下载调度服务
 *
 * 按「常规设置 → 定时下载」的时间规则自动暂停/恢复全部任务：
 * - 窗口开始（out→in）：unpause-all
 * - 窗口结束（in→out）：pause-all
 * 只在窗口状态翻转时动作（与速度调度器的 lastAppliedRuleName 模式一致），
 * 不与用户的手动暂停/恢复打架。
 *
 * 引擎不可用（未运行）时跳过本轮检查；应用启动时首次检查不动作（previous=null），
 * 避免启动瞬间突然暂停/唤醒全部任务。
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

  /** 引擎（重新）启动后重置记忆并立即检查——引擎重启不会改变已暂停/活动状态，
   *  但如果调度窗口正在生效，此刻应把状态对齐（比如窗口内但任务被引擎重启中断） */
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
    const now = new Date()
    const current = resolveDownloadScheduleState(config, now.getDay(), formatClockTime(now))
    const action = resolveScheduleAction(this.lastState, current)
    this.lastState = current
    if (!action) return

    const settings = getSettingsFresh()
    const port = Number(settings.aria2?.port) || 6800
    const secret = String(settings.aria2?.secret || '')
    const method = action === 'pause-all' ? 'aria2.pauseAll' : 'aria2.unpauseAll'
    callAria2Rpc({ port, secret, method })
      .then(() => {
        logger.info(`[DownloadScheduler] ${action === 'pause-all' ? '窗口结束，已暂停全部任务' : '窗口开始，已恢复全部任务'}`)
      })
      .catch(err => {
        // 引擎没运行：本轮不动作，lastState 已更新——下一个翻转点自然接管
        logger.warn(`[DownloadScheduler] ${action} 下发失败（引擎未运行？）:`, err)
      })
  }
}
