import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { Aria2Service } from '@/services/aria2Service'
import { taskTimeService } from '@/services/taskTimeService'
import { taskPersistenceService } from '@/services/taskPersistenceService'
import type { 
  Aria2Config, 
  Aria2Task, 
  Aria2GlobalStat, 
  Aria2Version,
  Aria2Option 
} from '@/types/aria2'

export const useAria2Store = defineStore('aria2', () => {
  // 状态
  const service = ref<Aria2Service | null>(null)
  const isConnected = ref(false)
  const isConnecting = ref(false)
  const connectionError = ref<string | null>(null)
  
  // 任务数据
  const activeTasks = ref<Aria2Task[]>([])
  const waitingTasks = ref<Aria2Task[]>([])
  const stoppedTasks = ref<Aria2Task[]>([])
  const selectedTaskGids = ref<Set<string>>(new Set())
  
  // 全局统计
  const globalStat = ref<Aria2GlobalStat>({
    downloadSpeed: '0',
    uploadSpeed: '0',
    numActive: '0',
    numWaiting: '0',
    numStopped: '0',
    numStoppedTotal: '0'
  })
  
  // 版本信息
  const version = ref<Aria2Version | null>(null)
  
  // 全局选项
  const globalOptions = ref<Aria2Option>({})
  
  // 配置
  const config = ref<Aria2Config>({
    host: 'localhost',
    port: 6800,
    protocol: 'http',
    secret: '',
    path: '/jsonrpc'
  })

  // 计算属性
  const allTasks = computed(() => [
    ...activeTasks.value,
    ...waitingTasks.value,
    ...stoppedTasks.value
  ])

  const totalTasks = computed(() => allTasks.value.length)
  
  const downloadingTasks = computed(() => 
    activeTasks.value.filter(task => task.status === 'active')
  )
  
  const completedTasks = computed(() => 
    stoppedTasks.value.filter(task => task.status === 'complete')
  )
  
  const errorTasks = computed(() => 
    stoppedTasks.value.filter(task => task.status === 'error')
  )

  const hasSelectedTasks = computed(() => selectedTaskGids.value.size > 0)

  // 连接管理
  async function connect(newConfig?: Partial<Aria2Config>) {
    if (newConfig) {
      config.value = { ...config.value, ...newConfig }
    }
    
    isConnecting.value = true
    connectionError.value = null
    
    try {
      if (service.value) {
        service.value.disconnect()
      }
      
      service.value = new Aria2Service(config.value)
      
      // 设置事件监听
      setupEventListeners()
      
      // 尝试连接WebSocket
      try {
        await service.value.connect()
        isConnected.value = true
      } catch (wsError) {
        console.warn('WebSocket connection failed, using HTTP:', wsError)
        // WebSocket连接失败，使用HTTP模式
        isConnected.value = true
      }
      
      // 获取初始数据
      await Promise.all([
        loadVersion(),
        loadGlobalStat(),
        loadGlobalOptions(),
        loadAllTasks()
      ])

      // 启动自动更新
      startAutoUpdate()
      
    } catch (error) {
      connectionError.value = error instanceof Error ? error.message : 'Connection failed'
      isConnected.value = false
      throw error
    } finally {
      isConnecting.value = false
    }
  }

  function disconnect() {
    if (service.value) {
      service.value.disconnect()
      service.value = null
    }
    isConnected.value = false
    connectionError.value = null
  }

  function setupEventListeners() {
    if (!service.value) return

    service.value.on('connected', () => {
      isConnected.value = true
      connectionError.value = null
    })

    service.value.on('disconnected', () => {
      isConnected.value = false
    })

    service.value.on('error', (error: any) => {
      connectionError.value = error.message || 'Connection error'
    })

    // 任务事件监听
    service.value.on('downloadStart', (event: any) => {
      loadAllTasks()
    })

    service.value.on('downloadPause', (event: any) => {
      loadAllTasks()
    })

    service.value.on('downloadStop', (event: any) => {
      loadAllTasks()
    })

    service.value.on('downloadComplete', (event: any) => {
      loadAllTasks()
    })

    service.value.on('downloadError', (event: any) => {
      loadAllTasks()
    })
  }

  // 数据加载
  async function loadVersion() {
    if (!service.value) return
    try {
      version.value = await service.value.getVersion()
    } catch (error) {
      console.error('Failed to load version:', error)
    }
  }

  async function loadGlobalStat() {
    if (!service.value) return
    try {
      globalStat.value = await service.value.getGlobalStat()
    } catch (error) {
      console.error('Failed to load global stat:', error)
    }
  }

  async function loadGlobalOptions() {
    if (!service.value) return
    try {
      globalOptions.value = await service.value.getGlobalOption()
    } catch (error) {
      console.error('Failed to load global options:', error)
    }
  }

  async function loadAllTasks() {
    if (!service.value) return

    try {
      // 保存之前的任务状态用于比较
      const previousStopped = new Set(stoppedTasks.value.map(task => task.gid))
      const previousActive = new Set(activeTasks.value.map(task => task.gid))

      const [active, waiting, stopped] = await Promise.all([
        service.value.tellActive(),
        service.value.tellWaiting(0, 1000),
        service.value.tellStopped(0, 1000)
      ])

      // 记录新添加的活跃任务
      active.forEach(task => {
        if (!previousActive.has(task.gid)) {
          const fileName = getTaskName(task)
          taskTimeService.recordTaskAdd(task.gid, fileName)
        }
      })

      // 记录新完成的任务并持久化
      stopped.forEach(task => {
        if (!previousStopped.has(task.gid) && task.status === 'complete') {
          const fileName = getTaskName(task)
          console.log(`Processing newly completed task: ${task.gid}`)

          // 只有当任务没有完成时间记录时才记录（避免重复记录）
          const existingCompleteTime = taskTimeService.getCompleteTime(task.gid)
          if (!existingCompleteTime) {
            console.log(`Recording complete time for task: ${task.gid}`)
            taskTimeService.recordTaskComplete(task.gid, fileName)
          } else {
            console.log(`Task ${task.gid} already has complete time: ${new Date(existingCompleteTime)}`)
          }

          // 只有当任务没有被持久化时才持久化（避免重复持久化）
          if (!taskPersistenceService.isTaskPersisted(task.gid)) {
            const completeTime = taskTimeService.getCompleteTime(task.gid) || Date.now()
            console.log(`Persisting task: ${task.gid} with complete time: ${new Date(completeTime)}`)
            taskPersistenceService.persistCompletedTask(task, completeTime)
          } else {
            console.log(`Task ${task.gid} already persisted`)
          }
        }
      })

      // 同步现有的 Aria2 已完成任务到持久化存储（但不覆盖已有记录）
      // 这主要用于首次启动时同步已存在的完成任务
      stopped.forEach(task => {
        if (task.status === 'complete' && !taskPersistenceService.isTaskPersisted(task.gid)) {
          console.log(`Syncing existing completed task: ${task.gid}`)

          // 检查是否有时间记录
          const existingCompleteTime = taskTimeService.getCompleteTime(task.gid)
          if (existingCompleteTime) {
            console.log(`Using existing complete time for task ${task.gid}: ${new Date(existingCompleteTime)}`)
            taskPersistenceService.persistCompletedTask(task, existingCompleteTime)
          } else {
            // 这是一个已存在的完成任务，我们不知道确切完成时间
            // 使用一个较早的时间戳，避免显示为刚完成
            const estimatedTime = Date.now() - (24 * 60 * 60 * 1000) // 假设24小时前完成
            console.log(`Estimating complete time for existing task ${task.gid}: ${new Date(estimatedTime)}`)
            taskPersistenceService.persistCompletedTask(task, estimatedTime)
          }
        }
      })

      // 合并 Aria2 任务和持久化任务
      const mergedStoppedTasks = taskPersistenceService.mergeWithAria2Tasks(stopped)

      activeTasks.value = active
      waitingTasks.value = waiting
      stoppedTasks.value = mergedStoppedTasks
    } catch (error) {
      console.error('Failed to load tasks:', error)
    }
  }

  // 获取任务名称的辅助函数
  function getTaskName(task: Aria2Task): string {
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

  // 任务操作
  async function addUri(uris: string[], options?: Aria2Option) {
    if (!service.value) throw new Error('Not connected')

    const gid = await service.value.addUri(uris, options)

    // 记录任务添加时间
    const fileName = uris[0]?.split('/').pop() || uris[0]?.split('\\').pop() || 'Unknown'
    taskTimeService.recordTaskAdd(gid, fileName)

    await loadAllTasks()
    return gid
  }

  async function addTorrent(torrent: string, uris?: string[], options?: Aria2Option) {
    if (!service.value) throw new Error('Not connected')

    const gid = await service.value.addTorrent(torrent, uris, options)

    // 记录任务添加时间（种子文件名暂时未知，后续会在 loadAllTasks 中更新）
    taskTimeService.recordTaskAdd(gid, 'Torrent Task')

    await loadAllTasks()
    return gid
  }

  async function pauseTask(gid: string, force = false) {
    if (!service.value) throw new Error('Not connected')

    console.log(`${force ? 'Force pausing' : 'Pausing'} task:`, gid)

    try {
      let result
      if (force) {
        result = await service.value.forcePause(gid)
      } else {
        result = await service.value.pause(gid)
      }
      console.log('Pause command result:', result)

      // 等待一下确保命令生效
      await new Promise(resolve => setTimeout(resolve, 200))

      return result
    } catch (error) {
      console.error('Pause operation failed:', error)
      throw error
    }
  }

  async function unpauseTask(gid: string) {
    if (!service.value) throw new Error('Not connected')

    console.log('Unpausing task:', gid)

    try {
      const result = await service.value.unpause(gid)
      console.log('Unpause command result:', result)

      // 等待一下确保命令生效
      await new Promise(resolve => setTimeout(resolve, 200))

      return result
    } catch (error) {
      console.error('Unpause operation failed:', error)
      throw error
    }
  }

  // 验证任务是否存在
  async function verifyTaskExists(gid: string): Promise<boolean> {
    if (!service.value) return false

    try {
      await service.value.tellStatus(gid)
      return true
    } catch (error) {
      console.log('Task does not exist in Aria2:', gid)
      return false
    }
  }

  async function removeTask(gid: string, force = false, deleteFiles = false) {
    if (!service.value) throw new Error('Not connected')

    let taskFiles: string[] = []

    // 检查是否是持久化任务
    const isPersistedTask = taskPersistenceService.isTaskPersisted(gid)

    if (isPersistedTask) {
      // 如果是持久化任务，直接从本地存储删除
      taskPersistenceService.removePersistedTask(gid)
      taskTimeService.removeTaskTime(gid)
      await loadAllTasks()
      return true
    }

    // 先验证任务是否存在
    const taskExists = await verifyTaskExists(gid)
    console.log('Task exists in Aria2:', taskExists, 'GID:', gid)

    // 如果需要删除文件，先获取文件列表
    if (deleteFiles) {
      console.log('Delete files requested for task:', gid)
      console.log('Electron API available:', !!window.electronAPI)
      console.log('Delete files function available:', !!window.electronAPI?.deleteFiles)

      if (window.electronAPI?.deleteFiles) {
        try {
          const task = findTaskByGid(gid)
          console.log('Found task for deletion:', task)

          if (task && task.files && task.files.length > 0) {
            taskFiles = task.files
              .map(file => file.path)
              .filter(path => path && path.trim() && path !== '')
            console.log('Task files to delete:', taskFiles)
            console.log('Number of files to delete:', taskFiles.length)
          } else {
            console.log('No files found for task:', gid)
            console.log('Task files array:', task?.files)
          }
        } catch (error) {
          console.warn('Failed to get task files for deletion:', error)
        }
      } else {
        console.warn('Electron API deleteFiles not available')
      }
    }

    // 删除任务（只有当任务存在时才删除）
    if (taskExists) {
      try {
        if (force) {
          await service.value.forceRemove(gid)
        } else {
          await service.value.remove(gid)
        }
        console.log('Task removed from Aria2:', gid)
      } catch (error) {
        console.warn('Failed to remove task from Aria2:', error)

        // 检查是否是任务不存在的错误
        if (error.message && error.message.includes('not found')) {
          console.log('Task not found in Aria2, continuing with cleanup')
        } else {
          // 其他错误，重新抛出
          throw error
        }
      }
    } else {
      console.log('Task does not exist in Aria2, skipping removal')
    }

    // 删除文件
    if (deleteFiles) {
      console.log('Attempting to delete files...')
      console.log('Task files array:', taskFiles)
      console.log('Task files length:', taskFiles.length)
      console.log('Electron API available:', !!window.electronAPI?.deleteFiles)

      if (taskFiles.length > 0 && window.electronAPI?.deleteFiles) {
        try {
          console.log('Calling Electron API to delete files:', taskFiles)
          const result = await window.electronAPI.deleteFiles(taskFiles)
          console.log('File deletion result:', result)

          if (result.success) {
            const successCount = result.results?.filter((r: any) => r.success).length || 0
            const failCount = (result.results?.length || 0) - successCount
            console.log(`File deletion summary: ${successCount} success, ${failCount} failed`)

            if (failCount > 0) {
              const failedFiles = result.results?.filter((r: any) => !r.success) || []
              console.warn('Failed to delete files:', failedFiles)
            }
          } else {
            console.error('File deletion failed:', result.error)
            throw new Error(`文件删除失败: ${result.error}`)
          }
        } catch (error) {
          console.error('Failed to delete task files:', error)
          throw new Error(`删除文件时发生错误: ${error instanceof Error ? error.message : String(error)}`)
        }
      } else if (deleteFiles) {
        if (!window.electronAPI?.deleteFiles) {
          console.error('Electron API deleteFiles not available')
          throw new Error('文件删除功能不可用（需要桌面版）')
        } else if (taskFiles.length === 0) {
          console.warn('No files to delete for task:', gid)
          console.warn('This might be because the task has no files or files could not be retrieved')
        }
      }
    }

    // 清理持久化记录和时间记录
    taskPersistenceService.removePersistedTask(gid)
    taskTimeService.removeTaskTime(gid)

    await loadAllTasks()
  }

  async function pauseAllTasks() {
    if (!service.value) throw new Error('Not connected')
    
    await service.value.pauseAll()
    await loadAllTasks()
  }

  async function unpauseAllTasks() {
    if (!service.value) throw new Error('Not connected')
    
    await service.value.unpauseAll()
    await loadAllTasks()
  }

  // 批量操作
  async function pauseSelectedTasks() {
    if (!service.value || selectedTaskGids.value.size === 0) return
    
    const promises = Array.from(selectedTaskGids.value).map(gid => 
      service.value!.pause(gid).catch(console.error)
    )
    
    await Promise.all(promises)
    await loadAllTasks()
  }

  async function unpauseSelectedTasks() {
    if (!service.value || selectedTaskGids.value.size === 0) return
    
    const promises = Array.from(selectedTaskGids.value).map(gid => 
      service.value!.unpause(gid).catch(console.error)
    )
    
    await Promise.all(promises)
    await loadAllTasks()
  }

  async function removeSelectedTasks(force = false, deleteFiles = false) {
    if (!service.value || selectedTaskGids.value.size === 0) return

    const promises = Array.from(selectedTaskGids.value).map(gid =>
      removeTask(gid, force, deleteFiles).catch(console.error)
    )

    await Promise.all(promises)
    selectedTaskGids.value.clear()
  }

  // 任务选择
  function selectTask(gid: string) {
    selectedTaskGids.value.add(gid)
  }

  function unselectTask(gid: string) {
    selectedTaskGids.value.delete(gid)
  }

  function toggleTaskSelection(gid: string) {
    if (selectedTaskGids.value.has(gid)) {
      selectedTaskGids.value.delete(gid)
    } else {
      selectedTaskGids.value.add(gid)
    }
  }

  function selectAllTasks() {
    allTasks.value.forEach(task => {
      selectedTaskGids.value.add(task.gid)
    })
  }

  function clearSelection() {
    selectedTaskGids.value.clear()
  }

  // 定期更新
  let updateInterval: number | null = null

  function startAutoUpdate(interval = 500) {
    if (updateInterval) {
      clearInterval(updateInterval)
    }

    updateInterval = setInterval(async () => {
      if (isConnected.value) {
        await Promise.all([
          loadGlobalStat(),
          loadAllTasks()
        ])
      }
    }, interval)
  }

  function stopAutoUpdate() {
    if (updateInterval) {
      clearInterval(updateInterval)
      updateInterval = null
    }
  }

  // 辅助函数：根据 GID 查找任务
  function findTaskByGid(gid: string) {
    const allTasks = [
      ...activeTasks.value,
      ...waitingTasks.value,
      ...stoppedTasks.value
    ]
    return allTasks.find(task => task.gid === gid)
  }

  // 清理不存在的任务
  async function cleanupNonExistentTasks() {
    if (!service.value) return

    const allTasks = [
      ...activeTasks.value,
      ...waitingTasks.value,
      ...stoppedTasks.value
    ]

    console.log('Checking for non-existent tasks...')

    for (const task of allTasks) {
      const exists = await verifyTaskExists(task.gid)
      if (!exists) {
        console.log('Removing non-existent task from local list:', task.gid)
        // 这里可以添加从本地列表中移除任务的逻辑
      }
    }
  }

  // 添加获取全局选项的方法
  async function getGlobalOptions() {
    if (!service.value) throw new Error('Not connected')
    try {
      const options = await service.value.getGlobalOption()
      console.log('Retrieved global options:', options)
      return options
    } catch (error) {
      console.error('Failed to get global options:', error)
      throw error
    }
  }

  // 添加修改全局选项的方法
  async function changeGlobalOptions(options: any) {
    if (!service.value) throw new Error('Not connected')
    try {
      const result = await service.value.changeGlobalOption(options)
      console.log('Changed global options result:', result)
      return result
    } catch (error) {
      console.error('Failed to change global options:', error)
      throw error
    }
  }

  return {
    // 状态
    service,
    isConnected,
    isConnecting,
    connectionError,
    config,
    
    // 数据
    activeTasks,
    waitingTasks,
    stoppedTasks,
    selectedTaskGids,
    globalStat,
    version,
    globalOptions,
    
    // 计算属性
    allTasks,
    totalTasks,
    downloadingTasks,
    completedTasks,
    errorTasks,
    hasSelectedTasks,
    
    // 方法
    connect,
    disconnect,
    loadAllTasks,
    loadGlobalStat,
    addUri,
    addTorrent,
    pauseTask,
    unpauseTask,
    removeTask,
    pauseAllTasks,
    unpauseAllTasks,
    pauseSelectedTasks,
    unpauseSelectedTasks,
    removeSelectedTasks,
    selectTask,
    unselectTask,
    toggleTaskSelection,
    selectAllTasks,
    clearSelection,
    startAutoUpdate,
    stopAutoUpdate,
    getGlobalOptions,
    changeGlobalOptions,
    cleanupNonExistentTasks
  }
})
