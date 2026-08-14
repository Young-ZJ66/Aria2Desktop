<template>
  <el-card class="info-card">
    <el-table v-if="peers.length" :data="peers" style="width: 100%">
      <el-table-column type="index" label="序号" width="60" />
      <el-table-column label="IP 地址" width="150">
        <template #default="{ row }">
          {{ row.ip }}
        </template>
      </el-table-column>
      <el-table-column label="端口" width="80">
        <template #default="{ row }">
          {{ row.port }}
        </template>
      </el-table-column>
      <el-table-column label="客户端" width="200">
        <template #default="{ row }">
          {{ row.peerId || '未知' }}
        </template>
      </el-table-column>
      <el-table-column label="下载速度" width="120">
        <template #default="{ row }">
          {{ formatSpeed(row.downloadSpeed || '0') }}
        </template>
      </el-table-column>
      <el-table-column label="上传速度" width="120">
        <template #default="{ row }">
          {{ formatSpeed(row.uploadSpeed || '0') }}
        </template>
      </el-table-column>
      <el-table-column label="进度" width="100">
        <template #default="{ row }">
          {{ (parseFloat(row.bitfield || '0') * 100).toFixed(1) }}%
        </template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="getPeerStatusType(row.amChoking, row.peerChoking)" size="small">
            {{ getPeerStatusText(row.amChoking, row.peerChoking) }}
          </el-tag>
        </template>
      </el-table-column>
    </el-table>

    <el-empty v-else :description="t('common.none')" />
  </el-card>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { formatSpeed } from '@/utils/taskFormatters'

interface Props {
  peers: unknown[]
}

const { t } = useI18n()
defineProps<Props>()

function getPeerStatusType(amChoking: boolean, peerChoking: boolean): string {
  if (!amChoking && !peerChoking) return 'success'
  if (amChoking && peerChoking) return 'danger'
  return 'warning'
}

function getPeerStatusText(amChoking: boolean, peerChoking: boolean): string {
  if (!amChoking && !peerChoking) return '正常'
  if (amChoking && peerChoking) return '阻塞'
  if (amChoking) return '我方阻塞'
  if (peerChoking) return '对方阻塞'
  return '未知'
}
</script>

<style scoped>
.info-card {
  margin-bottom: 20px;
}
</style>
