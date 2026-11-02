/**
 * 下载速度调度服务
 * 按星期几/时间段自动切换 Aria2 限速设置。
 * 每分钟检查一次当前时间是否匹配某条规则，匹配时通过 RPC 应用限速。
 */

import { callAria2Rpc } from '../utils/aria2Rpc'
import { matchesSpeedRule, formatClockTime, buildSpeedLimitOptions, buildSpeedRestoreOptions } from '../utils/speedRule'
import { getSettingsFresh } from '../utils/settingsAccessor'
import { createLogger } from '../utils/logger'
import type { SpeedScheduleRule } from '../types/store'

// 本文件日志文案自带 [SpeedScheduler] 前缀（历史风格），故 scope 传空避免前缀重复
const logger = createLogger('')

/** 检查间隔（1 分钟） */
const CHECK_INTERVAL_MS = 60 * 1000

export class SpeedScheduler {
  private timer: NodeJS.Timeout | null = null
  private lastAppliedRuleName: string | null = null
  /**
   * 当前生效规则下发过的上传限速（0 表示没下发）。
   * 记它是为了"只回滚自己改过的项"：上传限速不在本功能的 UI 里，
   * 回滚时若一律写 0，会把用户单独配置的最大上传速度一起抹掉。
   */
  private appliedUploadLimit = 0

  /** 注：本类不再持有 store —— settings 读取统一走 utils/settingsAccessor */
  constructor() {}

  /** 启动调度器 */
  start(): void {
    this.stop()
    this.check()
    this.timer = setInterval(() => this.check(), CHECK_INTERVAL_MS)
  }

  /** 停止调度器 */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.lastAppliedRuleName = null
    this.appliedUploadLimit = 0
  }

  /** 立即检查并应用匹配的规则 */
  check(): void {
    // 直读：下面要拿 secret 做 RPC 鉴权，拿到过期密钥会导致限速指令下发失败
    const settings = getSettingsFresh()
    const schedule = settings.speedSchedule
    if (!schedule?.enabled || !schedule.rules?.length) return

    // RPC 参数只解密读取一次（原先 check/getRpcPort/getRpcSecret 会重复解密三遍）
    const port = Number(settings.aria2?.port) || 6800
    const secret = String(settings.aria2?.secret || '')

    const now = new Date()
    const currentDay = now.getDay()
    const currentTime = formatClockTime(now)

    for (const rule of schedule.rules) {
      if (matchesSpeedRule(rule, currentDay, currentTime)) {
        if (this.lastAppliedRuleName !== rule.name) {
          this.applyLimit(rule, port, secret)
          this.lastAppliedRuleName = rule.name
        }
        return
      }
    }

    // 无规则匹配：如果之前有限速规则在生效，清除限速
    if (this.lastAppliedRuleName) {
      this.clearLimit(port, secret)
      this.lastAppliedRuleName = null
    }
  }

  /** 通过 RPC 应用限速 */
  private applyLimit(rule: SpeedScheduleRule, port: number, secret: string): void {
    const options = buildSpeedLimitOptions(rule)
    const uploadLimit = Number(options['max-overall-upload-limit'] ?? 0)

    logger.info(`[SpeedScheduler] Applying rule "${rule.name}":`, options)
    callAria2Rpc({ port, secret, method: 'aria2.changeGlobalOption', params: [options] })
      .then(() => {
        // 只有真的下发成功才记下来，清除时会按这个值决定要不要把上传限速一并回滚
        this.appliedUploadLimit = uploadLimit
      })
      .catch(err => {
        logger.warn('[SpeedScheduler] Failed to apply speed limit:', err)
        this.appliedUploadLimit = 0
      })
  }

  /** 清除限速（只把本调度器改过的项恢复为无限制） */
  private clearLimit(port: number, secret: string): void {
    const options = buildSpeedRestoreOptions(this.appliedUploadLimit)
    logger.info('[SpeedScheduler] Clearing speed limit (no rule matched)', options)
    callAria2Rpc({ port, secret, method: 'aria2.changeGlobalOption', params: [options] }).catch(err => {
      logger.warn('[SpeedScheduler] Failed to clear speed limit:', err)
    })
    this.appliedUploadLimit = 0
  }
}
