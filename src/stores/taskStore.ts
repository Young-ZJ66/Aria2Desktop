import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { useConnectionStore } from './connectionStore'
import { useSettingsStore } from './settingsStore'
import { taskTimeService } from '@/services/taskTimeService'
import { taskPersistenceService } from '@/services/taskPersistenceService'
import { taskSourceService, type TaskSource } from '@/services/taskSourceService'
import { sessionManager } from '@/services/sessionManager'
import { completedTaskDeleteService } from '@/services/completedTaskDeleteService'
import { getTaskName } from '@/utils/taskUtils'
import { computeTaskListFingerprint } from '@/utils/fingerprint'
import { useTrafficMonitor } from '@/composables/useTrafficMonitor'
import { findDuplicateUris, findMagnetDuplicates, normalizeUrlForCompare, type DuplicateMatch } from '@/utils/duplicateUrl'
import type { Aria2Task, Aria2Option } from '@/types/aria2'
import type { Aria2ClientEvent } from '@/services/aria2Client'

/** 单次拉取等待/停止任务的最大数量 */
const MAX_TELL_COUNT = 5000

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
  /** 进行中的全量刷新：并发调用复用它，而不是静默丢弃（见 loadAllTasks 的说明） */
  let loadAllInFlight: Promise<void> | null = null
  /** 进行中刷新所属的连接代次；连接切换后旧请求的返回一律丢弃 */
  let loadAllGeneration = -1
  /**
   * 连接代次：每次 service 变化或 clearTasks 时自增。
   * 异步加载在 await 之后必须重新校验代次，否则旧服务器的任务会被写进新连接的列表。
   */
  let connectionGeneration = 0
  let loadingGeneration = -1

  // 指纹算法已抽到 @/utils/fingerprint（纯函数，便于单测）
  function setWaitingIfChanged(waiting: Aria2Task[]): void {
    const fp = computeTaskListFingerprint(waiting)
    if (fp !== waitingFingerprint) {
      waitingFingerprint = fp
      waitingTasks.value = waiting
    }
  }

  function setStoppedIfChanged(stopped: Aria2Task[]): void {
    const fp = computeTaskListFingerprint(stopped)
    if (fp !== stoppedFingerprint) {
      stoppedFingerprint = fp
      stoppedTasks.value = stopped
    }
  }

  /**
   * 全量刷新（active + waiting + stopped）。
   *
   * 并发语义：**复用进行中的请求**而不是丢弃后来的调用。
   * 为什么这么改：所有操作路径（暂停/恢复/删除/重试/新建）都依赖 `await loadAllTasks()`
   * 来同步 UI，而 1s 轻量轮询或 30s 全量轮询随时可能正在飞。此前 `if (isLoading) return`
   * 会让这次刷新被静默吞掉——用户点完删除/暂停后界面可能仍是旧状态，且调用方无从察觉。
   */
  async function loadAllTasks(): Promise<void> {
    const service = connectionStore.service
    if (!service) return
    const generation = connectionGeneration
    if (loadAllInFlight && loadAllGeneration === generation) return loadAllInFlight

    const base = doLoadAllTasks(generation, service)
    const tracked: Promise<void> = base
      .finally(() => {
        // 只有"当前代次、当前请求"才能清 in-flight；旧代次的收尾不能把新请求的引用清掉
        if (loadAllGeneration === generation && loadAllInFlight === tracked) {
          loadAllInFlight = null
        }
      })
      // 补刷必须挂在"清空 in-flight"之后：否则这次补刷会复用刚结束的请求而变成空操作
      .then(() => {
        if (generation === connectionGeneration) scheduleReloadIfNeeded()
      })
    loadAllGeneration = generation
    loadAllInFlight = tracked
    return tracked
  }

  /**
   * 刷新期间有 WS 事件到达时补刷一次。
   * 限制递归深度，避免事件密集时无限补刷。
   */
  function scheduleReloadIfNeeded(): void {
    if (!needsReload) return
    needsReload = false

    if (reloadDepth >= MAX_RELOAD_DEPTH) {
      reloadDepth = 0
      console.warn('loadAllTasks reload depth exceeded, skipping extra reload')
      return
    }

    reloadDepth++
    void loadAllTasks().finally(() => {
      reloadDepth--
    })
  }

  async function doLoadAllTasks(generation: number, service: NonNullable<typeof connectionStore.service>): Promise<void> {
    if (generation !== connectionGeneration || connectionStore.service !== service) return

    loadingGeneration = generation
    isLoading.value = true

    try {
      // 确保本地持久化数据已从主进程加载完成
      await taskPersistenceService.ensureLoaded()
      const previousStopped = new Set(stoppedTasks.value.map(task => task.gid))
      const previousActive = new Set(activeTasks.value.map(task => task.gid))
      const previousWaiting = new Set(waitingTasks.value.map(task => task.gid))

      // 优先用 system.multicall 把三张列表合并为一次 RPC（原实现要 3 次往返）。
      // system.multicall 的单项失败会以 { code, message } 对象占位，不会让整批抛错，
      // 因此仍能保持"单个列表失败只保留旧值"的容错语义；整体 RPC 失败时回退三请求。
      type SettledList = { status: 'fulfilled'; value: Aria2Task[] } | { status: 'rejected'; reason: unknown }
      let activeResult: SettledList
      let waitingResult: SettledList
      let stoppedResult: SettledList
      try {
        const batch = await service.multicall([
          { methodName: 'aria2.tellActive', params: [] },
          { methodName: 'aria2.tellWaiting', params: [0, MAX_TELL_COUNT] },
          { methodName: 'aria2.tellStopped', params: [0, MAX_TELL_COUNT] }
        ])
        const toSettled = (entry: unknown): SettledList => {
          if (Array.isArray(entry)) return { status: 'fulfilled', value: entry[0] as Aria2Task[] }
          return { status: 'rejected', reason: entry }
        }
        activeResult = toSettled(batch[0])
        waitingResult = toSettled(batch[1])
        stoppedResult = toSettled(batch[2])
      } catch (batchError) {
        console.warn('system.multicall failed, falling back to individual calls:', batchError)
        const settled = await Promise.allSettled([
          service.tellActive(),
          service.tellWaiting(0, MAX_TELL_COUNT),
          service.tellStopped(0, MAX_TELL_COUNT)
        ])
        activeResult = settled[0]
        waitingResult = settled[1]
        stoppedResult = settled[2]
      }

      // 连接可能在请求期间被切换：旧请求的响应绝不能写入新连接的列表
      if (generation !== connectionGeneration || connectionStore.service !== service) return

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
        const mergedStopped = taskPersistenceService.mergeWithAria2Tasks(stopped)
        setStoppedIfChanged(mergedStopped)
        scheduleAutoRetries(mergedStopped, previousStopped, previousActive, previousWaiting)
      } else {
        console.warn('Failed to load stopped tasks:', stoppedResult.reason)
      }

    } catch (error) {
      console.error('Failed to load tasks:', error)
    } finally {
      if (loadingGeneration === generation) {
        isLoading.value = false
      }
      // 补刷由 loadAllTasks 的 .then 负责（需等 in-flight 标记清空后才发起）
    }
  }

  /**
   * 高频轻量刷新：仅拉取活动/等待任务（速度等实时字段）。
   * stopped 列表由低频全量刷新与 WS 下载事件负责，降低大任务列表时的轮询开销。
   */
  async function loadLightTasks() {
    const service = connectionStore.service
    if (!service) return
    if (isLoading.value) return
    const generation = connectionGeneration
    loadingGeneration = generation
    isLoading.value = true

    try {
      // 确保本地持久化任务已加载，避免首次轻量刷新时持久化任务未合并
      await taskPersistenceService.ensureLoaded()
    } catch {
      // 加载失败不阻断轻量刷新
    }

    try {
      if (generation !== connectionGeneration || connectionStore.service !== service) return
      // Promise.allSettled：单个列表拉取失败不影响另一个，与 loadAllTasks 容错策略一致
      const [activeResult, waitingResult] = await Promise.allSettled([
        service.tellActive(),
        service.tellWaiting(0, MAX_TELL_COUNT)
      ])

      if (generation !== connectionGeneration || connectionStore.service !== service) return

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
      if (loadingGeneration === generation) {
        isLoading.value = false
      }
      // 轻量轮询期间到达的 WS 事件（如 downloadError 把任务移入 stopped 列表）在
      // 轻量刷新里看不到，若不消费要等下一次 30s 全量才反映——这里补刷一次全量。
      // 复用 scheduleReloadIfNeeded 的深度限制，避免事件密集时无界循环。
      scheduleReloadIfNeeded()
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

  /**
   * 磁力链接 → gid 的会话级索引：aria2 不把 magnet URI 存进任务的 files[].uris
   * （实测 1.37 返回空数组），URL 比对路径对磁力任务天然不命中。
   * 添加任务时记录，应用重启后丢失（引擎侧同样查不到，行为一致地"查不到"）。
   *
   * 条目只在比对时顺手清理（任务已不在进行中）并限制总量：长时间挂机、
   * 反复加磁力任务时这张表只增不减会一直涨内存，而它只服务于"提交前查重"。
   */
  const magnetUriIndex = new Map<string, string>()
  const MAGNET_INDEX_LIMIT = 500

  /** 丢掉已完成/已删除任务的条目，并按插入顺序淘汰超出上限的老条目 */
  function pruneMagnetIndex(liveGids: Set<string>): void {
    for (const [uri, gid] of magnetUriIndex) {
      if (!liveGids.has(gid)) magnetUriIndex.delete(uri)
    }
    while (magnetUriIndex.size > MAGNET_INDEX_LIMIT) {
      const oldest = magnetUriIndex.keys().next()
      if (oldest.done) break
      magnetUriIndex.delete(oldest.value)
    }
  }

  /**
   * 查找与输入 URI 重复的进行中任务（active/waiting/paused）。
   * 新建任务页提交前调用，提前拦住"同一链接再下一份副本"的误操作；
   * 完成与出错任务不参与比对（重下/重试是有意行为）。纯比对，不发请求。
   */
  function findDuplicateTasks(uris: string[]): DuplicateMatch[] {
    const inProgress = [...activeTasks.value, ...waitingTasks.value]
    pruneMagnetIndex(new Set(inProgress.map(t => t.gid)))
    const matches = findDuplicateUris(uris, inProgress)
    const matchedInputs = new Set(matches.map(m => normalizeUrlForCompare(m.uri)))
    const remaining = uris.filter(u => !matchedInputs.has(normalizeUrlForCompare(u)))
    matches.push(...findMagnetDuplicates(remaining, magnetUriIndex, inProgress))
    return matches
  }

  async function addUri(uris: string[], options?: Aria2Option) {
    if (!connectionStore.service) throw new Error('Not connected')

    // 磁力任务要求 aria2 把元数据另存为 <infoHash>.torrent，供「保存 .torrent」导出；
    // 普通 HTTP 任务不受影响，不改变其它下载行为。
    const hasMagnet = uris.some((uri) => uri.trim().toLowerCase().startsWith('magnet:'))
    const effectiveOptions: Aria2Option | undefined = hasMagnet
      ? { ...(options ?? {}), 'bt-save-metadata': 'true' }
      : options

    const gid = await connectionStore.service.addUri(uris, effectiveOptions)

    // 记录原始来源：aria2 tellStatus 不会返回 magnet 原文，失败重试(尤其应用重启后)依赖这份记录
    taskSourceService.record(gid, { kind: 'uri', uris }, effectiveOptions)

    // 磁力 URI 不入库（见 magnetUriIndex 注释）：添加时记下规范化 magnet → gid
    for (const uri of uris) {
      const normalized = normalizeUrlForCompare(uri)
      if (normalized.startsWith('magnet:')) magnetUriIndex.set(normalized, gid)
    }

    const fileName = uris[0]?.split('/').pop() || uris[0]?.split('\\').pop() || 'Unknown'
    await afterTaskAdded([gid], fileName)

    await loadAllTasks()
    return gid
  }

  async function addTorrent(torrent: string, uris?: string[], options?: Aria2Option) {
    if (!connectionStore.service) throw new Error('Not connected')

    const gid = await connectionStore.service.addTorrent(torrent, uris, options)

    taskSourceService.record(gid, { kind: 'torrent', torrent, uris }, options)

    await afterTaskAdded([gid], 'Torrent Task')

    await loadAllTasks()
    return gid
  }

  async function addMetalink(metalink: string, options?: Aria2Option) {
    if (!connectionStore.service) throw new Error('Not connected')

    const gids = await connectionStore.service.addMetalink(metalink, options)

    for (const gid of gids) {
      taskSourceService.record(gid, { kind: 'metalink', metalink }, options)
    }

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

    // 已完成并持久化的任务（或已不在引擎里的历史任务）：统一走删除服务。
    // 注意：即使 deleteFiles=false 也要清引擎记录——否则下一次 loadAllTasks
    // 会把这条任务从引擎的 stopped 列表原样拉回来（「删了又回来」），
    // 还会因时间记录已删而把完成时间重算成「约 24 小时前」。
    const isPersistedTask = taskPersistenceService.isTaskPersisted(gid)
    if (isPersistedTask) {
      const persisted = taskPersistenceService.getPersistedTask(gid)
      if (persisted) {
        const result = await completedTaskDeleteService.deleteCompletedTask(persisted, deleteFiles, connectionStore.service)
        // 引擎没答应时不许清本地记录，用户可重试（错误信息透传给界面）
        if (!result.success && result.errors.length > 0) {
          throw new Error(result.errors[0])
        }
      } else {
        // 找不到持久化记录（竞态：刚被别处清理）：至少把本地痕迹清掉
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

  /**
   * 等待队列排序：调整任务在队列中的位置（仅对 waiting 状态的任务有效）。
   *
   * aria2 语义（changePosition(gid, pos, how)）：
   * - up:   POS_CUR, -1（当前位置向前挪一位）
   * - down: POS_CUR, +1
   * - top:  POS_SET, 0（置顶）
   * 成功返回任务的新位置；失败（任务不在队列中/已开始下载）向上抛给调用方提示。
   */
  async function moveInQueue(gid: string, direction: 'up' | 'down' | 'top' | 'bottom'): Promise<number> {
    if (!connectionStore.service) throw new Error('Not connected')
    const how = direction === 'top' || direction === 'bottom' ? 'POS_SET' : 'POS_CUR'
    if (direction === 'bottom') {
      const newPos = await connectionStore.service.changePosition(gid, 0, 'POS_END')
      await loadAllTasks()
      return newPos
    }
    const pos = direction === 'up' ? -1 : direction === 'down' ? 1 : 0
    const newPos = await connectionStore.service.changePosition(gid, pos, how)
    await loadAllTasks()
    return newPos
  }

  async function unpauseTask(gid: string) {
    if (!connectionStore.service) throw new Error('Not connected')
    await connectionStore.service.unpause(gid)
    await loadAllTasks()
  }

  // ── 队列失败自动重试策略（queue.retryEnabled）────────────────────────────
  // 记录“同一原始来源”发起的重试次数：重试会生成新 gid，因此按新 gid 继承计数。
  const autoRetryAttempts = new Map<string, number>()
  const autoRetryScheduled = new Set<string>()

  /**
   * 扫描本次刷新新出现的失败任务：仅对“刚才还在下载/队列中”的任务自动重试，
   * 启动时加载到的历史失败任务不重试。延时与次数来自设置 queue.*。
   */
  function scheduleAutoRetries(
    stopped: Aria2Task[],
    previousStopped: Set<string>,
    previousActive: Set<string>,
    previousWaiting: Set<string>
  ): void {
    const settingsStore = useSettingsStore()
    const queue = settingsStore.settings.queue
    if (!queue?.retryEnabled) return
    const maxAttempts = Math.max(1, queue.retryMaxAttempts ?? 3)
    const delayMs = Math.max(0, queue.retryDelaySeconds ?? 30) * 1000

    for (const task of stopped) {
      if (task.status !== 'error') continue
      if (previousStopped.has(task.gid)) continue
      if (!previousActive.has(task.gid) && !previousWaiting.has(task.gid)) continue
      if (autoRetryScheduled.has(task.gid)) continue
      const attempts = autoRetryAttempts.get(task.gid) ?? 0
      if (attempts >= maxAttempts) continue
      autoRetryScheduled.add(task.gid)
      setTimeout(() => {
        void (async () => {
          try {
            const newGid = await retryErrorTask(task.gid)
            autoRetryAttempts.set(newGid, attempts + 1)
            // 在状态页速度曲线上标记本次自动重试，便于对照失败/重试时刻
            const { recordRetryMarker } = useTrafficMonitor()
            recordRetryMarker(`${task.gid.slice(0, 6)} #${attempts + 1}`)
          } catch (error) {
            console.warn('Auto retry failed:', task.gid, error)
          } finally {
            autoRetryScheduled.delete(task.gid)
          }
        })()
      }, delayMs)
    }
  }

  /**
   * 重试失败任务。
   *
   * 关键点：
   * 1. 优先使用添加任务时保存的原始来源（磁力/种子/metalink 内容）。aria2 的
   *    tellStatus 对 BT/磁力任务不会返回 files[].uris，旧实现因此直接报 No URIs found。
   * 2. **先建新任务、成功后再删旧任务**。旧实现先 forceRemove 再 addUri，一旦新请求失败，
   *    原任务记录已被删除，用户连重试入口都没有了。
   */
  async function retryErrorTask(gid: string) {
    if (!connectionStore.service) throw new Error('Not connected')
    await taskSourceService.ensureLoaded()

    const taskInfo = await connectionStore.service.tellStatus(gid)
    const sourceRecord = taskSourceService.get(gid)

    // 读取原任务选项（out、split、header 等）；原始来源记录的选项更贴近添加时语义
    let originalOptions: Aria2Option = { dir: taskInfo.dir }
    try {
      const fullOptions = await connectionStore.service.getOption(gid)
      // aria2 不允许 addUri 时指定 gid，透传会导致重试失败，需过滤
      const { gid: _ignored, ...rest } = fullOptions as Record<string, unknown>
      void _ignored
      originalOptions = rest as Aria2Option
    } catch {
      // 获取选项失败时仅保留目录
    }
    const retryOptions = (sourceRecord?.options as Aria2Option | undefined) || originalOptions

    let newGid: string
    // 重试成功后要把原始来源迁移到新 gid：否则连续重试第二次时 sourceRecord 已随旧
    // 任务删除而丢失，BT/磁力任务又会退化成“No URIs found”。
    let sourceToReRecord: TaskSource | null = null
    if (sourceRecord?.source.kind === 'torrent') {
      newGid = await connectionStore.service.addTorrent(
        sourceRecord.source.torrent,
        sourceRecord.source.uris,
        retryOptions
      )
      sourceToReRecord = sourceRecord.source
    } else if (sourceRecord?.source.kind === 'metalink') {
      const gids = await connectionStore.service.addMetalink(sourceRecord.source.metalink, retryOptions)
      if (gids.length === 0) throw new Error('No GID returned')
      newGid = gids[0]!
      sourceToReRecord = sourceRecord.source
    } else {
      let uris = sourceRecord?.source.kind === 'uri'
        ? sourceRecord.source.uris
        : taskInfo.files?.flatMap(f => f.uris || []).map(u => u.uri).filter(Boolean) || []
      // 没有原始 URI 但能拿到 infoHash：用磁力链接兜底（仅依赖 DHT/Tracker 重新抓取元数据）
      if (uris.length === 0 && taskInfo.infoHash) {
        uris = [`magnet:?xt=urn:btih:${taskInfo.infoHash}`]
      }
      if (uris.length === 0) throw new Error('No URIs found')
      newGid = await connectionStore.service.addUri(uris, retryOptions)
      sourceToReRecord = { kind: 'uri', uris }
    }
    taskSourceService.record(newGid, sourceToReRecord, retryOptions as Record<string, string | string[]>)

    // 新任务已成功创建，再清理旧任务；失败不影响新任务
    try { await connectionStore.service.forceRemove(gid) } catch { /* 忽略旧任务删除失败 */ }
    try { await connectionStore.service.removeDownloadResult(gid) } catch { /* 忽略结果删除失败 */ }

    taskPersistenceService.removePersistedTask(gid)
    taskTimeService.removeTaskTime(gid)
    taskSourceService.remove(gid)
    await loadAllTasks()
    return newGid
  }

  /** 导出 BT 任务的 .torrent（磁力任务依赖添加时的 bt-save-metadata） */
  async function exportTorrent(gid: string): Promise<{ success: boolean; path?: string; canceled?: boolean; error?: string }> {
    if (!window.electronAPI?.exportTaskTorrent) {
      return { success: false, error: 'not_available' }
    }
    return window.electronAPI.exportTaskTorrent(gid)
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

  // 清空前端缓存的任务列表（断开连接 / 切换服务器时调用）
  function clearTasks() {
    // 代次自增：让所有进行中的旧连接刷新请求在 await 之后失效
    connectionGeneration++
    loadAllInFlight = null
    loadAllGeneration = -1
    loadingGeneration = -1
    needsReload = false
    isLoading.value = false
    activeTasks.value = []
    waitingTasks.value = []
    stoppedTasks.value = []
    // 重置指纹，避免切换服务器后同 gid 序列误命中导致不更新
    waitingFingerprint = ''
    stoppedFingerprint = ''
    // 注意：不清空持久化历史（persisted-tasks，存于 userData）与任务时间记录——
    // 它们是本地用户数据，切换/断开连接不应造成永久丢失；
    // 重新连接后 loadAllTasks 会把持久化记录重新合并进列表。
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

  // 下载完成回调列表（供外部注册，如系统通知）
  type DownloadCompleteCallback = (gid: string) => void
  const downloadCompleteCallbacks: DownloadCompleteCallback[] = []

  function onDownloadComplete(callback: DownloadCompleteCallback): () => void {
    downloadCompleteCallbacks.push(callback)
    return () => {
      const idx = downloadCompleteCallbacks.indexOf(callback)
      if (idx > -1) downloadCompleteCallbacks.splice(idx, 1)
    }
  }

  // 下载失败回调（应用内通知中心）
  type DownloadErrorCallback = (gid: string) => void
  const downloadErrorCallbacks: DownloadErrorCallback[] = []

  function onDownloadError(callback: DownloadErrorCallback): () => void {
    downloadErrorCallbacks.push(callback)
    return () => {
      const idx = downloadErrorCallbacks.indexOf(callback)
      if (idx > -1) downloadErrorCallbacks.splice(idx, 1)
    }
  }

  /**
   * 把 aria2 下载事件转发给主进程的插件系统。
   *
   * 为什么必须由渲染层转发：aria2 的通知走 WebSocket，而 WebSocket 只在渲染层；
   * 插件运行在主进程。此前主进程的 `PluginManager.emit` **没有任何调用方**，
   * 于是 README 与示例插件文档化的 onDownloadComplete / onDownloadStart 永不触发。
   */
  function notifyPlugins(kind: 'downloadComplete' | 'downloadStart' | 'downloadError', gid: string): void {
    if (!gid) return
    try {
      const task = allTasks.value.find(t => t.gid === gid)
      window.electronAPI?.notifyDownloadEvent?.(kind, gid, task ? getTaskName(task) : '')
    } catch (error) {
      // 插件通知失败不应影响任务列表本身
      console.warn('Failed to notify plugins:', error)
    }
  }

  async function handleDownloadComplete(event: unknown) {
    // 先等任务列表刷新完成，确保回调能拿到最新数据（任务名等）
    await loadAllTasks()
    // 通知所有注册的回调
    const payload = event as { gid?: string } | undefined
    const gid = payload?.gid || ''
    for (const cb of downloadCompleteCallbacks) {
      try { cb(gid) } catch { /* 忽略回调异常 */ }
    }
    notifyPlugins('downloadComplete', gid)
  }

  /** 下载开始：触发刷新（与其它事件一致），并把事件转给插件 */
  function handleDownloadStart(event: unknown) {
    handleDownloadEvent()
    const gid = (event as { gid?: string } | undefined)?.gid || ''
    notifyPlugins('downloadStart', gid)
  }

  /** 下载失败：先刷新列表，再通知应用内通知中心 */
  async function handleDownloadError(event: unknown) {
    await loadAllTasks()
    const gid = (event as { gid?: string } | undefined)?.gid || ''
    for (const cb of downloadErrorCallbacks) {
      try { cb(gid) } catch { /* 忽略回调异常 */ }
    }
    // 失败事件同样转给插件与完成动作规则（condition.status = 'error'）
    notifyPlugins('downloadError', gid)
  }

  watch(() => connectionStore.service, (service, oldService) => {
    // 连接实例变化即进入新代次：旧请求的响应全部作废，in-flight 缓存也不再复用
    connectionGeneration++
    loadAllInFlight = null
    loadAllGeneration = -1
    loadingGeneration = -1
    needsReload = false
    isLoading.value = false
    if (oldService) {
      downloadEvents.forEach(evt => oldService.off(evt, handleDownloadEvent))
      oldService.off('downloadComplete', handleDownloadComplete)
      oldService.off('downloadStart', handleDownloadStart)
      oldService.off('downloadError', handleDownloadError)
    }
    if (service) {
      downloadEvents.forEach(evt => service.on(evt, handleDownloadEvent))
      // downloadComplete / downloadStart 额外做专属处理（通知回调、转发插件）
      service.off('downloadComplete', handleDownloadEvent)
      service.on('downloadComplete', handleDownloadComplete)
      service.off('downloadStart', handleDownloadEvent)
      service.on('downloadStart', handleDownloadStart)
      service.off('downloadError', handleDownloadEvent)
      service.on('downloadError', handleDownloadError)
      // BT 任务在"下载完成（做种可继续）"时发的是 onBtDownloadComplete，
      // onDownloadComplete 要等做种结束才发——不接线的话 BT 下载完成既无通知
      // 也不进下载量统计（seed-ratio 达标可能要很久）
      service.off('btDownloadComplete', handleDownloadComplete)
      service.on('btDownloadComplete', handleDownloadComplete)
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
    findDuplicateTasks,
    addUri,
    addTorrent,
    addMetalink,
    removeTask,
    pauseTask,
    unpauseTask,
    retryErrorTask,
    exportTorrent,
    pauseAllTasks,
    unpauseAllTasks,
    moveInQueue,
    clearTasks,
    onDownloadComplete,
    onDownloadError
  }
})
