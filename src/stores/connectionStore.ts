import { defineStore } from 'pinia'
import { ref, shallowRef, computed } from 'vue'
import { Aria2Service } from '@/services/aria2Service'
import { useSettingsStore } from '@/stores/settingsStore'
import { useTaskStore } from '@/stores/taskStore'
import { useStatsStore } from '@/stores/statsStore'
import type { Aria2Config, ConnectionProfile } from '@/types/aria2'

const DEFAULT_CONFIG: Aria2Config = {
  host: 'localhost',
  port: 6800,
  protocol: 'http',
  secret: '',
  path: '/jsonrpc'
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

  // 当前激活配置（自动连接 / 状态页地址展示使用）
  const config = computed<Aria2Config>(() => {
    const profile = profiles.value.find(p => p.id === activeProfileId.value)
    return profile ? { ...profile.config } : { ...DEFAULT_CONFIG }
  })

  // 从设置加载配置预设（含旧版 aria2 配置迁移）
  function loadProfiles() {
    const settingsStore = useSettingsStore()
    const saved = settingsStore.settings?.connectionProfiles
    if (saved && saved.length > 0) {
      profiles.value = saved.map(p => ({
        id: p.id,
        name: p.name,
        config: { ...DEFAULT_CONFIG, ...p.config }
      }))
    } else {
      // 迁移：首次使用多配置时，用旧版 aria2 连接设置填充默认预设
      const legacy = settingsStore.settings?.aria2
      const migratedConfig = legacy ? { ...DEFAULT_CONFIG, ...legacy } : { ...DEFAULT_CONFIG }
      profiles.value = [
        { id: 'default', name: '', config: migratedConfig }
      ]
    }

    const activeId = settingsStore.settings?.activeProfileId
    activeProfileId.value =
      activeId && profiles.value.some(p => p.id === activeId) ? activeId : profiles.value[0].id
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
      id: `profile_${Date.now().toString(36)}`,
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
      activeProfileId.value = profiles.value[0].id
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

  async function connect(newConfig?: Partial<Aria2Config>) {
    if (newConfig) {
      updateActiveConfig(newConfig)
    }

    isConnecting.value = true
    connectionError.value = null

    try {
      if (service.value) {
        service.value.disconnect()
        service.value = null
        // 从旧连接切换到新连接时清空前端缓存任务，加载全新列表（首次连接不清空，避免丢失本地已完成记录）
        const taskStore = useTaskStore()
        taskStore.clearTasks()
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

      service.value.on('error', (error: unknown) => {
        const err = error as Error
        connectionError.value = err.message || 'Connection error'
      })

      try {
        await service.value.connect()
      } catch (wsError) {
        console.warn('WebSocket connection failed, will use HTTP:', wsError)
      }

      // 验证连接
      await service.value.getVersion()
      isConnected.value = true

      // 连接成功后预热全局配置缓存，供设置页首次渲染直接使用，避免初次切换时的空白闪烁
      const statsStore = useStatsStore()
      await statsStore.loadGlobalOptions()

      // 连接成功后持久化配置预设
      await persistProfiles()

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
    connect,
    disconnect
  }
})
