import { defineStore } from 'pinia'
import { ref } from 'vue'
import { Aria2Service } from '@/services/aria2Service'
import type { Aria2Config } from '@/types/aria2'

export const useConnectionStore = defineStore('connection', () => {
    const service = ref<Aria2Service | null>(null)
    const isConnected = ref(false)
    const isConnecting = ref(false)
    const connectionError = ref<string | null>(null)

    const config = ref<Aria2Config>({
        host: 'localhost',
        port: 6800,
        protocol: 'http',
        secret: '',
        path: '/jsonrpc'
    })

    async function connect(newConfig?: Partial<Aria2Config>) {
        if (newConfig) {
            config.value = { ...config.value, ...newConfig }
        }

        isConnecting.value = true
        connectionError.value = null

        try {
            if (service.value) {
                service.value.disconnect()
            }

            service.value = new Aria2Service(config.value)

            // 设置基本监听器
            service.value.on('connected', () => {
                isConnected.value = true
                connectionError.value = null
            })

            service.value.on('disconnected', () => {
                isConnected.value = false
            })

            service.value.on('error', (error: any) => {
                connectionError.value = error.message || 'Connection error'
            })

            try {
                await service.value.connect()
                console.log('WebSocket connection established')
            } catch (wsError) {
                console.warn('WebSocket connection failed, will use HTTP:', wsError)
            }

            // 验证连接
            await service.value.getVersion()
            isConnected.value = true

        } catch (error) {
            connectionError.value = error instanceof Error ? error.message : 'Connection failed'
            isConnected.value = false
            throw error
        } finally {
            isConnecting.value = false
        }
    }

    function disconnect() {
        if (service.value) {
            service.value.disconnect()
            service.value = null
        }
        isConnected.value = false
        connectionError.value = null
    }

    function updateConfig(newConfig: Partial<Aria2Config>) {
        config.value = { ...config.value, ...newConfig }
    }

    return {
        service,
        isConnected,
        isConnecting,
        connectionError,
        config,
        connect,
        disconnect,
        updateConfig
    }
})
