<template>
  <div class="task-detail">
    <div class="task-detail-header">
      <h2>任务详情</h2>
      <el-button @click="$router.go(-1)">返回</el-button>
    </div>
    


    <div v-if="task" class="task-detail-content">

      <!-- 标签页 -->
      <el-tabs v-model="activeTab" class="detail-tabs">
        <!-- 基本信息标签页 -->
        <el-tab-pane label="基本信息" name="basic">
          <!-- 整合的任务信息卡片 -->
          <el-card class="info-card">
            <!-- 任务信息 -->
            <div class="info-section">
              <el-descriptions :column="2" border class="task-descriptions">
                <el-descriptions-item label="GID">
                  <div class="field-with-action">
                    <span>{{ task.gid }}</span>
                    <el-button size="small" text @click="copyGid" title="复制 GID">
                      <el-icon><CopyDocument /></el-icon>
                    </el-button>
                  </div>
                </el-descriptions-item>
                <el-descriptions-item label="状态">
                  <el-tag :type="getStatusType(task.status)">
                    {{ getStatusText(task.status) }}
                  </el-tag>
                </el-descriptions-item>

                <!-- 文件名 -->
                <el-descriptions-item label="文件名" v-if="task.files?.length">
                  <span>{{ getFileName(task.files[0].path) }}</span>
                </el-descriptions-item>

                <el-descriptions-item label="文件大小">{{ formatSize(task.totalLength) }}</el-descriptions-item>
                <el-descriptions-item label="已下载">{{ formatSize(task.completedLength) }}</el-descriptions-item>
                <el-descriptions-item label="下载进度">
                  <el-progress
                    :percentage="getProgress(task)"
                    :status="task.status === 'complete' ? 'success' : undefined"
                    style="width: 200px"
                  />
                </el-descriptions-item>
                <el-descriptions-item label="剩余时间">{{ formatRemainingTime(task) }}</el-descriptions-item>
                <el-descriptions-item label="下载速度">{{ formatSpeed(task.downloadSpeed) }}</el-descriptions-item>
                <el-descriptions-item label="分片数">{{ task.numPieces || 0 }}</el-descriptions-item>
                <el-descriptions-item label="分片长度">{{ formatSize(task.pieceLength || '0') }}</el-descriptions-item>

                <!-- 完整路径 -->
                <el-descriptions-item label="文件路径" :span="2" v-if="task.files?.length">
                  <div class="path-with-action">
                    <span>{{ task.files[0].path }}</span>
                    <el-button size="small" text @click="openFileInFolder(task.files[0].path)" v-if="isElectron" title="打开位置" style="margin-left: 8px;">
                      <el-icon><FolderOpened /></el-icon>
                    </el-button>
                  </div>
                </el-descriptions-item>

                <!-- 下载链接 -->
                <el-descriptions-item label="下载链接" :span="2" v-if="taskUris.length">
                  <div class="field-with-action">
                    <div class="uri-content-full">
                      <span class="uri-text-full">{{ taskUris[0].uri }}</span>
                    </div>
                    <el-button size="small" text @click="copyUri(taskUris[0].uri)" title="复制链接">
                      <el-icon><CopyDocument /></el-icon>
                    </el-button>
                  </div>
                </el-descriptions-item>

                <el-descriptions-item label="错误信息" v-if="task.errorCode && task.errorCode !== '0'" :span="2">
                  <el-text type="danger">{{ task.errorMessage || task.errorCode }}</el-text>
                </el-descriptions-item>
              </el-descriptions>

              <!-- 文件操作按钮 -->
              <div v-if="task.files?.length && task.status === 'complete'" class="file-actions">
                <el-space>
                  <el-button size="small" @click="openFile(task.files[0].path)" v-if="isElectron">
                    <el-icon><Document /></el-icon>
                    打开文件
                  </el-button>
                </el-space>
              </div>
            </div>
          </el-card>

          <!-- BitTorrent 信息 -->
          <el-card v-if="task.bittorrent" class="info-card">
            <template #header>
              <span>BitTorrent 信息</span>
            </template>

            <el-descriptions :column="2" border>
              <el-descriptions-item label="种子名称">{{ task.bittorrent.info?.name || '未知' }}</el-descriptions-item>
              <el-descriptions-item label="创建者">{{ task.bittorrent.createdBy || '未知' }}</el-descriptions-item>
              <el-descriptions-item label="创建时间">{{ formatDate(task.bittorrent.creationDate) }}</el-descriptions-item>
              <el-descriptions-item label="注释">{{ task.bittorrent.comment || '无' }}</el-descriptions-item>
              <el-descriptions-item label="模式">{{ task.bittorrent.mode || '未知' }}</el-descriptions-item>
              <el-descriptions-item label="宣布列表">
                <div v-if="task.bittorrent.announceList?.length">
                  <el-tag
                    v-for="(announce, index) in task.bittorrent.announceList.slice(0, 3)"
                    :key="index"
                    size="small"
                    style="margin: 2px;"
                  >
                    {{ announce[0] }}
                  </el-tag>
                  <span v-if="task.bittorrent.announceList.length > 3">
                    等 {{ task.bittorrent.announceList.length }} 个
                  </span>
                </div>
                <span v-else>无</span>
              </el-descriptions-item>
            </el-descriptions>
          </el-card>
        </el-tab-pane>



        <!-- 服务器信息标签页 -->
        <el-tab-pane name="servers">
          <template #label>
            <span>服务器信息</span>
          </template>

          <el-card class="info-card">
            <el-table :data="taskServers" style="width: 100%" v-if="taskServers.length">
              <el-table-column type="index" label="序号" width="60" />
              <el-table-column label="服务器" min-width="300">
                <template #default="{ row }">
                  <div v-for="(server, index) in row.servers" :key="index" class="server-item">
                    <el-text copyable>{{ server.uri }}</el-text>
                    <el-tag :type="getServerStatusType(server.status)" size="small" style="margin-left: 8px">
                      {{ getServerStatusText(server.status) }}
                    </el-tag>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="下载速度" width="120">
                <template #default="{ row }">
                  <div v-for="(server, index) in row.servers" :key="index" class="server-item">
                    {{ formatSpeed(server.downloadSpeed || '0') }}
                  </div>
                </template>
              </el-table-column>
            </el-table>

            <el-empty v-else description="没有服务器信息" />
          </el-card>
        </el-tab-pane>

        <!-- Peer 信息标签页（仅 BitTorrent） -->
        <el-tab-pane v-if="task.bittorrent" name="peers">
          <template #label>
            <span>Peer 信息 ({{ taskPeers.length }})</span>
          </template>

          <el-card class="info-card">
            <el-table :data="taskPeers" style="width: 100%" v-if="taskPeers.length">
              <el-table-column type="index" label="序号" width="60" />
              <el-table-column label="IP 地址" width="150">
                <template #default="{ row }">
                  {{ row.ip }}
                </template>
              </el-table-column>
              <el-table-column label="端口" width="80">
                <template #default="{ row }">
                  {{ row.port }}
                </template>
              </el-table-column>
              <el-table-column label="客户端" width="200">
                <template #default="{ row }">
                  {{ row.peerId || '未知' }}
                </template>
              </el-table-column>
              <el-table-column label="下载速度" width="120">
                <template #default="{ row }">
                  {{ formatSpeed(row.downloadSpeed || '0') }}
                </template>
              </el-table-column>
              <el-table-column label="上传速度" width="120">
                <template #default="{ row }">
                  {{ formatSpeed(row.uploadSpeed || '0') }}
                </template>
              </el-table-column>
              <el-table-column label="进度" width="100">
                <template #default="{ row }">
                  {{ (parseFloat(row.bitfield || '0') * 100).toFixed(1) }}%
                </template>
              </el-table-column>
              <el-table-column label="状态" width="100">
                <template #default="{ row }">
                  <el-tag :type="getPeerStatusType(row.amChoking, row.peerChoking)" size="small">
                    {{ getPeerStatusText(row.amChoking, row.peerChoking) }}
                  </el-tag>
                </template>
              </el-table-column>
            </el-table>

            <el-empty v-else description="没有 Peer 信息" />
          </el-card>
        </el-tab-pane>

        <!-- 区块信息标签页 -->
        <el-tab-pane name="pieces">
          <template #label>
            <span>区块信息</span>
          </template>

          <el-card class="info-card">
            <div v-if="task.numPieces && parseInt(task.numPieces) > 0">
              <div class="pieces-info">
                <el-descriptions :column="3" border>
                  <el-descriptions-item label="总区块数">{{ task.numPieces }}</el-descriptions-item>
                  <el-descriptions-item label="区块大小">{{ formatSize(task.pieceLength || '0') }}</el-descriptions-item>
                  <el-descriptions-item label="完成区块">{{ getCompletedPieces() }}</el-descriptions-item>
                </el-descriptions>
              </div>

              <div class="pieces-visual" style="margin-top: 20px;">
                <h4>区块完成状态</h4>
                <div class="pieces-grid">
                  <div
                    v-for="(piece, index) in getPiecesStatus()"
                    :key="index"
                    :class="['piece-block', piece ? 'completed' : 'pending']"
                    :title="`区块 ${index}: ${piece ? '已完成' : '未完成'}`"
                  ></div>
                </div>
                <div class="pieces-legend">
                  <span class="legend-item">
                    <span class="legend-color completed"></span>
                    已完成
                  </span>
                  <span class="legend-item">
                    <span class="legend-color pending"></span>
                    未完成
                  </span>
                </div>
              </div>
            </div>

            <el-empty v-else description="没有区块信息" />
          </el-card>
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
      <el-empty description="任务不存在或加载中..." />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  CopyDocument, FolderOpened, Document, Folder, Link
} from '@element-plus/icons-vue'
import { useAria2Store } from '@/stores/aria2Store'
import type { Aria2Task, Aria2File } from '@/types/aria2'
import { getTaskRemainingTime, formatTime, formatSpeed as utilFormatSpeed } from '@/utils/taskUtils'

interface Props {
  gid: string
}

const props = defineProps<Props>()
const route = useRoute()
const aria2Store = useAria2Store()

const task = ref<Aria2Task | null>(null)
const loading = ref(false)
const uriDialogVisible = ref(false)
const selectedFileUris = ref<any[]>([])
const taskUris = ref<any[]>([])
const taskPeers = ref<any[]>([])
const taskServers = ref<any[]>([])
const activeTab = ref('basic')

const gid = computed(() => props.gid || route.params.gid as string)
const isElectron = computed(() => !!window.electronAPI)

onMounted(async () => {
  await loadTaskDetail()
  // 设置定时刷新，但只在任务未完成时刷新
  const interval = setInterval(async () => {
    if (aria2Store.isConnected && gid.value && task.value) {
      // 只有活跃任务才需要频繁刷新
      if (['active', 'waiting', 'paused'].includes(task.value.status)) {
        await loadTaskDetail()
      }
    }
  }, 3000) // 增加刷新间隔到3秒

  // 组件卸载时清除定时器
  onUnmounted(() => {
    clearInterval(interval)
  })
})

async function loadTaskDetail() {
  if (!aria2Store.isConnected || !gid.value) {
    return
  }

  loading.value = true
  try {
    // 先从 store 中查找任务
    let foundTask = findTaskInStore(gid.value)

    if (!foundTask && aria2Store.service) {
      // 如果 store 中没有，直接从 Aria2 获取
      foundTask = await aria2Store.service.tellStatus(gid.value, [
        'gid', 'status', 'totalLength', 'completedLength', 'uploadLength',
        'downloadSpeed', 'uploadSpeed', 'connections', 'numPieces', 'pieceLength',
        'dir', 'files', 'bittorrent', 'errorCode', 'errorMessage'
      ])
    }

    if (foundTask) {
      task.value = foundTask

      // 获取详细信息
      if (aria2Store.service) {
        try {
          // 获取文件信息
          const files = await aria2Store.service.getFiles(gid.value)
          if (files && task.value) {
            task.value.files = files
          }

          // 获取 URI 信息
          try {
            const uris = await aria2Store.service.getUris(gid.value)
            console.log('原始 URI 数据:', uris)
            // 对 URI 进行去重处理
            taskUris.value = deduplicateUris(uris || [])
          } catch (error) {
            console.warn('Failed to get URIs (task may be completed):', error)
            // 对于已完成的任务，尝试从文件信息中获取 URI
            if (task.value.files && task.value.files.length > 0) {
              const fileUris: any[] = []
              task.value.files.forEach((file, index) => {
                if (file.uris && file.uris.length > 0) {
                  file.uris.forEach(uri => {
                    fileUris.push({
                      ...uri,
                      fileIndex: index,
                      fileName: getFileName(file.path)
                    })
                  })
                }
              })
              // 对文件 URI 也进行去重处理
              taskUris.value = deduplicateUris(fileUris)
            }
          }

          // 获取 Peer 信息（仅对 BitTorrent 任务）
          if (task.value.bittorrent) {
            try {
              const peers = await aria2Store.service.getPeers(gid.value)
              taskPeers.value = peers || []
            } catch (error) {
              console.warn('Failed to get peers:', error)
              taskPeers.value = []
            }
          }

          // 获取服务器信息
          try {
            const servers = await aria2Store.service.getServers(gid.value)
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
    ElMessage.error('加载任务详情失败')
  } finally {
    loading.value = false
  }
}

function findTaskInStore(gid: string): Aria2Task | null {
  // 在所有任务列表中查找
  const allTasks = [
    ...aria2Store.activeTasks,
    ...aria2Store.waitingTasks,
    ...aria2Store.stoppedTasks
  ]

  return allTasks.find(t => t.gid === gid) || null
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
  const speedNum = parseInt(speed) || 0
  return utilFormatSpeed(speedNum)
}

function formatRemainingTime(task: Aria2Task): string {
  const remainingSeconds = getTaskRemainingTime(task)
  return formatTime(remainingSeconds)
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

function getProgress(task: Aria2Task): number {
  const total = parseInt(task.totalLength)
  const completed = parseInt(task.completedLength)

  if (total === 0) return 0
  return Math.round((completed / total) * 100)
}

function getFileProgress(file: Aria2File): number {
  const total = parseInt(file.length)
  const completed = parseInt(file.completedLength)

  if (total === 0) return 0
  return Math.round((completed / total) * 100)
}

function getFileName(path: string): string {
  return path.split('/').pop() || path.split('\\').pop() || path
}

// URI 去重函数
function deduplicateUris(uris: any[]): any[] {
  if (!uris || uris.length === 0) return []

  const seen = new Set<string>()
  const uniqueUris: any[] = []

  uris.forEach(uri => {
    // 处理不同的 URI 数据格式
    let uriKey: string
    if (typeof uri === 'string') {
      uriKey = uri
    } else if (uri && uri.uri) {
      uriKey = uri.uri
    } else {
      return // 跳过无效的 URI
    }

    // 去重：如果这个 URI 还没有见过，就添加到结果中
    if (!seen.has(uriKey)) {
      seen.add(uriKey)
      uniqueUris.push(uri)
    }
  })

  if (uris.length !== uniqueUris.length) {
    console.log(`URI 去重: ${uris.length} -> ${uniqueUris.length} (移除了 ${uris.length - uniqueUris.length} 个重复项)`)
  }

  return uniqueUris
}

function isDirectory(path: string): boolean {
  return path.endsWith('/') || path.endsWith('\\')
}

function formatDate(timestamp: string): string {
  if (!timestamp || timestamp === '0') return '未知'
  const date = new Date(parseInt(timestamp) * 1000)
  return date.toLocaleString()
}

function copyGid() {
  if (task.value?.gid) {
    navigator.clipboard.writeText(task.value.gid)
    ElMessage.success('GID 已复制到剪贴板')
  }
}

function copyFilePath(path: string) {
  navigator.clipboard.writeText(path)
  ElMessage.success('文件路径已复制到剪贴板')
}

function copyUri(uri: string) {
  navigator.clipboard.writeText(uri)
  ElMessage.success('下载链接已复制到剪贴板')
}

function formatUri(uri: string): string {
  if (!uri) return ''

  // 如果URI太长，进行截断显示
  if (uri.length > 80) {
    const start = uri.substring(0, 40)
    const end = uri.substring(uri.length - 30)
    return `${start}...${end}`
  }

  return uri
}

async function openFileInFolder(filePath: string) {
  if (!window.electronAPI) {
    ElMessage.warning('此功能仅在桌面版中可用')
    return
  }

  try {
    console.log('Opening file in folder:', filePath)
    const result = await window.electronAPI.showItemInFolder(filePath)
    if (result?.success) {
      ElMessage.success('已打开文件位置')
    } else {
      ElMessage.error(`打开文件位置失败: ${result?.error || '未知错误'}`)
    }
  } catch (error) {
    console.error('Failed to open file in folder:', error)
    ElMessage.error('打开文件位置失败')
  }
}

async function openFile(filePath: string) {
  if (!window.electronAPI) {
    ElMessage.warning('此功能仅在桌面版中可用')
    return
  }

  try {
    console.log('Opening file:', filePath)
    const result = await window.electronAPI.openPath(filePath)
    if (result?.success) {
      ElMessage.success('已打开文件')
    } else {
      ElMessage.error(`打开文件失败: ${result?.error || '未知错误'}`)
    }
  } catch (error) {
    console.error('Failed to open file:', error)
    ElMessage.error('打开文件失败')
  }
}

async function openFileLocation() {
  if (!window.electronAPI) {
    ElMessage.warning('此功能仅在桌面版中可用')
    return
  }

  if (!task.value?.dir) {
    ElMessage.warning('没有找到文件目录信息')
    return
  }

  try {
    let result

    // 优先使用 Windows Explorer 方法（如果可用）
    if (window.electronAPI.openInExplorer) {
      console.log('Using Windows Explorer method')

      // 如果有具体的文件，打开文件位置
      if (task.value.files && task.value.files.length > 0) {
        const firstFile = task.value.files[0]
        if (firstFile.path) {
          result = await window.electronAPI.openInExplorer(firstFile.path)
          if (result?.success) {
            ElMessage.success('已打开文件位置')
            return
          }
        }
      }

      // 否则打开目录
      result = await window.electronAPI.openInExplorer(task.value.dir)
      if (result?.success) {
        ElMessage.success('已打开目录')
        return
      }
    }

    // 备用方法：使用 showItemInFolder
    console.log('Fallback to showItemInFolder method')
    if (task.value.files && task.value.files.length > 0) {
      const firstFile = task.value.files[0]
      if (firstFile.path) {
        result = await window.electronAPI.showItemInFolder(firstFile.path)
        if (result?.success) {
          ElMessage.success('已打开文件位置')
          return
        }
      }
    }

    // 最后尝试 openPath
    result = await window.electronAPI.openPath(task.value.dir)
    if (result?.success) {
      ElMessage.success('已打开目录')
    } else {
      ElMessage.error(`打开目录失败: ${result?.error || '未知错误'}`)
    }
  } catch (error) {
    console.error('Failed to open file location:', error)
    ElMessage.error('打开目录失败')
  }
}

function showFileUris(file: Aria2File) {
  selectedFileUris.value = file.uris || []
  uriDialogVisible.value = true
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

function getServerStatusType(status: string): string {
  switch (status) {
    case 'used': return 'success'
    case 'waiting': return 'warning'
    default: return 'info'
  }
}

function getServerStatusText(status: string): string {
  switch (status) {
    case 'used': return '使用中'
    case 'waiting': return '等待中'
    default: return status || '未知'
  }
}

function getPeerStatusType(amChoking: boolean, peerChoking: boolean): string {
  if (!amChoking && !peerChoking) return 'success'
  if (amChoking && peerChoking) return 'danger'
  return 'warning'
}

function getPeerStatusText(amChoking: boolean, peerChoking: boolean): string {
  if (!amChoking && !peerChoking) return '正常'
  if (amChoking && peerChoking) return '阻塞'
  if (amChoking) return '我方阻塞'
  if (peerChoking) return '对方阻塞'
  return '未知'
}

function getCompletedPieces(): string {
  if (!task.value?.bitfield) return '0'

  // 简单计算已完成的区块数
  const bitfield = task.value.bitfield
  let completed = 0
  for (let i = 0; i < bitfield.length; i++) {
    const byte = parseInt(bitfield.substr(i * 2, 2), 16)
    for (let j = 0; j < 8; j++) {
      if (byte & (1 << (7 - j))) completed++
    }
  }

  return completed.toString()
}

function getPiecesStatus(): boolean[] {
  if (!task.value?.bitfield || !task.value?.numPieces) return []

  const numPieces = parseInt(task.value.numPieces)
  const bitfield = task.value.bitfield
  const pieces: boolean[] = []

  // 限制显示的区块数量，避免页面卡顿
  const maxDisplay = Math.min(numPieces, 1000)

  for (let i = 0; i < maxDisplay; i++) {
    const byteIndex = Math.floor(i / 8)
    const bitIndex = i % 8

    if (byteIndex * 2 + 1 < bitfield.length) {
      const byte = parseInt(bitfield.substr(byteIndex * 2, 2), 16)
      pieces.push(!!(byte & (1 << (7 - bitIndex))))
    } else {
      pieces.push(false)
    }
  }

  return pieces
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
}

.loading {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 200px;
}

.info-card {
  margin-bottom: 20px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.file-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.file-icon {
  font-size: 18px;
  color: #409eff;
}

.file-details {
  flex: 1;
  min-width: 0;
}

.file-name {
  font-weight: 500;
  color: #303133;
  margin-bottom: 4px;
}

.file-path {
  font-size: 12px;
  color: #909399;
  word-break: break-all;
}

:deep(.el-descriptions__label) {
  font-weight: 500;
}

:deep(.el-card__header) {
  padding: 16px 20px;
  background-color: #fafafa;
}

:deep(.el-card__body) {
  padding: 20px;
}

.action-bar {
  margin-bottom: 20px;
  padding: 16px;
  background-color: #fafafa;
  border-radius: 8px;
}

.detail-tabs {
  margin-top: 0;
}

:deep(.el-tabs__header) {
  margin-bottom: 20px;
}

.server-item {
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.server-item:last-child {
  margin-bottom: 0;
}

.pieces-info {
  margin-bottom: 20px;
}

.pieces-visual h4 {
  margin: 0 0 16px 0;
  font-size: 16px;
  font-weight: 600;
}

.pieces-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(12px, 1fr));
  gap: 2px;
  max-width: 100%;
  margin-bottom: 16px;
  background-color: #f0f0f0;
  padding: 12px;
  border-radius: 6px;
}

.piece-block {
  width: 12px;
  height: 12px;
  border-radius: 2px;
  cursor: pointer;
  transition: all 0.2s;
}

.piece-block.completed {
  background-color: #67c23a;
}

.piece-block.pending {
  background-color: #e4e7ed;
}

.piece-block:hover {
  transform: scale(1.5);
  z-index: 1;
  position: relative;
}

.pieces-legend {
  display: flex;
  gap: 16px;
  align-items: center;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
}

.legend-color {
  width: 12px;
  height: 12px;
  border-radius: 2px;
}

.legend-color.completed {
  background-color: #67c23a;
}

.legend-color.pending {
  background-color: #e4e7ed;
}

.uri-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.uri-file {
  font-size: 12px;
  color: #909399;
}

.no-uris-info {
  padding: 20px 0;
}

/* 整合卡片样式 */
.info-section {
  margin-bottom: 32px;
}

.info-section:last-child {
  margin-bottom: 0;
}

.section-title {
  margin: 0 0 16px 0;
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  border-bottom: 2px solid #409eff;
  padding-bottom: 8px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.section-header .section-title {
  margin-bottom: 0;
  border-bottom: none;
  padding-bottom: 0;
}

/* 文件信息样式 */
.single-file-info {
  padding: 0;
}

.file-actions {
  display: flex;
  justify-content: flex-start;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #ebeef5;
}

/* 任务描述表格样式 */
.task-descriptions :deep(.el-descriptions__label) {
  min-width: 120px !important;
  width: 120px !important;
  white-space: nowrap !important;
  text-align: left !important;
  padding-right: 16px !important;
}

.task-descriptions :deep(.el-descriptions__content) {
  min-width: 0;
  flex: 1;
}

/* 字段与操作按钮的内联样式 */
.field-with-action {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

/* 路径与操作按钮的内联样式 */
.path-with-action {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0;
  width: 100%;
}

.path-with-action span {
  word-break: break-all;
  line-height: 1.5;
}

.path-with-action .el-button {
  flex-shrink: 0;
  padding: 4px;
  min-width: auto;
  height: auto;
}

.path-with-action .el-button .el-icon {
  margin: 0;
  font-size: 14px;
}

.field-with-action .el-text {
  flex: 1;
  min-width: 0;
}

.field-with-action .el-button {
  flex-shrink: 0;
  padding: 4px;
  min-width: auto;
  height: auto;
}

.field-with-action .el-button .el-icon {
  margin: 0;
  font-size: 14px;
}

/* 下载链接特殊样式 */
.field-with-action .uri-content {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 12px;
  background-color: #f8f9fa;
  border-radius: 4px;
  border: 1px solid #e9ecef;
  flex: 1;
  min-width: 0;
}

.field-with-action .uri-text {
  flex: 1;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 12px;
  color: #606266;
  word-break: break-all;
  line-height: 1.4;
  min-width: 0;
}

/* 完整URL显示样式 */
.field-with-action .uri-content-full {
  display: flex;
  align-items: flex-start;
  padding: 12px;
  background-color: #f8f9fa;
  border-radius: 4px;
  border: 1px solid #e9ecef;
  flex: 1;
  min-width: 0;
  max-height: 120px;
  overflow-y: auto;
}

.field-with-action .uri-text-full {
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 11px;
  color: #606266;
  word-break: break-all;
  line-height: 1.5;
  white-space: pre-wrap;
  width: 100%;
}

.uri-item {
  padding: 16px;
  background-color: #f8f9fa;
  border-radius: 8px;
  border: 1px solid #e9ecef;
  transition: all 0.2s ease;
}

.uri-item:hover {
  border-color: #409eff;
  box-shadow: 0 2px 8px rgba(64, 158, 255, 0.1);
}

.uri-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.uri-label {
  font-weight: 500;
  color: #303133;
  font-size: 14px;
}

.uri-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.uri-display {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background-color: #ffffff;
  border-radius: 4px;
  border: 1px solid #dcdfe6;
}

.uri-text {
  flex: 1;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 12px;
  color: #606266;
  word-break: break-all;
  line-height: 1.4;
}

.uri-file {
  font-size: 12px;
  color: #909399;
  padding-left: 12px;
}

/* 旧的样式保持兼容 */
.uri-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

/* 优化文件信息显示 */
.file-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.file-icon {
  font-size: 16px;
  color: #409eff;
  flex-shrink: 0;
}

/* 响应式优化 */
@media (max-width: 768px) {
  .uri-info {
    flex-direction: column;
    align-items: flex-start;
  }

  .file-actions {
    flex-direction: column;
    gap: 8px;
  }

  .file-actions .el-space {
    width: 100%;
  }
}


</style>
