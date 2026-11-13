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

    <n-alert v-if="!hasBtTasks" type="info" :bordered="false" class="empty-alert">
      {{ t('btInsights.noBtTasks') }}
    </n-alert>

    <template v-else-if="selectedGid && snapshot">
      <n-alert v-if="snapshot.error" type="warning" :bordered="false" class="empty-alert">
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

      <!-- Peers：复用任务详情的 peers 表（含地理位置查询） -->
      <TaskPeerInfo :peers="snapshot.peers" class="section-card" />

      <!-- Trackers：announceList tier 展平 -->
      <n-card :bordered="false" class="section-card">
        <template #header>
          {{ t('btInsights.trackers') }}
          <span class="header-count">({{ snapshot.announceList.length }})</span>
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
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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

const selectedGid = ref<string | null>(null)
const pageVisible = ref(true)
const enabled = computed(() => pageVisible.value && connectionStore.isConnected)

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
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', handleVisibility)
})
</script>

<style scoped>
.bt-insights-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.task-select {
  max-width: 360px;
}

.empty-alert {
  margin-bottom: 0;
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
