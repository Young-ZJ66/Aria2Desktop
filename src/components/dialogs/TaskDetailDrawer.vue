<template>
  <n-drawer
    :show="uiStore.showTaskDetail"
    placement="right"
    :width="720"
    :on-update:show="handleShowChange"
  >
    <n-drawer-content class="task-detail-drawer" :title="t('task.taskDetail')" closable>
      <!--
        注：n-drawer-content **没有 header-extra 插槽**（只支持 default/header/footer），
        此前误用该插槽名，刷新按钮实际上从未渲染出来。改用 #header，
        并自行带上标题文本——提供了 header 插槽后，默认标题就不再显示了。
      -->
      <template #header>
        <div class="drawer-header">
          <span class="drawer-title">{{ t('task.taskDetail') }}</span>
          <!-- v2：标题右侧带 gid 片段。详情抽屉经常是「从列表点进来又想确认看的是哪个」的场景，
               而 gid 是唯一稳定标识（文件名可能重复）。 -->
          <code v-if="gid" class="drawer-gid" :title="gid">{{ gid.slice(0, 8) }}</code>
          <n-tag v-if="task?.status" :type="getStatusType(task.status)" size="small">
            {{ t('status.' + task.status) }}
          </n-tag>
          <span class="drawer-header__spacer" />
          <n-button size="small" quaternary :loading="refreshing" :aria-label="t('common.refresh')" @click="refresh">
            <template #icon>
              <n-icon><RefreshOutline /></n-icon>
            </template>
          </n-button>
        </div>
      </template>

      <n-spin :show="loading">
        <div v-if="task" class="task-detail-content">
          <!-- 标签页 -->
          <n-tabs v-model:value="activeTab" type="line" animated>
            <n-tab-pane :name="'basic'" :tab="t('taskDetail.basicInfo')">
              <TaskBasicInfo
                :task="task"
                :task-uris="taskUris"
                :is-electron="isElectron"
                :stream-file-paths="streamFilePaths"
              />
            </n-tab-pane>

            <n-tab-pane v-if="task.bittorrent && task.status !== 'complete'" :name="'files'" :tab="t('taskDetail.filesInfo')">
              <TaskFilesInfo :task="task" @changed="fetchAndMergeDetails" />
            </n-tab-pane>

            <n-tab-pane v-if="!isStreamTask" :name="'servers'" :tab="t('taskDetail.serverInfo')">
              <TaskServerInfo :servers="taskServers" />
            </n-tab-pane>

            <n-tab-pane v-if="task.bittorrent" :name="'peers'" :tab="t('taskDetail.peerInfo', { count: taskPeers.length })">
              <TaskPeerInfo :peers="taskPeers" :show-count="false" />
            </n-tab-pane>

            <n-tab-pane v-if="!isStreamTask" :name="'pieces'" :tab="t('taskDetail.piecesInfo')">
              <TaskPiecesInfo :task="task" />
            </n-tab-pane>

            <n-tab-pane v-if="!isStreamTask" :name="'settings'" :tab="t('taskDetail.taskSettings')">
              <TaskSettingsPanel :gid="gid" :task="task" />
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
              :row-key="(row: Aria2Uri) => row.uri"
              :scroll-x="600"
            />
          </n-modal>
        </div>

        <div v-else class="drawer-empty">
          <UiEmpty
            :title="t('task.taskNotExist')"
            :icon="DocumentOutline"
            size="sm"
          />
        </div>
      </n-spin>
    </n-drawer-content>
  </n-drawer>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, h, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { NTag, NText, type DataTableColumns } from 'naive-ui'
import { DocumentOutline, RefreshOutline } from '@vicons/ionicons5'
import { message } from '@/utils/feedback'
import { ensureMinimumDuration } from '@/composables/useMinimumLoading'
import { useUiStore } from '@/stores/uiStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { useTaskStore } from '@/stores/taskStore'
import { useStreamTaskStore } from '@/stores/streamTaskStore'
import type { Aria2Task, Aria2Uri, Aria2Server, Aria2Peer } from '@/types/aria2'
import { getStatusType } from '@/utils/taskFormatters'
import { streamTaskFilePaths } from '@/utils/streamTaskUtils'
import TaskBasicInfo from '@/components/task/TaskBasicInfo.vue'
import TaskFilesInfo from '@/components/task/TaskFilesInfo.vue'
import TaskServerInfo from '@/components/task/TaskServerInfo.vue'
import TaskPeerInfo from '@/components/task/TaskPeerInfo.vue'
import TaskPiecesInfo from '@/components/task/TaskPiecesInfo.vue'
import TaskSettingsPanel from '@/components/task/TaskSettingsPanel.vue'
import UiEmpty from '@/components/ui/UiEmpty.vue'

const uiStore = useUiStore()
const { t } = useI18n()
const connectionStore = useConnectionStore()
const taskStore = useTaskStore()
const streamTaskStore = useStreamTaskStore()

const task = ref<Aria2Task | null>(null)
const loading = ref(false)
// 刷新按钮自己的加载态：只在用户手动点刷新时转圈。
// 不能直接复用 loading —— 抽屉打开期间每 3 秒会轮询刷新一次，那样按钮会一直转。
const refreshing = ref(false)
const uriDialogVisible = ref(false)
const selectedFileUris = ref<Aria2Uri[]>([])
const taskUris = ref<Aria2Uri[]>([])
const taskPeers = ref<Aria2Peer[]>([])
const taskServers = ref<Aria2Server[]>([])
const activeTab = ref('basic')

const isElectron = computed(() => !!window.electronAPI)

const gid = computed(() => uiStore.taskDetailGid || '')
const isStreamTask = computed(() => Boolean(gid.value && streamTaskStore.findByGid(gid.value)))

/**
 * 流媒体任务的全部输出文件（D-11）。
 *
 * 这类任务转成 Aria2Task 形状时只保留了首个文件（列表只展示一个名字），
 * 播放列表/多字幕会产出多个文件，详情里必须能看到每一个。
 */
const streamFilePaths = computed<string[]>(() => {
  if (!gid.value) return []
  const streamTask = streamTaskStore.findByGid(gid.value)
  return streamTask ? streamTaskFilePaths(streamTask) : []
})

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
  // 抽屉打开期间定时刷新活动任务（上一轮未结束时跳过，避免请求叠加）
  interval = setInterval(() => {
    if (!uiStore.showTaskDetail || !gid.value || !task.value || loading.value) return
    // 流媒体任务详情来自本地 store，不依赖 aria2 连接，活动期间持续跟随进度
    if (isStreamTask.value) {
      loadTaskDetail()
      return
    }
    if (connectionStore.isConnected && ['active', 'waiting', 'paused'].includes(task.value.status)) {
      loadTaskDetail()
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
        type: getUriStatusType(row.status),
        size: 'small'
      }, { default: () => getUriStatusText(row.status) })
  }
]

/**
 * 从 store 查找任务；未命中时通过 RPC tellStatus 拉取基础信息
 */
async function fetchTaskBase(): Promise<Aria2Task | null> {
  let foundTask = findTaskInStore(gid.value)

  if (!foundTask && connectionStore.service) {
    foundTask = await connectionStore.service.tellStatus(gid.value, [
      'gid', 'status', 'totalLength', 'completedLength', 'uploadLength',
      'downloadSpeed', 'uploadSpeed', 'connections', 'numPieces', 'pieceLength',
      'dir', 'files', 'bittorrent', 'errorCode', 'errorMessage',
      // BT 健康度依赖这两个字段：numSeeders 是已连上的做种者数量，seeder 表示本机是否在做种
      'numSeeders', 'seeder'
    ])
  }

  return foundTask
}

/**
 * 拉取并合并任务详情（files/uris/peers/servers），各项独立容错、失败时降级
 */
async function fetchAndMergeDetails(): Promise<void> {
  if (!connectionStore.service || !task.value) return

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

/**
 * 详情加载序号：抽屉会在 3 秒轮询与"打开抽屉/切换任务"两条路径上并发发起加载，
 * 而每次加载串行发出 5 个 RPC。没有序号守卫时，先请求的任务 A 的迟到响应会写进
 * 后打开的任务 B 的详情里（标题是 B、内容是 A）。
 */
let loadSeq = 0

async function loadTaskDetail() {
  if (!gid.value) return

  // 流媒体任务不在 aria2 队列：直接用 store 里的实时记录组装详情，跳过所有 RPC
  const streamTask = streamTaskStore.findByGid(gid.value)
  if (streamTask) {
    ++loadSeq
    task.value = streamTaskStore.toAria2Task(streamTask)
    taskUris.value = [{ uri: streamTask.url, status: 'used' }]
    taskPeers.value = []
    taskServers.value = []
    loading.value = false
    return
  }

  if (!connectionStore.isConnected) return

  const seq = ++loadSeq
  const requestedGid = gid.value

  loading.value = true
  try {
    const foundTask = await fetchTaskBase()

    // 已被更新的请求取代（切换了任务）时丢弃本次结果
    if (seq !== loadSeq || requestedGid !== gid.value) return

    if (foundTask) {
      task.value = foundTask
      // 数据拉取与状态更新分离
      await fetchAndMergeDetails()
      return
    }

    // D-48：连接正常却查不到这个 gid，说明任务已被外部删除（aria2 队列、清理脚本、另一窗口）。
    // 此前这里什么都不做，抽屉会一直停留在上一次的旧数据上——用户看到的进度条永远不动。
    // 上面的「最新请求」校验已排除切换任务的情况，这里只处理真正的任务消失。
    handleTaskGone()
  } catch (error) {
    if (seq !== loadSeq) return
    console.error('Failed to load task detail:', error)
    // D-48：aria2 对未知 gid 是抛错而不是返回空（"GID xxx is not found"）。
    // 这类错误等价于任务已被外部删除，按消失处理而不是报"任务不存在"错误。
    if (requestedGid === gid.value && isGidNotFoundError(error)) {
      handleTaskGone()
      return
    }
    // 区分"任务不存在"与"RPC 失败"：此前一律提示"任务不存在"，会把断连/超时
    // 误报成任务丢失，误导排查方向
    message.error(connectionStore.isConnected ? t('task.taskNotExist') : t('connection.disconnected'))
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

/** aria2 的「gid 不存在」错误文案（客户端把 RPC error.message 拼进 Error.message） */
function isGidNotFoundError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error ?? '')
  return /is not found|not found/i.test(text) && /gid/i.test(text)
}

/**
 * 任务在 aria2 侧已消失（D-48）：清空本地详情并关闭抽屉。
 *
 * 只提示、不报错：任务被删除是用户/外部工具的正常行为，不是故障。
 * 文案复用语言包里的「任务已删除」，不新增 key。
 */
function handleTaskGone() {
  task.value = null
  taskUris.value = []
  taskPeers.value = []
  taskServers.value = []
  uiStore.closeTaskDetail()
  message.warning(t('delete.taskDeleted'))
}

async function refresh() {
  // 手动刷新时按钮转圈；轮询走的是 loadTaskDetail()，不经过这里
  refreshing.value = true
  const startedAt = Date.now()
  try {
    await loadTaskDetail()
  } finally {
    // 本地读取常在几毫秒内完成，补齐最短时长，否则加载圈只闪一下看不见
    await ensureMinimumDuration(startedAt)
    refreshing.value = false
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

/** URI 状态标签类型（与 NTag type prop 对齐） */
function getUriStatusType(status: string): 'success' | 'warning' | 'info' {
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
.drawer-header {
  display: flex;
  align-items: center;
  gap: var(--ds-space-8);
  width: 100%;
}

.drawer-title {
  font-size: var(--ds-text-title-size);
  font-weight: 600;
  color: var(--ds-text-strong);
}

/* gid 用等宽字体 + 淡底：它是「技术标识」，不该和标题抢权重，但必须能被复制辨认 */
.drawer-gid {
  padding: 1px var(--ds-space-6);
  border-radius: var(--ds-radius-xs);
  background: var(--ds-bg-sunken);
  font-family: var(--ds-font-mono);
  font-size: var(--ds-text-micro-size);
  color: var(--ds-text-faint);
  letter-spacing: 0.02em;
}

.drawer-header__spacer {
  flex: 1;
}

.task-detail-content {
  padding: var(--ds-space-8) 0;
}

.task-detail-content :deep(.n-tab-pane) {
  padding-top: var(--ds-space-16);
}

.task-detail-content :deep(.n-tabs-nav) {
  padding: 0 var(--ds-space-4);
}

.drawer-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 240px;
}
</style>
