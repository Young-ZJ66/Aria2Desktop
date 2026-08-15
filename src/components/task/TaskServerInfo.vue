<template>
  <n-card class="info-card" size="small">
    <n-data-table
      v-if="servers.length"
      :columns="columns"
      :data="servers"
      :bordered="false"
    >
      <template #empty>
        <n-empty :description="t('common.none')" size="small" />
      </template>
    </n-data-table>

    <n-empty v-else :description="t('common.none')" />
  </n-card>
</template>

<script setup lang="ts">
import { h, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { NTag, NText, type DataTableColumns } from 'naive-ui'
import type { Aria2Server } from '@/types/aria2'
import { formatSpeed } from '@/utils/taskFormatters'

interface Props {
  servers: Aria2Server[]
}

defineProps<Props>()
const { t } = useI18n()

function getStatusType(status: string): string {
  switch (status) {
    case 'used': return 'success'
    case 'waiting': return 'warning'
    default: return 'info'
  }
}

function getStatusText(status: string): string {
  switch (status) {
    case 'used': return t('status.used')
    case 'waiting': return t('status.waiting')
    default: return status || t('common.unknown')
  }
}

const columns = computed<DataTableColumns<Aria2Server>>(() => [
  {
    title: t('taskDetail.index'),
    key: 'index',
    width: 60,
    render: (_row: Aria2Server, index: number) => index + 1
  },
  {
    title: t('taskDetail.server'),
    key: 'servers',
    minWidth: 300,
    render: (row: Aria2Server) => {
      return h('div', row.servers.map((server, idx) => {
        const status = (server as { status?: string }).status
        return h('div', { class: 'server-item', key: idx }, [
          h(NText, { code: true }, { default: () => server.uri }),
          h(NTag, {
            type: (getStatusType(status || '') as 'success' | 'warning' | 'info' | 'default') || 'default',
            size: 'small',
            style: 'margin-left: 8px'
          }, { default: () => getStatusText(status || '') })
        ])
      }))
    }
  },
  {
    title: t('task.downloadSpeed'),
    key: 'downloadSpeed',
    width: 120,
    render: (row: Aria2Server) => {
      return h('div', row.servers.map((server, idx) =>
        h('div', { class: 'server-item', key: idx }, formatSpeed(server.downloadSpeed || '0'))
      ))
    }
  }
])
</script>

<style scoped>
.info-card {
  margin-bottom: 20px;
}

.server-item {
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.server-item:last-child {
  margin-bottom: 0;
}
</style>
