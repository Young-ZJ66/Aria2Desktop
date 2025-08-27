<template>
  <div class="status-page">
    <div class="status-header">
      <h2>Aria2 状态</h2>
    </div>
    
    <div class="status-content">
      <el-row :gutter="20">
        <el-col :span="12">
          <el-card title="连接状态">
            <div class="status-item">
              <span class="label">连接状态:</span>
              <el-tag :type="isConnected ? 'success' : 'danger'">
                {{ isConnected ? '已连接' : '未连接' }}
              </el-tag>
            </div>
            <div class="status-item">
              <span class="label">服务器地址:</span>
              <span>{{ config.protocol }}://{{ config.host }}:{{ config.port }}</span>
            </div>
            <div class="status-item" v-if="version">
              <span class="label">Aria2 版本:</span>
              <span>{{ version.version }}</span>
            </div>
          </el-card>
        </el-col>
        
        <el-col :span="12">
          <el-card title="全局统计">
            <div class="status-item">
              <span class="label">下载速度:</span>
              <span>{{ formatSpeed(globalStat.downloadSpeed) }}/s</span>
            </div>
            <div class="status-item">
              <span class="label">上传速度:</span>
              <span>{{ formatSpeed(globalStat.uploadSpeed) }}/s</span>
            </div>
            <div class="status-item">
              <span class="label">活动任务:</span>
              <span>{{ globalStat.numActive }}</span>
            </div>
            <div class="status-item">
              <span class="label">等待任务:</span>
              <span>{{ globalStat.numWaiting }}</span>
            </div>
            <div class="status-item">
              <span class="label">已停止任务:</span>
              <span>{{ globalStat.numStopped }}</span>
            </div>
          </el-card>
        </el-col>
      </el-row>
      
      <!-- 任务统计图表 -->
      <div style="margin-top: 20px;">
        <TaskStats :stats="allTaskStats" :tasks="allTasks" />
      </div>

      <el-row :gutter="20" style="margin-top: 20px;" v-if="version">
        <el-col :span="24">
          <el-card title="支持的功能">
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
import { useAria2Store } from '@/stores/aria2Store'
import TaskStats from '@/components/TaskStats.vue'
import { getTaskStats } from '@/utils/taskUtils'

const aria2Store = useAria2Store()

const isConnected = computed(() => aria2Store.isConnected)
const config = computed(() => aria2Store.config)
const globalStat = computed(() => aria2Store.globalStat)
const version = computed(() => aria2Store.version)

// 计算所有任务
const allTasks = computed(() => [
  ...aria2Store.activeTasks,
  ...aria2Store.waitingTasks,
  ...aria2Store.stoppedTasks
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
  color: #606266;
}
</style>
