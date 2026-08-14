<template>
  <el-card class="info-card">
    <el-table v-if="servers.length" :data="servers" style="width: 100%">
      <el-table-column type="index" label="序号" width="60" />
      <el-table-column label="服务器" min-width="300">
        <template #default="{ row }">
          <div v-for="(server, index) in row.servers" :key="index" class="server-item">
            <el-text copyable>{{ server.uri }}</el-text>
            <el-tag :type="getStatusType(server.status)" size="small" style="margin-left: 8px">
              {{ getStatusText(server.status) }}
            </el-tag>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="下载速度" width="120">
        <template #default="{ row }">
          <div v-for="(server, index) in row.servers" :key="index" class="server-item">
            {{ formatSpeed(server.downloadSpeed || '0') }}
          </div>
        </template>
      </el-table-column>
    </el-table>

    <el-empty v-else :description="t('common.none')" />
  </el-card>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { Aria2Server } from '@/types/aria2'
import { formatSpeed } from '@/utils/taskFormatters'

interface Props {
  servers: Aria2Server[]
}

const { t } = useI18n()
defineProps<Props>()

function getStatusType(status: string): string {
  switch (status) {
    case 'used': return 'success'
    case 'waiting': return 'warning'
    default: return 'info'
  }
}

function getStatusText(status: string): string {
  switch (status) {
    case 'used': return '使用中'
    case 'waiting': return '等待中'
    default: return status || '未知'
  }
}
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
