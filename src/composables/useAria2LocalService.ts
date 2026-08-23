import { ref, computed, readonly, type Ref } from 'vue'
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
  /** 资源路径信息（与主进程 ResourceManager.getResourceInfo 返回结构一致） */
  resourceInfo?: {
    executablePath: string
    configPath: string
    sessionFilePath: string
    exists: boolean
  }
}

export interface Aria2LocalConfig {
  port?: number
  secret?: string
  downloadDir?: string
  autoStart?: boolean
}

// ── 模块级单例状态 ──
// 在整个应用生命周期内只创建一次，状态跨组件实例共享
const processInfo = ref<Aria2ProcessInfo>({
  isRunning: false,
  pid: null,
  retryCount: 0,
  config: null
})

const isStarting = ref(false)
const isStopping = ref(false)
let statusCheckInterval: ReturnType<typeof setInterval> | null = null

// 模块级后台预加载标记，只初始化一次
let initialized = false

// 轮询并发锁：避免上一次 getStatus 未返回时下一次定时器触发并发请求 IPC
let isFetching = false

// 共享的进程状态拉取逻辑
async function fetchStatus(): Promise<void> {
  if (isFetching) return // 并发保护
  if (typeof window === 'undefined' || !window.electronAPI?.aria2) {
    console.warn('Electron API not available')
    return
  }

  isFetching = true
  try {
    const status = await window.electronAPI.aria2.getStatus()
    processInfo.value = status
  } catch (error) {
    console.error('获取 Aria2 状态失败:', error)
    processInfo.value.error = error instanceof Error ? error.message : String(error)
  } finally {
    isFetching = false
  }
}

// 应用启动时在后台预加载本地引擎状态并开启轮询，
// 使设置页首次进入即可直接渲染最新状态，避免从"停止"闪烁到"运行中"
export function initLocalService(): void {
  if (initialized) return
  initialized = true

  if (typeof window === 'undefined' || !window.electronAPI?.aria2) return

  // 首次拉取完成后再开启轮询，避免初始状态未就绪时轮询到空值造成 UI 闪烁
  void fetchStatus().then(() => {
    if (!statusCheckInterval && initialized) {
      statusCheckInterval = setInterval(() => void fetchStatus(), 5000)
    }
  })
}

/** 停止后台状态轮询（应用卸载时调用） */
export function stopStatusCheck(): void {
  if (statusCheckInterval) {
    clearInterval(statusCheckInterval)
    statusCheckInterval = null
  }
}

export function useAria2LocalService() {
  const { t } = useI18n()

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

  // 获取进程状态（复用模块级共享 fetch）
  async function getStatus(): Promise<void> {
    await fetchStatus()
  }

  /** 操作进行中等待提示文案 key（start/stop 按锁类型区分，restart 用专用文案） */
  function getWaitMsgKey(action: 'start' | 'stop' | 'restart', lockKey: 'isStarting' | 'isStopping'): string {
    if (action === 'restart') return 'localService.operatingWait'
    return lockKey === 'isStarting' ? 'localService.startingWait' : 'localService.stoppingWait'
  }

  /** 操作对应的失败日志动作名 */
  function getActionLabel(action: 'start' | 'stop' | 'restart'): string {
    if (action === 'restart') return '重启'
    return action === 'start' ? '启动' : '停止'
  }

  /**
   * 本地引擎操作的统一骨架：可用性检查 + 并发保护 + IPC 调用 + 结果提示
   * @param action 操作名（用于等待提示与失败日志）
   * @param lockRef 并发锁引用（start/restart 用 isStarting，stop 用 isStopping）
   * @param lockKey 锁类型（用于推导等待提示文案）
   * @param fn 实际 IPC 调用
   * @param successMsg 成功提示 i18n key（空字符串表示不提示，与启动原行为一致）
   * @param failMsgKey 失败提示 i18n key
   * @param extraLockRef 额外并发锁（restart 需同时检查 isStopping）
   */
  async function withLocalServiceOperation(
    action: 'start' | 'stop' | 'restart',
    lockRef: Ref<boolean>,
    lockKey: 'isStarting' | 'isStopping',
    fn: () => Promise<{ success: boolean; error?: string }>,
    successMsg: string,
    failMsgKey: string,
    extraLockRef?: Ref<boolean>
  ): Promise<boolean> {
    if (!isElectronAvailable.value) {
      message.error(t('localService.electronUnavailable'))
      return false
    }

    if (lockRef.value || extraLockRef?.value) {
      message.warning(t(getWaitMsgKey(action, lockKey)))
      return false
    }

    lockRef.value = true

    try {
      const result = await fn()

      if (result?.success) {
        if (successMsg) message.success(t(successMsg))
        await getStatus()
        return true
      } else {
        message.error(t(failMsgKey, { error: result.error }))
        return false
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      message.error(t(failMsgKey, { error: errorMessage }))
      console.error(`${getActionLabel(action)} Aria2 失败:`, error)
      return false
    } finally {
      lockRef.value = false
    }
  }

  // 启动 Aria2
  function start(): Promise<boolean> {
    return withLocalServiceOperation(
      'start',
      isStarting,
      'isStarting',
      () => window.electronAPI!.aria2.start(),
      '', // 启动成功不弹提示，与原行为一致
      'localService.startFailed'
    )
  }

  // 停止 Aria2
  function stop(): Promise<boolean> {
    return withLocalServiceOperation(
      'stop',
      isStopping,
      'isStopping',
      () => window.electronAPI!.aria2.stop(),
      'localService.serviceStopped',
      'localService.stopFailed'
    )
  }

  // 重启 Aria2
  function restart(): Promise<boolean> {
    return withLocalServiceOperation(
      'restart',
      isStarting,
      'isStarting',
      () => window.electronAPI!.aria2.restart(),
      'localService.restartSuccess',
      'localService.restartFailed',
      isStopping // 重启需同时检查停止中的锁
    )
  }

  // 更新配置
  async function updateConfig(config: Aria2LocalConfig): Promise<boolean> {
    if (!isElectronAvailable.value) {
      message.error(t('localService.electronUnavailable'))
      return false
    }

    try {
      const plainConfig = {
        port: config.port,
        secret: config.secret,
        downloadDir: config.downloadDir,
        autoStart: config.autoStart
      }

      const result = await window.electronAPI!.aria2.updateConfig(plainConfig)

      if (result?.success) {
        await getStatus()
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

  return {
    // 状态
    processInfo: readonly(processInfo),
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

    // 配置
    getConnectionConfig
  }
}
