/**
 * 下载速度调度服务
 * 按星期几/时间段自动切换 Aria2 限速设置。
 * 每分钟检查一次当前时间是否匹配某条规则，匹配时通过 RPC 应用限速。
 */

import Store from 'electron-store'
import http from 'http'
import { decryptSettingsSecrets } from '../utils/secretCipher'
import type { StoreData, AppSettings, SpeedScheduleRule } from '../types/store'

/** 检查间隔（1 分钟） */
const CHECK_INTERVAL_MS = 60 * 1000

export class SpeedScheduler {
  private store: Store<StoreData>
  private timer: NodeJS.Timeout | null = null
  private lastAppliedRuleName: string | null = null

  constructor(store: Store<StoreData>) {
    this.store = store
  }

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
  }

  /** 立即检查并应用匹配的规则 */
  check(): void {
    const settings = decryptSettingsSecrets(this.store.get('settings', {}) as AppSettings)
    const schedule = settings.speedSchedule
    if (!schedule?.enabled || !schedule.rules?.length) return

    const now = new Date()
    const currentDay = now.getDay()
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

    for (const rule of schedule.rules) {
      if (this.matchesRule(rule, currentDay, currentTime)) {
        if (this.lastAppliedRuleName !== rule.name) {
          this.applyLimit(rule)
          this.lastAppliedRuleName = rule.name
        }
        return
      }
    }

    // 无规则匹配：如果之前有限速规则在生效，清除限速
    if (this.lastAppliedRuleName) {
      this.clearLimit()
      this.lastAppliedRuleName = null
    }
  }

  /** 检查规则是否匹配当前时间 */
  private matchesRule(rule: SpeedScheduleRule, currentDay: number, currentTime: string): boolean {
    // 检查星期几
    if (rule.days.length > 0 && !rule.days.includes(currentDay)) return false

    // 检查时间段（支持跨午夜，如 22:00 - 06:00）
    const { startTime, endTime } = rule
    if (startTime <= endTime) {
      // 不跨午夜：currentTime 在 [startTime, endTime) 范围内
      return currentTime >= startTime && currentTime < endTime
    } else {
      // 跨午夜：currentTime 在 [startTime, 23:59] 或 [00:00, endTime) 范围内
      return currentTime >= startTime || currentTime < endTime
    }
  }

  /** 通过 RPC 应用限速 */
  private applyLimit(rule: SpeedScheduleRule): void {
    const port = this.getRpcPort()
    const secret = this.getRpcSecret()
    const options: Record<string, string> = {}

    if (rule.downloadLimit > 0) {
      options['max-overall-download-limit'] = String(rule.downloadLimit)
    } else {
      options['max-overall-download-limit'] = '0'
    }

    if (rule.uploadLimit > 0) {
      options['max-overall-upload-limit'] = String(rule.uploadLimit)
    } else {
      options['max-overall-upload-limit'] = '0'
    }

    console.log(`[SpeedScheduler] Applying rule "${rule.name}":`, options)
    this.callAria2Rpc(port, secret, 'aria2.changeGlobalOption', [options]).catch(err => {
      console.warn('[SpeedScheduler] Failed to apply speed limit:', err)
    })
  }

  /** 清除限速（恢复为无限制） */
  private clearLimit(): void {
    const port = this.getRpcPort()
    const secret = this.getRpcSecret()
    console.log('[SpeedScheduler] Clearing speed limit (no rule matched)')
    this.callAria2Rpc(port, secret, 'aria2.changeGlobalOption', [{
      'max-overall-download-limit': '0',
      'max-overall-upload-limit': '0'
    }]).catch(err => {
      console.warn('[SpeedScheduler] Failed to clear speed limit:', err)
    })
  }

  private getRpcPort(): number {
    const settings = decryptSettingsSecrets(this.store.get('settings', {}) as AppSettings)
    return Number(settings.aria2?.port) || 6800
  }

  private getRpcSecret(): string {
    const settings = decryptSettingsSecrets(this.store.get('settings', {}) as AppSettings)
    return String(settings.aria2?.secret || '')
  }

  private callAria2Rpc(port: number, secret: string, method: string, params: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const rpcParams = secret ? [`token:${secret}`, ...params] : params
      const body = JSON.stringify({ jsonrpc: '2.0', id: '1', method, params: rpcParams })

      const req = http.request({
        hostname: 'localhost',
        port,
        path: '/jsonrpc',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      }, (res) => {
        let data = ''
        res.on('data', (chunk) => { data += chunk })
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data)
            if (parsed.error) reject(new Error(parsed.error.message))
            else resolve(parsed.result)
          } catch (e) { reject(e) }
        })
      })

      req.on('error', reject)
      req.setTimeout(5000, () => req.destroy(new Error('timeout')))
      req.write(body)
      req.end()
    })
  }
}
