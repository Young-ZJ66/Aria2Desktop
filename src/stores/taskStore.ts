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

/** WS 事件补刷的最大递归深度，避免事件密集时无界递归 */
const MAX_RELOAD_DEPTH = 3

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
  // WS 事件到达时若正在轮询（isLoading 并发保护跳过），标记需要补刷一次
  let needsReload = false
  // 补刷递归深度计数（配合 MAX_RELOAD_DEPTH 限制无界递归）
  let reloadDepth = 0

  /**
   * 计算任务列表指纹（djb2 滚动哈希）。
   * 相比全量 stringify（map+join 生成 O(n) 大字符串），逐字符累加哈希，
   * 大列表（1000+）每秒轮询时显著降低内存与 CPU 开销。
   * 注：gid 为 16 位十六进制字符串，哈希碰撞概率可忽略。
   */
  function computeFingerprint(tasks: Aria2Task[]): string {
    let hash = 5381
    for (const task of tasks) {
      const gid = task.gid
      for (let j = 0; j < gid.length; j++) {
        hash = ((hash << 5) + hash + gid.charCodeAt(j)) >>> 0
      }
      hash = ((hash << 5) + hash + task.status.charCodeAt(0)) >>> 0
    }
    return hash.toString(36)
  }

  function setWaitingIfChanged(waiting: Aria2Task[]): void {
    const fp = computeFingerprint(waiting)
    if (fp !== waitingFingerprint) {
      waitingFingerprint = fp
      waitingTasks.value = waiting
    }
  }

  function setStoppedIfChanged(stopped: Aria2Task[]): void {
    const fp = computeFingerprint(stopped)
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

      // Promise.allSettled：单个列表拉取失败不影响其他列表，失败的保留旧值
      // 注：aria2Service.multicall 已实现但此处未使用——system.multicall 单方法失败时
      // 解析结构复杂（返回 [null, code] 占位），会牺牲 allSettled 的单列表容错，
      // 且只省 1 次 RPC 往返。权衡后维持独立三请求，保持健壮性优先。
      const [activeResult, waitingResult, stoppedResult] = await Promise.allSettled([
        connectionStore.service.tellActive(),
        connectionStore.service.tellWaiting(0, MAX_TELL_COUNT),
        connectionStore.service.tellStopped(0, MAX_TELL_COUNT)
      ])

      if (activeResult.status === 'fulfilled') {
        const active = activeResult.value
        // 记录新出现的活动任务的添加时间
        active.forEach(task => {
          if (!previousActive.has(task.gid)) {
            taskTimeService.recordTaskAdd(task.gid, getTaskName(task))
          }
        })
        activeTasks.value = active
      } else {
        console.warn('Failed to load active tasks:', activeResult.reason)
      }

      if (waitingResult.status === 'fulfilled') {
        // waiting 指纹相同时保留旧引用，避免无效响应式更新
        setWaitingIfChanged(waitingResult.value)
      } else {
        console.warn('Failed to load waiting tasks:', waitingResult.reason)
      }

      if (stoppedResult.status === 'fulfilled') {
        const stopped = stoppedResult.value
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
        // error/complete 任务统一保留在 stoppedTasks，由对应 computed 过滤
        setStoppedIfChanged(taskPersistenceService.mergeWithAria2Tasks(stopped))
      } else {
        console.warn('Failed to load stopped tasks:', stoppedResult.reason)
      }

    } catch (error) {
      console.error('Failed to load tasks:', error)
    } finally {
      isLoading.value = false
      // 轮询期间有 WS 事件到达（因 isLoading 并发保护被跳过）：补刷一次，避免丢失事件
      // 限制递归深度，防止事件密集时无限补刷
      if (needsReload) {
        needsReload = false
        if (reloadDepth < MAX_RELOAD_DEPTH) {
          reloadDepth++
          void loadAllTasks().finally(() => reloadDepth--)
        } else {
          reloadDepth = 0
          console.warn('loadAllTasks reload depth exceeded, skipping extra reload')
        }
      }
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
      // Promise.allSettled：单个列表拉取失败不影响另一个，与 loadAllTasks 容错策略一致
      const [activeResult, waitingResult] = await Promise.allSettled([
        connectionStore.service.tellActive(),
        connectionStore.service.tellWaiting(0, MAX_TELL_COUNT)
      ])

      if (activeResult.status === 'fulfilled') {
        const active = activeResult.value
        const previousActive = new Set(activeTasks.value.map(task => task.gid))
        active.forEach(task => {
          if (!previousActive.has(task.gid)) {
            taskTimeService.recordTaskAdd(task.gid, getTaskName(task))
          }
        })
        activeTasks.value = active
      } else {
        console.warn('Failed to load active tasks:', activeResult.reason)
      }

      if (waitingResult.status === 'fulfilled') {
        setWaitingIfChanged(waitingResult.value)
      } else {
        console.warn('Failed to load waiting tasks:', waitingResult.reason)
      }
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

  /**
   * 收集要删除的文件路径（趁任务记录还在时获取，统一使用删除服务的路径处理逻辑）
   * 失败时返回空数组并告警，不阻断主流程
   */
  function collectTaskFiles(task: Aria2Task | undefined, deleteFiles: boolean): string[] {
    let taskFiles: string[] = []
    if (deleteFiles && window.electronAPI && task) {
      try {
        taskFiles = completedTaskDeleteService.getTaskFilePaths(task)
      } catch (error) {
        console.warn('Failed to get files for deletion:', error)
      }
    }
    return taskFiles
  }

  /**
   * 删除任务文件：任一失败时抛出错误并保留任务记录，用户可重试。
   * 由调用方保证 deleteFiles 与 window.electronAPI.deleteFiles 存在
   */
  async function removeTaskFiles(task: Aria2Task | undefined, taskFiles: string[]): Promise<void> {
    const deleteResult = await window.electronAPI!.deleteFiles(taskFiles, task?.dir)
    const failedItems = deleteResult?.results?.filter(r => !r.success) || []
    if (!deleteResult || !deleteResult.success || failedItems.length > 0) {
      const detail = failedItems[0]?.error || deleteResult?.error || 'unknown'
      throw new Error(`文件删除失败: ${detail}`)
    }
  }

  /** 清理 Aria2 侧任务记录（removeDownloadResult 可能失败，忽略） */
  async function removeTaskRecord(gid: string): Promise<void> {
    try {
      await connectionStore.service!.removeDownloadResult(gid)
    } catch {
      // removeDownloadResult 可能失败（任务已不存在），忽略
    }
  }

  /** 本地清理：从三个列表移除任务，并清理持久化记录与时间记录 */
  function removeTaskLocal(gid: string): void {
    activeTasks.value = activeTasks.value.filter(t => t.gid !== gid)
    waitingTasks.value = waitingTasks.value.filter(t => t.gid !== gid)
    stoppedTasks.value = stoppedTasks.value.filter(t => t.gid !== gid)

    taskPersistenceService.removePersistedTask(gid)
    taskTimeService.removeTaskTime(gid)
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
        // 持久化任务不在三个列表中，仅清理本地记录（等价于 removeTaskLocal 的持久化/时间部分）
        taskPersistenceService.removePersistedTask(gid)
        taskTimeService.removeTaskTime(gid)
      }
      await loadAllTasks()
      return true
    }

    // 查找任务以判断状态（活动/等待任务用 forceRemove，已停止任务直接清理结果）
    const task = [...activeTasks.value, ...waitingTasks.value, ...stoppedTasks.value].find(t => t.gid === gid)

    // 收集要删除的文件路径（趁任务记录还在时获取，统一使用删除服务的路径处理逻辑）
    const taskFiles = collectTaskFiles(task, deleteFiles)

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
      await removeTaskFiles(task, taskFiles)
    }

    // 文件删除成功后再清理任务记录
    await removeTaskRecord(gid)

    // 本地清理
    removeTaskLocal(gid)

    try { await connectionStore.service.saveSession() }
    catch (error) { console.warn('saveSession after removeTask failed:', error) }
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
      // aria2 不允许 addUri 时指定 gid，透传会导致重试失败，需过滤
      delete (originalOptions as Record<string, unknown>).gid
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

  // WS 事件触发全量刷新；若正在轮询（isLoading 并发保护），标记补刷而非直接调用
  function handleDownloadEvent() {
    if (isLoading.value) {
      needsReload = true
    } else {
      void loadAllTasks()
    }
  }

  watch(() => connectionStore.service, (service, oldService) => {
    if (oldService) {
      downloadEvents.forEach(evt => oldService.off(evt, handleDownloadEvent))
    }
    if (service) {
      downloadEvents.forEach(evt => service.on(evt, handleDownloadEvent))
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
