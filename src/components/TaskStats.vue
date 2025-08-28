<template>
  <div class="task-stats">
    <el-row :gutter="16">
      <!-- 任务状态统计 -->
      <el-col :span="8">
        <el-card class="stats-card">
          <template #header>
            <div class="card-header">
              <span>任务状态分布</span>
              <el-icon><PieChart /></el-icon>
            </div>
          </template>
          <div ref="statusChartRef" class="chart-container"></div>
        </el-card>
      </el-col>
      
      <!-- 下载速度趋势 -->
      <el-col :span="8">
        <el-card class="stats-card">
          <template #header>
            <div class="card-header">
              <span>下载速度趋势</span>
              <el-icon><TrendCharts /></el-icon>
            </div>
          </template>
          <div ref="speedChartRef" class="chart-container"></div>
        </el-card>
      </el-col>
      
      <!-- 文件大小分布 -->
      <el-col :span="8">
        <el-card class="stats-card">
          <template #header>
            <div class="card-header">
              <span>文件大小分布</span>
              <el-icon><DataAnalysis /></el-icon>
            </div>
          </template>
          <div ref="sizeChartRef" class="chart-container"></div>
        </el-card>
      </el-col>
    </el-row>
    
    <!-- 详细统计信息 -->
    <el-row :gutter="16" style="margin-top: 16px">
      <el-col :span="24">
        <el-card>
          <template #header>
            <span>详细统计</span>
          </template>
          
          <el-row :gutter="16">
            <el-col :span="6">
              <div class="statistic-wrapper">
                <el-statistic
                  title="总任务数"
                  :value="stats.total"
                  suffix="个"
                />
              </div>
            </el-col>
            <el-col :span="6">
              <div class="statistic-wrapper">
                <el-statistic
                  title="总下载量"
                  :value="formatSize(stats.totalSize)"
                />
              </div>
            </el-col>
            <el-col :span="6">
              <div class="statistic-wrapper">
                <el-statistic
                  title="已完成"
                  :value="formatSize(stats.completedSize)"
                />
              </div>
            </el-col>
            <el-col :span="6">
              <div class="statistic-wrapper">
                <el-statistic
                  title="当前速度"
                  :value="formatSpeed(stats.totalSpeed)"
                />
              </div>
            </el-col>
          </el-row>
          
          <el-divider />
          
          <el-row :gutter="16">
            <el-col :span="4">
              <div class="status-stat">
                <div class="status-count active">{{ stats.active }}</div>
                <div class="status-label">下载中</div>
              </div>
            </el-col>
            <el-col :span="4">
              <div class="status-stat">
                <div class="status-count waiting">{{ stats.waiting }}</div>
                <div class="status-label">等待中</div>
              </div>
            </el-col>
            <el-col :span="4">
              <div class="status-stat">
                <div class="status-count paused">{{ stats.paused }}</div>
                <div class="status-label">已暂停</div>
              </div>
            </el-col>
            <el-col :span="4">
              <div class="status-stat">
                <div class="status-count complete">{{ stats.complete }}</div>
                <div class="status-label">已完成</div>
              </div>
            </el-col>
            <el-col :span="4">
              <div class="status-stat">
                <div class="status-count error">{{ stats.error }}</div>
                <div class="status-label">错误</div>
              </div>
            </el-col>
            <el-col :span="4">
              <div class="status-stat">
                <div class="status-count progress">{{ progressPercentage }}%</div>
                <div class="status-label">总进度</div>
              </div>
            </el-col>
          </el-row>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import * as echarts from 'echarts'
import { PieChart, TrendCharts, DataAnalysis } from '@element-plus/icons-vue'
import { formatSize, formatSpeed } from '@/utils/taskUtils'

interface TaskStats {
  total: number
  active: number
  waiting: number
  paused: number
  complete: number
  error: number
  totalSize: number
  completedSize: number
  totalSpeed: number
}

interface Props {
  stats: TaskStats
  tasks?: any[] // 添加任务数据用于计算文件大小分布
}

const props = defineProps<Props>()

// 图表引用
const statusChartRef = ref<HTMLDivElement>()
const speedChartRef = ref<HTMLDivElement>()
const sizeChartRef = ref<HTMLDivElement>()

// 图表实例
let statusChart: echarts.ECharts | null = null
let speedChart: echarts.ECharts | null = null
let sizeChart: echarts.ECharts | null = null

// 速度历史数据
const speedHistory = ref<Array<{ time: string; speed: number }>>([])
const maxHistoryLength = 30

// 计算属性
const progressPercentage = computed(() => {
  if (props.stats.totalSize === 0) return 0
  return Math.round((props.stats.completedSize / props.stats.totalSize) * 100)
})

// 初始化图表
onMounted(async () => {
  await nextTick()
  initCharts()
  
  // 开始收集速度数据
  startSpeedCollection()
})

onUnmounted(() => {
  destroyCharts()
})

// 监听统计数据变化
watch(() => props.stats, () => {
  updateCharts()
}, { deep: true })

function initCharts() {
  if (statusChartRef.value) {
    statusChart = echarts.init(statusChartRef.value)
    updateStatusChart()
  }
  
  if (speedChartRef.value) {
    speedChart = echarts.init(speedChartRef.value)
    updateSpeedChart()
  }
  
  if (sizeChartRef.value) {
    sizeChart = echarts.init(sizeChartRef.value)
    updateSizeChart()
  }
}

function updateCharts() {
  updateStatusChart()
  updateSpeedChart()
  updateSizeChart()
}

function updateStatusChart() {
  if (!statusChart) return
  
  const option = {
    tooltip: {
      trigger: 'item',
      formatter: '{a} <br/>{b}: {c} ({d}%)'
    },
    series: [
      {
        name: '任务状态',
        type: 'pie',
        radius: ['40%', '70%'],
        avoidLabelOverlap: false,
        label: {
          show: false,
          position: 'center'
        },
        emphasis: {
          label: {
            show: true,
            fontSize: '18',
            fontWeight: 'bold'
          }
        },
        labelLine: {
          show: false
        },
        data: [
          { value: props.stats.active, name: '下载中', itemStyle: { color: '#409eff' } },
          { value: props.stats.waiting, name: '等待中', itemStyle: { color: '#e6a23c' } },
          { value: props.stats.paused, name: '已暂停', itemStyle: { color: '#909399' } },
          { value: props.stats.complete, name: '已完成', itemStyle: { color: '#67c23a' } },
          { value: props.stats.error, name: '错误', itemStyle: { color: '#f56c6c' } }
        ].filter(item => item.value > 0)
      }
    ]
  }
  
  statusChart.setOption(option)
}

function updateSpeedChart() {
  if (!speedChart) return
  
  const option = {
    tooltip: {
      trigger: 'axis',
      formatter: (params: any) => {
        const data = params[0]
        return `${data.name}<br/>速度: ${formatSpeed(data.value)}`
      }
    },
    xAxis: {
      type: 'category',
      data: speedHistory.value.map(item => item.time),
      axisLabel: {
        fontSize: 10
      }
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        formatter: (value: number) => formatSpeed(value)
      }
    },
    series: [
      {
        name: '下载速度',
        type: 'line',
        smooth: true,
        data: speedHistory.value.map(item => item.speed),
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(64, 158, 255, 0.3)' },
            { offset: 1, color: 'rgba(64, 158, 255, 0.1)' }
          ])
        },
        lineStyle: {
          color: '#409eff'
        }
      }
    ]
  }
  
  speedChart.setOption(option)
}

function updateSizeChart() {
  if (!sizeChart) return

  // 计算真实的文件大小分布数据
  const sizeDistribution = [
    { name: '< 100MB', value: 0 },
    { name: '100MB - 1GB', value: 0 },
    { name: '1GB - 10GB', value: 0 },
    { name: '> 10GB', value: 0 }
  ]

  // 根据实际任务数据计算分布
  if (props.tasks && props.tasks.length > 0) {
    props.tasks.forEach(task => {
      const size = parseInt(task.totalLength) || 0
      const sizeMB = size / (1024 * 1024)
      const sizeGB = size / (1024 * 1024 * 1024)

      if (sizeMB < 100) {
        sizeDistribution[0].value++
      } else if (sizeMB >= 100 && sizeGB < 1) {
        sizeDistribution[1].value++
      } else if (sizeGB >= 1 && sizeGB < 10) {
        sizeDistribution[2].value++
      } else if (sizeGB >= 10) {
        sizeDistribution[3].value++
      }
    })
  }

  const option = {
    tooltip: {
      trigger: 'item',
      formatter: (params: any) => {
        return `${params.name}<br/>任务数: ${params.value} (${params.percent}%)`
      }
    },
    series: [
      {
        name: '文件大小',
        type: 'pie',
        radius: '70%',
        data: sizeDistribution.filter(item => item.value > 0),
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowOffsetX: 0,
            shadowColor: 'rgba(0, 0, 0, 0.5)'
          }
        }
      }
    ]
  }

  sizeChart.setOption(option)
}

function startSpeedCollection() {
  const interval = setInterval(() => {
    const now = new Date()
    const timeStr = now.toLocaleTimeString()
    
    speedHistory.value.push({
      time: timeStr,
      speed: props.stats.totalSpeed
    })
    
    // 保持历史数据长度
    if (speedHistory.value.length > maxHistoryLength) {
      speedHistory.value.shift()
    }
    
    updateSpeedChart()
  }, 2000)
  
  // 清理定时器
  onUnmounted(() => {
    clearInterval(interval)
  })
}

function destroyCharts() {
  if (statusChart) {
    statusChart.dispose()
    statusChart = null
  }
  if (speedChart) {
    speedChart.dispose()
    speedChart = null
  }
  if (sizeChart) {
    sizeChart.dispose()
    sizeChart = null
  }
}
</script>

<style scoped>
.task-stats {
  padding: 16px;
}

.stats-card {
  height: 300px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.chart-container {
  height: 220px;
}

.status-stat {
  text-align: center;
}

.statistic-wrapper {
  text-align: center;
}

.status-count {
  font-size: 24px;
  font-weight: bold;
  margin-bottom: 4px;
}

.status-count.active { color: #409eff; }
.status-count.waiting { color: #e6a23c; }
.status-count.paused { color: #909399; }
.status-count.complete { color: #67c23a; }
.status-count.error { color: #f56c6c; }
.status-count.progress { color: #606266; }

.status-label {
  font-size: 12px;
  color: #909399;
}

/* 深色主题适配 */
[data-theme="dark"] .status-count.active { color: var(--color-primary); }
[data-theme="dark"] .status-count.waiting { color: var(--color-warning); }
[data-theme="dark"] .status-count.paused { color: var(--text-secondary); }
[data-theme="dark"] .status-count.complete { color: var(--color-success); }
[data-theme="dark"] .status-count.error { color: var(--color-danger); }
[data-theme="dark"] .status-count.progress { color: var(--text-primary); }

[data-theme="dark"] .status-label {
  color: var(--text-secondary);
}
</style>
