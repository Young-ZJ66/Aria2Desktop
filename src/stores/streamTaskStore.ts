/**
 * 流媒体（yt-dlp 下载模式）任务的渲染层状态。
 *
 * 为什么单独建 store：这类下载由主进程的 yt-dlp 子进程执行，不在 aria2 队列里，
 * 但用户期望它在「下载任务 / 下载完成」列表中可见。这里把主进程推送的
 * 进度事件收敛成 Aria2Task 形状，供现有任务列表复用展示与操作。
 *
 * 生命周期只存在于本次运行：不持久化，也不会写 aria2 的会话/结果文件。
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { streamTaskToAria2Task, type StreamTask } from '@/utils/streamTaskUtils'
import type { StreamDownloadEvent } from '@/types/electron'

export interface StartStreamTaskInput {
  url: string
  formatId: string
  merge: boolean
  outputDir: string
  title: string
}

function baseName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath
}

export const useStreamTaskStore = defineStore('streamTask', () => {
  const tasks = ref<StreamTask[]>([])
  let unsubscribe: (() => void) | null = null

  const activeTasks = computed(() => tasks.value.filter(t => t.status === 'active'))
  const completedTasks = computed(() => tasks.value.filter(t => t.status === 'complete'))
  const errorTasks = computed(() => tasks.value.filter(t => t.status === 'error'))

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
      outputDir: input.outputDir
    })
    if (result.success && result.id && !findByGid(result.id)) {
      // 正常情况下 started 事件已经建立了记录；这里兜底（事件与 invoke 回包存在时序差）
      pushTask(result.id, input)
    }
    return result
  }

  function pushTask(id: string, input: StartStreamTaskInput): void {
    tasks.value.unshift({
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
      createdAt: Date.now()
    })
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
      return
    }

    if (event.type === 'completed') {
      task.status = 'complete'
      task.percent = 100
      task.speedBytes = 0
      task.speedText = ''
      task.eta = ''
      task.filePath = event.filePath
      task.completedAt = Date.now()
      // 扩展只给了页面 URL 时，用最终文件名替换掉 URL，列表展示更可读
      if (!task.title || task.title === task.url) task.title = baseName(event.filePath)
      return
    }

    if (event.type === 'failed') {
      task.status = 'error'
      task.speedBytes = 0
      task.speedText = ''
      task.eta = ''
      task.error = event.error
      return
    }

    // cancelled：把记录移出列表（取消是用户的显式动作，不需要保留一条"已取消"）
    tasks.value = tasks.value.filter(item => item.gid !== event.id)
  }

  /** 取消进行中的下载（结束后由 cancelled 事件移除记录） */
  async function cancelTask(gid: string): Promise<boolean> {
    if (!window.electronAPI?.streamDownloadCancel) return false
    return await window.electronAPI.streamDownloadCancel(gid)
  }

  /** 从列表移除（进行中的会先取消；已下载的文件保留在磁盘上） */
  async function removeTask(gid: string): Promise<void> {
    const task = findByGid(gid)
    if (task?.status === 'active') {
      await cancelTask(gid)
    }
    tasks.value = tasks.value.filter(item => item.gid !== gid)
  }

  /** 失败任务重试：沿用原 URL/格式/目录重新发起（新下载会获得新 id） */
  async function retryTask(gid: string): Promise<{ success: boolean; error?: string }> {
    const task = findByGid(gid)
    if (!task) return { success: false, error: 'Task not found' }
    const result = await startTask({
      url: task.url,
      formatId: task.formatId,
      merge: task.merge,
      outputDir: task.outputDir,
      title: task.title
    })
    if (result.success) {
      tasks.value = tasks.value.filter(item => item.gid !== gid)
    }
    return result
  }

  // 扩展发起的下载不会经过 startTask，store 一被使用就装好监听
  ensureListener()

  return {
    tasks,
    activeTasks,
    completedTasks,
    errorTasks,
    findByGid,
    startTask,
    cancelTask,
    removeTask,
    retryTask,
    toAria2Task: streamTaskToAria2Task
  }
})
