import { defineStore } from 'pinia'
import { ref, shallowRef, computed } from 'vue'
import { Aria2Service } from '@/services/aria2Service'
import { useSettingsStore } from '@/stores/settingsStore'
import { useTaskStore } from '@/stores/taskStore'
import { useStatsStore } from '@/stores/statsStore'
import { isLocalEngineAddress } from '@/shared/localEngine'
import type { Aria2Config, ConnectionProfile } from '@/types/aria2'

const DEFAULT_CONFIG: Aria2Config = {
  host: 'localhost',
  port: 6800,
  protocol: 'http',
  secret: '',
  path: '/jsonrpc'
}

/**
 * 让指向本机引擎的连接预设与引擎密钥保持一致。
 *
 * 为什么需要：本地引擎的 rpc-secret 由主进程负责（首启自动生成，写入 aria2.conf 与
 * settings.aria2.secret）。连接预设的密钥可能与之脱节，典型场景：
 *  - 首次安装：预设来自 defaultSettings（secret: ''）
 *  - 用户在「RPC 安全设置」页改了密钥（写 conf），预设仍是旧值
 * 两种情况下前端都会用错误的 token 连接，表现为"授权失败、无法连接"。
 *
 * 规则：仅当"本机地址 + 与本地引擎同端口 + 引擎侧确有密钥"时，把预设密钥对齐为引擎密钥；
 * 用户自建的远程预设、以及引擎本身无密钥的情况都不改动。
 */
function alignLocalEngineSecret(
  config: Aria2Config,
  aria2Settings?: { secret?: string; port?: number }
): Aria2Config {
  const secret = aria2Settings?.secret || ''
  if (!secret) return config
  if (!isLocalEngineAddress(config.host, config.port, aria2Settings?.port)) return config
  return config.secret === secret ? config : { ...config, secret }
}

export const useConnectionStore = defineStore('connection', () => {
  // shallowRef：service 内部持有 WebSocket/axios 等非纯数据结构，仅追踪引用变化，避免深度代理开销与行为异常
  const service = shallowRef<Aria2Service | null>(null)
  const isConnected = ref(false)
  const isConnecting = ref(false)
  const connectionError = ref<string | null>(null)
  // 全局连接对话框显示状态（对话框实例只挂载在 App.vue，避免多处实例）
  const showConnectionDialog = ref(false)

  // 命名连接配置预设
  const profiles = ref<ConnectionProfile[]>([
    { id: 'default', name: '', config: { ...DEFAULT_CONFIG } }
  ])
  const activeProfileId = ref<string>('default')
  // 连接代次：每次 connect/disconnect 都会 +1。旧连接尝试发现自己不再是"最新一代"时
  // 必须安静退出，不能覆盖新连接的状态（否则会出现"提示连接成功但实际没连上"）
  let connectToken = 0

  // 当前激活配置（自动连接 / 状态页地址展示使用）
  const config = computed<Aria2Config>(() => {
    const profile = profiles.value.find(p => p.id === activeProfileId.value)
    return profile ? { ...profile.config } : { ...DEFAULT_CONFIG }
  })

  // 从设置加载配置预设（含旧版 aria2 配置迁移）
  function loadProfiles() {
    const settingsStore = useSettingsStore()
    const aria2Settings = settingsStore.settings?.aria2
    const saved = settingsStore.settings?.connectionProfiles
    if (saved && saved.length > 0) {
      profiles.value = saved.map(p => ({
        id: p.id,
        name: p.name,
        // 对齐本机引擎密钥，避免"引擎要 token、前端不发/发旧 token"导致连不上
        config: alignLocalEngineSecret({ ...DEFAULT_CONFIG, ...p.config }, aria2Settings)
      }))
    } else {
      // 迁移：首次使用多配置时，用旧版 aria2 连接设置填充默认预设
      const migratedConfig = alignLocalEngineSecret(
        { ...DEFAULT_CONFIG, ...(aria2Settings || {}) },
        aria2Settings
      )
      profiles.value = [
        { id: 'default', name: '', config: migratedConfig }
      ]
    }

    const activeId = settingsStore.settings?.activeProfileId
    activeProfileId.value =
      activeId && profiles.value.some(p => p.id === activeId) ? activeId : profiles.value[0]?.id ?? ''
  }

  // 持久化配置预设
  async function persistProfiles() {
    const settingsStore = useSettingsStore()
    await settingsStore.updateSettings({
      connectionProfiles: profiles.value.map(p => ({
        id: p.id,
        name: p.name,
        config: {
          host: p.config.host,
          port: p.config.port,
          protocol: p.config.protocol,
          secret: p.config.secret || '',
          path: p.config.path || '/jsonrpc'
        }
      })),
      activeProfileId: activeProfileId.value
    })
  }

  // 新建配置预设（不切换当前激活连接：未实际连接前不应把新配置标记为已连接）
  async function createProfile(name: string, baseConfig?: Aria2Config): Promise<ConnectionProfile> {
    const profile: ConnectionProfile = {
      id: `profile_${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim() || '未命名',
      config: { ...DEFAULT_CONFIG, ...(baseConfig || {}) }
    }
    profiles.value.push(profile)
    await persistProfiles()
    return profile
  }

  // 重命名配置预设
  async function renameProfile(id: string, name: string): Promise<void> {
    const profile = profiles.value.find(p => p.id === id)
    if (profile) {
      profile.name = name.trim() || profile.name
      await persistProfiles()
    }
  }

  // 删除配置预设（至少保留一个）
  async function deleteProfile(id: string): Promise<void> {
    if (profiles.value.length <= 1) return
    const index = profiles.value.findIndex(p => p.id === id)
    if (index === -1) return
    profiles.value.splice(index, 1)
    if (activeProfileId.value === id) {
      activeProfileId.value = profiles.value[0]?.id ?? ''
    }
    await persistProfiles()
  }

  // 切换当前配置预设
  function setActiveProfile(id: string): void {
    if (profiles.value.some(p => p.id === id)) {
      activeProfileId.value = id
    }
  }

  // 更新当前激活预设的连接参数（不持久化，由调用方决定）
  function updateActiveConfig(newConfig: Partial<Aria2Config>): void {
    const profile = profiles.value.find(p => p.id === activeProfileId.value)
    if (profile) {
      profile.config = { ...profile.config, ...newConfig }
    }
  }

  // 更新指定预设的连接参数并持久化
  async function updateProfileConfig(id: string, newConfig: Partial<Aria2Config>): Promise<void> {
    const profile = profiles.value.find(p => p.id === id)
    if (profile) {
      profile.config = { ...profile.config, ...newConfig }
      await persistProfiles()
    }
  }

  async function connect(newConfig?: Partial<Aria2Config>, profileId?: string): Promise<boolean> {
    // 允许并发发起连接：后来的连接会接管（token 递增），先前的尝试自动作废。
    // 这样用户在第一个实例迟迟连不上时可以直接点另一个实例，不必等超时。
    const token = ++connectToken

    // 指定 profileId 时按该预设连接，成功后才把它切成当前预设：
    // 失败的连接不会把界面上的「当前连接」改到连不上的实例上
    const targetProfile = profileId ? profiles.value.find(p => p.id === profileId) : undefined
    if (targetProfile) {
      if (newConfig) targetProfile.config = { ...targetProfile.config, ...newConfig }
    } else if (newConfig) {
      updateActiveConfig(newConfig)
    }
    // 固定本次尝试的目标配置：并发发起第二次连接时，第一次仍按自己当初的参数收尾，
    // 不会因为 activeProfile 变了而连到错误的实例
    const targetConfig: Aria2Config = { ...(targetProfile ? targetProfile.config : config.value) }

    isConnecting.value = true
    connectionError.value = null
    let targetService: Aria2Service | null = null

    try {
      if (service.value) {
        service.value.disconnect()
        service.value = null
        // 从旧连接切换到新连接时清空前端缓存任务，加载全新列表
        // （本地已完成记录持久化保留，loadAllTasks 会重新合并）
        const taskStore = useTaskStore()
        taskStore.clearTasks()
      }

      // 用局部变量持有本次连接的服务实例：并发发起第二次连接会改写 service.value，
      // 若这里始终读 service.value，第一次的 await 会落到第二次的实例上，相互串扰
      targetService = new Aria2Service(targetConfig)
      service.value = targetService

      // 设置基本监听器
      targetService.on('connected', () => {
        if (token !== connectToken) return
        isConnected.value = true
        connectionError.value = null
      })

      targetService.on('disconnected', () => {
        if (token !== connectToken) return
        isConnected.value = false
      })

      targetService.on('error', (error: unknown) => {
        if (token !== connectToken) return
        const err = error as Error
        connectionError.value = err.message || 'Connection error'
      })

      try {
        await targetService.connect()
      } catch (wsError) {
        console.warn('WebSocket connection failed, will use HTTP:', wsError)
      }

      // 验证连接
      await targetService.getVersion()

      // 期间又发起了新的连接：本次结果作废，交还给最新一次尝试
      if (token !== connectToken) return false

      isConnected.value = true
      connectionError.value = null

      // 连接成功后预热全局配置缓存，供设置页首次渲染直接使用，避免初次切换时的空白闪烁
      const statsStore = useStatsStore()
      await statsStore.loadGlobalOptions()

      // 连接成功后才切换当前预设并持久化：失败或作废的尝试不会改动它
      if (targetProfile) activeProfileId.value = targetProfile.id
      try {
        await persistProfiles()
      } catch (persistError) {
        // 预设写盘失败不应拆掉已经建立的可用连接，只记录日志
        console.warn('Failed to persist connection profiles after connect:', persistError)
      }

      return true

    } catch (error) {
      // 被更新的连接取代：不报错、不改状态，让最新一次尝试自己汇报结果
      if (token !== connectToken) return false
      // 连接失败时必须销毁本次创建的 service：否则 WebSocket 已 onopen 后 getVersion
      // 失败（鉴权/版本不兼容）会留下 shouldReconnect=true 的实例，在后台无限重连。
      if (targetService && service.value === targetService) {
        try { targetService.disconnect() } catch { /* 清理失败不影响错误上报 */ }
        service.value = null
        useTaskStore().clearTasks()
      }
      connectionError.value = error instanceof Error ? error.message : 'Connection failed'
      isConnected.value = false
      throw error
    } finally {
      // 只有最新一次尝试才负责收尾，避免旧尝试把新连接的 loading 提前关掉
      if (token === connectToken) isConnecting.value = false
    }
  }

  // 测试任意配置的连通性，不影响当前活动连接（多实例管理面板使用）
  async function testConnection(target: Aria2Config): Promise<{ success: boolean; version?: string; latencyMs: number; error?: string }> {
    const started = Date.now()
    const probe = new Aria2Service({ ...DEFAULT_CONFIG, ...target })
    try {
      const version = await Promise.race([
        probe.getVersion(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Connection timed out')), 6000))
      ])
      return { success: true, version: version.version, latencyMs: Date.now() - started }
    } catch (error) {
      return { success: false, latencyMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) }
    } finally {
      try { probe.disconnect() } catch { /* 探测实例断开失败无需处理 */ }
    }
  }

  function disconnect() {
    // 断开也推进代次：正在进行的连接尝试随之作废，不会再回写 isConnected
    connectToken += 1
    isConnecting.value = false
    if (service.value) {
      service.value.disconnect()
      service.value = null
    }
    isConnected.value = false
    connectionError.value = null

    // 清空全局配置缓存，避免重新连接后展示旧连接的数据
    useStatsStore().clearCache()

    // 断开连接后清空前端缓存的任务，便于连接新服务时加载全新列表
    const taskStore = useTaskStore()
    taskStore.clearTasks()
  }

  return {
    service,
    isConnected,
    isConnecting,
    connectionError,
    showConnectionDialog,
    profiles,
    activeProfileId,
    config,
    loadProfiles,
    persistProfiles,
    createProfile,
    renameProfile,
    deleteProfile,
    setActiveProfile,
    updateActiveConfig,
    updateProfileConfig,
    testConnection,
    connect,
    disconnect
  }
})
