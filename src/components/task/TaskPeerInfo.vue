<template>
  <n-card class="info-card" size="small">
    <n-data-table
      v-if="peers.length"
      :columns="columns"
      :data="peers"
      :bordered="false"
      :scroll-x="1000"
    />

    <n-empty v-else :description="t('common.none')" />
  </n-card>
</template>

<script setup lang="ts">
import { computed, h } from 'vue'
import { useI18n } from 'vue-i18n'
import { NTag, type DataTableColumns } from 'naive-ui'
import type { Aria2Peer } from '@/types/aria2'
import { formatSpeed } from '@/utils/taskFormatters'

interface Props {
  peers: unknown[]
}

defineProps<Props>()
const { t } = useI18n()

const columns = computed<DataTableColumns<any>>(() => [
  {
    key: 'index',
    title: t('taskDetail.index'),
    width: 60,
    render: (_row, index) => index + 1
  },
  {
    key: 'ip',
    title: t('taskPeer.ip'),
    width: 150,
    render: (row: Aria2Peer) => row.ip
  },
  {
    key: 'port',
    title: t('taskPeer.port'),
    width: 80,
    render: (row: Aria2Peer) => row.port
  },
  {
    key: 'client',
    title: t('taskPeer.client'),
    width: 200,
    render: (row: Aria2Peer) => row.peerId || t('taskPeer.unknown')
  },
  {
    key: 'downloadSpeed',
    title: t('taskPeer.downloadSpeed'),
    width: 120,
    render: (row: Aria2Peer) => formatSpeed(row.downloadSpeed || '0')
  },
  {
    key: 'uploadSpeed',
    title: t('taskPeer.uploadSpeed'),
    width: 120,
    render: (row: Aria2Peer) => formatSpeed(row.uploadSpeed || '0')
  },
  {
    key: 'progress',
    title: t('taskPeer.progress'),
    width: 100,
    render: (row: Aria2Peer) => `${(parseFloat(row.bitfield || '0') * 100).toFixed(1)}%`
  },
  {
    key: 'status',
    title: t('taskPeer.status'),
    width: 100,
    render: (row: Aria2Peer) =>
      h(NTag, {
        type: getPeerStatusType(row.amChoking === 'true', row.peerChoking === 'true'),
        size: 'small'
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
  margin-bottom: 20px;
}
</style>
