<template>
  <n-card class="info-card" size="small" :bordered="false">
    <n-data-table
      v-if="peers.length"
      :columns="columns"
      :data="peers"
      :bordered="false"
      :size="'small'"
      :single-line="false"
      :scroll-x="1000"
    />

    <n-empty v-else :description="t('common.none')" size="small" />
  </n-card>
</template>

<script setup lang="ts">
import { computed, h } from 'vue'
import { useI18n } from 'vue-i18n'
import { NTag, NProgress, type DataTableColumns } from 'naive-ui'
import type { Aria2Peer } from '@/types/aria2'
import { formatSpeed } from '@/utils/taskFormatters'

interface Props {
  peers: Aria2Peer[]
}

defineProps<Props>()
const { t } = useI18n()

const columns = computed<DataTableColumns<Aria2Peer>>(() => [
  {
    key: 'index',
    title: t('taskDetail.index'),
    width: 60,
    render: (_row, index) => index + 1
  },
  {
    key: 'ip',
    title: t('taskPeer.ip'),
    width: 150
  },
  {
    key: 'port',
    title: t('taskPeer.port'),
    width: 80
  },
  {
    key: 'client',
    title: t('taskPeer.client'),
    width: 200,
    ellipsis: { tooltip: true },
    render: (row: Aria2Peer) => row.peerId || t('taskPeer.unknown')
  },
  {
    key: 'downloadSpeed',
    title: t('taskPeer.downloadSpeed'),
    width: 120,
    align: 'right',
    render: (row: Aria2Peer) => {
      const speed = formatSpeed(row.downloadSpeed || '0')
      return Number(row.downloadSpeed) > 0
        ? h('span', { style: 'color: var(--color-success); font-weight: 500; font-variant-numeric: tabular-nums;' }, speed)
        : speed
    }
  },
  {
    key: 'uploadSpeed',
    title: t('taskPeer.uploadSpeed'),
    width: 120,
    align: 'right',
    render: (row: Aria2Peer) => {
      const speed = formatSpeed(row.uploadSpeed || '0')
      return Number(row.uploadSpeed) > 0
        ? h('span', { style: 'color: var(--color-info); font-weight: 500; font-variant-numeric: tabular-nums;' }, speed)
        : speed
    }
  },
  {
    key: 'progress',
    title: t('taskPeer.progress'),
    width: 140,
    render: (row: Aria2Peer) => {
      const percentage = Math.min(Math.round(parseFloat(row.bitfield || '0') * 100), 100)
      return h(NProgress, {
        type: 'line',
        percentage,
        height: 6,
        indicator: true,
        indicatorPlacement: 'inside',
        borderRadius: 3,
        style: 'width: 100%'
      })
    }
  },
  {
    key: 'status',
    title: t('taskPeer.status'),
    width: 100,
    align: 'center',
    render: (row: Aria2Peer) =>
      h(NTag, {
        type: getPeerStatusType(row.amChoking === 'true', row.peerChoking === 'true'),
        size: 'small',
        bordered: false
      }, { default: () => getPeerStatusText(row.amChoking === 'true', row.peerChoking === 'true') })
  }
])

function getPeerStatusType(amChoking: boolean, peerChoking: boolean): 'success' | 'warning' | 'error' {
  if (!amChoking && !peerChoking) return 'success'
  if (amChoking && peerChoking) return 'error'
  return 'warning'
}

function getPeerStatusText(amChoking: boolean, peerChoking: boolean): string {
  if (!amChoking && !peerChoking) return t('taskPeer.normal')
  if (amChoking && peerChoking) return t('taskPeer.bothChoked')
  if (amChoking) return t('taskPeer.amChoking')
  if (peerChoking) return t('taskPeer.peerChoking')
  return t('taskPeer.unknown')
}
</script>

<style scoped>
.info-card {
  background: var(--bg-primary);
  border: 1px solid var(--border-light);
  border-radius: 10px;
}

.info-card :deep(.n-data-table) {
  font-size: 13px;
}

.info-card :deep(.n-data-table-th) {
  font-weight: 600;
}
</style>
