<template>
  <div class="task-list">
    <div class="task-list-header">
      <h2>{{ title }}</h2>
      <div class="task-stats">
        <n-space size="small">
          <span>{{ t('task.totalTasks', { count: allTasks.length }) }}</span>
          <span v-if="filteredTasks.length !== allTasks.length">
            {{ t('task.showingTasks', { count: filteredTasks.length }) }}
          </span>
          <n-tag v-if="taskStats.totalSpeed > 0" type="primary" size="small">
            {{ t('task.totalSpeed') }}: {{ formatSpeed(taskStats.totalSpeed) }}
          </n-tag>
        </n-space>
      </div>
    </div>

    <!-- 操作栏 -->
    <div class="task-actions">
      <div class="action-left">
        <n-button type="primary" class="app-action-btn" @click="uiStore.openNewTask()">
          <template #icon>
            <n-icon><AddOutline /></n-icon>
          </template>
          {{ t('task.newDownload') }}
        </n-button>

        <n-divider vertical class="action-divider" />

        <TaskBatchActions
          :selected-count="selectedCount"
          :has-selection="hasSelection"
          :can-batch-start="canBatchStart"
          :can-batch-pause="canBatchPause"
          @batch-start="batchStart"
          @batch-pause="batchPause"
          @batch-delete="batchDelete"
        />
      </div>

      <div class="action-right">
        <n-input
          v-model:value="searchText"
          :placeholder="t('task.searchPlaceholder')"
          clearable
          style="width: 220px;"
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
        :scroll-x="1200"
        flex-height
        :bordered="false"
        class="task-table"
      >
        <template #empty>
          <n-empty :description="t('task.noTasks')" size="small" />
        </template>
      </n-data-table>
    </div>

    <!-- 批量删除对话框（带文件删除选项） -->
    <DeleteTaskDialog
      v-model="showBatchDeleteDialog"
      :tasks="tasksToDelete"
      :task-name="tasksToDelete.length === 1 ? getTaskDisplayName(tasksToDelete[0]) : undefined"
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
import { AddOutline, SearchOutline, VideocamOutline, MusicalNotesOutline, ImageOutline, ArchiveOutline, DocumentTextOutline, CodeSlashOutline, DocumentOutline } from '@vicons/ionicons5'
import { message, confirm } from '@/utils/feedback'
import { useTaskStore } from '@/stores/taskStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { useUiStore } from '@/stores/uiStore'
import { useTaskSelection } from '@/composables/useTaskSelection'
import { taskTimeService } from '@/services/taskTimeService'
import { completedTaskDeleteService } from '@/services/completedTaskDeleteService'
import TaskCheckbox from '@/components/TaskCheckbox.vue'
import DeleteTaskDialog from '@/components/dialogs/DeleteTaskDialog.vue'
import TaskBatchActions from '@/components/task/TaskBatchActions.vue'
import TaskRowActions from '@/components/task/TaskRowActions.vue'
import type { Aria2Task, Aria2File, Aria2Uri } from '@/types/aria2'
import {
  getTaskStats,
  getTaskName as utilGetTaskName
} from '@/utils/taskUtils'
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
const { t } = useI18n()

// 批量删除对话框状态
const showBatchDeleteDialog = ref(false)
const tasksToDelete = ref<Aria2Task[]>([])
// 批量删除执行中（驱动删除对话框的 loading，删除期间保持对话框打开）
const batchDeleting = ref(false)

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

const title = computed(() => {
  switch (props.taskType) {
    case 'active': return t('task.downloading')
    case 'waiting': return t('task.waiting')
    case 'stopped': return t('task.stopped')
    case 'active-and-waiting': return t('task.activeAndWaiting')
    default: return t('task.activeAndWaiting')
  }
})

const allTasks = computed(() => {
  let tasks: Aria2Task[] = []

  switch (props.taskType) {
    case 'active':
      tasks = [...taskStore.activeTasks]
      break
    case 'waiting':
      tasks = [...taskStore.waitingTasks]
      break
    case 'stopped':
      // 已停止列表只展示已完成任务，失败/错误任务归入下载任务列表
      tasks = taskStore.stoppedTasks.filter(task => task.status !== 'error')
      break
    case 'active-and-waiting':
      // 下载任务列表：正在下载 + 等待 + 失败/错误（方便点击重试）
      tasks = [
        ...taskStore.activeTasks,
        ...taskStore.waitingTasks,
        ...taskStore.stoppedTasks.filter(task => task.status === 'error')
      ]
      break
    default:
      return []
  }

  // 按状态和添加时间排序
  return sortTasksByStatus(tasks)
})

// GID 为 16 位十六进制数，BigInt 比较避免超出 Number 安全整数精度丢失
// 格式异常时回退为 0，避免整个列表排序崩溃
function parseGid(gid: string): bigint {
  try {
    return BigInt(`0x${gid}`)
  } catch {
    return 0n
  }
}

function compareGidDesc(a: Aria2Task, b: Aria2Task): number {
  const diff = parseGid(b.gid) - parseGid(a.gid)
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

// 排序和过滤后的任务
const filteredTasks = computed(() => {
  let tasks = [...allTasks.value]

  // 搜索过滤
  if (searchText.value.trim()) {
    const searchTerm = searchText.value.toLowerCase().trim()
    tasks = tasks.filter((task: Aria2Task) => {
      const taskName = utilGetTaskName(task).toLowerCase()
      if (taskName.includes(searchTerm)) return true

      if (task.files && task.files.length > 0) {
        const hasMatchingFile = task.files.some((file: Aria2File) =>
          file.path && file.path.toLowerCase().includes(searchTerm)
        )
        if (hasMatchingFile) return true

        const hasMatchingUri = task.files.some((file: Aria2File) =>
          file.uris && file.uris.some((uri: Aria2Uri) =>
            uri.uri && uri.uri.toLowerCase().includes(searchTerm)
          )
        )
        if (hasMatchingUri) return true
      }

      if (task.gid.toLowerCase().includes(searchTerm)) return true

      return false
    })
  }

  // 根据任务类型设置不同的排序规则
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

// 表头全选复选框状态
const allChecked = computed(() =>
  filteredTasks.value.length > 0 && filteredTasks.value.every(t => selectedTaskGids.value.has(t.gid))
)
const indeterminate = computed(() => {
  const selected = filteredTasks.value.filter(t => selectedTaskGids.value.has(t.gid))
  return selected.length > 0 && selected.length < filteredTasks.value.length
})

function handleSelectAllChange(checked: boolean) {
  if (checked) {
    selectAll(filteredTasks.value)
  } else {
    clearSelection()
  }
}

// 获取任务名称
function getTaskName(task: Aria2Task): string {
  return utilGetTaskName(task)
}

// 获取文件类型图标（基于文件扩展名）
function getFileTypeIcon(task: Aria2Task): Component {
  const name = getTaskName(task).toLowerCase()
  const ext = name.split('.').pop() || ''

  // 视频
  if (['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'ts', 'm4v', '3gp'].includes(ext)) {
    return VideocamOutline
  }
  // 音频
  if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a', 'opus'].includes(ext)) {
    return MusicalNotesOutline
  }
  // 图片
  if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tiff', 'psd'].includes(ext)) {
    return ImageOutline
  }
  // 压缩包
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso'].includes(ext)) {
    return ArchiveOutline
  }
  // 文档
  if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'csv'].includes(ext)) {
    return DocumentTextOutline
  }
  // 代码
  if (['js', 'ts', 'py', 'java', 'cpp', 'c', 'h', 'css', 'html', 'vue', 'json', 'xml', 'yaml', 'yml', 'sh', 'bat', 'go', 'rs', 'php', 'rb'].includes(ext)) {
    return CodeSlashOutline
  }
  // 默认
  return DocumentOutline
}

// 格式化完成时间标签
function formatCompleteTimeLabel(task: Aria2Task): string {
  const completeTime = taskTimeService.getCompleteTime(task.gid)
  return completeTime ? formatCompleteTime(completeTime) : '--'
}

// ── 表格列定义 ──

const columns = computed<DataTableColumns<Aria2Task>>(() => [
  {
    key: 'selection',
    width: 55,
    fixed: 'left',
    title: () =>
      h(NCheckbox, {
        checked: allChecked.value,
        indeterminate: indeterminate.value,
        'onUpdate:checked': handleSelectAllChange,
        'aria-label': t('task.selectAll')
      }),
    render: (row: Aria2Task) => h(TaskCheckbox, { task: row })
  },
  {
    key: 'gid',
    title: t('task.gid'),
    width: 120
  },
  {
    key: 'name',
    title: t('task.fileName'),
    width: 280,
    render: (row: Aria2Task) => {
      const name = getTaskName(row)
      return h('div', { class: 'file-info' }, [
        h('div', { class: 'file-name-row' }, [
          h('span', { class: 'file-name', title: name }, name),
          h(NIcon, { class: 'file-type-icon', size: 14 }, { default: () => h(getFileTypeIcon(row)) })
        ]),
        row.dir ? h('div', { class: 'file-path', title: row.dir }, row.dir) : null
      ])
    }
  },
  {
    key: 'size',
    title: t('task.size'),
    width: 100,
    render: (row: Aria2Task) => formatSize(row.totalLength)
  },
  {
    key: 'progress',
    title: t('task.progress'),
    width: 140,
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
    width: 130,
    render: (row: Aria2Task) =>
      h(NTag, { type: getStatusType(row.status), size: 'small' }, { default: () => t('status.' + row.status) })
  },
  {
    key: 'downloadSpeed',
    title: t('task.downloadSpeed'),
    width: 120,
    render: (row: Aria2Task) => formatSpeed(row.downloadSpeed)
  },
  props.taskType === 'stopped'
    ? {
      key: 'completeTime',
      title: t('task.completeTime'),
      width: 150,
      render: (row: Aria2Task) => formatCompleteTimeLabel(row)
    }
    : {
      key: 'remainingTime',
      title: t('task.remainingTime'),
      width: 120,
      render: (row: Aria2Task) => formatRemainingTime(row)
    },
  {
    key: 'actions',
    title: t('task.actions'),
    width: 200,
    fixed: 'right',
    align: 'center',
    render: (row: Aria2Task) =>
      h(TaskRowActions, {
        gid: row.gid,
        status: row.status,
        operating: operatingTasks.value.has(row.gid),
        showOpenLocation: props.taskType === 'stopped',
        task: row,
        onUnpause: unpauseTask,
        onRetry: retryTask,
        onPause: pauseTask,
        'onOpen-location': (task: Aria2Task) => openTaskLocation(task),
        onRemove: removeTask,
        'onView-detail': viewTaskDetail
      })
  }
])

// 行点击选择任务
function rowProps(row: Aria2Task) {
  return {
    onClick: () => handleRowSelect(row)
  }
}

// ── 单任务操作 ──

async function pauseTask(gid: string) {
  if (operatingTasks.value.has(gid)) return

  operatingTasks.value.add(gid)

  try {
    await taskStore.pauseTask(gid, true)
    message.success(t('task.taskPaused'))
  } catch (error: unknown) {
    console.error('暂停任务失败:', error)
    message.error(t('task.pauseFailed', { error: (error as Error).message || error }))
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
    message.error(t('task.startFailed', { error: (error as Error).message || error }))
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
    message.error(t('task.retryFailed', { error: (error as Error).message || error }))
    await taskStore.loadAllTasks()
  } finally {
    operatingTasks.value.delete(gid)
  }
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
        if (firstFile.path) {
          result = await window.electronAPI.openInExplorer(firstFile.path)
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
      if (firstFile.path) {
        result = await window.electronAPI.showItemInFolder(firstFile.path)
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

// ── 批量操作 ──

async function batchStart() {
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
    message.error(t('task.startFailed', { error: '' }))
  }
}

async function batchPause() {
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
    message.error(t('task.pauseFailed', { error: '' }))
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

.task-list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.task-list-header h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}

.task-stats {
  color: var(--text-secondary);
  font-size: 14px;
}

.task-list-content {
  flex: 1;
  overflow: auto;
  background: var(--bg-primary);
  border: 1px solid var(--border-light);
  border-radius: 8px;
  box-shadow: var(--shadow-light);
  transition: background-color 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease;
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 16px 0;
  padding: 16px;
  background: var(--bg-primary);
  border: 1px solid var(--border-light);
  border-radius: 8px;
  box-shadow: var(--shadow-light);
  gap: 16px;
  transition: background-color 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease;
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
  gap: 12px;
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
  align-items: flex-start;
  gap: 6px;
  min-width: 0;
}

:deep(.file-name) {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  word-break: break-all;
  line-height: 1.4;
}

:deep(.file-type-icon) {
  flex-shrink: 0;
  color: var(--text-secondary);
  display: inline-flex;
}

/* 下载路径使用等宽字体与弱化颜色，与文件名明显区分 */
:deep(.file-path) {
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

:deep(.app-action-btn--primary-type) {
  box-shadow: 0 4px 12px color-mix(in srgb, var(--color-primary) 25%, transparent);
}


</style>
