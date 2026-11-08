<template>
  <div class="instances-view">
    <div class="instances-header">
      <div>
        <h2>{{ t('instances.title') }}</h2>
        <p class="instances-desc">{{ t('instances.description') }}</p>
      </div>
      <div class="instances-actions">
        <n-button size="small" :loading="testingAll" @click="testAll">{{ t('instances.testAll') }}</n-button>
        <n-button size="small" type="primary" @click="openConnectionDialog">{{ t('instances.manage') }}</n-button>
      </div>
    </div>

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
            type="primary"
            :disabled="profile.id === connectionStore.activeProfileId && connectionStore.isConnected"
            :loading="connectingId === profile.id"
            @click="activate(profile)"
          >
            {{ profile.id === connectionStore.activeProfileId && connectionStore.isConnected ? t('instances.connected') : t('instances.connect') }}
          </n-button>
          <n-button size="tiny" quaternary @click="edit(profile)">{{ t('instances.edit') }}</n-button>
        </div>
      </n-card>
    </div>

    <n-alert type="info" :show-icon="false" class="instances-note">{{ t('instances.multiInstanceNote') }}</n-alert>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { NCard, NButton, NTag, NEmpty, NAlert } from 'naive-ui'
import { useConnectionStore } from '@/stores/connectionStore'

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
    probes[profile.id] = await connectionStore.testConnection(profile.config)
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

async function activate(profile: ConnectionProfile) {
  connectingId.value = profile.id
  try {
    connectionStore.setActiveProfile(profile.id)
    await connectionStore.connect({ ...profile.config })
    message.success(t('instances.connectSuccess', { name: profile.name || t('connection.defaultProfileName') }))
  } catch (error) {
    message.error(t('instances.connectFailed', { error: getUserFriendlyError(error) }))
  } finally {
    connectingId.value = ''
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
.instances-view { padding: 20px 24px; }
.instances-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
.instances-header h2 { margin: 0 0 4px; font-size: 20px; }
.instances-desc { margin: 0; color: var(--text-secondary); font-size: 13px; }
.instances-actions { display: flex; gap: 10px; }
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
