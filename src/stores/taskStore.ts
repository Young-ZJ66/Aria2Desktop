import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { useConnectionStore } from './connectionStore'
import { taskTimeService } from '@/services/taskTimeService'
import { taskPersistenceService } from '@/services/taskPersistenceService'
import { sessionManager } from '@/services/sessionManager'
import { completedTaskDeleteService } from '@/services/completedTaskDeleteService'
import { getTaskName } from '@/utils/taskUtils'
import type { Aria2Task, Aria2Option } from '@/types/aria2'
import type { Aria2ClientEvent } from '@/services/aria2Client'

/** 单次拉取等待/停止任务的最大数量 */
const MAX_TELL_COUNT = 1000

export const useTaskStore = defineStore('task', () => {
  const connectionStore = useConnectionStore()

  // 状态
  const activeTasks = ref<Aria2Task[]>([])
  const waitingTasks = ref<Aria2Task[]>([])
  const stoppedTasks = ref<Aria2Task[]>([])

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

  // 操作方法
  // 加载状态（响应式，供 UI 展示加载中；同时用作并发保护标志）
  const isLoading = ref(false)

  // waiting/stopped 列表指纹（gid+status）：未变化时保留旧数组引用，
  // 避免每秒轮询全量替换数组触发表格无效 diff 与全量重排序
  let waitingFingerprint = ''
  let stoppedFingerprint = ''

  function setWaitingIfChanged(waiting: Aria2Task[]): void {
    const fp = waiting.map(t => `${t.gid}:${t.status}`).join('|')
    if (fp !== waitingFingerprint) {
      waitingFingerprint = fp
      waitingTasks.value = waiting
    }
  }

  function setStoppedIfChanged(stopped: Aria2Task[]): void {
    const fp = stopped.map(t => `${t.gid}:${t.status}`).join('|')
    if (fp !== stoppedFingerprint) {
      stoppedFingerprint = fp
      stoppedTasks.value = stopped
    }
  }

  async function loadAllTasks() {
    if (!connectionStore.service) return
    // 并发保护：轮询与 WS 事件同时触发时跳过后续调用，避免竞态
    if (isLoading.value) return
    isLoading.value = true

    try {
      // 确保本地持久化任务已从主进程加载完成，避免首次合并时丢失历史记录
      await taskPersistenceService.ensureLoaded()
      const previousStopped = new Set(stoppedTasks.value.map(task => task.gid))
      const previousActive = new Set(activeTasks.value.map(task => task.gid))

      const [active, waiting, stopped] = await Promise.all([
        connectionStore.service.tellActive(),
        connectionStore.service.tellWaiting(0, MAX_TELL_COUNT),
        connectionStore.service.tellStopped(0, MAX_TELL_COUNT)
      ])

      // 记录新出现的活动任务的添加时间
      active.forEach(task => {
        if (!previousActive.has(task.gid)) {
          taskTimeService.recordTaskAdd(task.gid, getTaskName(task))
        }
      })

      // 持久化已完成任务（合并记录时间与持久化逻辑）
      stopped.forEach(task => {
        if (task.status !== 'complete') return
        if (taskPersistenceService.isTaskPersisted(task.gid)) return

        const isNew = !previousStopped.has(task.gid)
        if (isNew && !taskTimeService.getCompleteTime(task.gid)) {
          taskTimeService.recordTaskComplete(task.gid, getTaskName(task))
        }
        // 新完成任务用记录时间/当前时间；启动时已存在的老任务估算为 24 小时前
        const completeTime = taskTimeService.getCompleteTime(task.gid)
          ?? (isNew ? Date.now() : Date.now() - 24 * 60 * 60 * 1000)
        taskPersistenceService.persistCompletedTask(task, completeTime)
      })

      activeTasks.value = active
      // waiting/stopped 指纹相同时保留旧引用，避免无效响应式更新
      setWaitingIfChanged(waiting)
      // error/complete 任务统一保留在 stoppedTasks，由对应 computed 过滤
      setStoppedIfChanged(taskPersistenceService.mergeWithAria2Tasks(stopped))

    } catch (error) {
      console.error('Failed to load tasks:', error)
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 高频轻量刷新：仅拉取活动/等待任务（速度等实时字段）。
   * stopped 列表由低频全量刷新与 WS 下载事件负责，降低大任务列表时的轮询开销。
   */
  async function loadLightTasks() {
    if (!connectionStore.service) return
    if (isLoading.value) return
    isLoading.value = true

    try {
      const [active, waiting] = await Promise.all([
        connectionStore.service.tellActive(),
        connectionStore.service.tellWaiting(0, MAX_TELL_COUNT)
      ])

      const previousActive = new Set(activeTasks.value.map(task => task.gid))
      active.forEach(task => {
        if (!previousActive.has(task.gid)) {
          taskTimeService.recordTaskAdd(task.gid, getTaskName(task))
        }
      })

      activeTasks.value = active
      setWaitingIfChanged(waiting)
    } catch (error) {
      console.error('Failed to load active tasks:', error)
    } finally {
      isLoading.value = false
    }
  }

  /** 新任务添加后的统一收尾：记录时间、标记防抖保存并立即保存一次会话 */
  async function afterTaskAdded(gids: string[], fallbackName: string) {
    for (const gid of gids) {
      taskTimeService.recordTaskAdd(gid, fallbackName)
      sessionManager.markTaskForSave(gid)
    }
    // 立即保存一次会话，避免应用在防抖窗口内退出导致新任务丢失
    try {
      await connectionStore.service!.saveSession()
    } catch (error) {
      console.warn('Failed to save session immediately:', error)
    }
  }

  async function addUri(uris: string[], options?: Aria2Option) {
    if (!connectionStore.service) throw new Error('Not connected')

    const gid = await connectionStore.service.addUri(uris, options)

    const fileName = uris[0]?.split('/').pop() || uris[0]?.split('\\').pop() || 'Unknown'
    await afterTaskAdded([gid], fileName)

    await loadAllTasks()
    return gid
  }

  async function addTorrent(torrent: string, uris?: string[], options?: Aria2Option) {
    if (!connectionStore.service) throw new Error('Not connected')

    const gid = await connectionStore.service.addTorrent(torrent, uris, options)

    await afterTaskAdded([gid], 'Torrent Task')

    await loadAllTasks()
    return gid
  }

  async function addMetalink(metalink: string, options?: Aria2Option) {
    if (!connectionStore.service) throw new Error('Not connected')

    const gids = await connectionStore.service.addMetalink(metalink, options)

    await afterTaskAdded(gids, 'Metalink Task')

    await loadAllTasks()
    return gids
  }

  async function removeTask(gid: string, deleteFiles = false) {
    if (!connectionStore.service) throw new Error('Not connected')

    // 仅存在于本地持久化中的任务（Aria2 已不持有），统一走删除服务处理文件删除
    const isPersistedTask = taskPersistenceService.isTaskPersisted(gid)
    if (isPersistedTask) {
      const persisted = taskPersistenceService.getPersistedTask(gid)
      if (persisted && deleteFiles) {
        await completedTaskDeleteService.deleteCompletedTask(persisted, true, connectionStore.service)
      } else {
        taskPersistenceService.removePersistedTask(gid)
        taskTimeService.removeTaskTime(gid)
      }
      await loadAllTasks()
      return true
    }

    // 查找任务以判断状态（活动/等待任务用 forceRemove，已停止任务直接清理结果）
    const task = [...activeTasks.value, ...waitingTasks.value, ...stoppedTasks.value].find(t => t.gid === gid)

    // 收集要删除的文件路径（趁任务记录还在时获取，统一使用删除服务的路径处理逻辑）
    let taskFiles: string[] = []
    if (deleteFiles && window.electronAPI && task) {
      try {
        taskFiles = completedTaskDeleteService.getTaskFilePaths(task)
      } catch (error) {
        console.warn('Failed to get files for deletion:', error)
      }
    }

    const isActive = task && (task.status === 'active' || task.status === 'waiting' || task.status === 'paused')

    // 活动/等待/暂停中的任务：先 forceRemove 停止下载并释放文件句柄（文件占用时删除会失败）
    if (isActive) {
      try {
        await connectionStore.service.forceRemove(gid)
      } catch (e) {
        console.warn('forceRemove failed:', e)
      }
    }

    // 先删文件：任一失败时抛出错误并保留任务记录，用户可重试；
    // 避免旧顺序（先清记录后删文件）失败后留下无入口的孤儿文件
    if (deleteFiles && taskFiles.length > 0 && window.electronAPI?.deleteFiles) {
      const deleteResult = await window.electronAPI.deleteFiles(taskFiles, task?.dir)
      const failedItems = deleteResult.results?.filter(r => !r.success) || []
      if (!deleteResult.success || failedItems.length > 0) {
        const detail = failedItems[0]?.error || deleteResult.error || 'unknown'
        throw new Error(`文件删除失败: ${detail}`)
      }
    }

    // 文件删除成功后再清理任务记录
    try {
      await connectionStore.service.removeDownloadResult(gid)
    } catch {
      // removeDownloadResult 可能失败（任务已不存在），忽略
    }

    // 本地清理
    activeTasks.value = activeTasks.value.filter(t => t.gid !== gid)
    waitingTasks.value = waitingTasks.value.filter(t => t.gid !== gid)
    stoppedTasks.value = stoppedTasks.value.filter(t => t.gid !== gid)

    taskPersistenceService.removePersistedTask(gid)
    taskTimeService.removeTaskTime(gid)

    try { await connectionStore.service.saveSession() } catch { /* 忽略会话保存失败 */ }
    await loadAllTasks()
  }

  // 其他操作
  async function pauseTask(gid: string, force = false) {
    if (!connectionStore.service) throw new Error('Not connected')
    if (force) await connectionStore.service.forcePause(gid)
    else await connectionStore.service.pause(gid)
    await loadAllTasks()
  }

  async function unpauseTask(gid: string) {
    if (!connectionStore.service) throw new Error('Not connected')
    await connectionStore.service.unpause(gid)
    await loadAllTasks()
  }

  async function retryErrorTask(gid: string) {
    if (!connectionStore.service) throw new Error('Not connected')
    // tellStatus -> 获取 URIs 与原任务选项 -> 删除 -> addUri（尽量保留原始下载选项）
    const taskInfo = await connectionStore.service.tellStatus(gid)
    const uris = taskInfo.files?.flatMap(f => f.uris || []).map(u => u.uri).filter(Boolean) || []
    if (uris.length === 0) throw new Error('No URIs found')

    // 读取原任务的选项（out、split、header 等），避免重试后行为与原任务不一致
    let originalOptions: Aria2Option = { dir: taskInfo.dir }
    try {
      originalOptions = await connectionStore.service.getOption(gid)
    } catch {
      // 获取选项失败时仅保留目录
    }

    // 删除旧任务
    try { await connectionStore.service.forceRemove(gid) } catch { /* 忽略旧任务删除失败 */ }
    try { await connectionStore.service.removeDownloadResult(gid) } catch { /* 忽略结果删除失败 */ }

    // 添加新任务（透传原始选项）
    const newGid = await connectionStore.service.addUri(uris, originalOptions)

    // 清理本地
    taskPersistenceService.removePersistedTask(gid)
    await loadAllTasks()
    return newGid
  }

  async function pauseAllTasks() {
    if (!connectionStore.service) return
    await connectionStore.service.pauseAll()
    await loadAllTasks()
  }

  async function unpauseAllTasks() {
    if (!connectionStore.service) return
    await connectionStore.service.unpauseAll()
    await loadAllTasks()
  }

  // 清空前端缓存的所有任务（断开连接 / 切换服务器时调用）
  function clearTasks() {
    activeTasks.value = []
    waitingTasks.value = []
    stoppedTasks.value = []
    // 重置指纹，避免切换服务器后同 gid 序列误命中导致不更新
    waitingFingerprint = ''
    stoppedFingerprint = ''
    taskPersistenceService.clearAllPersistedTasks()
    taskTimeService.clearAll()
  }

  // 监听器：service 变化时先移除旧监听器，避免重连后叠加刷新
  // immediate: 首次注册时 service 可能已存在（store 晚于连接创建），需立即绑定
  const downloadEvents: Aria2ClientEvent[] = [
    'downloadStart',
    'downloadPause',
    'downloadStop',
    'downloadComplete',
    'downloadError'
  ]

  watch(() => connectionStore.service, (service, oldService) => {
    if (oldService) {
      downloadEvents.forEach(evt => oldService.off(evt, loadAllTasks))
    }
    if (service) {
      downloadEvents.forEach(evt => service.on(evt, loadAllTasks))
    }
  }, { immediate: true })

  return {
    activeTasks,
    waitingTasks,
    stoppedTasks,
    allTasks,
    totalTasks,
    downloadingTasks,
    completedTasks,
    errorTasks,
    isLoading,
    loadAllTasks,
    loadLightTasks,
    addUri,
    addTorrent,
    addMetalink,
    removeTask,
    pauseTask,
    unpauseTask,
    retryErrorTask,
    pauseAllTasks,
    unpauseAllTasks,
    clearTasks
  }
})
