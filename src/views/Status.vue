<template>
  <div class="status-page">
    <div class="status-header">
      <h2>{{ t('statusPage.title') }}</h2>
      <p class="status-subtitle">{{ t('statusPage.subtitle') }}</p>
    </div>

    <!-- 服务信息 -->
    <n-card class="info-card" :bordered="false">
      <n-grid :cols="1" :x-gap="24" :y-gap="8" item-responsive>
        <n-grid-item v-for="info in serverInfos" :key="info.label">
          <div class="info-item">
            <span class="info-label">{{ info.label }}</span>
            <div class="info-value">
              <n-tag v-if="info.type === 'status'" :type="info.tagType" size="small">
                {{ info.value }}
              </n-tag>
              <span v-else>{{ info.value }}</span>
            </div>
          </div>
        </n-grid-item>
      </n-grid>
    </n-card>

    <!-- 流量统计卡片 -->
    <n-card class="traffic-card" :bordered="false" :title="t('statusPage.trafficStats')">
      <!-- 实时流量图（位于所有小卡片上方） -->
      <div class="traffic-chart-section">
        <div ref="trafficChartRef" class="traffic-chart" />
      </div>

      <div class="traffic-grid">
        <div class="traffic-stat" v-for="stat in trafficStats" :key="stat.label">
          <div class="traffic-stat-icon" :class="stat.colorClass">
            <n-icon :size="20"><component :is="stat.icon" /></n-icon>
          </div>
          <div class="traffic-stat-meta">
            <div class="traffic-stat-value">{{ stat.value }}</div>
            <div class="traffic-stat-label">{{ stat.label }}</div>
          </div>
        </div>
      </div>
    </n-card>

    <!-- 支持的功能 -->
    <n-card v-if="version" class="features-card" :bordered="false" :title="t('statusPage.enabledFeatures')">
      <n-space wrap :size="4">
        <n-tag
          v-for="feature in version.enabledFeatures"
          :key="feature"
          size="small"
        >
          {{ feature }}
        </n-tag>
      </n-space>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useConnectionStore } from '@/stores/connectionStore'
import { useTaskStore } from '@/stores/taskStore'
import { useStatsStore } from '@/stores/statsStore'
import { formatSpeed, formatSize } from '@/utils/taskFormatters'
import { getTaskStats } from '@/utils/taskUtils'
import { useTrafficMonitor } from '@/composables/useTrafficMonitor'
import {
  DownloadOutline,
  CloudUploadOutline,
  CheckmarkDoneOutline,
  LayersOutline,
  SaveOutline,
  TrendingUpOutline
} from '@vicons/ionicons5'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { TooltipComponent, GridComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([LineChart, TooltipComponent, GridComponent, CanvasRenderer])

const connectionStore = useConnectionStore()
const taskStore = useTaskStore()
const statsStore = useStatsStore()
const { t } = useI18n()

const isConnected = computed(() => connectionStore.isConnected)
const config = computed(() => connectionStore.config)
const globalStat = computed(() => statsStore.globalStat)
const version = computed(() => statsStore.version)

// 所有任务及其统计
const allTasks = computed(() => [
  ...taskStore.activeTasks,
  ...taskStore.waitingTasks,
  ...taskStore.stoppedTasks
])
const allTaskStats = computed(() => getTaskStats(allTasks.value))

// 服务信息
const serverInfos = computed(() => [
  {
    label: t('statusPage.connectionStatus'),
    type: 'status',
    value: isConnected.value ? t('header.connected') : t('header.disconnected'),
    tagType: isConnected.value ? 'success' : 'error'
  },
  {
    label: t('statusPage.serverAddress'),
    type: 'text',
    value: `${config.value.protocol}://${config.value.host}:${config.value.port}`
  },
  {
    label: t('statusPage.aria2Version'),
    type: 'text',
    value: version.value?.version || '--'
  }
])

// 流量统计小卡片数据（下载/上传速度 + 详细统计去重整合）
const trafficStats = computed(() => {
  const stats = allTaskStats.value
  const progress = stats.totalSize > 0 ? Math.round((stats.completedSize / stats.totalSize) * 100) : 0
  return [
    {
      label: t('statusPage.downloadSpeed'),
      value: `${formatSpeed(globalStat.value.downloadSpeed)}/s`,
      icon: DownloadOutline,
      colorClass: 'download'
    },
    {
      label: t('statusPage.uploadSpeed'),
      value: `${formatSpeed(globalStat.value.uploadSpeed)}/s`,
      icon: CloudUploadOutline,
      colorClass: 'upload'
    },
    {
      label: t('stats.totalTasks'),
      value: stats.total,
      icon: LayersOutline,
      colorClass: 'all'
    },
    {
      label: t('stats.totalDownloaded'),
      value: formatSize(stats.totalSize),
      icon: SaveOutline,
      colorClass: 'download'
    },
    {
      label: t('stats.completed'),
      value: formatSize(stats.completedSize),
      icon: CheckmarkDoneOutline,
      colorClass: 'complete'
    },
    {
      label: t('stats.totalProgress'),
      value: `${progress}%`,
      icon: TrendingUpOutline,
      colorClass: 'active'
    }
  ]
})

// ── 实时流量图（速度趋势折线图） ──
// 数据由全局后台监控（useTrafficMonitor）采集，与状态页是否打开无关
const { speedHistory } = useTrafficMonitor()
const trafficChartRef = ref<HTMLDivElement>()
let trafficChart: echarts.ECharts | null = null
let resizeObserver: ResizeObserver | null = null

onMounted(async () => {
  await nextTick()
  initTrafficChart()
  // 跟随容器宽度自适应，页面缩放时图表同步压缩/拉伸
  if (trafficChartRef.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      trafficChart?.resize()
    })
    resizeObserver.observe(trafficChartRef.value)
  }
})

onUnmounted(() => {
  // 仅销毁图表实例与尺寸监听，不停止后台监控（监控生命周期由全局连接状态管理）
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  if (trafficChart) {
    trafficChart.dispose()
    trafficChart = null
  }
})

// 后台监控每秒推入新点，订阅变化以刷新图表
watch(speedHistory, () => {
  if (trafficChart) updateTrafficChart()
})

// 是否为整分钟节点（某分钟的 :00 秒）
function isMinuteBoundary(index: number): boolean {
  const point = speedHistory.value[index]
  return point ? point.time.endsWith(':00') : false
}

function initTrafficChart() {
  if (!trafficChartRef.value) return
  trafficChart = echarts.init(trafficChartRef.value)
  updateTrafficChart()
}

function updateTrafficChart() {
  if (!trafficChart) return

  // 根据实际数据计算合理的 y 轴上限，空闲时回退到 1KB/s，避免出现异常大刻度
  const speeds = speedHistory.value.map(item => item.speed)
  const maxSpeed = speeds.length > 0 ? Math.max(...speeds) : 0
  const yMax = maxSpeed > 0 ? Math.ceil((maxSpeed * 1.2) / 1024) * 1024 : 1024

  const option = {
    tooltip: {
      trigger: 'axis',
      formatter: (params: { name: string; value: number; dataIndex: number } | { name: string; value: number; dataIndex: number }[]) => {
        const data = Array.isArray(params) ? params[0] : params
        const point = speedHistory.value[data.dataIndex]
        const time = point ? point.time : ''
        return `${time}<br/>${t('stats.downloadSpeed')}: ${formatSpeed(data.value)}`
      }
    },
    grid: { left: 8, right: 8, top: 16, bottom: 8, containLabel: true },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: speedHistory.value.map(item => item.time),
      // 仅在整分钟（:00 秒）生成大刻度/标签/网格线
      axisTick: { interval: isMinuteBoundary },
      axisLabel: {
        fontSize: 10,
        interval: isMinuteBoundary,
        formatter: (value: string) => value.slice(0, 5)
      },
      splitLine: { interval: isMinuteBoundary }
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: yMax,
      axisLabel: { formatter: (value: number) => formatSpeed(value) }
    },
    series: [
      {
        name: t('stats.downloadSpeed'),
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: speedHistory.value.map(item => item.speed),
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(32, 128, 240, 0.3)' },
            { offset: 1, color: 'rgba(32, 128, 240, 0.1)' }
          ])
        },
        lineStyle: { color: '#2080f0' },
        itemStyle: { color: '#2080f0' }
      }
    ]
  }
  trafficChart.setOption(option)
}
</script>

<style scoped>
.status-page {
  padding: 20px;
}

.status-header {
  margin-bottom: 20px;
}

.status-header h2 {
  margin: 0 0 6px 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary);
}

.status-subtitle {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
}

.info-card {
  margin-bottom: 16px;
  background: var(--bg-primary);
  border: 1px solid var(--border-light);
  border-radius: 10px;
  box-shadow: var(--shadow-light);
  transition: background-color 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease;
}

.info-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 0;
}

.info-label {
  font-size: 13px;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.info-value {
  font-size: 13px;
  color: var(--text-primary);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.traffic-card {
  margin-bottom: 16px;
  background: var(--bg-primary);
  border: 1px solid var(--border-light);
  border-radius: 10px;
  box-shadow: var(--shadow-light);
  transition: background-color 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease;
}

.traffic-chart-section {
  margin-bottom: 16px;
}

.traffic-chart {
  height: 200px;
  width: 100%;
}

.traffic-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

@media (max-width: 1200px) {
  .traffic-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

.traffic-stat {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-light);
  border-radius: 8px;
  transition: border-color 0.2s ease;
}

.traffic-stat:hover {
  border-color: var(--color-primary);
}

.traffic-stat-icon {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.traffic-stat-icon.download {
  background: rgba(32, 128, 240, 0.12);
  color: #2080f0;
}

.traffic-stat-icon.upload {
  background: rgba(24, 160, 88, 0.12);
  color: #18a058;
}

.traffic-stat-icon.active {
  background: rgba(240, 160, 32, 0.12);
  color: #f0a020;
}

.traffic-stat-icon.waiting {
  background: rgba(144, 147, 153, 0.12);
  color: var(--text-secondary);
}

.traffic-stat-icon.complete {
  background: rgba(24, 160, 88, 0.12);
  color: #18a058;
}

.traffic-stat-icon.all {
  background: rgba(32, 128, 240, 0.12);
  color: #2080f0;
}

.traffic-stat-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.traffic-stat-value {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
  white-space: nowrap;
}

.traffic-stat-label {
  font-size: 12px;
  color: var(--text-secondary);
}

.features-card {
  background: var(--bg-primary);
  border: 1px solid var(--border-light);
  border-radius: 10px;
  box-shadow: var(--shadow-light);
  transition: background-color 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease;
}
</style>