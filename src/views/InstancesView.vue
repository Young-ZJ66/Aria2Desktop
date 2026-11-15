<template>
  <div class="instances-view">
    <PageHeader :title="t('instances.title')" :description="t('instances.description')">
      <template #actions>
        <n-button size="small" :loading="testingAll" @click="testAll">{{ t('instances.testAll') }}</n-button>
        <n-button size="small" type="primary" @click="openConnectionDialog">{{ t('instances.manage') }}</n-button>
      </template>
    </PageHeader>

    <n-empty v-if="connectionStore.profiles.length === 0" :description="t('instances.empty')" />

    <div v-else class="instance-grid">
      <n-card v-for="profile in connectionStore.profiles" :key="profile.id" size="small" class="instance-card" :class="{ active: profile.id === connectionStore.activeProfileId }">
        <div class="instance-card-header">
          <div class="instance-name">
            {{ profile.name || t('connection.defaultProfileName') }}
            <n-tag v-if="profile.id === connectionStore.activeProfileId" size="tiny" type="primary" :bordered="false">
              {{ t('instances.current') }}
            </n-tag>
          </div>
          <n-tag size="tiny" :type="statusType(profile.id)" :bordered="false">
            {{ statusLabel(profile.id) }}
          </n-tag>
        </div>

        <div class="instance-endpoint">{{ endpoint(profile) }}</div>

        <div class="instance-meta">
          <span v-if="probes[profile.id]?.version">aria2 {{ probes[profile.id]?.version }}</span>
          <span v-if="probes[profile.id]?.latencyMs !== undefined">{{ t('instances.latency', { ms: probes[profile.id]?.latencyMs }) }}</span>
          <span v-if="probes[profile.id]?.error" class="instance-error" :title="probes[profile.id]?.error">{{ probes[profile.id]?.error }}</span>
          <span v-else-if="!probes[profile.id]" class="instance-muted">{{ t('instances.notTested') }}</span>
        </div>

        <div class="instance-card-actions">
          <n-button size="tiny" :loading="testing[profile.id]" @click="test(profile)">{{ t('instances.test') }}</n-button>
          <n-button
            size="tiny"
            :type="isActive(profile) ? 'default' : 'primary'"
            :class="isActive(profile) ? 'btn-danger-outline' : ''"
            :loading="connectingId === profile.id"
            @click="activate(profile)"
          >
            {{ isActive(profile) ? t('connection.disconnect') : t('instances.connect') }}
          </n-button>
          <n-button size="tiny" @click="edit(profile)">{{ t('instances.edit') }}</n-button>
        </div>
      </n-card>
    </div>

    <DismissibleAlert storage-key="instances.note" type="info" :show-icon="false" class="instances-note">{{ t('instances.multiInstanceNote') }}</DismissibleAlert>
  </div>
</template>

<script setup lang="ts">
import { onActivated, onDeactivated, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { NCard, NButton, NTag, NEmpty } from 'naive-ui'
import DismissibleAlert from '@/components/common/DismissibleAlert.vue'
import { useConnectionStore } from '@/stores/connectionStore'
import PageHeader from '@/components/layout/PageHeader.vue'
import { withMinimumDuration } from '@/composables/useMinimumLoading'

import { message } from '@/utils/feedback'
import { getUserFriendlyError } from '@/utils/errorMessages'
import type { ConnectionProfile } from '@/types/aria2'

interface ProbeResult {
  success: boolean
  version?: string
  latencyMs: number
  error?: string
}

const { t } = useI18n()
const connectionStore = useConnectionStore()
const probes = reactive<Record<string, ProbeResult>>({})
const testing = reactive<Record<string, boolean>>({})
const testingAll = ref(false)
const connectingId = ref('')

/** 已连接实例的实时延迟刷新间隔 */
const LATENCY_REFRESH_MS = 5000
let latencyTimer: ReturnType<typeof setInterval> | null = null

/**
 * 静默探测：不点亮「测试」按钮、不显示「测试中」，只在后台更新版本与延迟。
 * 用于连接成功后与已连接实例的定时刷新 —— 用户不需要手动点「测试」就能看到实时延迟。
 */
async function probeSilently(profile: ConnectionProfile) {
  try {
    probes[profile.id] = await connectionStore.testConnection(profile.config)
  } catch {
    // 静默探测失败不打扰用户：保留上一次的结果
  }
}

function activeProfile(): ConnectionProfile | undefined {
  return connectionStore.profiles.find(profile => profile.id === connectionStore.activeProfileId)
}

function startLatencyPolling() {
  stopLatencyPolling()
  latencyTimer = setInterval(() => {
    if (!connectionStore.isConnected) return
    const profile = activeProfile()
    if (profile) void probeSilently(profile)
  }, LATENCY_REFRESH_MS)
}

function stopLatencyPolling() {
  if (latencyTimer !== null) {
    clearInterval(latencyTimer)
    latencyTimer = null
  }
}

// keep-alive 下页面不会被卸载：随「激活 / 失活」启停轮询，避免后台页继续探测
onMounted(() => startLatencyPolling())
onActivated(() => {
  startLatencyPolling()
  const profile = activeProfile()
  if (profile && connectionStore.isConnected) void probeSilently(profile)
})
onDeactivated(() => stopLatencyPolling())
onUnmounted(() => stopLatencyPolling())

// 连接建立或切换实例后立即静默刷新一次，让延迟马上出现在卡片上
watch(
  () => [connectionStore.activeProfileId, connectionStore.isConnected] as const,
  ([, connected]) => {
    if (!connected) return
    const profile = activeProfile()
    if (profile) void probeSilently(profile)
  }
)

function endpoint(profile: ConnectionProfile): string {
  return `${profile.config.protocol}://${profile.config.host}:${profile.config.port}${profile.config.path || '/jsonrpc'}`
}

function statusType(id: string): 'default' | 'success' | 'error' | 'warning' {
  if (testing[id]) return 'warning'
  const probe = probes[id]
  if (!probe) return 'default'
  return probe.success ? 'success' : 'error'
}

function statusLabel(id: string): string {
  if (testing[id]) return t('instances.testing')
  const probe = probes[id]
  if (!probe) return t('instances.unknown')
  return probe.success ? t('instances.online') : t('instances.offline')
}

async function test(profile: ConnectionProfile) {
  testing[profile.id] = true
  try {
    probes[profile.id] = await withMinimumDuration(() => connectionStore.testConnection(profile.config))
  } finally {
    testing[profile.id] = false
  }
}

async function testAll() {
  testingAll.value = true
  try {
    await Promise.all(connectionStore.profiles.map(profile => test(profile)))
  } finally {
    testingAll.value = false
  }
}

function isActive(profile: ConnectionProfile): boolean {
  return profile.id === connectionStore.activeProfileId && connectionStore.isConnected
}

async function activate(profile: ConnectionProfile) {
  // 已连接的实例：同一个按钮改为断开
  if (isActive(profile)) {
    connectingId.value = profile.id
    try {
      await withMinimumDuration(async () => connectionStore.disconnect())
      message.success(t('connection.disconnected'))
    } finally {
      if (connectingId.value === profile.id) connectingId.value = ''
    }
    return
  }

  connectingId.value = profile.id
  try {
    // 按预设连接：成功的连接才会把它切成「当前」，失败不会改动当前连接
    const connected = await withMinimumDuration(() => connectionStore.connect({ ...profile.config }, profile.id))
    // false = 本次尝试已被更新的连接取代（用户又点了别的实例），静默退出，不弹提示
    if (!connected) return
    message.success(t('instances.connectSuccess', { name: profile.name || t('connection.defaultProfileName') }))
    // 连接成功后静默测一次延迟（不点亮「测试」按钮），省去用户再点「测试」
    void probeSilently(profile)
  } catch (error) {
    message.error(t('instances.connectFailed', { error: getUserFriendlyError(error) }))
  } finally {
    // 并发连接时 connectingId 可能已被后来的实例接管，只有仍归自己时才清空
    if (connectingId.value === profile.id) connectingId.value = ''
  }
}

function edit(profile: ConnectionProfile) {
  connectionStore.setActiveProfile(profile.id)
  openConnectionDialog()
}

function openConnectionDialog() {
  connectionStore.showConnectionDialog = true
}
</script>

<style scoped>
.instance-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 14px; }
.instance-card { border-radius: 12px; border: 1px solid var(--border-light); }
.instance-card.active { border-color: var(--color-primary); box-shadow: 0 0 0 1px var(--color-primary) inset; }
.instance-card-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.instance-name { display: flex; align-items: center; gap: 8px; font-weight: 600; }
.instance-endpoint { margin-top: 10px; font-family: var(--font-mono, monospace); font-size: 12px; color: var(--text-secondary); word-break: break-all; }
.instance-meta { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 10px; font-size: 12px; color: var(--text-secondary); min-height: 18px; }
.instance-muted { opacity: 0.75; }
.instance-error { color: var(--color-error); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.instance-card-actions { display: flex; gap: 8px; margin-top: 14px; }
.instances-note { margin-top: 20px; }
</style>
