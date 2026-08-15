import { ref, computed, onMounted, onUnmounted } from 'vue'
import { message } from '@/utils/feedback'
import { useI18n } from 'vue-i18n'

export interface Aria2ProcessInfo {
  isRunning: boolean
  pid: number | null
  retryCount: number
  config: {
    executablePath: string
    configPath: string
    port: number
    secret: string
    downloadDir: string
    enableRpc: boolean
    rpcAllowOriginAll: boolean
    autoStart: boolean
  } | null
  error?: string
  /** 内置 Aria2 是否可用 */
  isAria2Available?: boolean
  /** 资源路径信息 */
  resourceInfo?: {
    userDataPath: string
    resourcesPath: string
  }
}

export interface Aria2LocalConfig {
  port?: number
  secret?: string
  downloadDir?: string
  autoStart?: boolean
}

export function useAria2LocalService() {
  const { t } = useI18n()

  const processInfo = ref<Aria2ProcessInfo>({
    isRunning: false,
    pid: null,
    retryCount: 0,
    config: null
  })

  const isStarting = ref(false)
  const isStopping = ref(false)
  const statusCheckInterval = ref<NodeJS.Timeout | null>(null)

  // 计算属性
  const isRunning = computed(() => processInfo.value.isRunning)
  const hasError = computed(() => !!processInfo.value.error)
  const canStart = computed(() => !isRunning.value && !isStarting.value)
  const canStop = computed(() => isRunning.value && !isStopping.value)
  const canRestart = computed(() => !isStarting.value && !isStopping.value)

  // 检查 Electron API 是否可用
  const isElectronAvailable = computed(() => {
    return typeof window !== 'undefined' &&
           window.electronAPI &&
           window.electronAPI.aria2
  })

  // 获取进程状态
  async function getStatus(): Promise<void> {
    if (!isElectronAvailable.value) {
      console.warn('Electron API not available')
      return
    }

    try {
      const status = await window.electronAPI.aria2.getStatus()
      processInfo.value = status
    } catch (error) {
      console.error('获取 Aria2 状态失败:', error)
      processInfo.value.error = error instanceof Error ? error.message : String(error)
    }
  }

  // 启动 Aria2
  async function start(): Promise<boolean> {
    if (!isElectronAvailable.value) {
      message.error(t('localService.electronUnavailable'))
      return false
    }

    if (isStarting.value) {
      message.warning(t('localService.startingWait'))
      return false
    }

    isStarting.value = true

    try {
      const result = await window.electronAPI.aria2.start()

      if (result.success) {
        // 移除自动提示，让调用方决定是否显示成功消息
        await getStatus()
        return true
      } else {
        message.error(t('localService.startFailed', { error: result.error }))
        return false
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      message.error(t('localService.startFailed', { error: errorMessage }))
      console.error('启动 Aria2 失败:', error)
      return false
    } finally {
      isStarting.value = false
    }
  }

  // 停止 Aria2
  async function stop(): Promise<boolean> {
    if (!isElectronAvailable.value) {
      message.error(t('localService.electronUnavailable'))
      return false
    }

    if (isStopping.value) {
      message.warning(t('localService.stoppingWait'))
      return false
    }

    isStopping.value = true

    try {
      const result = await window.electronAPI.aria2.stop()

      if (result.success) {
        message.success(t('localService.serviceStopped'))
        await getStatus()
        return true
      } else {
        message.error(t('localService.stopFailed', { error: result.error }))
        return false
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      message.error(t('localService.stopFailed', { error: errorMessage }))
      console.error('停止 Aria2 失败:', error)
      return false
    } finally {
      isStopping.value = false
    }
  }

  // 重启 Aria2
  async function restart(): Promise<boolean> {
    if (!isElectronAvailable.value) {
      message.error(t('localService.electronUnavailable'))
      return false
    }

    if (isStarting.value || isStopping.value) {
      message.warning(t('localService.operatingWait'))
      return false
    }

    isStarting.value = true

    try {
      const result = await window.electronAPI.aria2.restart()

      if (result.success) {
        message.success(t('localService.restartSuccess'))
        await getStatus()
        return true
      } else {
        message.error(t('localService.restartFailed', { error: result.error }))
        return false
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      message.error(t('localService.restartFailed', { error: errorMessage }))
      console.error('重启 Aria2 失败:', error)
      return false
    } finally {
      isStarting.value = false
    }
  }

  // 更新配置
  async function updateConfig(config: Aria2LocalConfig): Promise<boolean> {
    if (!isElectronAvailable.value) {
      message.error(t('localService.electronUnavailable'))
      return false
    }

    try {
      // 将 reactive 对象转换为普通对象，确保可以序列化
      const plainConfig = {
        port: config.port,
        secret: config.secret,
        downloadDir: config.downloadDir,
        autoStart: config.autoStart
      }

      console.warn('正在更新 Aria2 配置:', plainConfig) // {{ AURA: Add - 调试日志 }}
      const result = await window.electronAPI.aria2.updateConfig(plainConfig)
      console.warn('配置更新结果:', result) // {{ AURA: Add - 调试日志 }}

      if (result.success) {
        // 移除重复的成功提示，让调用方决定是否显示消息
        await getStatus()
        console.warn('配置更新成功，状态已刷新') // {{ AURA: Add - 调试日志 }}
        return true
      } else {
        message.error(t('localService.updateConfigFailed', { error: result.error }))
        return false
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      message.error(t('localService.updateConfigFailed', { error: errorMessage }))
      console.error('更新 Aria2 配置失败:', error)
      return false
    }
  }

  // 开始定期检查状态
  function startStatusCheck(interval = 5000): void {
    if (statusCheckInterval.value) {
      clearInterval(statusCheckInterval.value)
    }

    statusCheckInterval.value = setInterval(async () => {
      await getStatus()
    }, interval)
  }

  // 停止状态检查
  function stopStatusCheck(): void {
    if (statusCheckInterval.value) {
      clearInterval(statusCheckInterval.value)
      statusCheckInterval.value = null
    }
  }

  // 获取连接配置
  const getConnectionConfig = computed(() => {
    if (!processInfo.value.config) {
      return {
        host: 'localhost',
        port: 6800,
        protocol: 'http',
        secret: ''
      }
    }

    return {
      host: 'localhost',
      port: processInfo.value.config.port,
      protocol: 'http',
      secret: processInfo.value.config.secret
    }
  })

  // 生命周期钩子
  onMounted(async () => {
    if (isElectronAvailable.value) {
      await getStatus()
      startStatusCheck()
    }
  })

  onUnmounted(() => {
    stopStatusCheck()
  })

  return {
    // 状态
    processInfo,
    isRunning,
    hasError,
    canStart,
    canStop,
    canRestart,
    isStarting,
    isStopping,
    isElectronAvailable,

    // 方法
    start,
    stop,
    restart,
    getStatus,
    updateConfig,
    startStatusCheck,
    stopStatusCheck,

    // 配置
    getConnectionConfig
  }
}
