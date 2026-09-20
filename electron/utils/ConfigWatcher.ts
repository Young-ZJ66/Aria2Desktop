import Store from 'electron-store'
import { EventEmitter } from 'events'
import { createLogger } from './logger'
import type { StoreData } from '../types/store'

// 本文件日志文案自带 [ConfigWatcher] 前缀（历史风格），故 scope 传空避免前缀重复
const logger = createLogger('')

export interface ConfigChangeEvent {
  key: string
  newValue: unknown
  oldValue: unknown
}

/**
 * ConfigWatcher - 监控 electron-store 配置变更并发出事件
 * 灵感来自 Motrix 的配置监听机制
 */
export class ConfigWatcher extends EventEmitter {
  private store: Store<StoreData>
  private configListeners: Map<string, () => void> = new Map()

  constructor(store: Store<StoreData>) {
    super()
    this.store = store
  }

  /**
   * 监听特定配置键的变更
   */
  watch(key: string, callback: (newValue: unknown, oldValue: unknown) => void) {
    if (this.configListeners.has(key)) {
      logger.warn(`[ConfigWatcher] Key "${key}" is already being watched`)
      return
    }

    const unsubscribe = this.store.onDidChange(key as keyof StoreData, (newValue, oldValue) => {
      // 不为每次配置变更打印日志（高频噪音），由各订阅者按需记录
      callback(newValue, oldValue)
      this.emit('change', { key, newValue, oldValue })
    })

    this.configListeners.set(key, unsubscribe)
  }

  /**
   * 停止监听特定键
   */
  unwatch(key: string) {
    const unsubscribe = this.configListeners.get(key)
    if (unsubscribe) {
      unsubscribe()
      this.configListeners.delete(key)
    }
  }

  /**
   * 停止监听所有键
   */
  unwatchAll() {
    this.configListeners.forEach((unsubscribe) => unsubscribe())
    this.configListeners.clear()
  }
}
