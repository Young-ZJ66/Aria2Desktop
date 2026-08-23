<template>
  <n-card class="info-card" size="small" :bordered="false">
    <n-data-table
      v-if="rows.length"
      :columns="columns"
      :data="rows"
      :bordered="false"
      :size="'small'"
      :single-line="false"
      :row-key="(row: ServerRow) => row.key"
    >
      <template #empty>
        <n-empty :description="t('common.none')" size="small" />
      </template>
    </n-data-table>

    <n-empty v-else :description="t('common.none')" size="small" />
  </n-card>
</template>

<script setup lang="ts">
import { h, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { NTag, NText, NButton, NIcon, type DataTableColumns } from 'naive-ui'
import { CopyOutline } from '@vicons/ionicons5'
import { message } from '@/utils/feedback'
import type { Aria2Server } from '@/types/aria2'
import { formatSpeed } from '@/utils/taskFormatters'

interface Props {
  servers: Aria2Server[]
}

const props = defineProps<Props>()
const { t } = useI18n()

interface ServerRow {
  key: string
  fileIndex: string
  uri: string
  downloadSpeed: string
  status: string
}

// 将每个文件下的服务器平铺为独立行，避免多个服务器挤在一个格子内
const rows = computed<ServerRow[]>(() => {
  const result: ServerRow[] = []
  props.servers.forEach((entry) => {
    entry.servers?.forEach((server, idx) => {
      result.push({
        key: `${entry.index}-${idx}`,
        fileIndex: entry.index,
        uri: server.uri,
        downloadSpeed: server.downloadSpeed || '0',
        status: server.status || ''
      })
    })
  })
  return result
})

/** 服务器状态标签类型（与 NTag type prop 对齐） */
function getStatusType(status: string): 'success' | 'warning' | 'info' {
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

function copyUri(uri: string) {
  navigator.clipboard.writeText(uri)
  message.success(t('common.copied'))
}

const columns = computed<DataTableColumns<ServerRow>>(() => [
  {
    title: t('taskDetail.index'),
    key: 'index',
    width: 60,
    render: (_row: ServerRow, index: number) => index + 1
  },
  {
    title: t('taskDetail.server'),
    key: 'uri',
    minWidth: 320,
    render: (row: ServerRow) => {
      return h('div', { class: 'server-item' }, [
        h(NText, { code: true, depth: 2, class: 'server-uri' }, { default: () => row.uri }),
        h(NButton, {
          size: 'tiny',
          quaternary: true,
          circle: true,
          style: 'flex-shrink: 0',
          'aria-label': t('taskDetail.copyLink'),
          onClick: () => copyUri(row.uri)
        }, {
          icon: () => h(NIcon, null, { default: () => h(CopyOutline) })
        })
      ])
    }
  },
  {
    title: t('task.downloadSpeed'),
    key: 'downloadSpeed',
    width: 130,
    align: 'right',
    render: (row: ServerRow) => formatSpeed(row.downloadSpeed)
  },
  {
    title: t('taskDetail.uriStatus'),
    key: 'status',
    width: 100,
    align: 'center',
    render: (row: ServerRow) =>
      h(NTag, {
        type: getStatusType(row.status),
        size: 'small',
        bordered: false
      }, { default: () => getStatusText(row.status) })
  }
])
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

.server-item {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 2px 0;
}

.server-uri {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
