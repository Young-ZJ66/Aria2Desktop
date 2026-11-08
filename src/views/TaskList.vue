<template>
  <div class="task-list">
    <PageHeader :title="title" :description="pageDescription">
      <template #actions>
        <div class="task-stats">
          <span>{{ t('task.totalTasks', { count: allTasks.length }) }}</span>
          <span v-if="filteredTasks.length !== allTasks.length">
            {{ t('task.showingTasks', { count: filteredTasks.length }) }}
          </span>
          <n-tag v-if="taskStats.totalSpeed > 0" type="primary" size="small" :bordered="false">
            {{ t('task.totalSpeed') }} {{ formatSpeed(taskStats.totalSpeed) }}
          </n-tag>
        </div>
        <n-button type="primary" class="app-action-btn" @click="uiStore.openNewTask()">
          <template #icon>
            <n-icon><AddOutline /></n-icon>
          </template>
          {{ t('task.newDownload') }}
        </n-button>
      </template>
    </PageHeader>

    <section class="task-surface">
      <!-- 操作栏与任务表同处一个表面，减少空白卡片堆叠 -->
      <div class="task-actions">
        <div class="action-left">
          <TaskBatchActions
            :selected-count="selectedCount"
            :has-selection="hasSelection"
            :can-batch-start="canBatchStart"
            :can-batch-pause="canBatchPause"
            :can-batch-open="props.taskType === 'stopped' && selectedTasks.some(task => task.files?.some(file => file.path))"
            :operating="batchOperating || batchOpening"
            :deleting="batchDeleting"
            @batch-start="batchStart"
            @batch-pause="batchPause"
            @batch-open="batchOpen"
            @batch-delete="batchDelete"
          />
        </div>

        <div class="action-right">
          <!-- 任务导出/导入 -->
          <n-button size="small" quaternary @click="exportTasks" :title="t('task.exportTasks')">
            <template #icon><n-icon><ExportIcon /></n-icon></template>
          </n-button>
          <n-button size="small" quaternary @click="importTasks" :title="t('task.importTasks')">
            <template #icon><n-icon><ImportIcon /></n-icon></template>
          </n-button>
          <!-- 分类 / 来源类型筛选：与现有表格页共用，不额外拆路由 -->
          <n-select
            v-model:value="selectedCategory"
            :options="categoryOptions"
            :placeholder="t('task.allCategories')"
            size="small"
            clearable
            style="width: 110px;"
          />
          <n-select
            v-model:value="selectedKind"
            :options="kindOptions"
            :placeholder="t('task.allTypes')"
            size="small"
            clearable
            style="width: 104px;"
          />
          <n-input
            v-model:value="searchText"
            :placeholder="t('task.searchPlaceholder')"
            clearable
            style="flex: 0 0 200px; width: 200px;"
          >
            <template #prefix>
              <n-icon><SearchOutline /></n-icon>
            </template>
          </n-input>
        </div>
      </div>

      <div class="task-list-content">
        <n-data-table
          :loading="loading"
          :columns="columns"
          :data="filteredTasks"
          :row-key="(row: Aria2Task) => row.gid"
          :row-props="rowProps"
          :scroll-x="920"
          :min-row-height="60"
          flex-height
          virtual-scroll
          table-layout="fixed"
          :bordered="false"
          class="task-table"
          :sort-order="controlledSorter ?? undefined"
          @sorter-change="handleSorterChange"
        >
          <template #empty>
            <!-- 空状态出现时淡入（避免搜索结果/空列表切换时生硬闪出） -->
            <transition name="fade-in">
              <n-empty :description="t('task.noTasks')" size="small">
                <template #extra>
                  <span class="empty-hint">{{ t('task.emptyHint') }}</span>
                </template>
              </n-empty>
            </transition>
          </template>
        </n-data-table>
      </div>
    </section>

    <!-- 批量删除对话框（带文件删除选项） -->
    <DeleteTaskDialog
      v-model="showBatchDeleteDialog"
      :tasks="tasksToDelete"
      :task-name="tasksToDelete.length === 1 ? getTaskDisplayName(tasksToDelete[0] as Aria2Task) : undefined"
      :task-type="taskType"
      :loading="batchDeleting"
      @confirm="handleBatchDeleteConfirm"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, h, ref, watch, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import { NIcon, NProgress, NTag, NCheckbox, type DataTableColumns } from 'naive-ui'
import { AddOutline, SearchOutline, VideocamOutline, MusicalNotesOutline, ImageOutline, ArchiveOutline, DocumentTextOutline, CodeSlashOutline, CubeOutline, DocumentOutline } from '@vicons/ionicons5'
import { ExportIcon, ImportIcon } from '@/components/icons/ExportImportIcons'
import { message, confirm } from '@/utils/feedback'
import { getUserFriendlyError } from '@/utils/errorMessages'
import { useTaskStore } from '@/stores/taskStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { useUiStore } from '@/stores/uiStore'
import { useStreamTaskStore } from '@/stores/streamTaskStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useTaskSelection } from '@/composables/useTaskSelection'
import { taskTimeService } from '@/services/taskTimeService'
import { taskPersistenceService } from '@/services/taskPersistenceService'
import { completedTaskDeleteService } from '@/services/completedTaskDeleteService'
import TaskCheckbox from '@/components/TaskCheckbox.vue'
import DeleteTaskDialog from '@/components/dialogs/DeleteTaskDialog.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import TaskBatchActions from '@/components/task/TaskBatchActions.vue'
import TaskRowActions from '@/components/task/TaskRowActions.vue'
import type { Aria2Task } from '@/types/aria2'
import {
  getTaskStats,
  getTaskName as utilGetTaskName,
  searchTasks
} from '@/utils/taskUtils'
import { getFileCategory } from '@/utils/fileTypeIcons'
import { CATEGORY_GENERAL, resolveCategory } from '@/shared/fileCategories'
import { detectTaskKind, type TaskKind } from '@/utils/taskKind'
import {
  formatSize,
  formatSpeed,
  formatRemainingTime,
  getProgress,
  getStatusType,
  getTaskDisplayName,
  formatCompleteTime
} from '@/utils/taskFormatters'

interface Props {
  taskType: 'active' | 'waiting' | 'stopped' | 'active-and-waiting'
}

const props = defineProps<Props>()
const taskStore = useTaskStore()
const connectionStore = useConnectionStore()
const uiStore = useUiStore()
const streamTaskStore = useStreamTaskStore()
const settingsStore = useSettingsStore()
const { t } = useI18n()

// 批量删除对话框状态
const showBatchDeleteDialog = ref(false)
const tasksToDelete = ref<Aria2Task[]>([])
// 批量删除执行中（驱动删除对话框的 loading，删除期间保持对话框打开）
const batchDeleting = ref(false)
// 批量开始/暂停执行中（禁用批量操作按钮，防止重复触发）
const batchOperating = ref(false)
// 批量打开文件中
const batchOpening = ref(false)

// 操作锁定状态
const operatingTasks = ref<Set<string>>(new Set())

// 使用独立的选择状态管理
const {
  selectedTaskGids,
  selectedTasks,
  selectedCount,
  hasSelection,
  canBatchStart,
  canBatchPause,
  clearSelection,
  selectAll,
  toggleTask,
  updateSelectedTasksData,
  cleanupNonExistentTasks
} = useTaskSelection()

// 状态
const loading = ref(false)
const searchText = ref('')
const selectedCategory = ref<string | null>(null)
const selectedKind = ref<TaskKind | null>(null)

// 列头排序状态：Naive UI 的 sorter 是非受控的（组件内部管理三态循环），
// 但切页/切列表会销毁组件导致排序丢失——这里用受控 sortOrderer 恢复，并在变化时持久化。
// key 带 taskType：两个列表（下载/完成）各自记忆自己的排序。
const SORT_PREF_KEY = 'task-list-sort'
type SorterState = { columnKey: string; order: 'ascend' | 'descend' }

const savedSort = (() => {
  try {
    const all = JSON.parse(localStorage.getItem(SORT_PREF_KEY) || '{}') as Record<string, unknown>
    const entry = all[props.taskType] as Partial<SorterState> | undefined
    // 形状校验后再回填：localStorage 可能被手工改过、或残留旧版本的结构，
    // 直接透传给 Naive 的 sort-order 会得到"表格不排序且控制台告警"这类难排查的现场。
    // 列名不在这里校验（列定义在别处，且列增删时最坏只是该列不排序，无副作用）。
    if (
      entry &&
      typeof entry.columnKey === 'string' &&
      entry.columnKey.length > 0 &&
      (entry.order === 'ascend' || entry.order === 'descend')
    ) {
      return { columnKey: entry.columnKey, order: entry.order }
    }
    return null
  } catch {
    return null
  }
})()
const controlledSorter = ref<SorterState | null>(savedSort)

function persistSort(state: SorterState | null) {
  try {
    const all = JSON.parse(localStorage.getItem(SORT_PREF_KEY) || '{}') as Record<string, SorterState>
    if (state) all[props.taskType] = state
    else delete all[props.taskType]
    localStorage.setItem(SORT_PREF_KEY, JSON.stringify(all))
  } catch { /* localStorage 不可用时静默 */ }
}

function handleSorterChange(state: { columnKey: string; order: 'ascend' | 'descend' | false } | null) {
  if (state && state.order) {
    controlledSorter.value = { columnKey: state.columnKey, order: state.order }
    persistSort(controlledSorter.value)
  } else {
    controlledSorter.value = null
    persistSort(null)
  }
}

const title = computed(() => {
  switch (props.taskType) {
    case 'active': return t('task.downloading')
    case 'waiting': return t('task.waiting')
    case 'stopped': return t('task.stopped')
    case 'active-and-waiting': return t('task.activeAndWaiting')
    default: return t('task.activeAndWaiting')
  }
})

const pageDescription = computed(() =>
  props.taskType === 'stopped' ? t('task.pageCompleted') : t('task.pageDownloading')
)

const allTasks = computed(() => {
  let tasks: Aria2Task[] = []
  // yt-dlp 流媒体下载不在 aria2 队列里，但按用户预期一并显示在对应列表
  const streamTasks = (statuses: Array<'active' | 'complete' | 'error'>) =>
    streamTaskStore.tasks
      .filter(task => statuses.includes(task.status))
      .map(task => streamTaskStore.toAria2Task(task))

  switch (props.taskType) {
    case 'active':
      tasks = [...taskStore.activeTasks, ...streamTasks(['active'])]
      break
    case 'waiting':
      tasks = [...taskStore.waitingTasks]
      break
    case 'stopped':
      // 已停止列表只展示已完成任务，失败/错误任务归入下载任务列表
      tasks = [
        ...taskStore.stoppedTasks.filter(task => task.status !== 'error'),
        ...streamTasks(['complete'])
      ]
      break
    case 'active-and-waiting':
      // 下载任务列表：正在下载 + 等待 + 失败/错误（方便点击重试）
      tasks = [
        ...taskStore.activeTasks,
        ...taskStore.waitingTasks,
        ...taskStore.stoppedTasks.filter(task => task.status === 'error'),
        ...streamTasks(['active', 'error'])
      ]
      break
    default:
      return []
  }

  // 不在 computed 里排序：waiting 列表的顺序就是 aria2 的队列顺序，
  // 任何"按 gid 重排"都会让上移/下移/置顶操作看起来无效。具体排序见 filteredTasks。
  return tasks
})

/** 分类筛选选项：内置分类 + 用户自定义分类（与新建任务下拉同口径） */
const categoryOptions = computed(() =>
  (settingsStore.categoryConfig.categories ?? []).map(category => ({
    label: category.id === CATEGORY_GENERAL
      ? t('newTask.categoryGeneral')
      : (category.name || t(`newTask.category.${category.id}`)),
    value: category.id
  }))
)

/** 来源类型筛选选项（Metalink 创建后与 HTTP 无法区分，不单列） */
const kindOptions = computed(() => [
  { label: t('task.typeHttp'), value: 'http' },
  { label: t('task.typeFtp'), value: 'ftp' },
  { label: t('task.typeBt'), value: 'bt' },
  { label: t('task.typeMagnet'), value: 'magnet' },
  { label: t('task.typeStream'), value: 'stream' }
])

/** 任务所属分类（按文件名扩展名，与自动分类落盘使用同一套规则） */
function taskCategoryId(task: Aria2Task): string {
  return resolveCategory(getTaskName(task), settingsStore.categoryConfig.categories ?? []).id
}

/**
 * 快速路径的形态判定：aria2 的 gid 是小写十六进制（通常 16 位）。
 * 只接受**小写**：混用大小写时字典序与数值序不再等价（'A' < 'a'），
 * 那种情况一律退回 BigInt，保证语义不变。
 */
const HEX_GID_PATTERN = /^[0-9a-f]{1,32}$/

// 格式异常时回退为 0，避免整个列表排序崩溃
function parseGid(gid: string): bigint {
  try {
    return BigInt(`0x${gid}`)
  } catch {
    return 0n
  }
}

/**
 * 按 GID 倒序比较。
 *
 * 为什么不用 BigInt：这里是**每秒执行**的排序比较器，1000 条任务约 1 万次比较，
 * 每次比较都要跑 2 次 BigInt() + try/catch（合计每秒约 2 万次构造）。
 * 而**等长十六进制字符串的字典序等价于其数值序**，因此长度一致时直接比字符串即可；
 * 长度不齐或含非十六进制字符（异常 gid）时才回退 BigInt。
 */
function compareGidDesc(a: Aria2Task, b: Aria2Task): number {
  const ga = a.gid
  const gb = b.gid

  if (ga.length === gb.length && HEX_GID_PATTERN.test(ga) && HEX_GID_PATTERN.test(gb)) {
    if (ga === gb) return 0
    return ga > gb ? -1 : 1
  }

  const diff = parseGid(gb) - parseGid(ga)
  return diff > 0n ? 1 : diff < 0n ? -1 : 0
}

// 排序任务：error > active > waiting > paused，同状态按添加时间倒序
function sortTasksByStatus(tasks: Aria2Task[]): Aria2Task[] {
  const statusPriority: Record<string, number> = { 'error': 4, 'active': 3, 'waiting': 2, 'paused': 1 }
  return tasks.sort((a, b) => {
    const aPriority = statusPriority[a.status] || 0
    const bPriority = statusPriority[b.status] || 0
    if (aPriority !== bPriority) return bPriority - aPriority
    return compareGidDesc(a, b)
  })
}

/**
 * 混合列表排序：只按状态分组，同状态保持输入顺序。
 * 输入中的 waiting 段来自 tellWaiting，顺序即真实队列顺序；按 gid 再排会覆盖它。
 * Array.prototype.sort 在现代 V8 是稳定排序，这里仍显式记录原始下标，避免依赖实现细节。
 */
function sortTasksByStatusStable(tasks: Aria2Task[]): Aria2Task[] {
  const statusPriority: Record<string, number> = { 'error': 4, 'active': 3, 'waiting': 2, 'paused': 1 }
  const originalIndex = new Map(tasks.map((task, index) => [task, index]))
  return [...tasks].sort((a, b) => {
    const diff = (statusPriority[b.status] || 0) - (statusPriority[a.status] || 0)
    if (diff !== 0) return diff
    return (originalIndex.get(a) ?? 0) - (originalIndex.get(b) ?? 0)
  })
}

// 排序和过滤后的任务
const filteredTasks = computed(() => {
  let tasks = [...allTasks.value]

  // 分类 / 来源类型筛选（不拆路由，保持现有表格页结构）
  if (selectedCategory.value) {
    tasks = tasks.filter(task => taskCategoryId(task) === selectedCategory.value)
  }
  if (selectedKind.value) {
    const kind = selectedKind.value
    tasks = tasks.filter(task =>
      detectTaskKind(task, streamTaskStore.findByGid(task.gid) !== undefined) === kind
    )
  }

  // 搜索过滤（复用 taskUtils.searchTasks 的统一实现，避免两份过滤逻辑漂移）
  if (searchText.value.trim()) {
    tasks = searchTasks(tasks, searchText.value)
  }

  // 等待队列：保持 tellWaiting 的原始顺序（队列操作的唯一事实来源）
  if (props.taskType === 'waiting') {
    return tasks
  }

  // 混合列表：只按状态分组，等待段内部保持队列顺序
  if (props.taskType === 'active-and-waiting') {
    return sortTasksByStatusStable(tasks)
  }

  // 默认排序：根据任务类型（列头排序由 Naive UI DataTable 内置处理）
  if (props.taskType === 'stopped') {
    return tasks.sort((a: Aria2Task, b: Aria2Task) => {
      const aCompleteTime = taskTimeService.getCompleteTime(a.gid)
      const bCompleteTime = taskTimeService.getCompleteTime(b.gid)

      if (aCompleteTime && bCompleteTime) return bCompleteTime - aCompleteTime
      if (aCompleteTime && !bCompleteTime) return -1
      if (!aCompleteTime && bCompleteTime) return 1
      return compareGidDesc(a, b)
    })
  }

  return sortTasksByStatus(tasks)
})

// 任务统计
const taskStats = computed(() => getTaskStats(filteredTasks.value))

/**
 * 可批量选择的任务：yt-dlp 流媒体任务没有 aria2 gid，批量暂停/删除无法作用于它们，
 * 因此不参与勾选（行内仍提供取消/重试/移除）。
 */
const selectableTasks = computed(() =>
  filteredTasks.value.filter(task => !streamTaskStore.findByGid(task.gid))
)

// 表头全选复选框状态
const allChecked = computed(() =>
  selectableTasks.value.length > 0 && selectableTasks.value.every(t => selectedTaskGids.value.has(t.gid))
)
const indeterminate = computed(() => {
  const selected = selectableTasks.value.filter(t => selectedTaskGids.value.has(t.gid))
  return selected.length > 0 && selected.length < selectableTasks.value.length
})

function handleSelectAllChange(checked: boolean) {
  if (checked) {
    selectAll(selectableTasks.value)
  } else {
    clearSelection()
  }
}

// 获取任务名称
function getTaskName(task: Aria2Task): string {
  return utilGetTaskName(task)
}

// 获取文件类型图标（基于文件扩展名，复用共享分类映射）
const CATEGORY_ICON_MAP: Record<string, Component> = {
  video: VideocamOutline,
  audio: MusicalNotesOutline,
  image: ImageOutline,
  archive: ArchiveOutline,
  document: DocumentTextOutline,
  code: CodeSlashOutline,
  // 安装包/可执行文件用盒子图标：与文档（纸页）、压缩包（箱）一眼可分
  app: CubeOutline
}

function getFileTypeIcon(task: Aria2Task): Component {
  const name = getTaskName(task)
  const category = getFileCategory(name)
  return CATEGORY_ICON_MAP[category] || DocumentOutline
}

// 格式化完成时间标签（流媒体任务没有 taskTimeService 记录，回退到任务自身的 completionTime）
function formatCompleteTimeLabel(task: Aria2Task): string {
  const completeTime = taskTimeService.getCompleteTime(task.gid)
    ?? (task.completionTime ? Number(task.completionTime) * 1000 : undefined)
  return completeTime ? formatCompleteTime(completeTime) : '--'
}

// ── 表格列定义 ──

const columns = computed<DataTableColumns<Aria2Task>>(() => [
  {
    key: 'selection',
    width: 48,
    fixed: 'left',
    title: () =>
      h(NCheckbox, {
        checked: allChecked.value,
        indeterminate: indeterminate.value,
        'onUpdate:checked': handleSelectAllChange,
        'aria-label': t('task.selectAll')
      }),
    render: (row: Aria2Task) =>
      streamTaskStore.findByGid(row.gid)
        ? h('span', { class: 'stream-task-no-select', 'aria-hidden': 'true' })
        : h(TaskCheckbox, { task: row })
  },
  {
    key: 'name',
    title: t('task.fileName'),
    width: 210,
    sorter: (a: Aria2Task, b: Aria2Task) => getTaskName(a).localeCompare(getTaskName(b)),
    render: (row: Aria2Task) => {
      const name = getTaskName(row)
      return h('div', { class: 'file-info' }, [
        h('div', { class: 'file-name-row' }, [
          // 类型图标放在文件名**前面**：原来放在后面且 `.file-name` 是 flex: 1，
          // 文件名短时图标会被推到列的最右端，看起来像浮在空白里（用户反馈）。
          // 前置图标位置固定、和文字基线对齐，长文件名省略时也不会跟着漂移。
          h(NIcon, { class: 'file-type-icon', size: 16 }, { default: () => h(getFileTypeIcon(row)) }),
          h('span', { class: 'file-name', title: name }, name)
        ]),
        row.dir ? h('div', { class: 'file-path', title: row.dir }, row.dir) : null
      ])
    }
  },
  {
    key: 'size',
    title: t('task.size'),
    width: 78,
    sorter: (a: Aria2Task, b: Aria2Task) => (parseInt(a.totalLength, 10) || 0) - (parseInt(b.totalLength, 10) || 0),
    render: (row: Aria2Task) => formatSize(row.totalLength)
  },
  {
    key: 'progress',
    title: t('task.progress'),
    width: 110,
    sorter: (a: Aria2Task, b: Aria2Task) => getProgress(a) - getProgress(b),
    render: (row: Aria2Task) =>
      h(NProgress, {
        type: 'line',
        percentage: getProgress(row),
        status: row.status === 'complete' ? 'success' : row.status === 'error' ? 'error' : 'default',
        height: 8,
        indicatorPlacement: 'outside'
      })
  },
  {
    key: 'status',
    title: t('task.status'),
    width: 96,
    sorter: (a: Aria2Task, b: Aria2Task) => a.status.localeCompare(b.status),
    render: (row: Aria2Task) =>
      h(NTag, { type: getStatusType(row.status), size: 'small' }, { default: () => t('status.' + row.status) })
  },
  {
    key: 'downloadSpeed',
    title: t('task.downloadSpeed'),
    width: 100,
    sorter: (a: Aria2Task, b: Aria2Task) => (parseInt(a.downloadSpeed, 10) || 0) - (parseInt(b.downloadSpeed, 10) || 0),
    render: (row: Aria2Task) => formatSpeed(row.downloadSpeed)
  },
  props.taskType === 'stopped'
    ? {
      key: 'completeTime',
      title: t('task.completeTime'),
      width: 120,
      sorter: (a: Aria2Task, b: Aria2Task) => (taskTimeService.getCompleteTime(a.gid) || 0) - (taskTimeService.getCompleteTime(b.gid) || 0),
      render: (row: Aria2Task) => formatCompleteTimeLabel(row)
    }
    : {
      key: 'remainingTime',
      title: t('task.remainingTime'),
      width: 110,
      sorter: (a: Aria2Task, b: Aria2Task) => {
        const aSpeed = parseInt(a.downloadSpeed, 10) || 0
        const bSpeed = parseInt(b.downloadSpeed, 10) || 0
        const aRemain = aSpeed > 0 ? (parseInt(a.totalLength, 10) - parseInt(a.completedLength, 10)) / aSpeed : 0
        const bRemain = bSpeed > 0 ? (parseInt(b.totalLength, 10) - parseInt(b.completedLength, 10)) / bSpeed : 0
        return aRemain - bRemain
      },
      render: (row: Aria2Task) => formatRemainingTime(row)
    },
  {
    key: 'actions',
    title: t('task.actions'),
    width: 160,
    fixed: 'right',
    align: 'center',
    render: (row: Aria2Task) => {
      const isStreamTask = Boolean(streamTaskStore.findByGid(row.gid))
      return h(TaskRowActions, {
        gid: row.gid,
        status: row.status,
        operating: operatingTasks.value.has(row.gid),
        showOpenLocation: props.taskType === 'stopped',
        // 已完成且文件存在时才显示“打开文件”（BT 多文件任务同样打开第一个文件）
        showOpenFile: props.taskType === 'stopped' && Boolean(row.files?.[0]?.path),
        // 流媒体任务没有 aria2 详情（tellStatus 会失败），隐藏详情入口
        showDetail: !isStreamTask,
        // 等待队列排序按钮仅在"下载任务"页显示（waiting 状态才有队列位置）
        showQueueActions: props.taskType === 'active-and-waiting',
        // BT 任务可导出已保存的 .torrent 元数据
        showTorrentExport: Boolean(row.bittorrent),
        task: row,
        onUnpause: unpauseTask,
        onRetry: isStreamTask ? retryStreamTask : retryTask,
        onPause: isStreamTask ? cancelStreamTask : pauseTask,
        'onOpen-location': (task: Aria2Task) => openTaskLocation(task),
        'onOpen-file': (task: Aria2Task) => openTaskFile(task),
        onRemove: isStreamTask ? removeStreamTask : removeTask,
        'onView-detail': viewTaskDetail,
        'onMove-up': (gid: string) => void moveTaskInQueue(gid, 'up'),
        'onMove-down': (gid: string) => void moveTaskInQueue(gid, 'down'),
        'onMove-top': (gid: string) => void moveTaskInQueue(gid, 'top'),
        'onExport-torrent': (gid: string) => void exportTaskTorrent(gid)
      })
    }
  }
])

// 行点击选择任务。忽略点击行内按钮/链接等交互元素的事件，避免误触发选中
function rowProps(row: Aria2Task) {
  return {
    onClick: (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('button, a, input, textarea, select, .n-checkbox, .n-button')) return
      handleRowSelect(row)
    }
  }
}

// ── 单任务操作 ──

/**
 * 队列上移/下移/置顶。
 * 旧实现 fire-and-forget：RPC 失败（任务已开始下载、不在队列中）时界面毫无反馈，
 * 用户只会觉得按钮没反应；这里统一捕获并提示，成功后刷新队列。
 */
async function moveTaskInQueue(gid: string, direction: 'up' | 'down' | 'top') {
  if (operatingTasks.value.has(gid)) return
  operatingTasks.value.add(gid)
  try {
    await taskStore.moveInQueue(gid, direction)
  } catch (error: unknown) {
    console.error('调整队列位置失败:', error)
    message.error(t('task.queueMoveFailed', { error: getUserFriendlyError(error) }))
    await taskStore.loadAllTasks()
  } finally {
    operatingTasks.value.delete(gid)
  }
}

async function pauseTask(gid: string) {
  if (operatingTasks.value.has(gid)) return

  operatingTasks.value.add(gid)

  try {
    await taskStore.pauseTask(gid, true)
    message.success(t('task.taskPaused'))
  } catch (error: unknown) {
    console.error('暂停任务失败:', error)
    message.error(t('task.pauseFailed', { error: getUserFriendlyError(error) }))
    await taskStore.loadAllTasks()
  } finally {
    operatingTasks.value.delete(gid)
  }
}

async function unpauseTask(gid: string) {
  if (operatingTasks.value.has(gid)) return

  operatingTasks.value.add(gid)

  try {
    await taskStore.unpauseTask(gid)
    message.success(t('task.taskStarted'))
  } catch (error: unknown) {
    console.error('开始任务失败:', error)
    message.error(t('task.startFailed', { error: getUserFriendlyError(error) }))
    await taskStore.loadAllTasks()
  } finally {
    operatingTasks.value.delete(gid)
  }
}

async function retryTask(gid: string) {
  if (operatingTasks.value.has(gid)) return

  operatingTasks.value.add(gid)

  try {
    await taskStore.retryErrorTask(gid)
    message.success(t('task.taskRetried'))
    await taskStore.loadAllTasks()
  } catch (error: unknown) {
    console.error('重试任务失败:', error)
    message.error(t('task.retryFailed', { error: getUserFriendlyError(error) }))
    await taskStore.loadAllTasks()
  } finally {
    operatingTasks.value.delete(gid)
  }
}

/**
 * 流媒体任务（yt-dlp）：取消 / 重试 / 从列表移除。
 * 这些操作不经过 aria2，直接调用 streamTaskStore。
 */
async function cancelStreamTask(gid: string) {
  if (operatingTasks.value.has(gid)) return
  operatingTasks.value.add(gid)
  try {
    const cancelled = await streamTaskStore.cancelTask(gid)
    if (cancelled) message.success(t('task.streamCancelDone'))
  } catch (error: unknown) {
    console.error('取消流媒体下载失败:', error)
    message.error(t('task.pauseFailed', { error: getUserFriendlyError(error) }))
  } finally {
    operatingTasks.value.delete(gid)
  }
}

async function retryStreamTask(gid: string) {
  if (operatingTasks.value.has(gid)) return
  operatingTasks.value.add(gid)
  try {
    const result = await streamTaskStore.retryTask(gid)
    if (result.success) {
      message.success(t('task.taskRetried'))
    } else {
      message.error(t('task.retryFailed', { error: getUserFriendlyError(result.error) }))
    }
  } catch (error: unknown) {
    console.error('重试流媒体下载失败:', error)
    message.error(t('task.retryFailed', { error: getUserFriendlyError(error) }))
  } finally {
    operatingTasks.value.delete(gid)
  }
}

async function removeStreamTask(gid: string) {
  confirm({
    title: t('delete.title'),
    content: t('task.streamRemoveConfirm'),
    positiveText: t('delete.confirm'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      await streamTaskStore.removeTask(gid)
      message.success(t('task.streamRemoveDone'))
    }
  })
}

async function removeTask(gid: string) {
  try {
    const task = filteredTasks.value.find(t => t.gid === gid)
    if (!task) {
      message.error(t('task.taskNotExistShort'))
      return
    }

    const isElectron = !!window.electronAPI?.deleteFiles
    let hasFiles = false

    if (props.taskType === 'stopped') {
      hasFiles = completedTaskDeleteService.hasDeleteableFiles(task)
    } else {
      hasFiles = task.files && task.files.length > 0 &&
        task.files.some(file => file.path && file.path.trim())
    }

    if (isElectron && hasFiles) {
      // 使用自定义删除对话框
      tasksToDelete.value = [task]
      showBatchDeleteDialog.value = true
    } else {
      // 使用简单确认对话框
      confirm({
        title: t('delete.title'),
        content: t('delete.confirmSingle'),
        positiveText: t('delete.confirm'),
        negativeText: t('common.cancel'),
        onPositiveClick: async () => {
          try {
            if (props.taskType === 'stopped') {
              const result = await completedTaskDeleteService.deleteCompletedTask(task, false, connectionStore.service)
              await taskStore.loadAllTasks()
              if (result.success) {
                message.success(t('delete.taskDeleted'))
              } else {
                message.error(t('task.deleteFailed', { error: result.errors.join(', ') }))
              }
            } else {
              await taskStore.removeTask(gid)
              message.success(t('delete.taskDeleted'))
            }
          } catch (error: unknown) {
            if (error !== 'cancel') {
              console.error('删除任务失败:', error)
              message.error(t('task.deleteTaskFailed'))
            }
          }
        }
      })
    }
  } catch (error: unknown) {
    if (error !== 'cancel') {
      console.error('删除任务失败:', error)
      message.error(t('task.deleteTaskFailed'))
    }
  }
}

// 行点击选择任务
function handleRowSelect(row: Aria2Task) {
  // 流媒体任务不参与批量操作，点击行不勾选
  if (streamTaskStore.findByGid(row.gid)) return
  toggleTask(row)
}

// 查看任务详情（侧边抽屉）
function viewTaskDetail(gid: string) {
  uiStore.openTaskDetail(gid)
}

// 打开任务位置
async function openTaskLocation(task: Aria2Task) {
  if (!window.electronAPI) {
    message.warning(t('task.desktopOnly'))
    return
  }

  if (!task.dir) {
    message.warning(t('task.noDirInfo'))
    return
  }

  try {
    let result

    if (window.electronAPI.openInExplorer) {
      if (task.files && task.files.length > 0) {
        const firstFile = task.files[0]
        if (firstFile?.path) {
          result = await window.electronAPI.openInExplorer(firstFile.path, task.dir)
          if (result?.success) {
            message.success(t('task.openedLocation'))
            return
          }
        }
      }
      result = await window.electronAPI.openInExplorer(task.dir)
      if (result?.success) {
        message.success(t('task.openedDir'))
        return
      }
    }

    if (task.files && task.files.length > 0) {
      const firstFile = task.files[0]
      if (firstFile?.path) {
        result = await window.electronAPI.showItemInFolder(firstFile.path, task.dir)
        if (result?.success) {
          message.success(t('task.openedLocation'))
          return
        }
      }
    }

    result = await window.electronAPI.openPath(task.dir)
    if (result?.success) {
      message.success(t('task.openedDir'))
    } else {
      message.error(t('task.openDirFailed', { error: result?.error || t('common.unknown') }))
    }
  } catch (error) {
    console.error('Failed to open task location:', error)
    message.error(t('task.openLocationFailed'))
  }
}

// 打开任务文件（下载完成后用系统默认程序查看；主进程会再次校验路径边界）
async function openTaskFile(task: Aria2Task) {
  if (!window.electronAPI?.openFile) {
    message.warning(t('task.desktopOnly'))
    return
  }
  const firstFile = task.files?.find(file => file.path)
  if (!firstFile?.path) {
    message.warning(t('task.noFileInfo'))
    return
  }
  try {
    const result = await window.electronAPI.openFile(firstFile.path, task.dir)
    if (result?.success) {
      message.success(t('task.openedFile'))
    } else {
      message.error(t('task.openFileFailed', { error: result?.error || t('common.unknown') }))
    }
  } catch (error) {
    console.error('Failed to open task file:', error)
    message.error(t('task.openFileFailed', { error: getUserFriendlyError(error) }))
  }
}

// 保存 BT 任务的 .torrent 元数据
async function exportTaskTorrent(gid: string) {
  if (!window.electronAPI?.exportTaskTorrent) {
    message.warning(t('task.desktopOnly'))
    return
  }
  try {
    const result = await taskStore.exportTorrent(gid)
    if (!result || result.canceled) return
    if (result.success) {
      message.success(t('task.saveTorrentSuccess', { path: result.path || '' }))
      return
    }
    let key = 'task.saveTorrentFailed'
    if (result.error === 'not_bittorrent') key = 'task.saveTorrentNotBt'
    else if (result.error === 'metadata_not_saved') key = 'task.saveTorrentNoMetadata'
    message.error(t(key, { error: result.error || t('common.unknown') }))
  } catch (error) {
    console.error('Failed to export torrent:', error)
    message.error(t('task.saveTorrentFailed', { error: getUserFriendlyError(error) }))
  }
}

// 批量打开所选任务的文件（仅完成页可触发）
async function batchOpen() {
  if (batchOpening.value) return
  if (!window.electronAPI?.openFile) {
    message.warning(t('task.desktopOnly'))
    return
  }
  const openable = selectedTasks.value.filter(task => task.files?.some(file => file.path))
  if (openable.length === 0) {
    message.warning(t('task.noFileInfo'))
    return
  }
  batchOpening.value = true
  let opened = 0
  try {
    for (const task of openable) {
      const firstFile = task.files?.find(file => file.path)
      if (!firstFile?.path) continue
      const result = await window.electronAPI.openFile(firstFile.path, task.dir)
      if (result?.success) opened += 1
    }
    if (opened > 0) message.success(t('task.batchOpenSuccess', { count: opened }))
    else message.warning(t('task.batchOpenFailed'))
  } catch (error) {
    console.error('Failed to batch open files:', error)
    message.error(t('task.batchOpenFailed'))
  } finally {
    batchOpening.value = false
  }
}

// ── 批量操作 ──

async function batchStart() {
  if (batchOperating.value) return
  batchOperating.value = true
  try {
    const startableTasks = selectedTasks.value.filter(task =>
      task.status === 'paused' || task.status === 'waiting' || task.status === 'error'
    )

    if (startableTasks.length === 0) {
      message.warning(t('task.noStartableTasks'))
      return
    }

    for (const task of startableTasks) {
      if (task.status === 'error') {
        await taskStore.retryErrorTask(task.gid)
      } else {
        await taskStore.unpauseTask(task.gid)
      }
    }

    await taskStore.loadAllTasks()
    message.success(t('task.startedCount', { count: startableTasks.length }))
    clearSelection()
  } catch (error) {
    console.error('开始任务失败:', error)
    message.error(t('task.startFailed', { error: getUserFriendlyError(error) }))
  } finally {
    batchOperating.value = false
  }
}

async function batchPause() {
  if (batchOperating.value) return
  batchOperating.value = true
  try {
    const pausableTasks = selectedTasks.value.filter(task =>
      task.status === 'active' || task.status === 'waiting'
    )

    if (pausableTasks.length === 0) {
      message.warning(t('task.noPausableTasks'))
      return
    }

    for (const task of pausableTasks) {
      await taskStore.pauseTask(task.gid, true)
    }

    message.success(t('task.pausedCount', { count: pausableTasks.length }))
    clearSelection()
  } catch (error) {
    console.error('暂停任务失败:', error)
    message.error(t('task.pauseFailed', { error: getUserFriendlyError(error) }))
  } finally {
    batchOperating.value = false
  }
}

async function batchDelete() {
  try {
    if (selectedCount.value === 0) {
      message.warning(t('task.selectTasksFirst'))
      return
    }

    const isElectron = !!window.electronAPI?.deleteFiles
    let hasFiles = false

    if (props.taskType === 'stopped') {
      hasFiles = selectedTasks.value.some(task =>
        completedTaskDeleteService.hasDeleteableFiles(task)
      )
    } else {
      hasFiles = selectedTasks.value.some(task =>
        task.files && task.files.length > 0 && task.files.some(file => file.path && file.path.trim())
      )
    }

    if (isElectron && hasFiles) {
      tasksToDelete.value = [...selectedTasks.value]
      showBatchDeleteDialog.value = true
    } else {
      confirm({
        title: t('delete.title'),
        content: t('delete.confirmBatch', { count: selectedCount.value }),
        positiveText: t('delete.confirm'),
        negativeText: t('common.cancel'),
        onPositiveClick: async () => {
          await handleBatchDeleteConfirm(false)
        }
      })
    }
  } catch (error) {
    if (error !== 'cancel') {
      console.error('删除任务失败:', error)
      message.error(t('task.deleteTaskFailed'))
    }
  }
}

// 批量删除确认处理
async function handleBatchDeleteConfirm(deleteFiles: boolean) {
  batchDeleting.value = true
  try {
    const tasks = tasksToDelete.value.length > 0 ? tasksToDelete.value : [...selectedTasks.value]

    if (props.taskType === 'stopped') {
      const result = await completedTaskDeleteService.batchDeleteCompletedTasks(tasks, deleteFiles, connectionStore.service)
      await taskStore.loadAllTasks()

      if (result.successfulTasks === result.totalTasks) {
        let messageText = t('task.deletedCount', { count: result.successfulTasks })
        if (deleteFiles && result.totalFilesDeleted > 0) {
          messageText += ` + ${t('task.filesDeletedCount', { count: result.totalFilesDeleted })}`
        }
        message.success(messageText)
      } else {
        message.warning(t('task.deletedPartial', { success: result.successfulTasks, total: result.totalTasks }))
        if (result.errors.length > 0) {
          result.errors.slice(0, 3).forEach(error => message.error(error))
        }
      }
    } else {
      let successCount = 0
      for (const task of tasks) {
        try {
          await taskStore.removeTask(task.gid, deleteFiles)
          successCount++
        } catch (error) {
          console.error(`Failed to delete task ${task.gid}:`, error)
        }
      }

      if (successCount === tasks.length) {
        const messageText = deleteFiles
          ? t('task.deletedCountWithFiles', { count: successCount })
          : t('task.deletedCount', { count: successCount })
        message.success(messageText)
      } else {
        message.warning(t('task.deletedPartial', { success: successCount, total: tasks.length }))
      }
    }

    clearSelection()
    tasksToDelete.value = []
  } catch (error) {
    console.error('删除任务失败:', error)
    message.error(t('task.deleteTaskFailed'))
  } finally {
    batchDeleting.value = false
    showBatchDeleteDialog.value = false
  }
}

// ── 任务导出/导入（方案 B：两个页面不同行为） ──
// 下载任务页：导出未完成任务 URI 用于迁移，导入时重新创建下载
// 下载完成页：导出历史记录用于备份，导入时仅恢复记录（不重新下载）

/** 去掉 URL 中的用户名/密码与片段：导出文件常被分享/上传，不能带凭据 */
function sanitizeExportUri(raw: string): string {
  try {
    const url = new URL(raw)
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'ftp:') {
      url.username = ''
      url.password = ''
      url.hash = ''
      return url.toString()
    }
  } catch {
    // magnet 等非 URL 形式原样保留（磁力链接本身不含文件内容）
  }
  return raw
}

function exportTasks() {
  // 导出只保留迁移所需字段：目录替换为文件名，避免把本机用户名/盘符结构写进分享文件；
  // 文件 URI 去掉 userinfo/hash。完成页历史记录不需要 URI，因此不导出（更小的隐私面）。
  const tasks = filteredTasks.value.map(task => ({
    gid: task.gid,
    status: task.status,
    fileName: task.files?.[0]?.path ? String(task.files[0].path).split(/[\\/]/).pop() : '',
    dir: '',
    totalLength: task.totalLength,
    completedLength: task.completedLength,
    files: (task.files || []).map(file => ({
      index: String(file.index ?? ''),
      path: String(file.path || '').split(/[\\/]/).pop() || '',
      length: String(file.length ?? '0'),
      completedLength: String(file.completedLength ?? '0'),
      selected: String(file.selected ?? 'true'),
      uris: (file.uris || []).map(uri => ({ uri: sanitizeExportUri(String(uri.uri || '')), status: uri.status || 'waiting' }))
    }))
  }))

  const json = JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), type: props.taskType, tasks }, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const prefix = props.taskType === 'stopped' ? 'aria2-history' : 'aria2-tasks'
  a.download = `${prefix}-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
  message.success(t('task.exportSuccess', { count: tasks.length }))
}

/**
 * 导入条目的形状校验（导入文件是外部输入，不能只靠 `as unknown as Aria2Task` 断言）。
 *
 * 为什么必须有：完成页会把条目直接持久化并交给表格渲染，而渲染路径会访问
 * `task.files[0].path` 等字段——一个字段类型不对的条目就会抛 TypeError 让整页白屏，
 * 且**重启后依旧**（坏数据已经落盘）。这里只放行字段齐备的条目，其余跳过并提示数量。
 */
/** 导入的 URI 只接受下载器支持的协议；解析失败/协议不符直接丢弃 */
function sanitizeImportedUri(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw || raw.length > 8192) return null
  try {
    const parsed = new URL(raw)
    if (!['http:', 'https:', 'ftp:', 'magnet:'].includes(parsed.protocol)) return null
    if ((parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'ftp:')
      && (parsed.username || parsed.password)) {
      return null
    }
    return raw
  } catch {
    return null
  }
}

const IMPORTABLE_STATUS = new Set(['active', 'waiting', 'paused', 'error', 'complete', 'removed'])

function isImportableTask(value: unknown): value is Record<string, unknown> & Aria2Task {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const task = value as Record<string, unknown>
  if (typeof task.gid !== 'string' || !task.gid || task.gid.length > 128) return false
  if (typeof task.status !== 'string' || !IMPORTABLE_STATUS.has(task.status)) return false
  if (!Array.isArray(task.files) || task.files.length > 1000) return false
  for (const file of task.files) {
    if (!file || typeof file !== 'object' || Array.isArray(file)) return false
    const f = file as Record<string, unknown>
    if (typeof f.path !== 'string' || f.path.length > 32768) return false
    if (f.uris !== undefined) {
      if (!Array.isArray(f.uris) || f.uris.length > 100) return false
      for (const uri of f.uris) {
        if (!uri || typeof uri !== 'object') return false
        if (!sanitizeImportedUri((uri as Record<string, unknown>).uri)) return false
      }
    }
  }
  if (task.dir !== undefined && (typeof task.dir !== 'string' || task.dir.length > 32768)) return false
  return true
}

/** 仅重建已知字段：导入文件里的任意扩展键不会被持久化/渲染 */
function normalizeImportedTask(task: Record<string, unknown> & Aria2Task): Aria2Task {
  const asLengthString = (value: unknown): string =>
    typeof value === 'string' && value ? value : String(Number(value) || 0)
  const files = (task.files || []).map((file, index) => ({
    index: String(file.index ?? index + 1),
    path: String(file.path || ''),
    length: asLengthString(file.length),
    completedLength: asLengthString(file.completedLength),
    selected: String(file.selected ?? 'true'),
    uris: (file.uris || [])
      .map(uri => sanitizeImportedUri(uri.uri))
      .filter((uri): uri is string => !!uri)
      .map(uri => ({ uri, status: 'waiting' as const }))
  }))
  return {
    gid: String(task.gid),
    status: task.status,
    totalLength: asLengthString(task.totalLength),
    completedLength: asLengthString(task.completedLength),
    uploadLength: asLengthString(task.uploadLength),
    downloadSpeed: '0',
    uploadSpeed: '0',
    connections: '0',
    dir: typeof task.dir === 'string' ? task.dir : '',
    files,
    ...(typeof task.infoHash === 'string' ? { infoHash: task.infoHash } : {}),
    ...(typeof task.errorCode === 'string' ? { errorCode: task.errorCode } : {}),
    ...(typeof task.errorMessage === 'string' ? { errorMessage: task.errorMessage } : {})
  }
}

/** 导入目录只接受本机绝对路径（拒绝 UNC/相对路径），避免把任意网络位置写进任务 */
function isSafeImportDir(dir: unknown): dir is string {
  if (typeof dir !== 'string' || !dir || dir.length > 32768) return false
  if (/^[a-zA-Z]:[\\/]/.test(dir)) return true
  return /^\/(?!\/)/.test(dir)
}


function importTasks() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json'
  input.onchange = async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) return
    try {
      // 导入文件是外部输入：先限大小，避免一次 JSON.parse 卡死渲染进程
      if (file.size > 10 * 1024 * 1024) {
        message.error(t('task.importTooLarge'))
        return
      }
      const text = await file.text()
      const parsed = JSON.parse(text)
      // 兼容旧格式（纯数组）和新格式（{ version, type, tasks }）
      const rawData: unknown = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>).tasks : null)
      if (!Array.isArray(rawData) || rawData.length === 0 || rawData.length > 5000) {
        message.error(t('task.importFailed'))
        return
      }
      const data = rawData as Array<Record<string, unknown>>

      // 运行时校验：导入文件是**外部输入**，此前只检查 gid 非空就用 `as unknown as Aria2Task`
      // 直接持久化——坏数据会被永久写进 userData，之后 task.files[0].path 之类的访问会抛
      // TypeError，让"下载完成"页白屏且重启后依旧。这里只放行字段齐备的条目，其余跳过并计数。
      const validTasks = data.filter(isImportableTask)
      const skipped = data.length - validTasks.length
      if (validTasks.length === 0) {
        message.error(t('task.importFailed'))
        return
      }
      if (skipped > 0) {
        message.warning(t('task.importSkipped', { count: skipped }))
      }

      if (props.taskType === 'stopped') {
        // 下载完成页：仅恢复历史记录（写入持久化存储，不重新下载）
        let restored = 0
        for (const task of validTasks) {
          const gid = String(task.gid || '')
          if (!gid) continue
          if (taskPersistenceService.isTaskPersisted(gid)) continue
          const completedAt = Number(task.completedAt) || taskTimeService.getCompleteTime(gid) || Date.now()
          taskPersistenceService.persistCompletedTask(normalizeImportedTask(task), completedAt)
          taskTimeService.recordTaskComplete(gid, String(task.fileName || ''))
          restored++
        }
        if (restored > 0) {
          message.success(t('task.importRestored', { count: restored }))
          await taskStore.loadAllTasks()
        } else {
          message.warning(t('task.importNoTasks'))
        }
      } else {
        // 下载任务页：提取 URI 重新创建下载任务
        let imported = 0
        for (const task of validTasks) {
          const uris = (task.files as Array<{ uris?: Array<{ uri: string }> }> | undefined)
            ?.flatMap(f => f.uris?.map(u => u.uri) || []).filter(Boolean)
          if (uris && uris.length > 0) {
            try {
              const options: Record<string, string> = {}
              if (isSafeImportDir(task.dir)) options.dir = task.dir
              await taskStore.addUri(uris, options)
              imported++
            } catch {
              // 跳过导入失败的任务
            }
          }
        }
        if (imported > 0) {
          message.success(t('task.importSuccess', { count: imported }))
        } else {
          message.warning(t('task.importNoTasks'))
        }
      }
    } catch {
      message.error(t('task.importFailed'))
    }
  }
  input.click()
}

// 监听任务数据变化，更新选中任务的数据
// （filteredTasks 是每次返回新数组的 computed，浅层监听即可，deep 会每秒递归比较全量任务属性）
// immediate: 挂载时立即同步一次，处理"选中任务在离开页面期间被删除"的情况
watch(
  filteredTasks,
  (newTasks) => {
    updateSelectedTasksData(newTasks)
    const existingGids = newTasks.map(task => task.gid)
    cleanupNonExistentTasks(existingGids)
  },
  { immediate: true }
)
</script>

<style scoped>
.task-list {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.task-surface {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-primary);
  border: 1px solid var(--border-light);
  border-radius: 10px;
  box-shadow: var(--shadow-light);
  transition: background-color 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease;
}

.task-stats {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text-secondary);
  font-size: 13px;
  white-space: nowrap;
}

.task-list-content {
  flex: 1;
  /* min-height: 0 是 flex 子项能正确收缩、让内部表格 flex-height 生效的关键，否则内容区可能被撑塌/留白 */
  min-height: 0;
  /* flex-height 模式下表格内部自己处理滚动，外层无需滚动，避免双重滚动容器冲突 */
  overflow: hidden;
}

/* 让表格填满容器高度（配合 flex-height），横向滚动条固定在列表底部 */
.task-list-content :deep(.n-data-table) {
  height: 100%;
}

/* 空状态铺满列表区域并居中，避免空列表时横向滚动条残留在中间 */
.task-list-content :deep(.n-data-table-empty) {
  min-height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.task-actions {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  margin: 0;
  padding: 12px 16px;
  background: transparent;
  border-bottom: 1px solid var(--border-light);
  gap: 12px;
  transition: border-color 0.3s ease;
}

.action-left {
  display: flex;
  gap: 12px;
  flex: 1;
  align-items: center;
}

.action-right {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.action-divider {
  height: 32px;
  margin: 0 8px;
}

/* DataTable 列 render 创建的节点不携带 scoped data-v，需用 :deep() 定位 */
:deep(.file-info) {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

:deep(.file-name-row) {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

:deep(.file-name) {
  flex: 0 1 auto;
  min-width: 0;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  /* 单行省略：保证每行内容高度恒定（配合 virtual-scroll 的 min-row-height=60），
     长文件名换行会撑高行导致虚拟滚动可视区错位/空白，全名通过 title 悬浮提示展示 */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.4;
}

:deep(.file-type-icon) {
  flex-shrink: 0;
  color: var(--text-secondary);
  display: inline-flex;
  /* 图标字形在 16px 方框内偏上，与 13px 文字的光学中心差约 1px，向下微调对齐 */
  transform: translateY(1px);
}

/* 下载路径使用等宽字体与弱化颜色，与文件名明显区分 */
:deep(.file-path) {
  /* 与文件名文字左边缘对齐（图标 16px + gap 6px），视觉上从属于上一行 */
  padding-left: 22px;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 11px;
  color: var(--text-secondary);
  opacity: 0.85;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 统一现代化操作按钮：圆角、语义色光晕、悬停轻微浮起（与全局按钮风格一致） */
:deep(.app-action-btn) {
  height: 30px;
  border-radius: 8px;
  font-weight: 500;
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}

:deep(.app-action-btn:hover:not([disabled])) {
  transform: translateY(-1px);
}

:deep(.app-action-btn:active:not([disabled])) {
  transform: translateY(0);
}

.empty-hint {
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 4px;
}

:deep(.app-action-btn--primary-type) {
  box-shadow: 0 4px 12px color-mix(in srgb, var(--color-primary) 25%, transparent);
}


</style>
