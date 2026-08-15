<template>
  <n-drawer
    :show="uiStore.showTaskDetail"
    placement="right"
    :width="720"
    :on-update:show="handleShowChange"
  >
    <n-drawer-content :title="t('task.taskDetail')" closable>
      <template #header-extra>
        <n-button size="small" quaternary @click="refresh">
          <template #icon>
            <n-icon><RefreshOutline /></n-icon>
          </template>
        </n-button>
      </template>

      <div v-if="task" class="task-detail-content">
        <!-- 标签页 -->
        <n-tabs v-model:value="activeTab" type="line" animated>
          <n-tab-pane :name="'basic'" :tab="t('taskDetail.basicInfo')">
            <TaskBasicInfo
              :task="task"
              :task-uris="taskUris"
              :is-electron="isElectron"
            />
          </n-tab-pane>

          <n-tab-pane :name="'servers'" :tab="t('taskDetail.serverInfo')">
            <TaskServerInfo :servers="taskServers" />
          </n-tab-pane>

          <n-tab-pane v-if="task.bittorrent" :name="'peers'" :tab="t('taskDetail.peerInfo', { count: taskPeers.length })">
            <TaskPeerInfo :peers="taskPeers" />
          </n-tab-pane>

          <n-tab-pane :name="'pieces'" :tab="t('taskDetail.piecesInfo')">
            <TaskPiecesInfo :task="task" />
          </n-tab-pane>
        </n-tabs>

        <!-- URI 信息对话框 -->
        <n-modal
          v-model:show="uriDialogVisible"
          :title="t('taskDetail.uriListTitle')"
          preset="card"
          style="width: 70%"
          :bordered="false"
        >
          <n-data-table
            :columns="uriColumns"
            :data="selectedFileUris"
            :row-key="(row: any) => row.uri"
            :scroll-x="600"
          />
        </n-modal>
      </div>

      <div v-else class="loading">
        <n-empty :description="t('task.taskNotExist')" />
      </div>
    </n-drawer-content>
  </n-drawer>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, h, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { NTag, NText, type DataTableColumns } from 'naive-ui'
import { RefreshOutline } from '@vicons/ionicons5'
import { message } from '@/utils/feedback'
import { useUiStore } from '@/stores/uiStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { useTaskStore } from '@/stores/taskStore'
import type { Aria2Task, Aria2Uri, Aria2Server } from '@/types/aria2'
import TaskBasicInfo from '@/components/task/TaskBasicInfo.vue'
import TaskServerInfo from '@/components/task/TaskServerInfo.vue'
import TaskPeerInfo from '@/components/task/TaskPeerInfo.vue'
import TaskPiecesInfo from '@/components/task/TaskPiecesInfo.vue'

const uiStore = useUiStore()
const { t } = useI18n()
const connectionStore = useConnectionStore()
const taskStore = useTaskStore()

const task = ref<Aria2Task | null>(null)
const loading = ref(false)
const uriDialogVisible = ref(false)
const selectedFileUris = ref<Aria2Uri[]>([])
const taskUris = ref<Aria2Uri[]>([])
const taskPeers = ref<unknown[]>([])
const taskServers = ref<Aria2Server[]>([])
const activeTab = ref('basic')

const isElectron = computed(() => !!window.electronAPI)

const gid = computed(() => uiStore.taskDetailGid || '')

// 抽屉开关状态同步（n-drawer 通过 update:show 通知）
function handleShowChange(value: boolean) {
  if (!value) uiStore.closeTaskDetail()
}

// 抽屉打开时加载任务
watch(() => uiStore.showTaskDetail, (show) => {
  if (show && gid.value) {
    activeTab.value = 'basic'
    loadTaskDetail()
  }
})

let interval: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  // 抽屉打开期间定时刷新活动任务
  interval = setInterval(() => {
    if (uiStore.showTaskDetail && connectionStore.isConnected && gid.value && task.value) {
      if (['active', 'waiting', 'paused'].includes(task.value.status)) {
        loadTaskDetail()
      }
    }
  }, 3000)
})

onUnmounted(() => {
  if (interval) {
    clearInterval(interval)
    interval = null
  }
})

const uriColumns: DataTableColumns<Aria2Uri> = [
  {
    key: 'index',
    title: t('taskDetail.index'),
    width: 60,
    render: (_row, index) => index + 1
  },
  {
    key: 'uri',
    title: 'URI',
    minWidth: 400,
    render: (row) => h(NText, { code: true, depth: 2 }, { default: () => row.uri })
  },
  {
    key: 'status',
    title: t('task.status'),
    width: 100,
    render: (row) =>
      h(NTag, {
        type: (getUriStatusType(row.status) as 'success' | 'warning' | 'info' | 'default') || 'default',
        size: 'small'
      }, { default: () => getUriStatusText(row.status) })
  }
]

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
          const files = await connectionStore.service.getFiles(gid.value)
          if (files && task.value) {
            task.value.files = files
          }

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

          if (task.value.bittorrent) {
            try {
              const peers = await connectionStore.service.getPeers(gid.value)
              taskPeers.value = peers || []
            } catch (error) {
              console.warn('Failed to get peers:', error)
              taskPeers.value = []
            }
          }

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
    message.error(t('task.taskNotExist'))
  } finally {
    loading.value = false
  }
}

async function refresh() {
  await loadTaskDetail()
}

function findTaskInStore(gid: string): Aria2Task | null {
  const allTasks = [
    ...taskStore.activeTasks,
    ...taskStore.waitingTasks,
    ...taskStore.stoppedTasks
  ]
  return allTasks.find(t => t.gid === gid) || null
}

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
    case 'used': return t('status.used')
    case 'waiting': return t('status.waiting')
    default: return status || t('common.unknown')
  }
}
</script>

<style scoped>
.task-detail-content {
  padding: 8px 0;
}

.loading {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 200px;
}
</style>
