/**
 * 流媒体（yt-dlp 下载模式）任务的渲染层状态。
 *
 * 为什么单独建 store：这类下载由主进程的 yt-dlp 子进程执行，不在 aria2 队列里，
 * 但用户期望它在「下载任务 / 下载完成」列表中可见。这里把主进程推送的
 * 进度事件收敛成 Aria2Task 形状，供现有任务列表复用展示与操作。
 *
 * 持久化（D-37）：yt-dlp 任务不进 aria2 的会话/结果文件，关掉 App 就彻底消失，
 * 用户既看不到已完成的任务，也没法对失败任务重试。这里把任务快照落到
 * localStorage（见 @/services/streamTaskPersistenceService），启动时恢复：
 * 已完成/失败记录原样回来，上次运行遗留的进行中/暂停任务改写为
 * 「应用重启，任务已中断，请重试」的错误记录（子进程早已随应用退出被杀掉）。
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  streamTaskFilePaths,
  streamTaskToAria2Task,
  type StreamTask,
  type StreamTaskInput
} from '@/utils/streamTaskUtils'
import { streamTaskPersistence, STREAM_TASK_INTERRUPTED_ERROR } from '@/services/streamTaskPersistenceService'
import { useDownloadHistoryStore } from './downloadHistoryStore'
import type { StreamDownloadEvent } from '@/types/electron'

export interface StartStreamTaskInput {
  url: string
  formatId: string
  merge: boolean
  outputDir: string
  title: string
  /** 播放列表选中条目 id（--playlist-items 语义） */
  playlist?: { ids: string[] }
  /** 字幕设置（enabled 时写字幕并转 srt） */
  subtitle?: { enabled: boolean; languages: string[]; includeAuto?: boolean }
  /** Cookie 文件绝对路径（会员视频等登录态场景） */
  cookieFile?: string
  /** 提取音频并转 MP3 */
  extractAudio?: boolean
}

function baseName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath
}

/**
 * 深拷贝一份发起参数用于持久化。
 *
 * 必须拷贝：调用方（新建任务面板）会复用同一个对象，且持久化记录要与之后的重试
 * 请求完全隔离——引用共享会让"重试时参数被界面改动"这类问题极难排查。
 */
function snapshotInput(input: StartStreamTaskInput): StreamTaskInput {
  return {
    url: input.url,
    formatId: input.formatId,
    merge: input.merge,
    outputDir: input.outputDir,
    title: input.title,
    ...(input.playlist ? { playlist: { ids: [...input.playlist.ids] } } : {}),
    ...(input.subtitle
      ? {
        subtitle: {
          enabled: input.subtitle.enabled,
          languages: [...input.subtitle.languages],
          ...(input.subtitle.includeAuto !== undefined ? { includeAuto: input.subtitle.includeAuto } : {})
        }
      }
      : {}),
    ...(input.cookieFile ? { cookieFile: input.cookieFile } : {}),
    ...(input.extractAudio ? { extractAudio: true } : {})
  }
}

/**
 * 由任务记录还原一份完整的发起参数（重试用）。
 *
 * 优先用保存下来的 input（含 playlist/subtitle/cookieFile/extractAudio），
 * 缺失时回退到任务本身的顶层字段——扩展发起的下载与 D-37 之前的旧记录没有 input，
 * 这时退化成"只有 url/格式/目录"的重试，而不是崩溃或发出畸形请求。
 */
function resolveTaskInput(task: StreamTask): StartStreamTaskInput {
  const saved = task.input
  return {
    url: task.url || saved?.url || '',
    formatId: task.formatId || saved?.formatId || '',
    merge: task.merge,
    outputDir: task.outputDir || saved?.outputDir || '',
    title: task.title || saved?.title || task.url,
    ...(saved?.playlist && saved.playlist.ids.length > 0
      ? { playlist: { ids: [...saved.playlist.ids] } }
      : {}),
    ...(saved?.subtitle && saved.subtitle.languages.length > 0
      ? {
        subtitle: {
          enabled: saved.subtitle.enabled,
          languages: [...saved.subtitle.languages],
          ...(saved.subtitle.includeAuto !== undefined ? { includeAuto: saved.subtitle.includeAuto } : {})
        }
      }
      : {}),
    ...(saved?.cookieFile ? { cookieFile: saved.cookieFile } : {}),
    ...(saved?.extractAudio ? { extractAudio: true } : {})
  }
}

export const useStreamTaskStore = defineStore('streamTask', () => {
  // 流媒体下载量也要计入「今日/累计下载量」（D-10）：这类任务不进 aria2，
  // 原先只有 aria2 的完成事件会写历史，用户在状态页看到的下载量会明显偏小。
  const downloadHistoryStore = useDownloadHistoryStore()
  const tasks = ref<StreamTask[]>([])
  let unsubscribe: (() => void) | null = null

  const activeTasks = computed(() => tasks.value.filter(t => t.status === 'active'))
  const pausedTasks = computed(() => tasks.value.filter(t => t.status === 'paused'))
  const completedTasks = computed(() => tasks.value.filter(t => t.status === 'complete'))
  const errorTasks = computed(() => tasks.value.filter(t => t.status === 'error'))

  /**
   * 进行中任务的合计速度（字节/秒）。
   *
   * 页脚与托盘的速度原来只取 aria2 的 globalStat，流媒体任务不在 aria2 队列里，
   * 于是"正在下载但页脚显示 0 B/s"（D-10 一期）。这里给出可直接相加的聚合值。
   */
  const activeSpeedBytes = computed(() =>
    tasks.value.reduce((sum, task) => (task.status === 'active' ? sum + (task.speedBytes || 0) : sum), 0)
  )

  /** 进行中任务数（流媒体侧；与 aria2 的 numActive 相加才是用户看到的"活动"数） */
  const activeCount = computed(() => tasks.value.filter(t => t.status === 'active').length)

  /** 单条记录落盘（服务内部合批，进度事件高频调用也不会打满配额） */
  function persistTask(task: StreamTask): void {
    streamTaskPersistence.upsert(task)
  }

  /** 删除持久化记录（任务被移除/取消/重试替换时同步） */
  function forgetPersisted(gid: string): void {
    streamTaskPersistence.remove(gid)
  }

  /**
   * 启动时恢复上次运行的任务记录。
   *
   * 时机与 ensureListener 一致：store 一被创建就执行（模块加载阶段，不依赖 DOM 生命周期），
   * 这样列表在首帧渲染前就已经拿到历史任务，不会出现"先空后闪"。
   * 上次运行的 active/paused 已在服务层被改写为 error + 中断文案。
   */
  function restorePersistedTasks(): void {
    const restored = streamTaskPersistence.load()
    if (restored.length === 0) return
    const known = new Set(tasks.value.map(task => task.gid))
    const merged = [...tasks.value]
    for (const task of restored) {
      if (known.has(task.gid)) continue
      known.add(task.gid)
      merged.push(task)
    }
    tasks.value = merged
    // 回写归一化后的状态：第二次重启时直接看到同样的"已中断"记录，而不是再被推断一次
    streamTaskPersistence.replaceAll(merged)
  }

  /** 订阅主进程事件（只装一次；store 是单例，弹窗关闭后仍继续接收进度） */
  function ensureListener(): void {
    if (unsubscribe || !window.electronAPI?.onStreamDownloadEvent) return
    unsubscribe = window.electronAPI.onStreamDownloadEvent(handleEvent)
  }

  function findByGid(gid: string): StreamTask | undefined {
    return tasks.value.find(task => task.gid === gid)
  }

  async function startTask(input: StartStreamTaskInput): Promise<{ success: boolean; code?: string; error?: string }> {
    ensureListener()
    if (!window.electronAPI?.streamDownloadStart) {
      return { success: false, error: 'Not available' }
    }
    const result = await window.electronAPI.streamDownloadStart({
      url: input.url,
      formatId: input.formatId,
      merge: input.merge,
      // title 必须随请求传给主进程：started 事件要靠它给扩展发起之外的列表记录命名
      title: input.title,
      outputDir: input.outputDir,
      // 新能力字段只在调用方提供时携带，请求形状与旧版本保持一致
      ...(input.playlist ? { playlist: input.playlist } : {}),
      ...(input.subtitle ? { subtitle: input.subtitle } : {}),
      ...(input.cookieFile ? { cookieFile: input.cookieFile } : {}),
      ...(input.extractAudio ? { extractAudio: input.extractAudio } : {})
    })
    if (result.success && result.id && !findByGid(result.id)) {
      // 正常情况下 started 事件已经建立了记录；这里兜底（事件与 invoke 回包存在时序差）
      pushTask(result.id, input)
    }
    return result
  }

  function pushTask(id: string, input: StartStreamTaskInput): void {
    const task: StreamTask = {
      gid: id,
      url: input.url,
      formatId: input.formatId,
      merge: input.merge,
      outputDir: input.outputDir,
      title: input.title || input.url,
      status: 'active',
      percent: 0,
      speedBytes: 0,
      speedText: '',
      eta: '',
      totalBytes: 0,
      downloadedBytes: 0,
      createdAt: Date.now(),
      input: snapshotInput(input)
    }
    tasks.value.unshift(task)
    persistTask(task)
  }

  function handleEvent(event: StreamDownloadEvent): void {
    if (event.type === 'started') {
      // 扩展发起的下载只会在事件里出现，渲染层据此建立列表记录
      if (!findByGid(event.id)) {
        pushTask(event.id, {
          url: event.url,
          formatId: event.formatId ?? '',
          merge: event.merge,
          outputDir: event.outputDir,
          title: event.title ?? ''
        })
      }
      return
    }

    const task = findByGid(event.id)
    if (!task) return

    if (event.type === 'progress') {
      task.percent = event.percent
      task.speedBytes = event.speedBytes ?? 0
      task.speedText = event.speed ?? ''
      task.eta = event.eta ?? ''
      if (event.totalBytes) task.totalBytes = event.totalBytes
      if (event.downloadedBytes) task.downloadedBytes = event.downloadedBytes
      // 标题由主进程从 --print-to-file 写出的 UTF-8 文件读回（进度行里的是 GBK 乱码），
      // 播放列表模式再补「(n/m)」序号，用户能看到当前在下哪一条。
      // 仍保留替换字符兜底：万一标题文件本身被写坏，宁可继续用调用方传入的正确标题。
      if (event.entryTitle && !event.entryTitle.includes(String.fromCharCode(0xfffd))) {
        const suffix = event.entryIndex && event.entryCount
          ? ' (' + event.entryIndex + '/' + event.entryCount + ')'
          : ''
        task.title = event.entryTitle + suffix
      }
      persistTask(task)
      return
    }

    if (event.type === 'paused') {
      task.status = 'paused'
      task.speedBytes = 0
      task.speedText = ''
      task.eta = ''
      persistTask(task)
      return
    }

    if (event.type === 'completed') {
      task.status = 'complete'
      task.percent = 100
      task.speedBytes = 0
      task.speedText = ''
      task.eta = ''
      // 多文件（播放列表/多字幕）：主进程给出全部输出文件；旧主进程只有单文件 filePath
      const paths = event.filePaths && event.filePaths.length > 0
        ? event.filePaths
        : (event.filePath ? [event.filePath] : [])
      if (paths.length > 0) task.filePaths = [...paths]
      if (event.filePath) {
        task.filePath = event.filePath
      } else if (paths.length > 0) {
        task.filePath = paths[0]
      }
      task.completedAt = Date.now()
      // 计入下载量历史（D-10）：只统计本次运行真正新增的字节，
      // 用 downloadedBytes 而非 totalBytes——播放列表可能只下了其中几项。
      if (task.downloadedBytes > 0) downloadHistoryStore.record(task.downloadedBytes)
      // 扩展只给了页面 URL 时，用最终文件名替换掉 URL，列表展示更可读
      if (!task.title || task.title === task.url) {
        const displayPath = task.filePath || task.filePaths?.[0]
        if (displayPath) task.title = baseName(displayPath)
      }
      persistTask(task)
      return
    }

    if (event.type === 'failed') {
      task.status = 'error'
      task.speedBytes = 0
      task.speedText = ''
      task.eta = ''
      task.error = event.error
      persistTask(task)
      return
    }

    // cancelled：把记录移出列表（取消是用户的显式动作，不需要保留一条"已取消"）
    tasks.value = tasks.value.filter(item => item.gid !== event.id)
    forgetPersisted(event.id)
  }

  /** 取消进行中的下载（结束后由 cancelled 事件移除记录） */
  async function cancelTask(gid: string): Promise<boolean> {
    if (!window.electronAPI?.streamDownloadCancel) return false
    return await window.electronAPI.streamDownloadCancel(gid)
  }

  /** 暂停进行中的下载（主进程结束子进程但保留任务记录） */
  async function pauseTask(gid: string): Promise<boolean> {
    const task = findByGid(gid)
    if (!task || !window.electronAPI?.streamDownloadPause) return false
    // 事件可能先于 IPC 回包把状态改成 paused；此时重复点击不应再提示失败
    if (task.status === 'paused') return true
    if (task.status !== 'active') return false
    const paused = await window.electronAPI.streamDownloadPause(gid)
    if (paused) {
      if (task.status === 'active') {
        task.status = 'paused'
        task.speedBytes = 0
        task.speedText = ''
        task.eta = ''
        persistTask(task)
      }
      return true
    }
    // 暂停事件已经到达但 IPC 因进程刚退出返回 false：以界面状态为准
    return findByGid(gid)?.status === 'paused'
  }

  /** 继续已暂停的下载（沿用原参数重新拉起 yt-dlp） */
  async function resumeTask(gid: string): Promise<boolean> {
    const task = findByGid(gid)
    if (!task || task.status !== 'paused' || !window.electronAPI?.streamDownloadResume) return false
    const resumed = await window.electronAPI.streamDownloadResume(gid)
    if (resumed && task.status === 'paused') {
      task.status = 'active'
      persistTask(task)
    }
    return resumed
  }

  /**
   * 暂停全部进行中的流媒体任务（D-10）。
   *
   * 「暂停全部」原先只作用于 aria2 队列：用户按了托盘/快捷键暂停全部，
   * 流媒体任务仍在后台继续下载，与按钮语义不符。这里按快照逐条暂停，
   * 单条失败（进程刚退出等）不影响其余任务，返回实际生效的条数。
   */
  async function pauseAllTasks(): Promise<{ paused: number; failed: number }> {
    const gids = activeTasks.value.map(task => task.gid)
    let paused = 0
    let failed = 0
    for (const gid of gids) {
      if (await pauseTask(gid)) paused += 1
      else failed += 1
    }
    return { paused, failed }
  }

  /** 恢复全部已暂停的流媒体任务（与 pauseAllTasks 对称） */
  async function resumeAllTasks(): Promise<{ resumed: number; failed: number }> {
    const gids = pausedTasks.value.map(task => task.gid)
    let resumed = 0
    let failed = 0
    for (const gid of gids) {
      if (await resumeTask(gid)) resumed += 1
      else failed += 1
    }
    return { resumed, failed }
  }

  /**
   * 从列表移除。
   * - 进行中/暂停中的任务先终止进程并清理临时目录；
   * - 已完成的任务可选择同时删除最终文件（与 aria2 任务共用系统回收站语义）；
   *   播放列表/多字幕会产出多个文件，逐个删除，单个失败只汇总错误、继续删其余；
   * - 未勾选删除或任务没有输出文件时，文件保留在磁盘上。
   */
  async function removeTask(gid: string, deleteFiles = false): Promise<{ success: boolean; error?: string }> {
    const task = findByGid(gid)
    if (!task) return { success: false, error: 'Task not found' }

    // 进行中/暂停中：discard 会结束进程、删除 .part 与临时目录（即使不勾选删除文件，
    // 这些临时内容也不应留在磁盘上）。旧 preload 没有 discard 时退回 cancel。
    if (task.status === 'active' || task.status === 'paused') {
      const discarded = window.electronAPI?.streamDownloadDiscard
        ? await window.electronAPI.streamDownloadDiscard(gid)
        : await cancelTask(gid)
      if (!discarded) return { success: false, error: 'Cancel failed' }
    }

    if (deleteFiles && task.status === 'complete' && window.electronAPI?.streamDownloadDeleteFile) {
      const paths = streamTaskFilePaths(task)
      if (paths.length > 0) {
        const failures: string[] = []
        for (const filePath of paths) {
          try {
            // 专用通道只允许本进程创建过的输出目录，避免通用删除接口拒绝非默认下载目录
            const result = await window.electronAPI.streamDownloadDeleteFile(filePath, task.outputDir)
            if (!result.success) failures.push(result.error || 'File deletion failed')
          } catch (error) {
            failures.push(error instanceof Error ? error.message : String(error))
          }
        }
        // 有失败就保留任务记录（用户还能再点一次删除），但其余文件已经删掉了
        if (failures.length > 0) return { success: false, error: failures.join('; ') }
      }
    }

    // 完成/失败任务的临时目录可能仍在（例如失败时），勾选删除文件时一并清理。
    // discard 失败时保留记录：用户勾了「同时删除文件」，结果文件还在磁盘上却把任务
    // 从列表移除，等于让用户以为已经清理干净（D-52）。
    if (deleteFiles && task.status !== 'complete' && window.electronAPI?.streamDownloadDiscard) {
      let discarded = false
      try {
        discarded = await window.electronAPI.streamDownloadDiscard(gid)
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
      if (!discarded) return { success: false, error: 'File deletion failed' }
    }

    tasks.value = tasks.value.filter(item => item.gid !== gid)
    forgetPersisted(gid)
    return { success: true }
  }

  /**
   * 失败任务重试：完整透传原任务的发起参数（D-38）。
   *
   * 只传 url/格式/目录会让重试结果与原始请求不一致：播放列表少下几集、
   * 字幕丢失、会员视频因为没带 Cookie 直接 403。这里把持久化的 input 全量还原，
   * 扩展发起的旧记录没有 input 时按顶层字段降级，仍然可以重试。
   */
  async function retryTask(gid: string): Promise<{ success: boolean; error?: string }> {
    const task = findByGid(gid)
    if (!task) return { success: false, error: 'Task not found' }
    const result = await startTask(resolveTaskInput(task))
    if (result.success) {
      tasks.value = tasks.value.filter(item => item.gid !== gid)
      forgetPersisted(gid)
    }
    return result
  }

  // 启动即恢复历史任务（与下面装监听同一时机：store 一被创建就执行）
  restorePersistedTasks()
  // 扩展发起的下载不会经过 startTask，store 一被使用就装好监听
  ensureListener()

  return {
    tasks,
    activeTasks,
    pausedTasks,
    completedTasks,
    errorTasks,
    activeSpeedBytes,
    activeCount,
    findByGid,
    startTask,
    cancelTask,
    pauseTask,
    resumeTask,
    pauseAllTasks,
    resumeAllTasks,
    removeTask,
    retryTask,
    toAria2Task: streamTaskToAria2Task,
    /** 中断文案（界面/测试共用同一常量，避免两处各写一句中文） */
    interruptedError: STREAM_TASK_INTERRUPTED_ERROR
  }
})
