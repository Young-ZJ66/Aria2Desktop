import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useConnectionStore } from './connectionStore'
import type { Aria2GlobalStat, Aria2Version, Aria2Option } from '@/types/aria2'

/**
 * 全局统计（数值型）。
 * aria2 RPC 返回的 globalStat 字段均为字符串，此处转为 number，
 * 使 UI 直接使用数值而无需 parseInt，避免类型安全缺失。
 */
export interface NumericGlobalStat {
  downloadSpeed: number
  uploadSpeed: number
  numActive: number
  numWaiting: number
  numStopped: number
  numStoppedTotal: number
}

/** 将 aria2 字符串统计转换为数值，非法/缺失值回退 0 */
function toNumericStat(raw: Aria2GlobalStat): NumericGlobalStat {
  return {
    downloadSpeed: Number(raw.downloadSpeed) || 0,
    uploadSpeed: Number(raw.uploadSpeed) || 0,
    numActive: Number(raw.numActive) || 0,
    numWaiting: Number(raw.numWaiting) || 0,
    numStopped: Number(raw.numStopped) || 0,
    numStoppedTotal: Number(raw.numStoppedTotal) || 0
  }
}

export const useStatsStore = defineStore('stats', () => {
  const connectionStore = useConnectionStore()

  const globalStat = ref<NumericGlobalStat>({
    downloadSpeed: 0,
    uploadSpeed: 0,
    numActive: 0,
    numWaiting: 0,
    numStopped: 0,
    numStoppedTotal: 0
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
      globalStat.value = toNumericStat(await connectionStore.service.getGlobalStat())
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

  async function getGlobalOptions(force = false) {
    if (!connectionStore.service) throw new Error('Not connected')
    // 已缓存时直接返回，避免切换设置页重复请求导致闪烁
    if (!force && Object.keys(globalOptions.value).length > 0) {
      return globalOptions.value
    }
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

  function clearGlobalOptions() {
    globalOptions.value = {}
  }

  /** 清空全部缓存（断开连接/切换服务器时调用，避免旧连接数据残留） */
  function clearCache() {
    globalOptions.value = {}
    version.value = null
  }

  // ── 限速快捷开关 ──

  /** 记忆上次限速值（字节/秒），切换时恢复；默认 1MB/s */
  let rememberedSpeedLimit = '1048576'

  /** 当前是否处于限速状态（max-overall-download-limit 非空且非零） */
  const isSpeedLimited = computed(() => {
    const limit = globalOptions.value['max-overall-download-limit']
    return !!limit && limit !== '0' && limit !== ''
  })

  /** 当前限速值的友好显示（KB/s 或 MB/s） */
  const speedLimitDisplay = computed(() => {
    if (!isSpeedLimited.value) return ''
    const bytes = parseInt(globalOptions.value['max-overall-download-limit'] as string, 10) || 0
    if (bytes <= 0) return ''
    if (bytes >= 1048576) return `${Math.round(bytes / 1048576)} MB/s`
    return `${Math.round(bytes / 1024)} KB/s`
  })

  /** 切换限速开关 */
  async function toggleSpeedLimit(): Promise<void> {
    if (!connectionStore.service) return
    if (isSpeedLimited.value) {
      // 关闭限速：记住当前值后清零
      rememberedSpeedLimit = (globalOptions.value['max-overall-download-limit'] as string) || rememberedSpeedLimit
      await changeGlobalOptions({ 'max-overall-download-limit': '0' })
    } else {
      // 开启限速：恢复上次记忆值
      await changeGlobalOptions({ 'max-overall-download-limit': rememberedSpeedLimit })
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
    changeGlobalOptions,
    clearGlobalOptions,
    clearCache,
    isSpeedLimited,
    speedLimitDisplay,
    toggleSpeedLimit
  }
})
