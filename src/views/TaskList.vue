<template>
  <div class="task-list">
    <div class="task-list-header">
      <h2>{{ title }}</h2>
      <div class="task-stats">
        <el-space>
          <span>{{ t('task.totalTasks', { count: allTasks.length }) }}</span>
          <span v-if="filteredTasks.length !== allTasks.length">
            {{ t('task.showingTasks', { count: filteredTasks.length }) }}
          </span>
          <el-tag v-if="taskStats.totalSpeed > 0" type="primary" size="small">
            {{ t('task.totalSpeed') }}: {{ formatSpeed(taskStats.totalSpeed) }}
          </el-tag>
        </el-space>
      </div>
    </div>

    <!-- 操作栏 -->
    <div class="task-actions">
      <div class="action-left">
        <el-button size="default" type="primary" @click="$router.push('/new')">
          <el-icon><Plus /></el-icon>
          {{ t('task.newDownload') }}
        </el-button>

        <el-divider direction="vertical" class="action-divider" />

        <TaskBatchActions
          :selected-count="selectedCount"
          :has-selection="hasSelection"
          :can-batch-start="canBatchStart"
          :can-batch-pause="canBatchPause"
          :total-count="filteredTasks.length"
          @select-all="selectAllTasks"
          @batch-start="batchStart"
          @batch-pause="batchPause"
          @batch-delete="batchDelete"
          @clear-selection="clearSelection"
        />
      </div>

      <div class="action-right">
        <div class="search-box">
          <el-input
            v-model="searchText"
            :placeholder="t('task.searchPlaceholder')"
            :prefix-icon="Search"
            clearable
            style="width: 200px;"
            @input="handleSearch"
          />
        </div>
      </div>
    </div>

    <div class="task-list-content">
      <el-table
        ref="tableRef"
        v-loading="loading"
        :data="filteredTasks"
        style="width: 100%"
        empty-text=""
        class="task-table"
        row-key="gid"
        @row-click="handleRowSelect"
      >
        <el-table-column width="55" fixed="left" label="">
          <template #default="{ row }">
            <TaskCheckbox :task="row" />
          </template>
        </el-table-column>

        <el-table-column prop="gid" :label="t('task.gid')" width="120" />

        <el-table-column :label="t('task.fileName')" min-width="200">
          <template #default="{ row }">
            <div class="file-info">
              <div class="file-name">{{ getTaskName(row) }}</div>
              <div v-if="row.dir" class="file-path">{{ row.dir }}</div>
            </div>
          </template>
        </el-table-column>

        <el-table-column :label="t('task.size')" width="100">
          <template #default="{ row }">
            {{ formatSize(row.totalLength) }}
          </template>
        </el-table-column>

        <el-table-column :label="t('task.progress')" width="120">
          <template #default="{ row }">
            <el-progress
              :percentage="getProgress(row)"
              :status="getProgressStatus(row)"
              :stroke-width="6"
            />
          </template>
        </el-table-column>

        <el-table-column :label="t('task.status')" width="120">
          <template #default="{ row }">
            <div class="status-column">
              <el-tag :type="getStatusType(row.status)" size="small">
                {{ t('status.' + row.status) }}
              </el-tag>
              <el-icon v-if="row.status === 'active'" class="status-icon active">
                <VideoPlay />
              </el-icon>
              <el-icon v-else-if="row.status === 'waiting'" class="status-icon waiting">
                <Clock />
              </el-icon>
            </div>
          </template>
        </el-table-column>

        <el-table-column :label="t('task.downloadSpeed')" width="120">
          <template #default="{ row }">
            {{ formatSpeed(row.downloadSpeed) }}
          </template>
        </el-table-column>

        <el-table-column v-if="taskType === 'stopped'" :label="t('task.completeTime')" width="150">
          <template #default="{ row }">
            {{ formatCompleteTimeLabel(row) }}
          </template>
        </el-table-column>

        <el-table-column v-else :label="t('task.remainingTime')" width="120">
          <template #default="{ row }">
            {{ formatRemainingTime(row) }}
          </template>
        </el-table-column>

        <el-table-column :label="t('task.actions')" width="200" fixed="right" align="center" header-align="center">
          <template #default="{ row }">
            <TaskRowActions
              :gid="row.gid"
              :status="row.status"
              :operating="operatingTasks.has(row.gid)"
              :show-open-location="taskType === 'stopped'"
              :task="row"
              @unpause="unpauseTask"
              @retry="retryTask"
              @pause="pauseTask"
              @open-location="openTaskLocation"
              @remove="removeTask"
              @view-detail="viewTaskDetail"
            />
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 批量删除对话框（带文件删除选项） -->
    <DeleteTaskDialog
      v-model="showBatchDeleteDialog"
      :tasks="tasksToDelete"
      :task-name="tasksToDelete.length === 1 ? getTaskDisplayName(tasksToDelete[0]) : undefined"
      :task-type="taskType"
      @confirm="handleBatchDeleteConfirm"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import { VideoPlay, Clock, Search, Plus } from '@element-plus/icons-vue'
import { useTaskStore } from '@/stores/taskStore'
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
  getProgressStatus,
  getStatusType,
  getTaskDisplayName,
  formatCompleteTime
} from '@/utils/taskFormatters'

interface Props {
  taskType: 'active' | 'waiting' | 'stopped' | 'active-and-waiting'
}

const props = defineProps<Props>()
const taskStore = useTaskStore()
const router = useRouter()
const { t } = useI18n()

// 批量删除对话框状态
const showBatchDeleteDialog = ref(false)
const tasksToDelete = ref<Aria2Task[]>([])

// 操作锁定状态
const operatingTasks = ref<Set<string>>(new Set())

// 表格引用
const tableRef = ref()

// 使用独立的选择状态管理
const {
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
      tasks = [...taskStore.stoppedTasks]
      break
    case 'active-and-waiting':
      tasks = [...taskStore.activeTasks, ...taskStore.waitingTasks]
      break
    default:
      return []
  }

  // 按状态和添加时间排序
  return sortTasksByStatus(tasks)
})

// 排序任务：error > active > waiting > paused，同状态按添加时间倒序
function sortTasksByStatus(tasks: Aria2Task[]): Aria2Task[] {
  const statusPriority: Record<string, number> = { 'error': 4, 'active': 3, 'waiting': 2, 'paused': 1 }
  return tasks.sort((a, b) => {
    const aPriority = statusPriority[a.status] || 0
    const bPriority = statusPriority[b.status] || 0
    if (aPriority !== bPriority) return bPriority - aPriority
    return parseInt(b.gid, 16) - parseInt(a.gid, 16)
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
      return parseInt(b.gid, 16) - parseInt(a.gid, 16)
    })
  }

  return sortTasksByStatus(tasks)
})

// 任务统计
const taskStats = computed(() => getTaskStats(filteredTasks.value))

// 获取任务名称
function getTaskName(task: Aria2Task): string {
  return utilGetTaskName(task)
}

// 格式化完成时间标签
function formatCompleteTimeLabel(task: Aria2Task): string {
  const completeTime = taskTimeService.getCompleteTime(task.gid)
  return completeTime ? formatCompleteTime(completeTime) : '--'
}

// ── 单任务操作 ──

async function pauseTask(gid: string) {
  if (operatingTasks.value.has(gid)) return

  operatingTasks.value.add(gid)

  try {
    // 乐观更新
    const task = filteredTasks.value.find(t => t.gid === gid)
    if (task) {
      task.status = 'paused'
      task.downloadSpeed = '0'
    }

    await taskStore.pauseTask(gid, true)
    ElMessage.success(t('task.taskPaused'))

    setTimeout(async () => {
      await taskStore.loadAllTasks()
    }, 1000)
  } catch (error: unknown) {
    console.error('暂停任务失败:', error)
    ElMessage.error(t('task.pauseFailed', { error: (error as Error).message || error }))
    await taskStore.loadAllTasks()
  } finally {
    operatingTasks.value.delete(gid)
  }
}

async function unpauseTask(gid: string) {
  if (operatingTasks.value.has(gid)) return

  operatingTasks.value.add(gid)

  try {
    // 乐观更新
    const task = filteredTasks.value.find(t => t.gid === gid)
    if (task) {
      task.status = 'active'
    }

    await taskStore.unpauseTask(gid)
    ElMessage.success(t('task.taskStarted'))

    setTimeout(async () => {
      await taskStore.loadAllTasks()
    }, 1000)
  } catch (error: unknown) {
    console.error('开始任务失败:', error)
    ElMessage.error(t('task.startFailed', { error: (error as Error).message || error }))
    await taskStore.loadAllTasks()
  } finally {
    operatingTasks.value.delete(gid)
  }
}

async function retryTask(gid: string) {
  if (operatingTasks.value.has(gid)) return

  operatingTasks.value.add(gid)

  try {
    // 乐观更新
    const task = filteredTasks.value.find(t => t.gid === gid)
    if (task) {
      task.status = 'active'
    }

    await taskStore.retryErrorTask(gid)
    ElMessage.success(t('task.taskRetried'))
    await taskStore.loadAllTasks()
  } catch (error: unknown) {
    console.error('重试任务失败:', error)
    ElMessage.error(t('task.retryFailed', { error: (error as Error).message || error }))
    await taskStore.loadAllTasks()
  } finally {
    operatingTasks.value.delete(gid)
  }
}

async function removeTask(gid: string) {
  try {
    const task = filteredTasks.value.find(t => t.gid === gid)
    if (!task) {
      ElMessage.error(t('task.taskNotExistShort'))
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
      await ElMessageBox.confirm(
        t('delete.confirmSingle'),
        t('delete.title'),
        { confirmButtonText: t('delete.confirm'), cancelButtonText: t('common.cancel'), type: 'warning' }
      )

      if (props.taskType === 'stopped') {
        const result = await completedTaskDeleteService.deleteCompletedTask(task, false)
        await taskStore.loadAllTasks()
        if (result.success) {
          ElMessage.success(t('delete.taskDeleted'))
        } else {
          ElMessage.error(t('task.deleteFailed', { error: result.errors.join(', ') }))
        }
      } else {
        await taskStore.removeTask(gid, false, false)
        ElMessage.success(t('delete.taskDeleted'))
      }
    }
  } catch (error: unknown) {
    if (error !== 'cancel') {
      console.error('删除任务失败:', error)
      ElMessage.error(t('task.deleteTaskFailed'))
    }
  }
}

// 行点击选择任务
function handleRowSelect(row: Aria2Task) {
  toggleTask(row)
}

// 查看任务详情
function viewTaskDetail(gid: string) {
  router.push(`/task/${gid}`)
}

// 打开任务位置
async function openTaskLocation(task: Aria2Task) {
  if (!window.electronAPI) {
    ElMessage.warning(t('task.desktopOnly'))
    return
  }

  if (!task.dir) {
    ElMessage.warning(t('task.noDirInfo'))
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
            ElMessage.success(t('task.openedLocation'))
            return
          }
        }
      }
      result = await window.electronAPI.openInExplorer(task.dir)
      if (result?.success) {
        ElMessage.success(t('task.openedDir'))
        return
      }
    }

    if (task.files && task.files.length > 0) {
      const firstFile = task.files[0]
      if (firstFile.path) {
        result = await window.electronAPI.showItemInFolder(firstFile.path)
        if (result?.success) {
          ElMessage.success(t('task.openedLocation'))
          return
        }
      }
    }

    result = await window.electronAPI.openPath(task.dir)
    if (result?.success) {
      ElMessage.success(t('task.openedDir'))
    } else {
      ElMessage.error(t('task.openDirFailed', { error: result?.error || t('common.unknown') }))
    }
  } catch (error) {
    console.error('Failed to open task location:', error)
    ElMessage.error(t('task.openLocationFailed'))
  }
}

// ── 批量操作 ──

async function batchStart() {
  try {
    const startableTasks = selectedTasks.value.filter(task =>
      task.status === 'paused' || task.status === 'waiting' || task.status === 'error'
    )

    if (startableTasks.length === 0) {
      ElMessage.warning(t('task.noStartableTasks'))
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
    ElMessage.success(t('task.startedCount', { count: startableTasks.length }))
    clearSelection()
  } catch (error) {
    console.error('开始任务失败:', error)
    ElMessage.error(t('task.startFailed', { error: '' }))
  }
}

async function batchPause() {
  try {
    const pausableTasks = selectedTasks.value.filter(task =>
      task.status === 'active' || task.status === 'waiting'
    )

    if (pausableTasks.length === 0) {
      ElMessage.warning(t('task.noPausableTasks'))
      return
    }

    for (const task of pausableTasks) {
      await taskStore.pauseTask(task.gid, true)
    }

    ElMessage.success(t('task.pausedCount', { count: pausableTasks.length }))
    clearSelection()
  } catch (error) {
    console.error('暂停任务失败:', error)
    ElMessage.error(t('task.pauseFailed', { error: '' }))
  }
}

async function batchDelete() {
  try {
    if (selectedCount.value === 0) {
      ElMessage.warning(t('task.selectTasksFirst'))
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
      await ElMessageBox.confirm(
        t('delete.confirmBatch', { count: selectedCount.value }),
        t('delete.title'),
        { confirmButtonText: t('delete.confirm'), cancelButtonText: t('common.cancel'), type: 'warning' }
      )
      await handleBatchDeleteConfirm(false)
    }
  } catch (error) {
    if (error !== 'cancel') {
      console.error('删除任务失败:', error)
      ElMessage.error(t('task.deleteTaskFailed'))
    }
  }
}

// 批量删除确认处理
async function handleBatchDeleteConfirm(deleteFiles: boolean) {
  try {
    showBatchDeleteDialog.value = false

    const tasks = tasksToDelete.value.length > 0 ? tasksToDelete.value : [...selectedTasks.value]

    if (props.taskType === 'stopped') {
      const result = await completedTaskDeleteService.batchDeleteCompletedTasks(tasks, deleteFiles)
      await taskStore.loadAllTasks()

      if (result.successfulTasks === result.totalTasks) {
        let message = t('task.deletedCount', { count: result.successfulTasks })
        if (deleteFiles && result.totalFilesDeleted > 0) {
          message += ` + ${result.totalFilesDeleted} files`
        }
        ElMessage.success(message)
      } else {
        ElMessage.warning(t('task.deletedPartial', { success: result.successfulTasks, total: result.totalTasks }))
        if (result.errors.length > 0) {
          result.errors.slice(0, 3).forEach(error => ElMessage.error(error))
        }
      }
    } else {
      let successCount = 0
      for (const task of tasks) {
        try {
          await taskStore.removeTask(task.gid, false, deleteFiles)
          successCount++
        } catch (error) {
          console.error(`Failed to delete task ${task.gid}:`, error)
        }
      }

      if (successCount === tasks.length) {
        const message = deleteFiles
          ? t('task.deletedCountWithFiles', { count: successCount })
          : t('task.deletedCount', { count: successCount })
        ElMessage.success(message)
      } else {
        ElMessage.warning(t('task.deletedPartial', { success: successCount, total: tasks.length }))
      }
    }

    clearSelection()
    tasksToDelete.value = []
  } catch (error) {
    console.error('删除任务失败:', error)
    ElMessage.error('删除任务失败')
  }
}

// 全选功能
function selectAllTasks() {
  if (filteredTasks.value.length === 0) {
    ElMessage.warning(t('task.noSelectableTasks'))
    return
  }
  selectAll(filteredTasks.value)
  ElMessage.success(t('task.selectedCount', { count: filteredTasks.value.length }))
}

// 搜索处理函数
function handleSearch(_value: string) {
  // 搜索功能通过 computed 属性 filteredTasks 自动处理
}

// 监听任务数据变化，更新选中任务的数据
watch(
  () => filteredTasks.value,
  (newTasks) => {
    updateSelectedTasksData(newTasks)
    const existingGids = newTasks.map(task => task.gid)
    cleanupNonExistentTasks(existingGids)
  },
  { deep: true }
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
}

.task-table :deep(.el-table__row) {
  cursor: pointer;
}

/* 表格行和单元格需要有背景色 */
.task-table :deep(.el-table__body tr),
.task-table :deep(.el-table__body tr > td) {
  background-color: var(--bg-primary) !important;
  transition: background-color 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
}

/* 固定列需要有背景色 */
.task-table :deep(.el-table__fixed-right),
.task-table :deep(.el-table__fixed-left) {
  background-color: var(--bg-primary) !important;
}

.task-table :deep(.el-table__fixed-right .el-table__fixed-body-wrapper),
.task-table :deep(.el-table__fixed-left .el-table__fixed-body-wrapper),
.task-table :deep(.el-table__fixed-right .el-table__body-wrapper),
.task-table :deep(.el-table__fixed-left .el-table__body-wrapper) {
  background-color: var(--bg-primary) !important;
}

.task-table :deep(.el-table__fixed-right .el-table__body tr),
.task-table :deep(.el-table__fixed-right .el-table__body tr > td),
.task-table :deep(.el-table__fixed-left .el-table__body tr),
.task-table :deep(.el-table__fixed-left .el-table__body tr > td) {
  background-color: var(--bg-primary) !important;
  transition: background-color 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
}

/* 悬浮效果 */
.task-table :deep(.el-table__body-wrapper .el-table__body tbody tr:hover td),
.task-table :deep(.el-table__fixed-body-wrapper .el-table__body tbody tr:hover td) {
  background-color: var(--bg-hover) !important;
  transition: background-color 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
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
}

.action-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.search-box {
  display: flex;
  align-items: center;
}

.action-divider {
  height: 32px;
  margin: 0 8px;
}

.file-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.file-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-path {
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-column {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-icon {
  font-size: 14px;
}

.status-icon.active {
  color: var(--color-success);
  animation: pulse 2s infinite;
}

.status-icon.waiting {
  color: var(--color-warning);
}

@keyframes pulse {
  0% { opacity: 1; }
  50% { opacity: 0.5; }
  100% { opacity: 1; }
}
</style>
