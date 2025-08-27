<template>
  <div class="task-list">
    <div class="task-list-header">
      <h2>{{ title }}</h2>
      <div class="task-stats">
        <el-space>
          <span>共 {{ allTasks.length }} 个任务</span>
          <span v-if="filteredTasks.length !== allTasks.length">
            (显示 {{ filteredTasks.length }} 个)
          </span>
          <el-tag v-if="taskStats.totalSpeed > 0" type="primary" size="small">
            总速度: {{ formatSpeed(taskStats.totalSpeed) }}
          </el-tag>
        </el-space>
      </div>
    </div>



    <!-- 操作栏 -->
    <div class="task-actions">
      <div class="action-left">
        <el-button size="default" type="primary" @click="$router.push('/new')">
          <el-icon><Plus /></el-icon>
          新建下载
        </el-button>

        <!-- 操作按钮 -->
        <el-divider direction="vertical" class="action-divider" />
        <div class="batch-actions">
          <div class="action-buttons-group">
            <el-button
              size="default"
              @click="selectAllTasks"
              :disabled="filteredTasks.length === 0"
            >
              <el-icon><Select /></el-icon>
              全选
            </el-button>

            <el-button
              size="default"
              type="primary"
              @click="batchStart"
              :disabled="!canBatchStart"
            >
              <el-icon><VideoPlay /></el-icon>
              开始
            </el-button>

            <el-button
              size="default"
              type="warning"
              @click="batchPause"
              :disabled="!canBatchPause"
            >
              <el-icon><VideoPause /></el-icon>
              暂停
            </el-button>

            <el-button
              size="default"
              type="danger"
              @click="batchDelete"
              :disabled="!hasSelection"
            >
              <el-icon><Delete /></el-icon>
              删除
            </el-button>

            <el-button
              v-if="hasSelection"
              size="default"
              @click="clearSelection"
            >
              取消选择
            </el-button>
          </div>

          <span v-if="hasSelection" class="selected-count">已选择 {{ selectedCount }} 个任务</span>
        </div>
      </div>

      <div class="action-right">
        <div class="search-box">
          <el-input
            v-model="searchText"
            placeholder="搜索任务..."
            :prefix-icon="Search"
            clearable
            @input="handleSearch"
            style="width: 200px;"
          />
        </div>
      </div>
    </div>

    <div class="task-list-content">

      <el-table
        ref="tableRef"
        :data="filteredTasks"
        style="width: 100%"
        @row-click="handleRowSelect"
        v-loading="loading"
        empty-text="没有找到匹配的任务"
        class="task-table"
        row-key="gid"
      >
        <el-table-column width="55" fixed="left" label="">
          <template #default="{ row }">
            <TaskCheckbox :task="row" />
          </template>
        </el-table-column>
        
        <el-table-column prop="gid" label="GID" width="120" />
        
        <el-table-column label="文件名" min-width="200">
          <template #default="{ row }">
            <div class="file-info">
              <div class="file-name">{{ getTaskName(row) }}</div>
              <div class="file-path" v-if="row.dir">{{ row.dir }}</div>
            </div>
          </template>
        </el-table-column>
        
        <el-table-column label="大小" width="100">
          <template #default="{ row }">
            {{ formatSize(row.totalLength) }}
          </template>
        </el-table-column>
        
        <el-table-column label="进度" width="120">
          <template #default="{ row }">
            <el-progress 
              :percentage="getProgress(row)" 
              :status="getProgressStatus(row)"
              :stroke-width="6"
            />
          </template>
        </el-table-column>
        
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <div class="status-column">
              <el-tag :type="getStatusType(row.status)" size="small">
                {{ getStatusText(row.status) }}
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
        
        <el-table-column label="下载速度" width="120">
          <template #default="{ row }">
            {{ formatSpeed(row.downloadSpeed) }}
          </template>
        </el-table-column>

        <el-table-column v-if="taskType === 'stopped'" label="完成时间" width="150">
          <template #default="{ row }">
            {{ formatCompleteTime(row) }}
          </template>
        </el-table-column>

        <el-table-column v-else label="剩余时间" width="120">
          <template #default="{ row }">
            {{ formatRemainingTime(row) }}
          </template>
        </el-table-column>
        
        <el-table-column label="操作" width="200" fixed="right" align="center" header-align="center">
          <template #default="{ row }">
            <div class="action-buttons">
              <button
                v-if="row.status === 'paused'"
                @click.stop="unpauseTask(row.gid)"
                title="开始下载"
                class="task-action-btn"
                :disabled="operatingTasks.has(row.gid)"
              >
                <div v-if="operatingTasks.has(row.gid)" class="loading-spinner"></div>
                <CustomIcon v-else name="start" size="medium" />
              </button>

              <button
                v-else-if="row.status === 'error'"
                @click.stop="retryTask(row.gid)"
                title="重试下载"
                class="task-action-btn"
                :disabled="operatingTasks.has(row.gid)"
              >
                <div v-if="operatingTasks.has(row.gid)" class="loading-spinner"></div>
                <CustomIcon v-else name="start" size="medium" />
              </button>

              <button
                v-else-if="row.status === 'active'"
                @click.stop="pauseTask(row.gid)"
                title="暂停下载"
                class="task-action-btn"
                :disabled="operatingTasks.has(row.gid)"
              >
                <div v-if="operatingTasks.has(row.gid)" class="loading-spinner"></div>
                <CustomIcon v-else name="pause" size="medium" />
              </button>

              <!-- 打开位置按钮 - 仅在已完成任务页面显示 -->
              <button
                v-if="taskType === 'stopped'"
                @click.stop="openTaskLocation(row)"
                title="打开位置"
                class="task-action-btn"
              >
                <CustomIcon name="open" size="medium" />
              </button>

              <button
                @click.stop="removeTask(row.gid)"
                title="删除任务"
                class="task-action-btn"
              >
                <CustomIcon name="delete" size="medium" />
              </button>

              <button
                @click.stop="viewTaskDetail(row.gid)"
                title="查看详情"
                class="task-action-btn"
              >
                <CustomIcon name="detail" size="medium" />
              </button>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 删除确认对话框 -->
    <el-dialog
      v-model="showDeleteDialog"
      title="删除任务"
      width="400px"
      :before-close="handleDeleteDialogClose"
    >
      <div>
        <p>确定要删除这个任务吗？</p>
        <div style="margin-top: 16px;">
          <el-checkbox v-model="deleteFiles">
            同时删除文件
          </el-checkbox>
        </div>
      </div>

      <template #footer>
        <el-button @click="showDeleteDialog = false">取消</el-button>
        <el-button type="danger" @click="confirmDelete">删除</el-button>
      </template>
    </el-dialog>

    <!-- 新的删除对话框 -->
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
import { computed, ref, h, nextTick, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { VideoPlay, VideoPause, Clock, Plus, Select, Delete, Search } from '@element-plus/icons-vue'
import { useAria2Store } from '@/stores/aria2Store'
import { useTaskSelection } from '@/composables/useTaskSelection'
import { taskTimeService } from '@/services/taskTimeService'
import { completedTaskDeleteService } from '@/services/completedTaskDeleteService'
import TaskCheckbox from '@/components/TaskCheckbox.vue'
import CustomIcon from '@/components/CustomIcon.vue'
import DeleteTaskDialog from '@/components/dialogs/DeleteTaskDialog.vue'
import type { Aria2Task } from '@/types/aria2'
import {
  getTaskStats,
  formatSpeed as utilFormatSpeed,
  formatTime,
  getTaskRemainingTime
} from '@/utils/taskUtils'

interface Props {
  taskType: 'active' | 'waiting' | 'stopped' | 'active-and-waiting'
}

const props = defineProps<Props>()
const aria2Store = useAria2Store()
const router = useRouter()

// 删除对话框相关状态
const showDeleteDialog = ref(false)
const currentDeleteGid = ref('')
const deleteFiles = ref(false)

// 新的批量删除对话框状态
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
    case 'active': return '正在下载'
    case 'waiting': return '等待中'
    case 'stopped': return '下载完成'
    case 'active-and-waiting': return '下载任务'
    default: return '任务列表'
  }
})

const allTasks = computed(() => {
  let tasks: any[] = []

  switch (props.taskType) {
    case 'active':
      tasks = [...aria2Store.activeTasks]
      break
    case 'waiting':
      tasks = [...aria2Store.waitingTasks]
      break
    case 'stopped':
      tasks = [...aria2Store.stoppedTasks]
      break
    case 'active-and-waiting':
      // 合并正在下载和等待中的任务，按状态和下载顺序排序
      tasks = [...aria2Store.activeTasks, ...aria2Store.waitingTasks]
      break
    default:
      return []
  }

  // 按状态和添加时间排序：error > active > waiting > paused，然后按添加时间倒序
  return tasks.sort((a, b) => {
    // 状态优先级
    const statusPriority = { 'error': 4, 'active': 3, 'waiting': 2, 'paused': 1 }
    const aPriority = statusPriority[a.status] || 0
    const bPriority = statusPriority[b.status] || 0

    if (aPriority !== bPriority) {
      return bPriority - aPriority // 降序，error 在最前面
    }

    // 状态相同时，按添加时间排序（最新的在前）
    return parseInt(b.gid, 16) - parseInt(a.gid, 16)
  })
})

// 排序和过滤后的任务
const filteredTasks = computed(() => {
  let tasks = [...allTasks.value]

  // 搜索过滤
  if (searchText.value.trim()) {
    const searchTerm = searchText.value.toLowerCase().trim()
    tasks = tasks.filter(task => {
      // 搜索任务名称
      const taskName = getTaskName(task).toLowerCase()
      if (taskName.includes(searchTerm)) return true

      // 搜索文件路径
      if (task.files && task.files.length > 0) {
        const hasMatchingFile = task.files.some(file =>
          file.path && file.path.toLowerCase().includes(searchTerm)
        )
        if (hasMatchingFile) return true
      }

      // 搜索下载链接
      if (task.files && task.files.length > 0) {
        const hasMatchingUri = task.files.some(file =>
          file.uris && file.uris.some(uri =>
            uri.uri && uri.uri.toLowerCase().includes(searchTerm)
          )
        )
        if (hasMatchingUri) return true
      }

      // 搜索GID
      if (task.gid.toLowerCase().includes(searchTerm)) return true

      return false
    })
  }

  // 根据任务类型设置不同的排序规则
  if (props.taskType === 'stopped') {
    // 已完成任务：按完成时间降序排序（最近完成的在前）
    return tasks.sort((a, b) => {
      // 优先使用本地记录的完成时间
      const aCompleteTime = taskTimeService.getCompleteTime(a.gid)
      const bCompleteTime = taskTimeService.getCompleteTime(b.gid)

      if (aCompleteTime && bCompleteTime) {
        return bCompleteTime - aCompleteTime // 降序，最近完成的在前
      }

      // 如果只有一个有完成时间，有完成时间的排在前面
      if (aCompleteTime && !bCompleteTime) return -1
      if (!aCompleteTime && bCompleteTime) return 1

      // 都没有完成时间，使用 GID 作为时间参考
      return parseInt(b.gid, 16) - parseInt(a.gid, 16)
    })
  } else {
    // 下载任务：错误任务排在最前面，然后是下载中的任务
    return tasks.sort((a, b) => {
      // 状态优先级：error > active > waiting > paused
      const statusPriority = { 'error': 4, 'active': 3, 'waiting': 2, 'paused': 1 }
      const aPriority = statusPriority[a.status] || 0
      const bPriority = statusPriority[b.status] || 0

      if (aPriority !== bPriority) {
        return bPriority - aPriority // 降序，error 在最前面
      }

      // 状态相同时，按添加时间排序（最新的在前）
      return parseInt(b.gid, 16) - parseInt(a.gid, 16)
    })
  }
})

// 批量操作的计算属性已移至 useTaskSelection

// 任务统计
const taskStats = computed(() => {
  return getTaskStats(filteredTasks.value)
})

// 获取任务名称的辅助函数
function getTaskName(task: Aria2Task): string {
  if (task.files && task.files.length > 0) {
    const fileName = task.files[0].path.split('/').pop() || task.files[0].path
    return fileName
  }
  return task.gid
}

function formatSize(bytes: string): string {
  const size = parseInt(bytes)
  if (size === 0) return '0 B'
  
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(size) / Math.log(k))
  
  return parseFloat((size / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function formatSpeed(speed: string): string {
  return utilFormatSpeed(parseInt(speed))
}

function formatRemainingTime(task: Aria2Task): string {
  const remainingSeconds = getTaskRemainingTime(task)
  return formatTime(remainingSeconds)
}

// 获取任务显示名称的辅助函数
function getTaskDisplayName(task: Aria2Task): string {
  if (task.bittorrent?.info?.name) {
    return task.bittorrent.info.name
  }

  if (task.files && task.files.length > 0) {
    const file = task.files[0]
    const path = file.path
    return path.split('/').pop() || path.split('\\').pop() || 'Unknown'
  }

  return `Task ${task.gid}`
}

function formatCompleteTime(task: Aria2Task): string {
  const completeTime = taskTimeService.getCompleteTime(task.gid)
  if (completeTime) {
    const date = new Date(completeTime)
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const taskDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())

    // 如果是今天，只显示时间
    if (taskDate.getTime() === today.getTime()) {
      return date.toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
    }

    // 如果是昨天
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)
    if (taskDate.getTime() === yesterday.getTime()) {
      return '昨天 ' + date.toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit'
      })
    }

    // 如果是今年，显示月日和时间
    if (date.getFullYear() === now.getFullYear()) {
      return date.toLocaleDateString('zh-CN', {
        month: '2-digit',
        day: '2-digit'
      }) + ' ' + date.toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit'
      })
    }

    // 其他情况显示完整日期和时间
    return date.toLocaleDateString('zh-CN') + ' ' + date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  return '--'
}

// 移除过滤器功能，使用简单的默认排序

// 行点击处理
function handleRowClick(row: Aria2Task) {
  // 跳转到任务详情页面
  router.push(`/task/${row.gid}`)
}

function getProgress(task: Aria2Task): number {
  const total = parseInt(task.totalLength)
  const completed = parseInt(task.completedLength)
  
  if (total === 0) return 0
  return Math.round((completed / total) * 100)
}

function getProgressStatus(task: Aria2Task): string {
  switch (task.status) {
    case 'complete': return 'success'
    case 'error': return 'exception'
    case 'active': return ''
    default: return ''
  }
}

function getStatusType(status: string): string {
  switch (status) {
    case 'active': return 'primary'
    case 'waiting': return 'warning'
    case 'paused': return 'info'
    case 'complete': return 'success'
    case 'error': return 'danger'
    default: return ''
  }
}

function getStatusText(status: string): string {
  switch (status) {
    case 'active': return '下载中'
    case 'waiting': return '等待中'
    case 'paused': return '已暂停'
    case 'complete': return '已完成'
    case 'error': return '错误'
    case 'removed': return '已删除'
    default: return status
  }
}

async function pauseTask(gid: string) {
  // 检查是否正在操作
  if (operatingTasks.value.has(gid)) {
    console.log('Task is already being operated:', gid)
    return
  }

  // 添加操作锁
  operatingTasks.value.add(gid)

  try {
    console.log('Pausing task:', gid)

    // 立即更新本地显示状态（乐观更新）
    const task = filteredTasks.value.find(t => t.gid === gid)
    if (task) {
      task.status = 'paused'
      task.downloadSpeed = '0'
    }

    // 执行暂停操作
    await aria2Store.pauseTask(gid, true)
    ElMessage.success('任务已暂停')

    // 延迟刷新确保服务器状态同步
    setTimeout(async () => {
      await aria2Store.loadAllTasks()
    }, 1000)

  } catch (error) {
    console.error('暂停任务失败:', error)
    ElMessage.error(`暂停任务失败: ${error.message || error}`)

    // 如果操作失败，恢复原始状态
    await aria2Store.loadAllTasks()
  } finally {
    // 移除操作锁
    operatingTasks.value.delete(gid)
  }
}

async function unpauseTask(gid: string) {
  // 检查是否正在操作
  if (operatingTasks.value.has(gid)) {
    console.log('Task is already being operated:', gid)
    return
  }

  // 添加操作锁
  operatingTasks.value.add(gid)

  try {
    console.log('Starting task:', gid)

    // 立即更新本地显示状态（乐观更新）
    const task = filteredTasks.value.find(t => t.gid === gid)
    if (task) {
      task.status = 'active'
    }

    // 执行开始操作
    await aria2Store.unpauseTask(gid)
    ElMessage.success('任务已开始')

    // 延迟刷新确保服务器状态同步
    setTimeout(async () => {
      await aria2Store.loadAllTasks()
    }, 1000)

  } catch (error) {
    console.error('开始任务失败:', error)
    ElMessage.error(`开始任务失败: ${error.message || error}`)

    // 如果操作失败，恢复原始状态
    await aria2Store.loadAllTasks()
  } finally {
    // 移除操作锁
    operatingTasks.value.delete(gid)
  }
}

async function retryTask(gid: string) {
  // 检查是否正在操作
  if (operatingTasks.value.has(gid)) {
    console.log('Task is already being operated:', gid)
    return
  }

  // 添加操作锁
  operatingTasks.value.add(gid)

  try {
    console.log('Retrying task:', gid)

    // 立即更新本地显示状态（乐观更新）
    const task = filteredTasks.value.find(t => t.gid === gid)
    if (task) {
      task.status = 'active'
    }

    // 执行重试操作
    const newGid = await aria2Store.retryErrorTask(gid)
    ElMessage.success('任务重试成功')

    console.log('Task retried with new GID:', newGid)

    // 立即刷新任务列表（retryErrorTask 内部已经刷新了，但为了确保界面同步再刷新一次）
    await aria2Store.loadAllTasks()

  } catch (error) {
    console.error('重试任务失败:', error)
    ElMessage.error(`重试任务失败: ${error.message || error}`)

    // 如果操作失败，恢复原始状态
    await aria2Store.loadAllTasks()
  } finally {
    // 移除操作锁
    operatingTasks.value.delete(gid)
  }
}

async function removeTask(gid: string) {
  try {
    const task = filteredTasks.value.find(t => t.gid === gid)
    if (!task) {
      ElMessage.error('任务不存在')
      return
    }

    console.log(`Removing single task ${gid}, taskType: ${props.taskType}`)

    // 检查是否在 Electron 环境中且有文件可删除
    const isElectron = !!window.electronAPI?.deleteFiles
    let hasFiles = false

    if (props.taskType === 'stopped') {
      // 已完成任务使用专门的服务检查文件
      hasFiles = completedTaskDeleteService.hasDeleteableFiles(task)
      console.log(`Completed task ${gid} has deleteable files: ${hasFiles}`)
    } else {
      // 其他任务使用原有逻辑
      hasFiles = task.files && task.files.length > 0 &&
        task.files.some(file => file.path && file.path.trim())
      console.log(`Active/waiting task ${gid} has files: ${hasFiles}`)
    }

    if (isElectron && hasFiles) {
      // 使用自定义删除对话框
      tasksToDelete.value = [task]
      showBatchDeleteDialog.value = true
    } else {
      // 使用简单确认对话框
      await ElMessageBox.confirm(
        '确定要删除这个任务吗？',
        '删除任务',
        {
          confirmButtonText: '删除',
          cancelButtonText: '取消',
          type: 'warning'
        }
      )

      if (props.taskType === 'stopped') {
        // 已完成任务使用专门的删除服务
        const result = await completedTaskDeleteService.deleteCompletedTask(task, false)
        await aria2Store.loadAllTasks()

        if (result.success) {
          ElMessage.success('任务已删除')
        } else {
          ElMessage.error(`删除失败: ${result.errors.join(', ')}`)
        }
      } else {
        // 其他任务使用原有逻辑
        await aria2Store.removeTask(gid, false, false)
        ElMessage.success('任务已删除')
      }
    }
  } catch (error) {
    if (error !== 'cancel') {
      console.error('删除任务失败:', error)
      ElMessage.error('删除任务失败')
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
async function openTaskLocation(task: any) {
  if (!window.electronAPI) {
    ElMessage.warning('此功能仅在桌面版中可用')
    return
  }

  if (!task.dir) {
    ElMessage.warning('没有找到文件目录信息')
    return
  }

  try {
    let result

    // 优先使用 Windows Explorer 方法（如果可用）
    if (window.electronAPI.openInExplorer) {
      console.log('Using Windows Explorer method for task:', task.gid)

      // 如果有具体的文件，打开文件位置
      if (task.files && task.files.length > 0) {
        const firstFile = task.files[0]
        if (firstFile.path) {
          result = await window.electronAPI.openInExplorer(firstFile.path)
          if (result?.success) {
            ElMessage.success('已打开文件位置')
            return
          }
        }
      }

      // 否则打开目录
      result = await window.electronAPI.openInExplorer(task.dir)
      if (result?.success) {
        ElMessage.success('已打开目录')
        return
      }
    }

    // 备用方法：使用 showItemInFolder
    console.log('Fallback to showItemInFolder method for task:', task.gid)
    if (task.files && task.files.length > 0) {
      const firstFile = task.files[0]
      if (firstFile.path) {
        result = await window.electronAPI.showItemInFolder(firstFile.path)
        if (result?.success) {
          ElMessage.success('已打开文件位置')
          return
        }
      }
    }

    // 最后尝试 openPath
    result = await window.electronAPI.openPath(task.dir)
    if (result?.success) {
      ElMessage.success('已打开目录')
    } else {
      ElMessage.error(`打开目录失败: ${result?.error || '未知错误'}`)
    }
  } catch (error) {
    console.error('Failed to open task location:', error)
    ElMessage.error('打开位置失败')
  }
}

// 删除对话框处理函数
function handleDeleteDialogClose() {
  showDeleteDialog.value = false
  currentDeleteGid.value = ''
  deleteFiles.value = false
}

async function confirmDelete() {
  try {
    console.log('Deleting task:', currentDeleteGid.value, 'deleteFiles:', deleteFiles.value)
    await aria2Store.removeTask(currentDeleteGid.value, false, deleteFiles.value)
    ElMessage.success(deleteFiles.value ? '任务和文件已删除' : '任务已删除')
    handleDeleteDialogClose()
  } catch (error) {
    console.error('删除任务失败:', error)

    let errorMessage = '删除任务失败'
    if (error instanceof Error) {
      if (error.message.includes('not found')) {
        errorMessage = '任务不存在，可能已被删除'
        // 任务不存在时也算删除成功，关闭对话框并刷新列表
        ElMessage.warning(errorMessage)
        handleDeleteDialogClose()
        // 刷新任务列表
        await aria2Store.loadAllTasks()
        return
      } else {
        errorMessage = error.message
      }
    }

    ElMessage.error(errorMessage)
  }
}

// 移除手动刷新功能，依赖自动更新和乐观更新

// 操作方法
async function batchStart() {
  try {
    const startableTasks = selectedTasks.value.filter(task =>
      task.status === 'paused' || task.status === 'waiting' || task.status === 'error'
    )

    if (startableTasks.length === 0) {
      ElMessage.warning('没有可以开始的任务')
      return
    }

    for (const task of startableTasks) {
      if (task.status === 'error') {
        // 对错误任务使用重试方法
        await aria2Store.retryErrorTask(task.gid)
      } else {
        // 对其他任务使用普通的开始方法
        await aria2Store.unpauseTask(task.gid)
      }
    }

    // 批量操作完成后刷新任务列表
    await aria2Store.loadAllTasks()

    ElMessage.success(`已开始 ${startableTasks.length} 个任务`)
    clearSelection()
  } catch (error) {
    console.error('开始任务失败:', error)
    ElMessage.error('开始任务失败')
  }
}

async function batchPause() {
  try {
    // 包括所有可以暂停的任务：下载中、等待中的任务
    const pausableTasks = selectedTasks.value.filter(task =>
      task.status === 'active' || task.status === 'waiting'
    )

    if (pausableTasks.length === 0) {
      ElMessage.warning('没有可以暂停的任务')
      return
    }

    for (const task of pausableTasks) {
      // 使用 force = true 来确保等待中的任务也能被暂停
      await aria2Store.pauseTask(task.gid, true)
    }

    ElMessage.success(`已暂停 ${pausableTasks.length} 个任务`)
    clearSelection()
  } catch (error) {
    console.error('暂停任务失败:', error)
    ElMessage.error('暂停任务失败')
  }
}

async function batchDelete() {
  try {
    if (selectedCount.value === 0) {
      ElMessage.warning('请先选择要删除的任务')
      return
    }

    // 检查是否在 Electron 环境中且有文件可删除
    const isElectron = !!window.electronAPI?.deleteFiles
    let hasFiles = false

    if (props.taskType === 'stopped') {
      // 已完成任务使用专门的服务检查文件
      hasFiles = selectedTasks.value.some(task =>
        completedTaskDeleteService.hasDeleteableFiles(task)
      )
      console.log(`Completed tasks have deleteable files: ${hasFiles}`)
    } else {
      // 其他任务使用原有逻辑
      hasFiles = selectedTasks.value.some(task =>
        task.files && task.files.length > 0 && task.files.some(file => file.path && file.path.trim())
      )
      console.log(`Active/waiting tasks have files: ${hasFiles}`)
    }

    if (isElectron && hasFiles) {
      // 使用自定义删除对话框
      tasksToDelete.value = [...selectedTasks.value]
      showBatchDeleteDialog.value = true
    } else {
      // 使用简单确认对话框
      await ElMessageBox.confirm(
        `确定要删除选中的 ${selectedCount.value} 个任务吗？`,
        '删除任务',
        {
          confirmButtonText: '删除',
          cancelButtonText: '取消',
          type: 'warning'
        }
      )

      await handleBatchDeleteConfirm(false)
    }
  } catch (error) {
    if (error !== 'cancel') {
      console.error('删除任务失败:', error)
      ElMessage.error('删除任务失败')
    }
  }
}

// 批量删除确认处理
async function handleBatchDeleteConfirm(deleteFiles: boolean) {
  try {
    showBatchDeleteDialog.value = false

    const tasks = tasksToDelete.value.length > 0 ? tasksToDelete.value : [...selectedTasks.value]
    console.log(`Handling batch delete for ${tasks.length} tasks, deleteFiles: ${deleteFiles}`)
    console.log('Task type:', props.taskType)

    if (props.taskType === 'stopped') {
      // 已完成任务使用专门的删除服务
      console.log('Using completed task delete service')

      const result = await completedTaskDeleteService.batchDeleteCompletedTasks(tasks, deleteFiles)

      // 刷新任务列表
      await aria2Store.loadAllTasks()

      // 显示结果
      if (result.successfulTasks === result.totalTasks) {
        let message = `已删除 ${result.successfulTasks} 个任务`
        if (deleteFiles && result.totalFilesDeleted > 0) {
          message += `和 ${result.totalFilesDeleted} 个文件`
        }
        ElMessage.success(message)
      } else {
        ElMessage.warning(`已删除 ${result.successfulTasks}/${result.totalTasks} 个任务`)

        // 显示错误详情
        if (result.errors.length > 0) {
          console.error('Delete errors:', result.errors)
          result.errors.slice(0, 3).forEach(error => {
            ElMessage.error(error)
          })
        }
      }
    } else {
      // 其他任务使用原有的删除逻辑
      console.log('Using aria2Store.removeTask for active/waiting tasks')

      let successCount = 0
      for (const task of tasks) {
        try {
          await aria2Store.removeTask(task.gid, false, deleteFiles)
          successCount++
        } catch (error) {
          console.error(`Failed to delete task ${task.gid}:`, error)
        }
      }

      if (successCount === tasks.length) {
        const message = deleteFiles
          ? `已删除 ${successCount} 个任务和相关文件`
          : `已删除 ${successCount} 个任务`
        ElMessage.success(message)
      } else {
        ElMessage.warning(`已删除 ${successCount}/${tasks.length} 个任务`)
      }
    }

    clearSelection()
    tasksToDelete.value = []
  } catch (error) {
    console.error('删除任务失败:', error)
    ElMessage.error('删除任务失败')
  }
}

// clearSelection 已移至 useTaskSelection

// 全选功能
function selectAllTasks() {
  if (filteredTasks.value.length === 0) {
    ElMessage.warning('没有可选择的任务')
    return
  }

  selectAll(filteredTasks.value)
  ElMessage.success(`已选择 ${filteredTasks.value.length} 个任务`)
}

// 搜索处理函数
function handleSearch(value: string) {
  // 搜索功能通过 computed 属性 filteredTasks 自动处理
  console.log('Search term:', value)
}

// 监听任务数据变化，更新选中任务的数据
watch(
  () => filteredTasks.value,
  (newTasks) => {
    // 更新选中任务的数据
    updateSelectedTasksData(newTasks)

    // 清理不存在的任务
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
  color: #909399;
  font-size: 14px;
}

.task-list-content {
  flex: 1;
  overflow: auto;
}

.task-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.detail-icon {
  opacity: 0;
  transition: opacity 0.2s;
  color: #409eff;
  font-size: 14px;
}

.task-table :deep(.el-table__row) {
  cursor: pointer;
  transition: background-color 0.2s;
}

.task-table :deep(.el-table__row:hover) {
  background-color: #f5f7fa;
}

.task-table :deep(.el-table__row:hover) .detail-icon {
  opacity: 1;
}

.task-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 16px 0;
  padding: 16px;
  background: #ffffff;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  gap: 16px;
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



.action-buttons {
  display: flex;
  gap: 4px;
  align-items: center;
  justify-content: center;
}

.batch-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 1;
}

.action-buttons-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.action-divider {
  height: 32px;
  margin: 0 8px;
}

.selected-count {
  font-size: 14px;
  color: #409eff;
  font-weight: 500;
  margin-left: 16px;
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
  color: #909399;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}



.task-action-btn {
  border: none;
  background: transparent;
  padding: 8px;
  margin: 0 3px;
  border-radius: 6px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s ease;
  min-width: 32px;
  min-height: 32px;
}

.task-action-btn:hover {
  background: rgba(64, 158, 255, 0.1);
}

.task-action-btn:hover .custom-icon {
  filter: brightness(0) saturate(100%) invert(58%) sepia(96%) saturate(1458%) hue-rotate(204deg) brightness(97%) contrast(100%);
}

.task-action-btn:focus {
  outline: none;
  background: rgba(64, 158, 255, 0.1);
}

.task-action-btn:focus .custom-icon {
  filter: brightness(0) saturate(100%) invert(58%) sepia(96%) saturate(1458%) hue-rotate(204deg) brightness(97%) contrast(100%);
}

.task-action-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.loading-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid #e4e7ed;
  border-top: 2px solid #409eff;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
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
  color: #67c23a;
  animation: pulse 2s infinite;
}

.status-icon.waiting {
  color: #e6a23c;
}

@keyframes pulse {
  0% { opacity: 1; }
  50% { opacity: 0.5; }
  100% { opacity: 1; }
}
</style>
