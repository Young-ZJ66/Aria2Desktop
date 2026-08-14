<template>
  <div class="task-detail">
    <div class="task-detail-header">
      <h2>{{ t('task.taskDetail') }}</h2>
      <el-button @click="$router.go(-1)">{{ t('task.back') }}</el-button>
    </div>

    <div v-if="task" class="task-detail-content">
      <!-- 标签页 -->
      <el-tabs v-model="activeTab" class="detail-tabs">
        <!-- 基本信息标签页 -->
        <el-tab-pane label="基本信息" name="basic">
          <TaskBasicInfo
            :task="task"
            :task-uris="taskUris"
            :is-electron="isElectron"
          />
        </el-tab-pane>

        <!-- 服务器信息标签页 -->
        <el-tab-pane name="servers">
          <template #label>
            <span>服务器信息</span>
          </template>
          <TaskServerInfo :servers="taskServers" />
        </el-tab-pane>

        <!-- Peer 信息标签页（仅 BitTorrent） -->
        <el-tab-pane v-if="task.bittorrent" name="peers">
          <template #label>
            <span>Peer 信息 ({{ taskPeers.length }})</span>
          </template>
          <TaskPeerInfo :peers="taskPeers" />
        </el-tab-pane>

        <!-- 区块信息标签页 -->
        <el-tab-pane name="pieces">
          <template #label>
            <span>区块信息</span>
          </template>
          <TaskPiecesInfo :task="task" />
        </el-tab-pane>
      </el-tabs>

      <!-- URI 信息对话框 -->
      <el-dialog v-model="uriDialogVisible" title="文件 URI 列表" width="70%">
        <el-table :data="selectedFileUris" style="width: 100%">
          <el-table-column type="index" label="序号" width="60" />
          <el-table-column prop="uri" label="URI" min-width="400">
            <template #default="{ row }">
              <el-text copyable>{{ row.uri }}</el-text>
            </template>
          </el-table-column>
          <el-table-column prop="status" label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="getUriStatusType(row.status)" size="small">
                {{ getUriStatusText(row.status) }}
              </el-tag>
            </template>
          </el-table-column>
        </el-table>
      </el-dialog>
    </div>

    <div v-else class="loading">
      <el-empty :description="t('task.taskNotExist')" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { useConnectionStore } from '@/stores/connectionStore'
import { useTaskStore } from '@/stores/taskStore'
import type { Aria2Task, Aria2Uri, Aria2Server } from '@/types/aria2'
import TaskBasicInfo from '@/components/task/TaskBasicInfo.vue'
import TaskServerInfo from '@/components/task/TaskServerInfo.vue'
import TaskPeerInfo from '@/components/task/TaskPeerInfo.vue'
import TaskPiecesInfo from '@/components/task/TaskPiecesInfo.vue'

interface Props {
  gid: string
}

const props = defineProps<Props>()
const route = useRoute()
const { t } = useI18n()
const connectionStore = useConnectionStore()
const taskStore = useTaskStore()

const task = ref<Aria2Task | null>(null)
const loading = ref(false)
const uriDialogVisible = ref(false)
const selectedFileUris = ref<unknown[]>([])
const taskUris = ref<Aria2Uri[]>([])
const taskPeers = ref<unknown[]>([])
const taskServers = ref<Aria2Server[]>([])
const activeTab = ref('basic')

const gid = computed(() => props.gid || route.params.gid as string)
const isElectron = computed(() => !!window.electronAPI)

let interval: ReturnType<typeof setInterval> | null = null

onMounted(async () => {
  await loadTaskDetail()

  interval = setInterval(async () => {
    if (connectionStore.isConnected && gid.value && task.value) {
      if (['active', 'waiting', 'paused'].includes(task.value.status)) {
        await loadTaskDetail()
      }
    }
  }, 3000)
})

onUnmounted(() => {
  if (interval) {
    clearInterval(interval)
  }
})

async function loadTaskDetail() {
  if (!connectionStore.isConnected || !gid.value) return

  loading.value = true
  try {
    let foundTask = findTaskInStore(gid.value)

    if (!foundTask && connectionStore.service) {
      foundTask = await connectionStore.service.tellStatus(gid.value, [
        'gid', 'status', 'totalLength', 'completedLength', 'uploadLength',
        'downloadSpeed', 'uploadSpeed', 'connections', 'numPieces', 'pieceLength',
        'dir', 'files', 'bittorrent', 'errorCode', 'errorMessage'
      ])
    }

    if (foundTask) {
      task.value = foundTask

      if (connectionStore.service) {
        try {
          // 获取文件信息
          const files = await connectionStore.service.getFiles(gid.value)
          if (files && task.value) {
            task.value.files = files
          }

          // 获取 URI 信息
          try {
            const uris = await connectionStore.service.getUris(gid.value)
            taskUris.value = deduplicateUris(uris || [])
          } catch (error) {
            console.warn('Failed to get URIs (task may be completed):', error)
            if (task.value.files && task.value.files.length > 0) {
              const fileUris: Aria2Uri[] = []
              task.value.files.forEach((file) => {
                if (file.uris && file.uris.length > 0) {
                  file.uris.forEach(uri => {
                    fileUris.push(uri)
                  })
                }
              })
              taskUris.value = deduplicateUris(fileUris)
            }
          }

          // 获取 Peer 信息（仅对 BitTorrent 任务）
          if (task.value.bittorrent) {
            try {
              const peers = await connectionStore.service.getPeers(gid.value)
              taskPeers.value = peers || []
            } catch (error) {
              console.warn('Failed to get peers:', error)
              taskPeers.value = []
            }
          }

          // 获取服务器信息
          try {
            const servers = await connectionStore.service.getServers(gid.value)
            taskServers.value = servers || []
          } catch (error) {
            console.warn('Failed to get servers:', error)
            taskServers.value = []
          }
        } catch (error) {
          console.warn('Failed to get task details:', error)
        }
      }
    }
  } catch (error) {
    console.error('Failed to load task detail:', error)
    ElMessage.error(t('task.taskNotExist'))
  } finally {
    loading.value = false
  }
}

function findTaskInStore(gid: string): Aria2Task | null {
  const allTasks = [
    ...taskStore.activeTasks,
    ...taskStore.waitingTasks,
    ...taskStore.stoppedTasks
  ]
  return allTasks.find(t => t.gid === gid) || null
}

// URI 去重函数
function deduplicateUris(uris: Aria2Uri[]): Aria2Uri[] {
  if (!uris || uris.length === 0) return []

  const seen = new Set<string>()
  const uniqueUris: Aria2Uri[] = []

  uris.forEach(uri => {
    const uriKey = uri.uri

    if (!seen.has(uriKey)) {
      seen.add(uriKey)
      uniqueUris.push(uri)
    }
  })

  return uniqueUris
}

function getUriStatusType(status: string): string {
  switch (status) {
    case 'used': return 'success'
    case 'waiting': return 'warning'
    default: return 'info'
  }
}

function getUriStatusText(status: string): string {
  switch (status) {
    case 'used': return '使用中'
    case 'waiting': return '等待中'
    default: return status || '未知'
  }
}
</script>

<style scoped>
.task-detail {
  padding: 20px;
}

.task-detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.task-detail-header h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary);
}

.loading {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 200px;
}

.detail-tabs {
  margin-top: 0;
}

:deep(.el-tabs__header) {
  margin-bottom: 20px;
}

:deep(.el-descriptions__label) {
  font-weight: 500;
}

/* 深色主题下的描述列表边框颜色 */
[data-theme="dark"] :deep(.el-descriptions__cell) {
  border-color: var(--border-dark) !important;
}

[data-theme="dark"] :deep(.el-descriptions__table) {
  border-color: var(--border-dark) !important;
}

[data-theme="dark"] :deep(.el-descriptions__label) {
  border-color: var(--border-base) !important;
  background-color: var(--bg-tertiary) !important;
}

[data-theme="dark"] :deep(.el-descriptions__content) {
  border-color: var(--border-base) !important;
  background-color: var(--bg-tertiary) !important;
}

[data-theme="dark"] :deep(.el-descriptions__table) {
  background-color: var(--bg-secondary) !important;
}

[data-theme="dark"] :deep(.el-descriptions__cell) {
  background-color: var(--bg-secondary) !important;
  border-color: var(--border-base) !important;
}

/* 浅色主题下的描述列表样式 */
:deep(.el-descriptions__label) {
  background-color: var(--bg-tertiary) !important;
  color: var(--text-regular) !important;
  border-color: var(--border-base) !important;
}

:deep(.el-descriptions__content) {
  background-color: var(--bg-secondary) !important;
  color: var(--text-primary) !important;
  border-color: var(--border-base) !important;
}

:deep(.el-descriptions__table) {
  background-color: var(--bg-primary) !important;
}

:deep(.el-descriptions__cell) {
  border-color: var(--border-base) !important;
}

:deep(.el-card__header) {
  padding: 16px 20px;
  background-color: var(--bg-tertiary);
  border-bottom: 1px solid var(--border-light);
}

:deep(.el-card__body) {
  padding: 20px;
  background-color: var(--bg-secondary);
}
</style>
