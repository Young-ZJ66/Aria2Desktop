<template>
  <div class="status-page">
    <div class="status-header">
      <h2>{{ t('statusPage.title') }}</h2>
    </div>

    <div class="status-content">
      <el-row :gutter="20">
        <el-col :span="12">
          <el-card :title="t('statusPage.connectionStatus')">
            <div class="status-item">
              <span class="label">{{ t('statusPage.connectionLabel') }}</span>
              <el-tag :type="isConnected ? 'success' : 'danger'">
                {{ isConnected ? t('header.connected') : t('header.disconnected') }}
              </el-tag>
            </div>
            <div class="status-item">
              <span class="label">{{ t('statusPage.serverAddress') }}</span>
              <span>{{ config.protocol }}://{{ config.host }}:{{ config.port }}</span>
            </div>
            <div v-if="version" class="status-item">
              <span class="label">{{ t('statusPage.aria2Version') }}</span>
              <span>{{ version.version }}</span>
            </div>
          </el-card>
        </el-col>

        <el-col :span="12">
          <el-card :title="t('statusPage.globalStats')">
            <div class="status-item">
              <span class="label">{{ t('statusPage.downloadSpeed') }}</span>
              <span>{{ formatSpeed(globalStat.downloadSpeed) }}/s</span>
            </div>
            <div class="status-item">
              <span class="label">{{ t('statusPage.uploadSpeed') }}</span>
              <span>{{ formatSpeed(globalStat.uploadSpeed) }}/s</span>
            </div>
            <div class="status-item">
              <span class="label">{{ t('statusPage.activeTasks') }}</span>
              <span>{{ globalStat.numActive }}</span>
            </div>
            <div class="status-item">
              <span class="label">{{ t('statusPage.waitingTasks') }}</span>
              <span>{{ globalStat.numWaiting }}</span>
            </div>
            <div class="status-item">
              <span class="label">{{ t('statusPage.stoppedTasks') }}</span>
              <span>{{ globalStat.numStopped }}</span>
            </div>
          </el-card>
        </el-col>
      </el-row>

      <!-- 任务统计图表 -->
      <div style="margin-top: 20px;">
        <TaskStats :stats="allTaskStats" :tasks="allTasks" />
      </div>

      <el-row v-if="version" :gutter="20" style="margin-top: 20px;">
        <el-col :span="24">
          <el-card :title="t('statusPage.enabledFeatures')">
            <el-tag
              v-for="feature in version.enabledFeatures"
              :key="feature"
              style="margin: 4px;"
            >
              {{ feature }}
            </el-tag>
          </el-card>
        </el-col>
      </el-row>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useConnectionStore } from '@/stores/connectionStore'
import { useTaskStore } from '@/stores/taskStore'
import { useStatsStore } from '@/stores/statsStore'
import TaskStats from '@/components/TaskStats.vue'
import { getTaskStats } from '@/utils/taskUtils'

const connectionStore = useConnectionStore()
const taskStore = useTaskStore()
const statsStore = useStatsStore()
const { t } = useI18n()

const isConnected = computed(() => connectionStore.isConnected)
const config = computed(() => connectionStore.config)
const globalStat = computed(() => statsStore.globalStat)
const version = computed(() => statsStore.version)

// 计算所有任务
const allTasks = computed(() => [
  ...taskStore.activeTasks,
  ...taskStore.waitingTasks,
  ...taskStore.stoppedTasks
])

// 计算所有任务统计
const allTaskStats = computed(() => {
  return getTaskStats(allTasks.value)
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
.status-page {
  padding: 20px;
}

.status-header {
  margin-bottom: 24px;
}

.status-header h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary);
}

.status-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.status-item:last-child {
  margin-bottom: 0;
}

.label {
  font-weight: 500;
  color: var(--text-secondary);
}
</style>
