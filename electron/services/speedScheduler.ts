/**
 * 下载速度调度服务
 * 按星期几/时间段自动切换 Aria2 限速设置。
 * 每分钟检查一次当前时间是否匹配某条规则，匹配时通过 RPC 应用限速。
 */

import { callAria2Rpc } from '../utils/aria2Rpc'
import { matchesSpeedRule, formatClockTime, buildSpeedLimitOptions, buildSpeedRestoreOptions } from '../utils/speedRule'
import { getSettingsFresh } from '../utils/settingsAccessor'
import { activeRpcOptions } from '../utils/activeRpcConfig'
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
  /** 正在下发中的规则名：避免 RPC 未返回时每分钟重复发同一指令 */
  private applyingRuleName: string | null = null

  /** 注：本类不再持有 store —— settings 读取统一走 utils/settingsAccessor */
  constructor() {}

  /** 启动调度器 */
  start(): void {
    this.clearTimer()
    this.check()
    this.timer = setInterval(() => this.check(), CHECK_INTERVAL_MS)
  }

  private clearTimer(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /**
   * 引擎（重新）启动后重新下发当前规则的限速。
   *
   * aria2 的全局选项只活在进程内存里：引擎重启后 `max-overall-download-limit`
   * 回到 aria2.conf 里的值（通常是不限速）。而本调度器为了省 RPC，按"规则名没变
   * 就不重复下发"工作 —— 于是重启之后整个规则窗口都不会再限速，用户以为调度还在。
   * 这里清掉记忆再检查一次，让限速落到新进程上。
   */
  reapply(): void {
    this.lastAppliedRuleName = null
    this.appliedUploadLimit = 0
    // 引擎重启时上一条指令可能还卡在旧进程的 Promise 上：强制重发，不能被 applying 标记拦住
    this.applyingRuleName = null
    this.check(true)
  }

  /**
   * 停止调度器。
   *
   * 关掉调度（含用户停用功能、应用退出）时必须把本调度器下发过的限速清掉：
   * 否则 aria2 进程会带着上一次的 max-overall-download-limit 一直跑，
   * 用户在设置页看到"调度已关闭"，下载却仍然是几十 KB/s。
   */
  stop(): void {
    this.clearTimer()
    if (this.lastAppliedRuleName) {
      this.clearLimit(activeRpcOptions())
    }
    this.lastAppliedRuleName = null
    this.appliedUploadLimit = 0
  }

  /** 立即检查并应用匹配的规则。force=true 时忽略"同一规则已下发"的去重（用于引擎重启后重放） */
  check(force = false): void {
    // 直读：下面要拿 secret 做 RPC 鉴权，拿到过期密钥会导致限速指令下发失败
    const settings = getSettingsFresh()
    const rpc = activeRpcOptions(settings)
    const schedule = settings.speedSchedule

    if (!schedule?.enabled || !schedule.rules?.length) {
      // 功能被停用/规则被删空时也要回滚，而不是简单 return 把限速留在引擎里
      if (this.lastAppliedRuleName) {
        this.clearLimit(rpc)
        this.lastAppliedRuleName = null
      }
      return
    }

    const now = new Date()
    const currentDay = now.getDay()
    const currentTime = formatClockTime(now)

    for (const rule of schedule.rules) {
      if (matchesSpeedRule(rule, currentDay, currentTime)) {
        if (force || (this.lastAppliedRuleName !== rule.name && this.applyingRuleName !== rule.name)) {
          this.applyLimit(rule, rpc)
        }
        return
      }
    }

    // 无规则匹配：如果之前有限速规则在生效，清除限速
    if (this.lastAppliedRuleName) {
      this.clearLimit(rpc)
      this.lastAppliedRuleName = null
    }
  }

  /** 通过 RPC 应用限速（成功后才记为已生效，失败下一分钟自动重试） */
  private applyLimit(
    rule: SpeedScheduleRule,
    rpc: ReturnType<typeof activeRpcOptions>
  ): void {
    const options = buildSpeedLimitOptions(rule)
    const uploadLimit = Number(options['max-overall-upload-limit'] ?? 0)
    this.applyingRuleName = rule.name

    logger.info(`[SpeedScheduler] Applying rule "${rule.name}":`, options)
    callAria2Rpc({ ...rpc, method: 'aria2.changeGlobalOption', params: [options] })
      .then(() => {
        // 只有真的下发成功才记下来，清除时会按这个值决定要不要把上传限速一并回滚
        this.lastAppliedRuleName = rule.name
        this.appliedUploadLimit = uploadLimit
      })
      .catch(err => {
        logger.warn('[SpeedScheduler] Failed to apply speed limit:', err)
        this.appliedUploadLimit = 0
        // 失败不改 lastAppliedRuleName：下一轮检查会重试，避免整个时段静默不限速
      })
      .finally(() => {
        if (this.applyingRuleName === rule.name) this.applyingRuleName = null
      })
  }

  /** 清除限速（只把本调度器改过的项恢复为无限制） */
  private clearLimit(rpc: ReturnType<typeof activeRpcOptions>): void {
    const options = buildSpeedRestoreOptions(this.appliedUploadLimit)
    logger.info('[SpeedScheduler] Clearing speed limit (no rule matched)', options)
    callAria2Rpc({ ...rpc, method: 'aria2.changeGlobalOption', params: [options] }).catch(err => {
      logger.warn('[SpeedScheduler] Failed to clear speed limit:', err)
    })
    this.appliedUploadLimit = 0
  }
}
