<template>
  <div class="app-footer">
    <div class="footer-left">
      <div class="global-stats">
        <span class="stat-item">
          <el-icon><Download /></el-icon>
          {{ formatSpeed(globalStat.downloadSpeed) }}/s
        </span>
        <span class="stat-item">
          <el-icon><Upload /></el-icon>
          {{ formatSpeed(globalStat.uploadSpeed) }}/s
        </span>
        <span class="stat-item">
          活动: {{ globalStat.numActive }}
        </span>
        <span class="stat-item">
          等待: {{ globalStat.numWaiting }}
        </span>
        <span class="stat-item">
          已停止: {{ globalStat.numStopped }}
        </span>
      </div>
    </div>
    
    <div class="footer-right">
      <div class="connection-status">
        <el-icon 
          :class="connectionStatusClass"
        >
          <component :is="connectionIcon" />
        </el-icon>
        <span>{{ connectionStatusText }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useStatsStore } from '@/stores/statsStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { 
  Download, 
  Upload, 
  Connection,
  WarningFilled,
  CircleCheckFilled
} from '@element-plus/icons-vue'

const statsStore = useStatsStore()
const connectionStore = useConnectionStore()

const globalStat = computed(() => statsStore.globalStat)
const isConnected = computed(() => connectionStore.isConnected)
const isConnecting = computed(() => connectionStore.isConnecting)

const connectionStatusText = computed(() => {
  if (isConnecting.value) return '连接中...'
  return isConnected.value ? '已连接' : '未连接'
})

const connectionStatusClass = computed(() => {
  if (isConnecting.value) return 'status-connecting'
  return isConnected.value ? 'status-connected' : 'status-disconnected'
})

const connectionIcon = computed(() => {
  if (isConnecting.value) return Connection
  return isConnected.value ? CircleCheckFilled : WarningFilled
})

function formatSpeed(speed: string): string {
  const bytes = parseInt(speed)
  if (bytes === 0) return '0 B'
  
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}
</script>

<style scoped>
.app-footer {
  height: 40px;
  background: var(--bg-secondary);
  border-top: 1px solid var(--border-light);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  font-size: 12px;
  color: var(--text-primary);
  transition: background-color 0.3s ease, border-color 0.3s ease, color 0.3s ease;
}

.footer-left {
  flex: 1;
}

.global-stats {
  display: flex;
  gap: 16px;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--text-regular);
}

.footer-right {
  flex: 0 0 auto;
}

.connection-status {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--text-regular);
}

.status-connected {
  color: var(--color-success);
}

.status-connecting {
  color: var(--color-warning);
}

.status-disconnected {
  color: var(--color-danger);
}
</style>
