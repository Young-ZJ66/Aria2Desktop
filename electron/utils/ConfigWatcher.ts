import Store from 'electron-store'
import { EventEmitter } from 'events'

export interface ConfigChangeEvent {
    key: string
    newValue: any
    oldValue: any
}

/**
 * ConfigWatcher - 监控 electron-store 配置变更并发出事件
 * 灵感来自 Motrix 的配置监听机制
 */
export class ConfigWatcher extends EventEmitter {
    private store: Store
    private configListeners: Map<string, () => void> = new Map()

    constructor(store: Store) {
        super()
        this.store = store
    }

    /**
     * 监听特定配置键的变更
     */
    watch(key: string, callback: (newValue: any, oldValue: any) => void) {
        if (this.configListeners.has(key)) {
            console.warn(`[ConfigWatcher] Key "${key}" is already being watched`)
            return
        }

        const unsubscribe = this.store.onDidChange(key, (newValue, oldValue) => {
            console.log(`[ConfigWatcher] Config changed: ${key}`, { newValue, oldValue })
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

    /**
     * 获取配置键的当前值
     */
    get(key: string, defaultValue?: any): any {
        return this.store.get(key, defaultValue)
    }

    /**
     * 设置配置值
     */
    set(key: string, value: any) {
        this.store.set(key, value)
    }
}
