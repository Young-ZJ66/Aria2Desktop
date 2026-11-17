<template>
  <div class="bt-insights-view">
    <PageHeader class="page-head" :title="t('btInsights.title')" :description="t('btInsights.description')">
      <template #actions>
        <n-select
          v-model:value="selectedGid"
          :options="btTaskOptions"
          :placeholder="t('btInsights.selectTask')"
          :loading="loading"
          :aria-label="t('btInsights.selectTask')"
          filterable
          size="small"
          class="bt-task-select"
        />
      </template>
    </PageHeader>

    <!-- 内容区：滚动只发生在容器内，页头保持不动 -->
    <div class="bt-body">
      <template v-if="selectedGid && snapshot">
        <n-alert v-if="showPollErrorAlert" type="warning" :bordered="false" closable class="bt-poll-alert" @close="dismissPollError">
          {{ t('btInsights.pollError', { error: getUserFriendlyError(snapshot.error) }) }}
        </n-alert>

        <!-- 指标带：5 项指标等宽一行；info hash 单独占一整行（40 位十六进制放格子里必然被截断） -->
        <div class="stat-band">
          <UiStat
            v-for="item in summaryItems"
            :key="item.key"
            :label="item.label"
            :value="item.value"
            :tone="item.tone"
            :title="item.title"
            class="stat-band__cell"
          />
          <div class="stat-band__hash">
            <span class="stat-band__hash-label">{{ t('btInsights.infoHash') }}</span>
            <span class="stat-band__hash-value ds-tnum" :title="infoHash">{{ infoHash }}</span>
          </div>
        </div>

        <!-- Peers：查询地理位置收进面板 header actions，不再浮在表头上方 -->
        <UiPanel :title="t('btInsights.peers')" :hint="'(' + snapshot.peers.length + ')'" flush>
          <template #actions>
            <n-button size="small" secondary :loading="locating" :disabled="!snapshot.peers.length" @click="lookupLocations">
              {{ t('taskPeer.lookupLocation') }}
            </n-button>
          </template>

          <DismissibleAlert v-if="locationError" storage-key="task.peerLocation" type="warning" class="bt-peer-alert">
            {{ locationError }}
          </DismissibleAlert>

          <n-data-table
            v-if="snapshot.peers.length"
            :columns="peerColumns"
            :data="snapshot.peers"
            :bordered="false"
            size="small"
            :single-line="false"
            :scroll-x="1040"
            class="bt-peers-table"
            :aria-label="t('taskDetail.peerInfo', { count: snapshot.peers.length })"
          />
          <UiEmpty v-else size="sm" :title="t('taskPeer.noPeers')" :icon="PeopleOutline" />
        </UiPanel>

        <!-- Trackers：announceList tier 展平 -->
        <UiPanel :title="t('btInsights.trackers')" :hint="'(' + snapshot.announceList.length + ')'" flush>
          <n-table v-if="snapshot.announceList.length" :bordered="false" size="small" class="bt-tracker-table">
            <thead>
              <tr>
                <th class="col-tier">{{ t('btInsights.tier') }}</th>
                <th>{{ t('btInsights.trackerUrl') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in snapshot.announceList" :key="row.url">
                <td class="col-tier ds-tnum">{{ row.tier }}</td>
                <td class="tracker-url" :title="row.url">{{ row.url }}</td>
              </tr>
            </tbody>
          </n-table>
          <UiEmpty v-else size="sm" :title="t('btInsights.noTrackers')" :icon="LinkOutline" />
        </UiPanel>
      </template>

      <UiPanel v-else-if="selectedGid && !snapshot" flush>
        <div class="bt-loading">
          <n-spin :description="t('btInsights.loading')" />
        </div>
      </UiPanel>

      <!-- 无 BT 任务 / 未选中任务 / 未连接：稳定的空态，图标在容器内垂直居中 -->
      <div v-else class="bt-empty">
        <UiEmpty :title="emptyState.title" :description="emptyState.description" :icon="AnalyticsOutline">
          <template #actions>
            <n-button v-if="isDisconnected" size="small" type="primary" @click="openConnectionDialog">
              {{ t('connection.connect') }}
            </n-button>
          </template>
        </UiEmpty>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NDataTable, NProgress, NTag, type DataTableColumns } from 'naive-ui'
import { AnalyticsOutline, LinkOutline, PeopleOutline } from '@vicons/ionicons5'
import { useTaskStore } from '@/stores/taskStore'
import { useConnectionStore } from '@/stores/connectionStore'
import PageHeader from '@/components/layout/PageHeader.vue'
import DismissibleAlert from '@/components/common/DismissibleAlert.vue'
import { UiEmpty, UiPanel, UiStat } from '@/components/ui'
import { isBtTask, useBtInsights } from '@/composables/useBtInsights'
import { withMinimumDuration } from '@/composables/useMinimumLoading'
import { getTaskDisplayName, formatSpeed } from '@/utils/taskFormatters'
import { getUserFriendlyError } from '@/utils/errorMessages'
import { countryCodeToFlag, getPeerClientName } from '@/utils/peerClient'
import type { Aria2Peer } from '@/types/aria2'

const { t } = useI18n()
const taskStore = useTaskStore()
const connectionStore = useConnectionStore()

// 断连时任务列表被清空，空态要说明是「未连接」而不是「没有 BT 任务」
const isDisconnected = computed(() => !connectionStore.isConnected)

const selectedGid = ref<string | null>(null)
const pageVisible = ref(true)
// keep-alive 缓存期间页面并未销毁，但已经切走：用这个标记暂停轮询，切回来再恢复
const pageActive = ref(true)
const enabled = computed(() => pageVisible.value && pageActive.value && connectionStore.isConnected)

const { snapshot, loading } = useBtInsights(selectedGid, enabled, () => connectionStore.service)

const btTaskOptions = computed(() => {
  const all = [...taskStore.activeTasks, ...taskStore.waitingTasks, ...taskStore.stoppedTasks]
  return all
    .filter(isBtTask)
    .map(task => ({
      label: `${getTaskDisplayName(task)} (${t('status.' + task.status)})`,
      value: task.gid
    }))
})

const hasBtTasks = computed(() => btTaskOptions.value.length > 0)

/** v2 空态 = 标题 + 一句解释 + 可选主操作 */
const emptyState = computed(() => {
  if (isDisconnected.value) {
    return { title: t('settings.notConnectedTitle'), description: t('btInsights.description') }
  }
  if (hasBtTasks.value) {
    return { title: t('btInsights.selectTask'), description: t('btInsights.description') }
  }
  return { title: t('btInsights.noBtTasks'), description: t('btInsights.description') }
})

function openConnectionDialog(): void {
  connectionStore.showConnectionDialog = true
}

// 提示条可关闭：按内容记忆，避免轮询时同一提示反复弹出
const dismissedPollError = ref<string | null>(null)
const showPollErrorAlert = computed(
  () => !!snapshot.value?.error && snapshot.value.error !== dismissedPollError.value
)
function dismissPollError(): void {
  dismissedPollError.value = snapshot.value?.error ?? null
}

interface SummaryItem {
  key: string
  label: string
  value: string
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger'
  title?: string
}

const summaryItems = computed<SummaryItem[]>(() => {
  const snap = snapshot.value
  if (!snap) return []
  const peers = snap.peers
  const seederCount = peers.filter(peer => peer.seeder === 'true').length
  const totalDown = peers.reduce((sum, peer) => sum + Number(peer.downloadSpeed || 0), 0)
  const totalUp = peers.reduce((sum, peer) => sum + Number(peer.uploadSpeed || 0), 0)
  const mode = snap.mode ?? t('btInsights.unknown')
  return [
    { key: 'peers', label: t('btInsights.peerCount'), value: String(peers.length) },
    { key: 'seeders', label: t('btInsights.seederCount'), value: String(seederCount) },
    // 与全站一致：下载=主色（accent），上传=成功色（success）
    { key: 'down', label: t('btInsights.totalDownload'), value: formatSpeed(String(totalDown)), tone: 'accent' },
    { key: 'up', label: t('btInsights.totalUpload'), value: formatSpeed(String(totalUp)), tone: 'success' },
    { key: 'mode', label: t('btInsights.mode'), value: mode, title: mode }
  ]
})

/** info hash 单独成行：40 位十六进制塞进 140px 的格子里只会剩下一串省略号 */
const infoHash = computed(() => snapshot.value?.infoHash ?? t('btInsights.unknown'))

// ── Peer 表 ──
// 地理位置查询：与原任务详情里的 peers 表同源（主进程 lookupPeerLocations），
// 差异是这里由页面自己持有状态，因为表格已按 v2 重写（进度条不再内嵌文字）
const locations = ref<Record<string, { country: string; countryCode: string }>>({})
const locating = ref(false)
const locationError = ref('')

async function lookupLocations() {
  if (locating.value) return
  const peers = snapshot.value?.peers ?? []
  const api = window.electronAPI?.lookupPeerLocations
  if (!api) {
    locationError.value = t('taskPeer.locationFailed')
    return
  }
  locating.value = true
  locationError.value = ''
  try {
    const ips = [...new Set(peers.map(peer => peer.ip).filter(Boolean))]
    const result = await withMinimumDuration(() => api(ips))
    locations.value = { ...locations.value, ...result }
    if (Object.keys(result).length === 0) locationError.value = t('taskPeer.locationFailed')
  } catch {
    locationError.value = t('taskPeer.locationFailed')
  } finally {
    locating.value = false
  }
}

function peerProgress(row: Aria2Peer): number {
  return Math.min(Math.round(parseFloat(row.bitfield || '0') * 100), 100)
}

function peerStatusType(amChoking: boolean, peerChoking: boolean): 'success' | 'warning' | 'error' {
  if (!amChoking && !peerChoking) return 'success'
  if (amChoking && peerChoking) return 'error'
  return 'warning'
}

function peerStatusText(amChoking: boolean, peerChoking: boolean): string {
  if (!amChoking && !peerChoking) return t('taskPeer.normal')
  if (amChoking && peerChoking) return t('taskPeer.bothChoked')
  if (amChoking) return t('taskPeer.amChoking')
  if (peerChoking) return t('taskPeer.peerChoking')
  return t('taskPeer.unknown')
}

const peerColumns = computed<DataTableColumns<Aria2Peer>>(() => [
  {
    key: 'index',
    title: t('taskDetail.index'),
    width: 48,
    align: 'right',
    titleAlign: 'right',
    render: (_row, index) => h('span', { class: 'ds-tnum cell-muted' }, String(index + 1))
  },
  {
    key: 'ip',
    title: t('taskPeer.ip'),
    width: 132,
    render: (row: Aria2Peer) => h('span', { class: 'ds-num' }, row.ip)
  },
  {
    key: 'port',
    title: t('taskPeer.port'),
    width: 64,
    align: 'right',
    titleAlign: 'right',
    render: (row: Aria2Peer) => h('span', { class: 'ds-tnum cell-muted' }, row.port)
  },
  {
    key: 'client',
    title: t('taskPeer.client'),
    width: 168,
    ellipsis: { tooltip: true },
    render: (row: Aria2Peer) => getPeerClientName(row.peerId) || t('taskPeer.unknown')
  },
  {
    key: 'location',
    title: t('taskPeer.location'),
    width: 136,
    ellipsis: { tooltip: true },
    render: (row: Aria2Peer) => {
      const location = locations.value[row.ip]
      if (!location) return t('taskPeer.unknown')
      return `${countryCodeToFlag(location.countryCode)} ${location.country}`.trim()
    }
  },
  {
    key: 'downloadSpeed',
    title: t('taskPeer.downloadSpeed'),
    width: 112,
    align: 'right',
    titleAlign: 'right',
    render: (row: Aria2Peer) => h(
      'span',
      { class: Number(row.downloadSpeed) > 0 ? 'ds-tnum cell-down' : 'ds-tnum cell-muted' },
      formatSpeed(row.downloadSpeed || '0')
    )
  },
  {
    key: 'uploadSpeed',
    title: t('taskPeer.uploadSpeed'),
    width: 112,
    align: 'right',
    titleAlign: 'right',
    render: (row: Aria2Peer) => h(
      'span',
      { class: Number(row.uploadSpeed) > 0 ? 'ds-tnum cell-up' : 'ds-tnum cell-muted' },
      formatSpeed(row.uploadSpeed || '0')
    )
  },
  {
    // 进度条：只画条，不再内嵌百分比文字（v1 的白字压在 6px 条上，100% 时右侧被裁）
    key: 'progress',
    // 表头留给右侧的百分比列，进度条列不再重复一次「进度」
    title: '',
    width: 96,
    render: (row: Aria2Peer) => h(NProgress, {
      type: 'line',
      percentage: peerProgress(row),
      height: 6,
      showIndicator: false,
      borderRadius: 3,
      style: 'width: 100%'
    })
  },
  {
    // 百分比独立成列，右对齐 + 等宽数字，多行数值竖直对齐
    key: 'progressText',
    title: t('taskPeer.progress'),
    width: 72,
    align: 'right',
    titleAlign: 'right',
    render: (row: Aria2Peer) => h('span', { class: 'ds-tnum' }, `${peerProgress(row).toFixed(1)}%`)
  },
  {
    key: 'status',
    title: t('taskPeer.status'),
    width: 100,
    align: 'center',
    titleAlign: 'center',
    render: (row: Aria2Peer) => {
      const amChoking = row.amChoking === 'true'
      const peerChoking = row.peerChoking === 'true'
      return h(
        NTag,
        { type: peerStatusType(amChoking, peerChoking), size: 'small', bordered: false },
        { default: () => peerStatusText(amChoking, peerChoking) }
      )
    }
  }
])

// 首个 BT 任务自动选中（进入页面即看数据，省一次点击）
watch(btTaskOptions, options => {
  if (selectedGid.value && options.some(option => option.value === selectedGid.value)) return
  selectedGid.value = options[0]?.value ?? null
}, { immediate: true })

// 窗口最小化/切走时暂停轮询（页面销毁时 onUnmounted 已在 composable 里清理）
function handleVisibility(): void {
  pageVisible.value = document.visibilityState === 'visible'
}
onMounted(() => {
  pageVisible.value = document.visibilityState === 'visible'
  document.addEventListener('visibilitychange', handleVisibility)
})
// keep-alive 下切走不会卸载组件，onBeforeUnmount 也不会跑：
// 用 activated/deactivated 暂停与恢复轮询，避免在后台页继续打 RPC
onActivated(() => {
  pageActive.value = true
})
onDeactivated(() => {
  pageActive.value = false
})
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', handleVisibility)
})
</script>

<style scoped>
.bt-insights-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--ds-space-16);
}

/* 内容在容器内滚动，页头固定不动（与改造前行为一致，只是去掉了外层 v1 大盒子） */
.bt-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ds-space-16);
  overflow: auto;
}

.bt-task-select {
  min-width: 280px;
  max-width: 360px;
}

.bt-poll-alert {
  margin: 0;
}

/* ── 指标带 ── */
.stat-band {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: var(--ds-space-16) var(--ds-space-20);
  padding: var(--ds-space-16) var(--ds-space-20);
  background: var(--ds-bg-surface);
  border: 1px solid var(--ds-border-subtle);
  border-radius: var(--ds-radius-lg);
}

.stat-band__cell {
  min-width: 0;
}

/* info hash 占满整行，等宽字体 + 省略号，title 里给全量 */
.stat-band__hash {
  grid-column: 1 / -1;
  display: flex;
  align-items: baseline;
  gap: var(--ds-space-8);
  min-width: 0;
  padding-top: var(--ds-space-12);
  border-top: 1px solid var(--ds-border-subtle);
}

.stat-band__hash-label {
  flex: none;
  font-size: var(--ds-text-micro-size);
  line-height: var(--ds-text-micro-leading);
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ds-text-muted);
}

.stat-band__hash-value {
  min-width: 0;
  font-family: var(--ds-font-mono);
  font-size: var(--ds-text-small-size);
  line-height: var(--ds-text-small-leading);
  color: var(--ds-text-base);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stat-band__cell :deep(.ui-stat__value) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Peers ── */
.bt-peer-alert {
  margin: 0 var(--ds-space-20) var(--ds-space-12);
}

:deep(.cell-muted) {
  color: var(--ds-text-muted);
}

/* 与全站一致：下载=主色，上传=成功色 */
:deep(.cell-down) {
  color: var(--ds-accent-text);
  font-weight: 500;
}

:deep(.cell-up) {
  color: var(--ds-status-success-text);
  font-weight: 500;
}

/* ── 表格在 flush 面板内：首列左、末列右补齐到 20px，与面板标题同一条竖线 ── */
.bt-peers-table :deep(.n-data-table-th:first-child),
.bt-peers-table :deep(.n-data-table-td:first-child),
.bt-tracker-table :deep(th:first-child),
.bt-tracker-table :deep(td:first-child) {
  padding-left: var(--ds-space-20);
}

.bt-peers-table :deep(.n-data-table-th:last-child),
.bt-peers-table :deep(.n-data-table-td:last-child),
.bt-tracker-table :deep(th:last-child),
.bt-tracker-table :deep(td:last-child) {
  padding-right: var(--ds-space-20);
}

/* ── Trackers ── */
.col-tier {
  width: 72px;
  text-align: right;
}

.tracker-url {
  font-family: var(--ds-font-mono);
  font-size: var(--ds-text-small-size);
  word-break: break-all;
}

/* ── 加载 / 空态 ── */
.bt-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 240px;
}

.bt-empty {
  flex: 1;
  min-height: 320px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--ds-bg-surface);
  border: 1px solid var(--ds-border-subtle);
  border-radius: var(--ds-radius-lg);
}
</style>
