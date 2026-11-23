<template>
  <div class="status-page">
    <PageHeader class="page-head" :title="t('statusPage.title')" />

    <!--
      服务信息：三项都是「引擎现在是什么状态」的只读事实，排成一条元信息带。
      v1 用 n-card + n-grid 撑起一整张卡，卡片标题缺省时只剩一块空面板，层级虚高。
    -->
    <UiPanel flush>
      <dl class="info-grid">
        <div v-for="info in serverInfos" :key="info.label" class="info-item">
          <dt class="info-label">{{ info.label }}</dt>
          <dd class="info-value">
            <n-tag v-if="info.type === 'status'" :type="info.tagType" size="small">
              {{ info.value }}
            </n-tag>
            <span v-else class="info-text" :title="info.value">{{ info.value }}</span>
          </dd>
        </div>
      </dl>
    </UiPanel>

    <!--
      摘要指标带：五个数字语义同一层级（都是「此刻的量」），并排成一排，
      数值用等宽数字、单位降级成小字，读的时候先读量级再读单位。
    -->
    <UiPanel flush>
      <div class="metric-band">
        <div v-for="item in summaryStats" :key="item.label" class="stat-cell">
          <UiStat :label="item.label" :value="item.value" :unit="item.unit" />
        </div>
      </div>
    </UiPanel>

    <!-- 下载趋势：7/30 天下载量柱状图，数据来自本地按日历史（90 天） -->
    <UiPanel :title="t('statusPage.downloadTrend')">
      <template #actions>
        <n-radio-group v-model:value="trendDays" size="small">
          <n-radio-button :value="7">7</n-radio-button>
          <n-radio-button :value="30">30</n-radio-button>
        </n-radio-group>
      </template>
      <div class="trend-chart" role="img" :aria-label="t('statusPage.downloadTrend')">
        <div
          v-for="point in trendPoints"
          :key="point.dateKey"
          class="trend-bar-column"
          :title="`${point.dateKey}: ${formatSize(point.bytes)}`"
        >
          <div class="trend-bar" :style="{ height: trendBarHeight(point.bytes) }" />
        </div>
      </div>
      <p v-if="trendHasNoData" class="trend-empty">{{ t('statusPage.noTrendData') }}</p>
      <div v-else class="trend-axis">
        <span
          v-for="(point, index) in trendPoints"
          :key="point.dateKey"
          class="trend-axis-label"
          :title="point.dateKey"
        >{{ formatTrendAxisLabel(point.dateKey, index, trendDays) }}</span>
      </div>
    </UiPanel>

    <!-- 流量统计：图 + 明细列表；破坏性的「重置统计」放在面板 header 右侧，不贴着数字 -->
    <UiPanel :title="t('statusPage.trafficStats')">
      <template #actions>
        <n-popconfirm @positive-click="downloadHistoryStore.reset()">
          <template #trigger>
            <n-button size="small" type="error" secondary>{{ t('statusPage.resetHistory') }}</n-button>
          </template>
          {{ t('statusPage.resetHistoryConfirm') }}
        </n-popconfirm>
      </template>

      <div class="traffic-chart-wrap">
        <div
          ref="trafficChartRef"
          class="traffic-chart"
          role="img"
          :aria-label="t('statusPage.trafficChartAria')"
        />
        <!-- 还没有采到数据点时的占位说明：图表本身空着会像「加载失败」 -->
        <p v-if="hasNoSpeedData" class="traffic-chart-empty">{{ t('statusPage.trafficCollecting') }}</p>
      </div>

      <!--
        明细列表：v1 是 6 张彩色 pastel 图标小卡，颜色无语义、还和摘要带抢注意力。
        这里改成中性两列列表，语义色只保留在「下载/上传」两个速度项的图标上。
      -->
      <ul class="traffic-list">
        <li v-for="stat in trafficStats" :key="stat.label" class="traffic-row">
          <span class="traffic-row__icon" :class="stat.colorClass">
            <n-icon :size="16"><component :is="stat.icon" /></n-icon>
          </span>
          <span class="traffic-row__label">{{ stat.label }}</span>
          <span class="traffic-row__value ds-tnum">{{ stat.value }}</span>
        </li>
      </ul>
    </UiPanel>

    <!-- 支持的功能 -->
    <UiPanel v-if="version" :title="t('statusPage.enabledFeatures')">
      <n-space wrap :size="4">
        <n-tag v-for="feature in version.enabledFeatures" :key="feature" size="small">
          {{ feature }}
        </n-tag>
      </n-space>
    </UiPanel>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onActivated, onDeactivated, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useConnectionStore } from '@/stores/connectionStore'
import { useTaskStore } from '@/stores/taskStore'
import { useStatsStore } from '@/stores/statsStore'
import { buildDailySeries, useDownloadHistoryStore } from '@/stores/downloadHistoryStore'
import { formatSpeed, formatSize } from '@/utils/taskFormatters'
import { formatTrendAxisLabel } from '@/utils/statusTrend'
import { getTaskStats } from '@/utils/taskUtils'
import PageHeader from '@/components/layout/PageHeader.vue'
import { UiPanel, UiStat } from '@/components/ui'
import { useTrafficMonitor } from '@/composables/useTrafficMonitor'
import { useThemeManager } from '@/composables/useThemeManager'
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
import { TooltipComponent, GridComponent, LegendComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([LineChart, TooltipComponent, GridComponent, LegendComponent, CanvasRenderer])

const connectionStore = useConnectionStore()
const taskStore = useTaskStore()
const statsStore = useStatsStore()
const downloadHistoryStore = useDownloadHistoryStore()
const { t } = useI18n()

// 暗色模式判断（与 AppSidebar 共用同一个响应式系统主题状态）
const { isDark } = useThemeManager()

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

const seedingCount = computed(() =>
  taskStore.activeTasks.filter(task => task.seeder === 'true').length
)

// formatSize 返回「1.5 MB」这种带单位的字符串：拆成数值 + 单位，数值走等宽数字，单位降级成小字
function splitUnit(formatted: string): { value: string; unit?: string } {
  const match = /^([\d.]+)\s*(.*)$/.exec(formatted)
  if (!match) return { value: formatted }
  const unit = match[2]
  return { value: match[1] ?? formatted, unit: unit && unit.length > 0 ? unit : undefined }
}

const summaryStats = computed(() => {
  const today = splitUnit(formatSize(downloadHistoryStore.todayBytes))
  const total = splitUnit(formatSize(downloadHistoryStore.totalBytes))
  return [
    { label: t('statusPage.todayDownloaded'), value: today.value, unit: today.unit },
    { label: t('statusPage.totalDownloaded'), value: total.value, unit: total.unit },
    { label: t('statusPage.activeTasks'), value: String(taskStore.activeTasks.length) },
    { label: t('statusPage.waitingTasks'), value: String(taskStore.waitingTasks.length) },
    { label: t('statusPage.seedingTasks'), value: String(seedingCount.value) }
  ]
})

// ── 下载趋势（7/30 天） ──
const trendDays = ref(7)
const trendPoints = computed(() => buildDailySeries(downloadHistoryStore.history.daily, trendDays.value))
const trendHasNoData = computed(() => trendPoints.value.every(point => point.bytes === 0))
const trendMaxBytes = computed(() => Math.max(1, ...trendPoints.value.map(point => point.bytes)))
function trendBarHeight(bytes: number): string {
  if (bytes <= 0) return '0%'
  // 极小值也保留 4% 高度，让用户能看到「这一天有下载」而不是空柱
  return `${Math.max(4, Math.round((bytes / trendMaxBytes.value) * 100))}%`
}

// 服务信息
/** 服务器信息卡片项；tagType 限定为 n-tag 支持的取值（否则模板里 :type 会因 string 过宽报错） */
interface ServerInfoItem {
  label: string
  type: 'status' | 'text'
  value: string
  tagType?: 'default' | 'primary' | 'info' | 'success' | 'warning' | 'error'
}

const serverInfos = computed<ServerInfoItem[]>(() => [
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

// 流量统计明细（下载/上传速度 + 任务统计）；colorClass 只给速度项上语义色，其余中性
const trafficStats = computed(() => {
  const stats = allTaskStats.value
  const progress = stats.totalSize > 0 ? Math.round((stats.completedSize / stats.totalSize) * 100) : 0
  return [
    {
      label: t('statusPage.downloadSpeed'),
      value: formatSpeed(globalStat.value.downloadSpeed),
      icon: DownloadOutline,
      colorClass: 'download'
    },
    {
      label: t('statusPage.uploadSpeed'),
      value: formatSpeed(globalStat.value.uploadSpeed),
      icon: CloudUploadOutline,
      colorClass: 'upload'
    },
    {
      label: t('stats.totalTasks'),
      value: String(stats.total),
      icon: LayersOutline,
      colorClass: 'neutral'
    },
    {
      label: t('stats.totalDownloaded'),
      value: formatSize(stats.totalSize),
      icon: SaveOutline,
      colorClass: 'neutral'
    },
    {
      label: t('stats.completed'),
      value: formatSize(stats.completedSize),
      icon: CheckmarkDoneOutline,
      colorClass: 'neutral'
    },
    {
      label: t('stats.totalProgress'),
      value: `${progress}%`,
      icon: TrendingUpOutline,
      colorClass: 'neutral'
    }
  ]
})

// ── 实时流量图（下载 + 上传双序列折线图） ──
// 下载序列由全局后台监控（useTrafficMonitor）采集，与状态页是否打开无关。
// 上传速度没有历史缓冲（composable 只记录下载速度，且不在本任务可改范围内），
// 这里按同一个 600 点窗口在本页自行采样，时间轴与下载序列严格对齐。
const { speedHistory, retryMarkers } = useTrafficMonitor()

interface UploadPoint {
  time: string
  speed: number
}

const UPLOAD_HISTORY_LIMIT = 600
const uploadHistory = ref<UploadPoint[]>([])

// 下载序列每多一个点，就为同一时刻补一个上传速度采样
watch(
  () => speedHistory.value[speedHistory.value.length - 1]?.time,
  time => {
    if (!time) return
    const speed = Number(globalStat.value.uploadSpeed) || 0
    uploadHistory.value = [...uploadHistory.value, { time, speed }].slice(-UPLOAD_HISTORY_LIMIT)
  }
)

// 图表空态：还没有任何速度采样点（刚启动/未连接）时给一句解释，而不是留一块空白画布
const hasNoSpeedData = computed(() => speedHistory.value.length === 0)

const trafficChartRef = ref<HTMLDivElement>()
let trafficChart: echarts.ECharts | null = null
let resizeObserver: ResizeObserver | null = null

onMounted(async () => {
  await nextTick()
  setupTrafficChart()
})

// keep-alive 下页面被缓存时 DOM 会被摘掉，但 onUnmounted 不会触发。
// 此时 echarts 实例仍持有已脱离文档的容器，resize 会算不出尺寸，
// 所以失活时销毁、激活时按当前容器重建。
onActivated(async () => {
  await nextTick()
  setupTrafficChart()
})

onDeactivated(() => {
  teardownTrafficChart()
})

onUnmounted(() => {
  teardownTrafficChart()
})

function setupTrafficChart(): void {
  if (trafficChart || !trafficChartRef.value) return
  initTrafficChart()
  // 跟随容器宽度自适应，页面缩放时图表同步压缩/拉伸
  if (trafficChartRef.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      trafficChart?.resize()
    })
    resizeObserver.observe(trafficChartRef.value)
  }
}

function teardownTrafficChart(): void {
  // 仅销毁图表实例与尺寸监听，不停止后台监控（监控生命周期由全局连接状态管理）
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  if (trafficChart) {
    trafficChart.dispose()
    trafficChart = null
  }
}

// 后台监控每秒推入新点，订阅变化以刷新图表
watch(speedHistory, () => {
  if (trafficChart) updateTrafficChart()
})

watch(uploadHistory, () => {
  if (trafficChart) updateTrafficChart()
})

watch(retryMarkers, () => {
  if (trafficChart) updateTrafficChart()
})

// 主题切换时同步刷新图表颜色（轴线/网格线/折线/渐变），无需重建实例
watch(isDark, () => {
  if (trafficChart) updateTrafficChart()
})

// 整分钟节点索引集合：每次历史变化只扫描一次，避免坐标轴逐点判断时 O(n²)
const minuteBoundaryIndices = computed(() => {
  const indices = new Set<number>()
  speedHistory.value.forEach((point, index) => {
    if (point.time.endsWith(':00')) indices.add(index)
  })
  return indices
})

/**
 * 横轴标签该落在哪些点上。
 *
 * 只有整分钟才画标签时，应用刚启动的前 59 秒横轴是完全空白的——
 * 屏幕上只有一条曲线飘在没有时间刻度的画布里，看起来像图表没加载完。
 * 窗口里还没有整分钟节点时，退化成「等分 6 份」的临时刻度。
 */
function showAxisLabel(index: number): boolean {
  const length = speedHistory.value.length
  if (length === 0) return false
  if (minuteBoundaryIndices.value.size > 0) return minuteBoundaryIndices.value.has(index)
  const step = Math.max(1, Math.ceil(length / 6))
  return index % step === 0
}

function initTrafficChart() {
  if (!trafficChartRef.value) return
  trafficChart = echarts.init(trafficChartRef.value)
  updateTrafficChart()
}

// 读取主题 CSS 变量（随 data-theme 自动切换浅/暗色），读不到时回退到 isDark 对应色值
function getCssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

// 将 #rrggbb 转为 rgba 字符串（用于图表渐变/半透明背景）
function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '')
  if (normalized.length !== 6) return hex
  const r = parseInt(normalized.slice(0, 2), 16)
  const g = parseInt(normalized.slice(2, 4), 16)
  const b = parseInt(normalized.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/**
 * 计算「好看的」y 轴：刻度落在 1/2/2.5/5 × 10^n 上，固定 4 段。
 * v1 用 Math.ceil(max*1.2/1024)*1024 直接定上限，刻度间隔与数值都不可读
 * （15.6/14.3/11.4/8.6/5.7/2.9 MB/s 这种刻度既不是整数、间距也不等）。
 */
function niceAxis(maxValue: number): { max: number; interval: number } {
  const target = maxValue > 0 ? maxValue * 1.1 : 1024
  const rough = target / 4
  // 刻度必须落在 1024 进制单位上：按十进制量级取整会得到 5,000,000 B 这样的间隔，
  // 换算成 MB/s 就是 4.8 / 9.5 / 14.3 / 19.1 —— 比 v1 还难读。
  const exponent = Math.max(0, Math.floor(Math.log(rough) / Math.log(1024)))
  const unit = Math.pow(1024, exponent)
  const scaled = rough / unit
  const steps = [1, 2, 2.5, 5, 10]
  let step = 10
  for (const candidate of steps) {
    if (scaled <= candidate) {
      step = candidate
      break
    }
  }
  const interval = step * unit
  return { max: interval * 4, interval }
}

interface TooltipItem {
  seriesName?: string
  marker?: string
  value?: number | null
  dataIndex: number
}

function updateTrafficChart() {
  if (!trafficChart) return

  // 按当前主题取色：全部走 --ds-* 角色令牌，图表与页面共用同一套配色
  const accentColor = getCssVar('--ds-accent', isDark.value ? '#5465d8' : '#4560e0')
  const successColor = getCssVar('--ds-status-success-text', isDark.value ? '#63e2b7' : '#15803d')
  const dangerColor = getCssVar('--ds-status-danger-text', isDark.value ? '#ff8b8b' : '#c81e1e')
  const axisTextColor = getCssVar('--ds-text-muted', isDark.value ? '#98a1b3' : '#636d7f')
  const splitLineColor = getCssVar('--ds-border-subtle', isDark.value ? '#232936' : '#eaedf2')
  const tooltipBgColor = getCssVar('--ds-bg-raised', isDark.value ? '#262d3c' : '#ffffff')
  const tooltipTextColor = getCssVar('--ds-text-strong', isDark.value ? '#e6e9ef' : '#1a1f2b')
  const tooltipBorderColor = getCssVar('--ds-border-base', isDark.value ? '#2c323e' : '#dfe3ea')

  const downloadData = speedHistory.value.map(item => item.speed)
  const uploadByTime = new Map(uploadHistory.value.map(item => [item.time, item.speed]))
  // 时间轴以下载序列为准（它才是每秒稳定推点的序列），上传按时刻对齐，缺失处留空不连线
  const uploadData = speedHistory.value.map(item => {
    const speed = uploadByTime.get(item.time)
    return speed === undefined ? null : speed
  })

  const peak = Math.max(
    downloadData.length > 0 ? Math.max(...downloadData) : 0,
    uploadHistory.value.length > 0 ? Math.max(...uploadHistory.value.map(item => item.speed)) : 0
  )
  const { max: yMax, interval: yInterval } = niceAxis(peak)

  const option = {
    // 数据每秒更新时曲线平滑过渡（而非瞬跳），默认缓动之外的显式声明以保证一致性
    animationDurationUpdate: 600,
    // as const：echarts 要求缓动名为字面量联合类型，直接写字符串会被推断为 string
    animationEasingUpdate: 'linear' as const,
    // 图例放右上角，与面板标题同一水平线，12px muted，避免抢曲线注意力
    legend: {
      top: 0,
      right: 0,
      itemWidth: 8,
      itemHeight: 8,
      itemGap: 12,
      icon: 'roundRect',
      textStyle: { color: axisTextColor, fontSize: 12 }
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: tooltipBgColor,
      borderColor: tooltipBorderColor,
      textStyle: { color: tooltipTextColor },
      formatter: (params: TooltipItem | TooltipItem[]) => {
        const list = Array.isArray(params) ? params : [params]
        const first = list[0]
        // 数组为空时没有可展示的数据点（noUncheckedIndexedAccess 下 params[0] 可能为 undefined）
        if (!first) return ''
        const point = speedHistory.value[first.dataIndex]
        const time = point ? point.time : ''
        const lines = list.map(item => {
          const value = item.value === null || item.value === undefined ? '--' : formatSpeed(item.value)
          return `${item.marker ?? ''}${item.seriesName ?? ''}: ${value}`
        })
        return [time, ...lines].join('<br/>')
      }
    },
    // containLabel: 给 y 轴标签与 x 轴时间留出真实空间，曲线不再压顶/贴边
    grid: { left: 4, right: 8, top: 28, bottom: 0, containLabel: true },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: speedHistory.value.map(item => item.time),
      // 整分钟优先；窗口内还没有整分钟时退化成等分标签，避免启动初期横轴空白
      axisTick: { interval: showAxisLabel },
      axisLabel: {
        fontSize: 10,
        interval: showAxisLabel,
        color: axisTextColor,
        // 窗口不足两分钟时所有点都在同一分钟里，只显示 HH:mm 会得到一排完全相同的标签，
        // 这种情况退到 mm:ss；跨度够大才用整分钟刻度
        formatter: (value: string) => (speedHistory.value.length < 120 ? value.slice(3) : value.slice(0, 5))
      },
      axisLine: { lineStyle: { color: splitLineColor } },
      splitLine: {
        interval: showAxisLabel,
        lineStyle: { color: splitLineColor }
      }
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: yMax,
      interval: yInterval,
      axisLabel: {
        color: axisTextColor,
        formatter: (value: number) => formatSpeed(value)
      },
      axisLine: { lineStyle: { color: splitLineColor } },
      splitLine: { lineStyle: { color: splitLineColor } }
    },
    series: [
      {
        name: t('statusPage.downloadSpeed'),
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: downloadData,
        // 面积填充压到 0.12 -> 0.02，双序列叠加时仍能读出主次
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: hexToRgba(accentColor, 0.12) },
            { offset: 1, color: hexToRgba(accentColor, 0.02) }
          ])
        },
        lineStyle: { color: accentColor, width: 2 },
        itemStyle: { color: accentColor },
        // 失败任务自动重试的断点：用红色菱形标出重试发生的时刻
        markPoint: {
          symbol: 'diamond',
          symbolSize: 10,
          itemStyle: { color: dangerColor },
          label: {
            show: true,
            formatter: (params: { name?: string }) => params.name || '',
            color: axisTextColor,
            fontSize: 10,
            position: 'top'
          },
          data: retryMarkers.value.map(marker => ({
            name: marker.label,
            coord: [marker.time, marker.speed],
            value: marker.speed
          }))
        }
      },
      {
        name: t('statusPage.uploadSpeed'),
        type: 'line',
        smooth: true,
        showSymbol: false,
        connectNulls: false,
        data: uploadData,
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: hexToRgba(successColor, 0.06) },
            { offset: 1, color: hexToRgba(successColor, 0.01) }
          ])
        },
        lineStyle: { color: successColor, width: 1.5 },
        itemStyle: { color: successColor }
      }
    ]
  }
  trafficChart.setOption(option)
}
</script>

<style scoped>
.status-page {
  display: flex;
  flex-direction: column;
  gap: var(--ds-space-16);
}

/* ── 服务信息带 ── */
.info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--ds-space-12) var(--ds-space-24);
  margin: 0;
  padding: var(--ds-space-16) var(--ds-space-20);
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: var(--ds-space-4);
  min-width: 0;
}

.info-label {
  margin: 0;
  font-size: var(--ds-text-small-size);
  line-height: var(--ds-text-small-leading);
  color: var(--ds-text-muted);
}

.info-value {
  margin: 0;
  min-width: 0;
}

.info-text {
  display: block;
  font-size: var(--ds-text-body-size);
  line-height: var(--ds-text-body-leading);
  font-weight: 500;
  color: var(--ds-text-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── 指标带 ── */
.metric-band {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: var(--ds-space-24);
  padding: var(--ds-space-20);
}

/* 发丝线分隔：靠线读「这是五个独立数字」，靠留白读「这是同一组」 */
.stat-cell + .stat-cell {
  border-left: 1px solid var(--ds-border-subtle);
  padding-left: var(--ds-space-24);
}

/*
  1100 以下不再改列数，只压缩间距：5 是个奇数，按 3 列排是 3+2、按 2 列排是 2+2+1，
  右下角永远缺一块。960 窗口内容区仍有约 670px，5 列各 110px 放得下四五个字的标签，
  所以宁可挤一点也不换行。
*/
@media (max-width: 1100px) {
  .metric-band {
    gap: var(--ds-space-12);
    padding: var(--ds-space-16);
  }

  .stat-cell + .stat-cell {
    padding-left: var(--ds-space-12);
  }
}

/* 真正放不下时退成两列，令第 5 项整行铺满，避免最后一行右侧留空 */
@media (max-width: 760px) {
  .metric-band {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    row-gap: var(--ds-space-16);
  }

  .stat-cell + .stat-cell {
    border-left: none;
    padding-left: 0;
  }

  .stat-cell:last-child {
    grid-column: 1 / -1;
  }
}

/* ── 下载趋势柱状图 ── */
.trend-chart {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 140px;
  padding: var(--ds-space-12) var(--ds-space-4) 0;
  border-bottom: 1px solid var(--ds-border-subtle);
}

.trend-bar-column {
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  align-items: flex-end;
}

.trend-bar {
  width: 100%;
  min-height: 0;
  border-radius: var(--ds-radius-sm) var(--ds-radius-sm) 0 0;
  background: linear-gradient(180deg, var(--ds-accent), var(--ds-accent-muted, var(--ds-accent)));
  opacity: 0.85;
}

.trend-bar-column:hover .trend-bar {
  opacity: 1;
}

.trend-empty {
  margin: var(--ds-space-8) 0 0;
  font-size: var(--ds-text-small-size);
  color: var(--ds-text-faint);
}

.trend-axis {
  display: flex;
  gap: 3px;
  padding: 0 var(--ds-space-4);
  margin-top: var(--ds-space-6);
  font-size: var(--ds-text-small-size);
  color: var(--ds-text-muted);
}

.trend-axis-label {
  flex: 1;
  min-width: 0;
  text-align: center;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

/* ── 图表 ── */
.traffic-chart-wrap {
  position: relative;
}

.traffic-chart {
  width: 100%;
  height: 200px;
}

.traffic-chart-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  font-size: var(--ds-text-small-size);
  line-height: var(--ds-text-small-leading);
  color: var(--ds-text-faint);
  pointer-events: none;
}

/* ── 明细列表：中性两列，语义色只留给下载/上传两项的图标 ── */
.traffic-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: var(--ds-space-32);
  margin: var(--ds-space-16) 0 0;
  padding: var(--ds-space-12) 0 0;
  border-top: 1px solid var(--ds-border-subtle);
  list-style: none;
}

@media (max-width: 760px) {
  .traffic-list {
    grid-template-columns: minmax(0, 1fr);
  }
}

.traffic-row {
  display: flex;
  align-items: center;
  gap: var(--ds-space-8);
  min-height: 40px;
  padding: var(--ds-space-8) 0;
  border-bottom: 1px solid var(--ds-border-subtle);
}

/* 列表末两行（两列布局的最后一行）不再画下边框 */
.traffic-row:last-child,
.traffic-row:nth-last-child(2) {
  border-bottom: none;
}

@media (max-width: 760px) {
  .traffic-row:nth-last-child(2) {
    border-bottom: 1px solid var(--ds-border-subtle);
  }

  .traffic-row:last-child {
    border-bottom: none;
  }
}

.traffic-row__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ds-text-muted);
}

/* 只有「速度」有方向语义：下载走强调色、上传走成功色 */
.traffic-row__icon.download {
  color: var(--ds-accent-text);
}

.traffic-row__icon.upload {
  color: var(--ds-status-success-text);
}

.traffic-row__label {
  flex: 1;
  min-width: 0;
  font-size: var(--ds-text-small-size);
  line-height: var(--ds-text-small-leading);
  color: var(--ds-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.traffic-row__value {
  font-size: var(--ds-text-body-size);
  line-height: var(--ds-text-body-leading);
  font-weight: 600;
  color: var(--ds-text-strong);
  white-space: nowrap;
  text-align: right;
}
</style>
