<template>
  <div class="instances-view">
    <PageHeader class="page-head" :title="t('instances.title')">
      <template #actions>
        <n-button size="small" :loading="testingAll" @click="testAll">{{ t('instances.testAll') }}</n-button>
        <n-button size="small" @click="openConnectionDialog">{{ t('instances.manage') }}</n-button>
        <n-button size="small" type="primary" :loading="addingInstance" @click="addInstance">
          <template #icon>
            <n-icon><AddOutline /></n-icon>
          </template>
          {{ t('instances.add') }}
        </n-button>
      </template>
    </PageHeader>

    <!-- 空态：标题 + 主操作（v2 空态写法），外面套一层表面避免浮在 app 背景上 -->
    <div v-if="connectionStore.profiles.length === 0" class="instances-empty">
      <UiEmpty
        :title="t('instances.empty')"
        :icon="ServerOutline"
      >
        <template #actions>
          <n-button size="small" type="primary" @click="addInstance">{{ t('instances.add') }}</n-button>
        </template>
      </UiEmpty>
    </div>

    <!-- 实例卡片网格：320px 起自适应列数，不再固定单列 -->
    <div v-else class="instance-grid">
      <article
        v-for="profile in connectionStore.profiles"
        :key="profile.id"
        class="instance-card"
        :class="{ 'instance-card--active': isActive(profile) }"
      >
        <header class="instance-card__head">
          <div class="instance-card__identity">
            <h3 class="instance-card__name ds-truncate" :title="displayName(profile)">{{ displayName(profile) }}</h3>
            <n-tag
              v-if="profile.id === connectionStore.activeProfileId"
              size="small"
              :bordered="false"
              class="instance-card__current"
            >
              {{ t('instances.current') }}
            </n-tag>
          </div>
          <n-tag size="small" :type="statusType(profile.id)" :bordered="false" class="instance-card__status">
            {{ statusLabel(profile.id) }}
          </n-tag>
        </header>

        <p class="instance-card__endpoint ds-num ds-truncate" :title="endpoint(profile)">{{ endpoint(profile) }}</p>

        <div class="instance-card__meta">
          <span v-if="probes[profile.id]?.version" class="instance-card__version ds-num">
            aria2 {{ probes[profile.id]?.version }}
          </span>
          <span v-if="probes[profile.id]?.latencyMs !== undefined" class="instance-card__latency ds-tnum">
            {{ t('instances.latency', { ms: probes[profile.id]?.latencyMs }) }}
          </span>
        </div>

        <p
          v-if="probes[profile.id]?.error"
          class="instance-card__error ds-truncate"
          :title="probes[profile.id]?.error"
        >
          {{ probes[profile.id]?.error }}
        </p>
        <p v-else-if="!probes[profile.id]" class="instance-card__hint">{{ t('instances.notTested') }}</p>

        <div class="instance-card__actions">
          <n-button size="small" :loading="testing[profile.id]" @click="test(profile)">{{ t('instances.test') }}</n-button>
          <n-button
            size="small"
            :type="isActive(profile) ? 'error' : 'primary'"
            :tertiary="isActive(profile)"
            :loading="connectingId === profile.id"
            @click="activate(profile)"
          >
            {{ isActive(profile) ? t('connection.disconnect') : t('instances.connect') }}
          </n-button>
          <n-button size="small" @click="edit(profile)">{{ t('instances.edit') }}</n-button>
          <n-button
            class="instance-card__delete"
            size="small"
            quaternary
            type="error"
            :disabled="connectionStore.profiles.length <= 1 || connectionStore.isConnecting || connectingId === profile.id"
            @click="removeInstance(profile)"
          >
            {{ t('connection.deleteProfile') }}
          </n-button>
        </div>
      </article>

      <!--
        末位虚线「新增实例」卡：单实例时网格右侧和下方是一整片空白，
        放一张可点的槽位卡既收口又给出下一步动作（与页头按钮同源，不新增入口）。
      -->
      <button class="instance-add" type="button" @click="addInstance">
        <n-icon size="22"><AddOutline /></n-icon>
        <span>{{ t('instances.add') }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onActivated, onDeactivated, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NIcon, NTag } from 'naive-ui'
import { AddOutline, ServerOutline } from '@vicons/ionicons5'
import { UiEmpty } from '@/components/ui'
import { useConnectionStore } from '@/stores/connectionStore'
import PageHeader from '@/components/layout/PageHeader.vue'
import { withMinimumDuration } from '@/composables/useMinimumLoading'

import { confirm, message } from '@/utils/feedback'
import { getUserFriendlyError } from '@/utils/errorMessages'
import type { ConnectionProfile } from '@/types/aria2'

interface ProbeResult {
  success: boolean
  version?: string
  latencyMs: number
  error?: string
}

// 文案来自 `instances.addInstance`（新增实例）
const { t } = useI18n()
const connectionStore = useConnectionStore()
const probes = reactive<Record<string, ProbeResult>>({})
const testing = reactive<Record<string, boolean>>({})
const testingAll = ref(false)
const connectingId = ref('')
const addingInstance = ref(false)

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

function displayName(profile: ConnectionProfile): string {
  return profile.name || t('connection.defaultProfileName')
}

function endpoint(profile: ConnectionProfile): string {
  return `${profile.config.protocol}://${profile.config.host}:${profile.config.port}${profile.config.path || '/jsonrpc'}`
}

/**
 * 状态语义色：在线 = success，测试中 = warning，其余（未测试 / 离线）= 中性。
 * 离线不再用 error 红：一屏多卡时红标签会盖过真正需要用户注意的错误行，
 * 错误原因由卡片内的错误行单独承担。
 */
function statusType(id: string): 'default' | 'success' | 'warning' {
  if (testing[id]) return 'warning'
  const probe = probes[id]
  if (!probe) return 'default'
  return probe.success ? 'success' : 'default'
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
    message.success(t('instances.connectSuccess', { name: displayName(profile) }))
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

/** 从实例卡直接删除配置；至少保留一个实例，删除正在使用的实例前先断开连接 */
function removeInstance(profile: ConnectionProfile) {
  if (connectionStore.profiles.length <= 1) return
  const name = displayName(profile)
  confirm({
    title: t('connection.deleteProfileTitle'),
    content: t('connection.confirmDeleteProfile', { name }),
    positiveText: t('common.confirm'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      try {
        // 删除当前正在使用的实例前先断开：否则 activeProfileId 会切到剩余实例，
        // 但 service 仍连着已删除的端点，界面会把另一张卡误标成「当前/已连接」。
        if (isActive(profile)) connectionStore.disconnect()
        await connectionStore.deleteProfile(profile.id)
        delete probes[profile.id]
        delete testing[profile.id]
      } catch (error) {
        console.error('Failed to delete instance:', error)
        message.error(getUserFriendlyError(error))
      }
    }
  })
}

function openConnectionDialog() {
  connectionStore.showConnectionDialog = true
}

/**
 * 新增实例：连接对话框没有「打开即进入新建态」的入口（它打开时总是回到配置列表并选中当前预设），
 * 所以这里用现有 store 能力组合出「新增」：先按默认配置建一个预设（卡片立刻出现在网格里），
 * 再打开对话框让用户改地址/端口并保存。默认名复用 connection.newProfile（各语言均有译文）。
 */
async function addInstance() {
  if (addingInstance.value) return
  addingInstance.value = true
  try {
    await connectionStore.createProfile(t('connection.newProfile'))
    openConnectionDialog()
  } finally {
    addingInstance.value = false
  }
}

</script>

<style scoped>
.instances-view {
  display: flex;
  flex-direction: column;
  gap: var(--ds-space-16);
}

/* 空态本身没有表面，套一层与卡片同款的面，避免文字直接浮在 app 背景上 */
.instances-empty {
  flex: 1;
  min-height: 320px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--ds-bg-surface);
  border: 1px solid var(--ds-border-subtle);
  border-radius: var(--ds-radius-lg);
}

.instance-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: var(--ds-space-16);
}

/* 新增实例的槽位卡：虚线 + 无底色，读起来是「这里还能放一个」而不是「已有一张卡」 */
.instance-add {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--ds-space-8);
  min-height: 156px;
  padding: var(--ds-space-16);
  font-family: inherit;
  font-size: var(--ds-text-small-size);
  font-weight: 500;
  color: var(--ds-text-muted);
  background: transparent;
  border: 1px dashed var(--ds-border-base);
  border-radius: var(--ds-radius-lg);
  cursor: pointer;
  transition:
    color var(--ds-motion-dur-2) var(--ds-motion-ease-out),
    border-color var(--ds-motion-dur-2) var(--ds-motion-ease-out),
    background-color var(--ds-motion-dur-2) var(--ds-motion-ease-out);
}

.instance-add:hover {
  color: var(--ds-accent-text);
  border-color: var(--ds-accent-border);
  background: var(--ds-accent-subtle);
}

.instance-card {
  display: flex;
  flex-direction: column;
  gap: var(--ds-space-12);
  min-width: 0;
  padding: var(--ds-space-16);
  background: var(--ds-bg-surface);
  border: 1px solid var(--ds-border-subtle);
  border-radius: var(--ds-radius-lg);
  transition: border-color var(--ds-motion-dur-2) var(--ds-motion-ease-out);
}

.instance-card:hover {
  border-color: var(--ds-border-base);
}

/* 当前已连接的实例：只提亮描边，不加阴影（v2 里阴影只属于浮层） */
.instance-card--active {
  border-color: var(--ds-accent-border);
}

.instance-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ds-space-8);
  min-width: 0;
}

.instance-card__identity {
  display: flex;
  align-items: center;
  gap: var(--ds-space-8);
  min-width: 0;
}

.instance-card__name {
  margin: 0;
  min-width: 0;
  font-size: var(--ds-text-bodyLg-size);
  line-height: var(--ds-text-bodyLg-leading);
  font-weight: 600;
  color: var(--ds-text-strong);
}

/* 「当前」标记：accent-subtle 底 + accent 文字（直接给属性，避免与 naive 的 --n-color 抢优先级） */
.instance-card__current {
  flex: none;
  background: var(--ds-accent-subtle);
  color: var(--ds-accent-text);
}

.instance-card__status {
  flex: none;
}

.instance-card__endpoint {
  margin: 0;
  min-width: 0;
  font-size: var(--ds-text-small-size);
  line-height: var(--ds-text-small-leading);
  color: var(--ds-text-muted);
}

.instance-card__meta {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--ds-space-8);
  min-width: 0;
  min-height: var(--ds-space-16);
}

.instance-card__version {
  font-size: var(--ds-text-small-size);
  color: var(--ds-text-base);
}

/* 延迟数值统一右对齐 + 等宽数字，多卡并排时数值能对齐 */
.instance-card__latency {
  margin-left: auto;
  font-size: var(--ds-text-small-size);
  color: var(--ds-text-muted);
  text-align: right;
  white-space: nowrap;
}

.instance-card__error {
  margin: 0;
  font-size: var(--ds-text-small-size);
  line-height: var(--ds-text-small-leading);
  color: var(--ds-status-danger-text);
}

.instance-card__hint {
  margin: 0;
  font-size: var(--ds-text-small-size);
  line-height: var(--ds-text-small-leading);
  color: var(--ds-text-faint);
}

/* 操作固定在卡片底部：同一行卡片高度不齐时按钮仍然对齐 */
.instance-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ds-space-8);
  margin-top: auto;
  padding-top: var(--ds-space-4);
}

/* 删除属于低频破坏性操作，放在操作行最右，和常用操作拉开距离 */
.instance-card__delete {
  margin-left: auto;
}

.instance-note {
  display: flex;
  align-items: flex-start;
  gap: var(--ds-space-12);
  padding: var(--ds-space-12) var(--ds-space-16);
  background: var(--ds-bg-surface);
  border: 1px solid var(--ds-border-subtle);
  border-left: 2px solid var(--ds-accent);
  border-radius: var(--ds-radius-md);
}

.instance-note__text {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  font-size: var(--ds-text-small-size);
  line-height: var(--ds-text-small-leading);
  color: var(--ds-text-base);
}

.instance-note__actions {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--ds-space-4);
}

.instance-note__forever {
  color: var(--ds-accent-text);
}
</style>
