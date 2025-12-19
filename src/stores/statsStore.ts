import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useConnectionStore } from './connectionStore'
import type { Aria2GlobalStat, Aria2Version, Aria2Option } from '@/types/aria2'

export const useStatsStore = defineStore('stats', () => {
    const connectionStore = useConnectionStore()

    const globalStat = ref<Aria2GlobalStat>({
        downloadSpeed: '0',
        uploadSpeed: '0',
        numActive: '0',
        numWaiting: '0',
        numStopped: '0',
        numStoppedTotal: '0'
    })

    const version = ref<Aria2Version | null>(null)
    const globalOptions = ref<Aria2Option>({})

    async function loadVersion() {
        if (!connectionStore.service) return
        try {
            version.value = await connectionStore.service.getVersion()
        } catch (error) {
            console.error('Failed to load version:', error)
        }
    }

    async function loadGlobalStat() {
        if (!connectionStore.service) return
        try {
            globalStat.value = await connectionStore.service.getGlobalStat()
        } catch (error) {
            console.error('Failed to load global stat:', error)
        }
    }

    async function loadGlobalOptions() {
        if (!connectionStore.service) return
        try {
            globalOptions.value = await connectionStore.service.getGlobalOption()
        } catch (error) {
            console.error('Failed to load global options:', error)
        }
    }

    async function getGlobalOptions() {
        if (!connectionStore.service) throw new Error('Not connected')
        try {
            const options = await connectionStore.service.getGlobalOption()
            globalOptions.value = options
            return options
        } catch (error) {
            console.error('Failed to get global options:', error)
            throw error
        }
    }

    async function changeGlobalOptions(options: Aria2Option) {
        if (!connectionStore.service) throw new Error('Not connected')
        try {
            const result = await connectionStore.service.changeGlobalOption(options)
            await loadGlobalOptions()
            return result
        } catch (error) {
            console.error('Failed to change global options:', error)
            throw error
        }
    }

    return {
        globalStat,
        version,
        globalOptions,
        loadVersion,
        loadGlobalStat,
        loadGlobalOptions,
        getGlobalOptions,
        changeGlobalOptions
    }
})
