<template>
  <div class="bt-insights-view">
    <PageHeader :title="t('btInsights.title')" :description="t('btInsights.description')">
      <template #actions>
        <n-select
          v-model:value="selectedGid"
          :options="btTaskOptions"
          :placeholder="t('btInsights.selectTask')"
          :loading="loading"
          filterable
          size="small"
          class="task-select"
          :style="{ minWidth: '280px' }"
        />
      </template>
    </PageHeader>

    <!-- 内容统一放进与下载任务页同款的列表容器：滚动只发生在容器内，页头保持不动 -->
    <section class="bt-surface">
      <template v-if="selectedGid && snapshot">
        <n-alert v-if="showPollErrorAlert" type="warning" :bordered="false" closable class="empty-alert" @close="dismissPollError">
          {{ t('btInsights.pollError', { error: snapshot.error }) }}
        </n-alert>

        <!-- 汇总：peers/seeder/速度/mode/infoHash -->
        <n-card :bordered="false" class="summary-card">
          <div class="summary-grid">
            <div v-for="item in summaryItems" :key="item.label" class="summary-item">
              <span class="summary-value" :class="item.valueClass">{{ item.value }}</span>
              <span class="summary-label">{{ item.label }}</span>
            </div>
          </div>
        </n-card>

        <!-- Peers：与 Trackers 一致的分区容器，内部复用任务详情的 peers 表（含地理位置查询） -->
        <n-card :bordered="false" class="section-card">
          <template #header>
            <div class="section-head">
              <span class="section-title">{{ t('btInsights.peers') }}</span>
              <span class="header-count">({{ snapshot.peers.length }})</span>
            </div>
          </template>
          <TaskPeerInfo :peers="snapshot.peers" flat />
        </n-card>

        <!-- Trackers：announceList tier 展平 -->
        <n-card :bordered="false" class="section-card">
          <template #header>
            <div class="section-head">
              <span class="section-title">{{ t('btInsights.trackers') }}</span>
              <span class="header-count">({{ snapshot.announceList.length }})</span>
            </div>
          </template>
          <n-table v-if="snapshot.announceList.length" :bordered="false" size="small">
            <thead>
              <tr>
                <th class="col-tier">{{ t('btInsights.tier') }}</th>
                <th>{{ t('btInsights.trackerUrl') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in snapshot.announceList" :key="row.url">
                <td class="col-tier">{{ row.tier }}</td>
                <td class="tracker-url" :title="row.url">
                  <span class="tier-marker">T{{ row.tier }}</span>
                  {{ row.url }}
                </td>
              </tr>
            </tbody>
          </n-table>
          <n-empty v-else :description="t('btInsights.noTrackers')" size="small" />
        </n-card>
      </template>

      <n-card v-else-if="selectedGid && !snapshot" :bordered="false" class="section-card">
        <n-spin :description="t('btInsights.loading')" />
      </n-card>

      <!-- 无 BT 任务（或未选中任务）时的稳定空态：与列表页一致，图标在容器内垂直居中 -->
      <div v-else class="bt-empty">
        <n-empty :description="emptyDescription">
          <template #extra>
            <n-button v-if="isDisconnected" size="small" type="primary" @click="openConnectionDialog">
              {{ t('connection.connect') }}
            </n-button>
          </template>
        </n-empty>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTaskStore } from '@/stores/taskStore'
import { useConnectionStore } from '@/stores/connectionStore'
import PageHeader from '@/components/layout/PageHeader.vue'
import TaskPeerInfo from '@/components/task/TaskPeerInfo.vue'
import { isBtTask, useBtInsights } from '@/composables/useBtInsights'
import { getTaskDisplayName, formatSpeed } from '@/utils/taskFormatters'

const { t } = useI18n()
const taskStore = useTaskStore()
const connectionStore = useConnectionStore()

// 断连时任务列表被清空，空态要说明是「未连接」而不是「没有 BT 任务」
const isDisconnected = computed(() => !connectionStore.isConnected)
const emptyDescription = computed(() => {
  if (isDisconnected.value) return t('settings.notConnectedTitle')
  return hasBtTasks.value ? t('btInsights.selectTask') : t('btInsights.noBtTasks')
})
function openConnectionDialog(): void {
  connectionStore.showConnectionDialog = true
}

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

// 提示条可关闭：按内容记忆，避免轮询时同一提示反复弹出
const dismissedPollError = ref<string | null>(null)
const showPollErrorAlert = computed(
  () => !!snapshot.value?.error && snapshot.value.error !== dismissedPollError.value
)
function dismissPollError(): void {
  dismissedPollError.value = snapshot.value?.error ?? null
}

const summaryItems = computed(() => {
  const snap = snapshot.value
  if (!snap) return []
  const peers = snap.peers
  const seederCount = peers.filter(peer => peer.seeder === 'true').length
  const totalDown = peers.reduce((sum, peer) => sum + Number(peer.downloadSpeed || 0), 0)
  const totalUp = peers.reduce((sum, peer) => sum + Number(peer.uploadSpeed || 0), 0)
  return [
    { label: t('btInsights.peerCount'), value: String(peers.length) },
    { label: t('btInsights.seederCount'), value: String(seederCount) },
    { label: t('btInsights.totalDownload'), value: formatSpeed(String(totalDown)), valueClass: 'value-success' },
    { label: t('btInsights.totalUpload'), value: formatSpeed(String(totalUp)), valueClass: 'value-info' },
    { label: t('btInsights.mode'), value: snap.mode ?? t('btInsights.unknown') },
    { label: t('btInsights.infoHash'), value: snap.infoHash ?? t('btInsights.unknown') }
  ]
})

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
  gap: 16px;
}

/* 与下载任务页同款的列表容器：内容在容器内滚动，页头固定不动 */
.bt-surface {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow: auto;
  padding: 16px;
  background: var(--bg-primary);
  border: 1px solid var(--border-light);
  border-radius: 10px;
  box-shadow: var(--shadow-light);
}

.task-select {
  max-width: 360px;
}

.empty-alert {
  margin-bottom: 0;
}

/* 空态：撑满剩余高度并垂直居中，避免图标贴顶 */
.bt-empty {
  flex: 1;
  min-height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.summary-card :deep(.summary-grid) {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 16px;
}

.summary-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.summary-value {
  font-size: 18px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.summary-value.value-success { color: var(--color-success); }
.summary-value.value-info { color: var(--color-info); }

.summary-label {
  font-size: 12px;
  color: var(--text-secondary);
}

.section-card {
  margin-top: 0;
}

.section-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.section-title {
  font-size: 15px;
  font-weight: 600;
}

.header-count {
  color: var(--text-secondary);
  font-weight: 400;
  font-size: 13px;
}

.col-tier {
  width: 64px;
}

.tracker-url {
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  word-break: break-all;
}

.tier-marker {
  display: inline-block;
  margin-right: 8px;
  font-size: 11px;
  color: var(--text-secondary);
}
</style>
