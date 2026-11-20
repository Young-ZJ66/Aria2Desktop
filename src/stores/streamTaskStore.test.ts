import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { StreamDownloadEvent } from '@/types/electron'
import {
  STREAM_TASK_INTERRUPTED_ERROR,
  STREAM_TASK_SCHEMA_VERSION,
  STREAM_TASK_STORAGE_KEY,
  streamTaskPersistence
} from '@/services/streamTaskPersistenceService'
import { useStreamTaskStore } from './streamTaskStore'

/** 假 localStorage：store 的持久化服务从 globalThis.localStorage 取存储 */
function stubLocalStorage(initial?: string): { dump: () => string | null } {
  let value: string | null = initial ?? null
  const storage = {
    getItem: (key: string) => (key === STREAM_TASK_STORAGE_KEY ? value : null),
    setItem: (key: string, next: string) => { if (key === STREAM_TASK_STORAGE_KEY) value = next },
    removeItem: (key: string) => { if (key === STREAM_TASK_STORAGE_KEY) value = null }
  }
  vi.stubGlobal('localStorage', storage)
  return { dump: () => value }
}

/** 构造一条持久化载荷（默认 schemaVersion 与当前一致） */
function persistedEnvelope(tasks: unknown[], schemaVersion = STREAM_TASK_SCHEMA_VERSION): string {
  return JSON.stringify({ schemaVersion, tasks })
}

/** 一条最小可用的持久化任务记录 */
function persistedTask(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    gid: 'sd-restored-1',
    url: 'https://example.com/video',
    formatId: '30080',
    merge: true,
    outputDir: 'D:/Downloads',
    title: '上次完成的任务',
    status: 'complete',
    percent: 100,
    totalBytes: 1_000_000,
    downloadedBytes: 1_000_000,
    filePath: 'D:/Downloads/上次完成的任务.mp4',
    filePaths: ['D:/Downloads/上次完成的任务.mp4'],
    createdAt: 1_700_000_000_000,
    completedAt: 1_700_000_100_000,
    ...patch
  }
}

/** 主进程事件订阅回调（测试里手动触发） */
let emit: ((event: StreamDownloadEvent) => void) | null = null

beforeEach(() => {
  setActivePinia(createPinia())
  emit = null
  // 持久化服务是模块级单例：每个用例都从"空存储 + 空内存态"开始，否则上一个用例
  // 留下的记录会在这个用例的 store 创建时被恢复进列表，断言就不可信了
  stubLocalStorage()
  streamTaskPersistence.clear()
  vi.stubGlobal('window', {
    electronAPI: {
      streamDownloadStart: vi.fn(async () => ({ success: true, id: 'sd-test-1' })),
      streamDownloadCancel: vi.fn(async () => true),
      streamDownloadDiscard: vi.fn(async () => true),
      streamDownloadPause: vi.fn(async () => true),
      streamDownloadResume: vi.fn(async () => true),
      streamDownloadDeleteFile: vi.fn(async () => ({ success: true })),
      onStreamDownloadEvent: vi.fn((callback: (event: StreamDownloadEvent) => void) => {
        emit = callback
        return () => { emit = null }
      })
    }
  })
})

afterEach(() => {
  // 清掉合批定时器与内存态，避免定时器在后续用例里把记录写进别人的存储
  streamTaskPersistence.clear()
  vi.unstubAllGlobals()
})

describe('streamTaskStore', () => {
  it('发起下载后进入列表，进度与完成事件更新任务', async () => {
    const store = useStreamTaskStore()
    const result = await store.startTask({
      url: 'https://example.com/video',
      formatId: '30080',
      merge: true,
      outputDir: 'D:/Downloads',
      title: '测试视频'
    })

    expect(result.success).toBe(true)
    expect(store.tasks).toHaveLength(1)
    expect(store.activeTasks).toHaveLength(1)
    expect(store.tasks[0]?.status).toBe('active')

    emit?.({
      type: 'progress',
      id: 'sd-test-1',
      percent: 42,
      speed: '1.2MiB/s',
      speedBytes: 1_258_291,
      eta: '00:10',
      totalBytes: 1_000_000,
      downloadedBytes: 420_000
    })
    expect(store.tasks[0]?.percent).toBe(42)
    expect(store.tasks[0]?.speedBytes).toBe(1_258_291)

    emit?.({ type: 'completed', id: 'sd-test-1', filePath: 'D:/Downloads/测试视频.mp4' })
    expect(store.tasks[0]?.status).toBe('complete')
    expect(store.completedTasks).toHaveLength(1)
    expect(store.activeTasks).toHaveLength(0)

    const mapped = store.toAria2Task(store.tasks[0]!)
    expect(mapped.status).toBe('complete')
    expect(mapped.files[0]?.path).toBe('D:/Downloads/测试视频.mp4')
  })

  it('进度事件里的乱码条目标题不会覆盖已有正确标题', async () => {
    const store = useStreamTaskStore()
    await store.startTask({
      url: 'https://example.com/video',
      formatId: '30080',
      merge: true,
      outputDir: 'D:/Downloads',
      title: '正确标题'
    })

    emit?.({
      type: 'progress',
      id: 'sd-test-1',
      percent: 42,
      entryTitle: 'GPT6.2 Astra' + String.fromCharCode(0xfffd) + String.fromCharCode(0xfffd) + ' Fable'
    })

    expect(store.tasks[0]?.title).toBe('正确标题')

    emit?.({
      type: 'progress',
      id: 'sd-test-1',
      percent: 43,
      entryTitle: '播放列表条目',
      entryIndex: 2,
      entryCount: 3
    })
    expect(store.tasks[0]?.title).toBe('播放列表条目 (2/3)')
  })

  it('扩展发起的下载：仅收到 started 事件也会建立列表记录', async () => {
    const store = useStreamTaskStore()
    // 先发起一次（顺带安装事件监听），再用另一个 id 模拟扩展发起的下载
    await store.startTask({
      url: 'https://example.com/a',
      formatId: '30080',
      merge: true,
      outputDir: 'D:/Downloads',
      title: '页面下载'
    })

    emit?.({
      type: 'started',
      id: 'sd-ext-1',
      url: 'https://www.bilibili.com/video/BV1GJ411x7h7',
      title: 'B 站视频',
      merge: true,
      outputDir: 'D:/Downloads'
    })

    const extensionTask = store.findByGid('sd-ext-1')
    expect(extensionTask).toBeDefined()
    expect(extensionTask?.status).toBe('active')
    expect(extensionTask?.title).toBe('B 站视频')
    expect(store.tasks).toHaveLength(2)
  })

  it('失败任务保留在列表（便于重试），取消则移除', async () => {
    const store = useStreamTaskStore()
    await store.startTask({
      url: 'https://example.com/video',
      formatId: '30080',
      merge: true,
      outputDir: 'D:/Downloads',
      title: '测试视频'
    })

    emit?.({ type: 'failed', id: 'sd-test-1', error: 'HTTP 403' })
    expect(store.errorTasks).toHaveLength(1)
    expect(store.tasks[0]?.error).toBe('HTTP 403')
    expect(store.toAria2Task(store.tasks[0]!).status).toBe('error')

    emit?.({ type: 'cancelled', id: 'sd-test-1' })
    expect(store.tasks).toHaveLength(0)
  })

  it('removeTask 对进行中的任务先丢弃进程并清理临时文件，再移除', async () => {
    const store = useStreamTaskStore()
    await store.startTask({
      url: 'https://example.com/video',
      formatId: '30080',
      merge: true,
      outputDir: 'D:/Downloads',
      title: '测试视频'
    })

    await store.removeTask('sd-test-1')

    expect(window.electronAPI!.streamDownloadDiscard).toHaveBeenCalledWith('sd-test-1')
    expect(window.electronAPI!.streamDownloadCancel).not.toHaveBeenCalled()
    expect(store.tasks).toHaveLength(0)
  })

  it('removeTask 勾选删除文件时对进行中的任务走丢弃，不调用完成态文件删除', async () => {
    const store = useStreamTaskStore()
    await store.startTask({
      url: 'https://example.com/video',
      formatId: '30080',
      merge: true,
      outputDir: 'D:/Downloads',
      title: '测试视频'
    })

    const result = await store.removeTask('sd-test-1', true)

    expect(result.success).toBe(true)
    expect(window.electronAPI!.streamDownloadDiscard).toHaveBeenCalledWith('sd-test-1')
    expect(window.electronAPI!.streamDownloadDeleteFile).not.toHaveBeenCalled()
    expect(store.tasks).toHaveLength(0)
  })

  it('removeTask 对已完成的任务不再触发取消', async () => {
    const store = useStreamTaskStore()
    await store.startTask({
      url: 'https://example.com/video',
      formatId: '30080',
      merge: true,
      outputDir: 'D:/Downloads',
      title: '测试视频'
    })
    emit?.({ type: 'completed', id: 'sd-test-1', filePath: 'D:/Downloads/测试视频.mp4' })

    await store.removeTask('sd-test-1')

    expect(window.electronAPI!.streamDownloadCancel).not.toHaveBeenCalled()
    expect(store.tasks).toHaveLength(0)
  })

  it('removeTask 勾选删除文件时调用 streamDownloadDeleteFile，并传输出目录作为白名单参数', async () => {
    const store = useStreamTaskStore()
    await store.startTask({
      url: 'https://example.com/video',
      formatId: '30080',
      merge: true,
      outputDir: 'E:/Media',
      title: '测试视频'
    })
    emit?.({ type: 'completed', id: 'sd-test-1', filePath: 'E:/Media/测试视频.mp4' })

    const result = await store.removeTask('sd-test-1', true)

    expect(result.success).toBe(true)
    expect(window.electronAPI!.streamDownloadDeleteFile).toHaveBeenCalledWith('E:/Media/测试视频.mp4', 'E:/Media')
    expect(store.tasks).toHaveLength(0)
  })

  it('removeTask 删除文件失败时保留任务记录并返回错误', async () => {
    const store = useStreamTaskStore()
    await store.startTask({
      url: 'https://example.com/video',
      formatId: '30080',
      merge: true,
      outputDir: 'D:/Downloads',
      title: '测试视频'
    })
    emit?.({ type: 'completed', id: 'sd-test-1', filePath: 'D:/Downloads/测试视频.mp4' })
    ;(window.electronAPI!.streamDownloadDeleteFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: false,
      error: 'Access denied'
    })

    const result = await store.removeTask('sd-test-1', true)

    expect(result.success).toBe(false)
    expect(result.error).toBe('Access denied')
    expect(store.findByGid('sd-test-1')).toBeDefined()
  })

  it('removeTask 勾选删除文件但 discard 失败时保留任务记录（D-52）', async () => {
    const store = useStreamTaskStore()
    await store.startTask({
      url: 'https://example.com/video',
      formatId: '30080',
      merge: true,
      outputDir: 'D:/Downloads',
      title: '测试视频'
    })
    emit?.({ type: 'failed', id: 'sd-test-1', error: 'yt-dlp exited with 1' })
    ;(window.electronAPI!.streamDownloadDiscard as ReturnType<typeof vi.fn>).mockResolvedValue(false)

    const result = await store.removeTask('sd-test-1', true)

    // 用户勾了「同时删除文件」，文件没删掉就不能把记录移除，否则用户以为已清理
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
    expect(store.findByGid('sd-test-1')).toBeDefined()
  })

  it('removeTask 勾选删除文件且 discard 抛错时保留任务记录并回传错误（D-52）', async () => {
    const store = useStreamTaskStore()
    await store.startTask({
      url: 'https://example.com/video',
      formatId: '30080',
      merge: true,
      outputDir: 'D:/Downloads',
      title: '测试视频'
    })
    emit?.({ type: 'failed', id: 'sd-test-1', error: 'yt-dlp exited with 1' })
    ;(window.electronAPI!.streamDownloadDiscard as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('discard failed')
    )

    const result = await store.removeTask('sd-test-1', true)

    expect(result.success).toBe(false)
    expect(result.error).toBe('discard failed')
    expect(store.findByGid('sd-test-1')).toBeDefined()
  })

  it('removeTask 未勾选删除文件时保留磁盘文件', async () => {
    const store = useStreamTaskStore()
    await store.startTask({
      url: 'https://example.com/video',
      formatId: '30080',
      merge: true,
      outputDir: 'D:/Downloads',
      title: '测试视频'
    })
    emit?.({ type: 'completed', id: 'sd-test-1', filePath: 'D:/Downloads/测试视频.mp4' })

    await store.removeTask('sd-test-1')

    expect(window.electronAPI!.streamDownloadDeleteFile).not.toHaveBeenCalled()
    expect(store.tasks).toHaveLength(0)
  })

  it('pauseTask 只暂停 active 任务并清空速度/剩余时间；resumeTask 恢复 active', async () => {
    const store = useStreamTaskStore()
    await store.startTask({
      url: 'https://example.com/video',
      formatId: '30080',
      merge: true,
      outputDir: 'D:/Downloads',
      title: '测试视频'
    })
    emit?.({
      type: 'progress',
      id: 'sd-test-1',
      percent: 42,
      speed: '1.2MiB/s',
      speedBytes: 1_258_291,
      eta: '00:10',
      totalBytes: 1_000_000,
      downloadedBytes: 420_000
    })

    expect(await store.pauseTask('sd-test-1')).toBe(true)
    expect(window.electronAPI!.streamDownloadPause).toHaveBeenCalledWith('sd-test-1')
    expect(store.findByGid('sd-test-1')?.status).toBe('paused')
    expect(store.findByGid('sd-test-1')?.speedBytes).toBe(0)
    expect(store.findByGid('sd-test-1')?.speedText).toBe('')
    expect(store.findByGid('sd-test-1')?.eta).toBe('')
    expect(store.pausedTasks).toHaveLength(1)
    expect(store.activeTasks).toHaveLength(0)

    expect(await store.resumeTask('sd-test-1')).toBe(true)
    expect(window.electronAPI!.streamDownloadResume).toHaveBeenCalledWith('sd-test-1')
    expect(store.findByGid('sd-test-1')?.status).toBe('active')
    expect(store.activeTasks).toHaveLength(1)
    expect(store.pausedTasks).toHaveLength(0)
  })

  it('paused 事件把任务标记为 paused，而不是从列表移除', async () => {
    const store = useStreamTaskStore()
    await store.startTask({
      url: 'https://example.com/video',
      formatId: '30080',
      merge: true,
      outputDir: 'D:/Downloads',
      title: '测试视频'
    })

    emit?.({ type: 'paused', id: 'sd-test-1' })
    expect(store.findByGid('sd-test-1')?.status).toBe('paused')
    expect(store.tasks).toHaveLength(1)
  })

  it('removeTask 对已暂停的任务先取消再移除', async () => {
    const store = useStreamTaskStore()
    await store.startTask({
      url: 'https://example.com/video',
      formatId: '30080',
      merge: true,
      outputDir: 'D:/Downloads',
      title: '测试视频'
    })
    await store.pauseTask('sd-test-1')

    await store.removeTask('sd-test-1')
    expect(window.electronAPI!.streamDownloadDiscard).toHaveBeenCalledWith('sd-test-1')
    expect(store.tasks).toHaveLength(0)
  })

  it('retryTask 沿用原 URL/格式/目录重新发起，成功后移除旧记录；失败则保留', async () => {
    const store = useStreamTaskStore()
    await store.startTask({
      url: 'https://example.com/video',
      formatId: '30080',
      merge: true,
      outputDir: 'D:/Downloads',
      title: '测试视频'
    })
    emit?.({ type: 'failed', id: 'sd-test-1', error: 'boom' })
    ;(window.electronAPI!.streamDownloadStart as ReturnType<typeof vi.fn>).mockResolvedValue({ success: false, error: 'offline' })
    expect((await store.retryTask('sd-test-1')).success).toBe(false)
    expect(store.findByGid('sd-test-1')).toBeDefined()

    ;(window.electronAPI!.streamDownloadStart as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, id: 'sd-retry-1' })
    const result = await store.retryTask('sd-test-1')
    expect(result.success).toBe(true)
    expect(window.electronAPI!.streamDownloadStart).toHaveBeenLastCalledWith({
      url: 'https://example.com/video',
      formatId: '30080',
      merge: true,
      // title 现在随请求透传给主进程（started 事件要靠它命名列表记录）
      title: '测试视频',
      outputDir: 'D:/Downloads'
    })
    expect(store.findByGid('sd-test-1')).toBeUndefined()
    expect(store.findByGid('sd-retry-1')).toBeDefined()
  })

  it('retryTask 完整透传 playlist/subtitle/cookieFile/extractAudio（D-38）', async () => {
    const store = useStreamTaskStore()
    await store.startTask({
      url: 'https://www.bilibili.com/video/BV1GJ411x7h7',
      formatId: '30080',
      merge: true,
      outputDir: 'E:/Media',
      title: '会员视频',
      playlist: { ids: ['1', '3', '5'] },
      subtitle: { enabled: true, languages: ['zh-Hans', 'en'], includeAuto: true },
      cookieFile: 'D:/cookies.txt',
      extractAudio: true
    })
    emit?.({ type: 'failed', id: 'sd-test-1', error: 'HTTP 403' })
    ;(window.electronAPI!.streamDownloadStart as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, id: 'sd-retry-2' })

    expect((await store.retryTask('sd-test-1')).success).toBe(true)

    // 少透传任何一个字段，重试出来的都不是用户当初发起的那个任务：
    // 播放列表少下几集、字幕丢失、会员视频因没带 Cookie 继续 403、音频没提取
    expect(window.electronAPI!.streamDownloadStart).toHaveBeenLastCalledWith({
      url: 'https://www.bilibili.com/video/BV1GJ411x7h7',
      formatId: '30080',
      merge: true,
      title: '会员视频',
      outputDir: 'E:/Media',
      playlist: { ids: ['1', '3', '5'] },
      subtitle: { enabled: true, languages: ['zh-Hans', 'en'], includeAuto: true },
      cookieFile: 'D:/cookies.txt',
      extractAudio: true
    })
  })

  it('retryTask 对没有完整 input 的旧记录（扩展发起）安全降级', async () => {
    const store = useStreamTaskStore()
    // 先发起一次安装监听，再用 started 事件模拟扩展发起的下载（只有 url/title/outputDir）
    await store.startTask({
      url: 'https://example.com/a',
      formatId: '30080',
      merge: true,
      outputDir: 'D:/Downloads',
      title: '页面下载'
    })
    emit?.({
      type: 'started',
      id: 'sd-ext-1',
      url: 'https://www.bilibili.com/video/BV1GJ411x7h7',
      title: 'B 站视频',
      merge: true,
      outputDir: 'E:/Media'
    })
    emit?.({ type: 'failed', id: 'sd-ext-1', error: 'network' })
    ;(window.electronAPI!.streamDownloadStart as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, id: 'sd-retry-3' })

    const result = await store.retryTask('sd-ext-1')

    expect(result.success).toBe(true)
    // 缺失字段不伪造：formatId 为空串、不带 playlist/subtitle/cookieFile/extractAudio
    expect(window.electronAPI!.streamDownloadStart).toHaveBeenLastCalledWith({
      url: 'https://www.bilibili.com/video/BV1GJ411x7h7',
      formatId: '',
      merge: true,
      title: 'B 站视频',
      outputDir: 'E:/Media'
    })
  })

  it('completed 事件带 filePaths 时记录全部文件，列表展示第一个', async () => {
    const store = useStreamTaskStore()
    await store.startTask({
      url: 'https://example.com/playlist',
      formatId: '30080',
      merge: true,
      outputDir: 'E:/Media',
      title: '播放列表'
    })

    emit?.({
      type: 'completed',
      id: 'sd-test-1',
      filePath: 'E:/Media/01.mp4',
      filePaths: ['E:/Media/01.mp4', 'E:/Media/02.mp4', 'E:/Media/03.mp4']
    })

    const task = store.findByGid('sd-test-1')
    expect(task?.status).toBe('complete')
    expect(task?.filePaths).toEqual(['E:/Media/01.mp4', 'E:/Media/02.mp4', 'E:/Media/03.mp4'])
    // filePath 保留为兼容字段（旧界面/旧代码仍在读它）
    expect(task?.filePath).toBe('E:/Media/01.mp4')
    expect(store.toAria2Task(task!).files[0]?.path).toBe('E:/Media/01.mp4')
  })

  it('completed 事件只有 filePath（旧主进程）时退化成单文件记录', async () => {
    const store = useStreamTaskStore()
    await store.startTask({
      url: 'https://example.com/video',
      formatId: '30080',
      merge: true,
      outputDir: 'D:/Downloads',
      title: '测试视频'
    })

    emit?.({ type: 'completed', id: 'sd-test-1', filePath: 'D:/Downloads/测试视频.mp4' })

    const task = store.findByGid('sd-test-1')
    expect(task?.filePaths).toEqual(['D:/Downloads/测试视频.mp4'])
    expect(task?.filePath).toBe('D:/Downloads/测试视频.mp4')
  })

  it('removeTask 勾选删除时逐个删除 filePaths，单个失败汇总后继续删其余', async () => {
    const store = useStreamTaskStore()
    await store.startTask({
      url: 'https://example.com/playlist',
      formatId: '30080',
      merge: true,
      outputDir: 'E:/Media',
      title: '播放列表'
    })
    emit?.({
      type: 'completed',
      id: 'sd-test-1',
      filePath: 'E:/Media/01.mp4',
      filePaths: ['E:/Media/01.mp4', 'E:/Media/02.mp4', 'E:/Media/03.mp4']
    })
    const deleteFile = window.electronAPI!.streamDownloadDeleteFile as ReturnType<typeof vi.fn>
    deleteFile.mockImplementation(async (filePath: string) => (
      filePath === 'E:/Media/02.mp4' ? { success: false, error: 'Access denied' } : { success: true }
    ))

    const result = await store.removeTask('sd-test-1', true)

    // 失败不中止：三个文件都尝试过，失败原因汇总返回
    expect(deleteFile).toHaveBeenCalledTimes(3)
    expect(deleteFile).toHaveBeenCalledWith('E:/Media/01.mp4', 'E:/Media')
    expect(deleteFile).toHaveBeenCalledWith('E:/Media/02.mp4', 'E:/Media')
    expect(deleteFile).toHaveBeenCalledWith('E:/Media/03.mp4', 'E:/Media')
    expect(result.success).toBe(false)
    expect(result.error).toBe('Access denied')
    // 有文件没删掉时保留记录，用户还能再点一次删除
    expect(store.findByGid('sd-test-1')).toBeDefined()
  })
})

describe('streamTaskStore 持久化（D-37）', () => {
  it('应用启动时恢复已完成的记录（含 filePaths 与完整 input）', () => {
    stubLocalStorage(persistedEnvelope([
      persistedTask({
        input: {
          url: 'https://example.com/video',
          formatId: '30080',
          merge: true,
          outputDir: 'D:/Downloads',
          title: '上次完成的任务',
          cookieFile: 'D:/cookies.txt',
          extractAudio: true
        }
      })
    ]))

    const store = useStreamTaskStore()

    expect(store.tasks).toHaveLength(1)
    expect(store.completedTasks).toHaveLength(1)
    expect(store.findByGid('sd-restored-1')?.filePaths).toEqual(['D:/Downloads/上次完成的任务.mp4'])
    // input 必须一起恢复：否则重启后的重试会丢 Cookie/提取音频设置
    expect(store.findByGid('sd-restored-1')?.input?.cookieFile).toBe('D:/cookies.txt')
    expect(store.findByGid('sd-restored-1')?.input?.extractAudio).toBe(true)
  })

  it('上次运行遗留的 active/paused 恢复为 error + 中断文案', () => {
    stubLocalStorage(persistedEnvelope([
      persistedTask({ gid: 'sd-active', status: 'active', percent: 37, filePath: undefined, filePaths: undefined }),
      persistedTask({ gid: 'sd-paused', status: 'paused', percent: 12, filePath: undefined, filePaths: undefined })
    ]))

    const store = useStreamTaskStore()

    expect(store.activeTasks).toHaveLength(0)
    expect(store.pausedTasks).toHaveLength(0)
    expect(store.errorTasks).toHaveLength(2)
    for (const gid of ['sd-active', 'sd-paused']) {
      const task = store.findByGid(gid)
      expect(task?.status).toBe('error')
      expect(task?.error).toBe(STREAM_TASK_INTERRUPTED_ERROR)
      expect(task?.percent).toBe(0)
    }
  })

  it('损坏的持久化数据不会让 store 创建失败，列表为空', () => {
    stubLocalStorage('{ 这不是 JSON')

    expect(() => useStreamTaskStore()).not.toThrow()
    expect(useStreamTaskStore().tasks).toHaveLength(0)
  })

  it('恢复后的记录会在下次启动继续保留（归一化结果回写）', () => {
    const storage = stubLocalStorage(persistedEnvelope([
      persistedTask({ gid: 'sd-active', status: 'active', percent: 55 })
    ]))

    useStreamTaskStore()
    streamTaskPersistence.flush()

    const persisted = JSON.parse(storage.dump() as string) as { tasks: Array<{ gid: string; status: string; error?: string }> }
    expect(persisted.tasks[0]?.status).toBe('error')
    expect(persisted.tasks[0]?.error).toBe(STREAM_TASK_INTERRUPTED_ERROR)
  })

  it('删除任务时同步删除持久化记录（重启后不会诈尸）', async () => {
    const storage = stubLocalStorage()
    const store = useStreamTaskStore()
    await store.startTask({
      url: 'https://example.com/video',
      formatId: '30080',
      merge: true,
      outputDir: 'D:/Downloads',
      title: '测试视频'
    })
    streamTaskPersistence.flush()
    expect(streamTaskPersistence.getSnapshot()).toHaveLength(1)

    await store.removeTask('sd-test-1')
    streamTaskPersistence.flush()

    expect(streamTaskPersistence.getSnapshot()).toHaveLength(0)
    expect((JSON.parse(storage.dump() as string) as { tasks: unknown[] }).tasks).toEqual([])
  })

  it('发起/进度/完成都会落盘（重启后能看到下载成果）', async () => {
    const storage = stubLocalStorage()
    const store = useStreamTaskStore()
    await store.startTask({
      url: 'https://example.com/video',
      formatId: '30080',
      merge: true,
      outputDir: 'D:/Downloads',
      title: '测试视频'
    })
    emit?.({ type: 'progress', id: 'sd-test-1', percent: 42 })
    emit?.({ type: 'completed', id: 'sd-test-1', filePath: 'D:/Downloads/测试视频.mp4' })
    streamTaskPersistence.flush()

    const persisted = JSON.parse(storage.dump() as string) as {
      schemaVersion: number
      tasks: Array<{ gid: string; status: string; filePaths?: string[] }>
    }
    expect(persisted.schemaVersion).toBe(STREAM_TASK_SCHEMA_VERSION)
    expect(persisted.tasks).toHaveLength(1)
    expect(persisted.tasks[0]?.status).toBe('complete')
    expect(persisted.tasks[0]?.filePaths).toEqual(['D:/Downloads/测试视频.mp4'])
  })

  it('重试成功后旧记录的持久化条目被清除', async () => {
    const store = useStreamTaskStore()
    await store.startTask({
      url: 'https://example.com/video',
      formatId: '30080',
      merge: true,
      outputDir: 'D:/Downloads',
      title: '测试视频'
    })
    emit?.({ type: 'failed', id: 'sd-test-1', error: 'boom' })
    ;(window.electronAPI!.streamDownloadStart as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, id: 'sd-retry-9' })

    await store.retryTask('sd-test-1')
    streamTaskPersistence.flush()

    const gids = streamTaskPersistence.getSnapshot().map(task => task.gid)
    expect(gids).not.toContain('sd-test-1')
    expect(gids).toContain('sd-retry-9')
  })

  it('pauseAllTasks 暂停全部进行中的流媒体任务，resumeAllTasks 全部恢复（D-10）', async () => {
    const store = useStreamTaskStore()
    await store.startTask({
      url: 'https://example.com/a',
      formatId: '30080',
      merge: true,
      outputDir: 'D:/Downloads',
      title: '任务 A'
    })
    // 第二条用 started 事件建立（扩展发起的下载路径），确保覆盖"多条并发"
    emit?.({
      type: 'started',
      id: 'sd-ext-2',
      url: 'https://example.com/b',
      title: '任务 B',
      merge: true,
      outputDir: 'D:/Downloads'
    })
    expect(store.activeTasks).toHaveLength(2)

    expect(await store.pauseAllTasks()).toEqual({ paused: 2, failed: 0 })
    expect(store.activeTasks).toHaveLength(0)
    expect(store.pausedTasks).toHaveLength(2)
    expect(window.electronAPI!.streamDownloadPause).toHaveBeenCalledWith('sd-test-1')
    expect(window.electronAPI!.streamDownloadPause).toHaveBeenCalledWith('sd-ext-2')

    expect(await store.resumeAllTasks()).toEqual({ resumed: 2, failed: 0 })
    expect(store.activeTasks).toHaveLength(2)
    expect(store.pausedTasks).toHaveLength(0)
  })

  it('pauseAllTasks 单条失败不影响其余任务，并回传失败条数', async () => {
    const store = useStreamTaskStore()
    await store.startTask({
      url: 'https://example.com/a',
      formatId: '30080',
      merge: true,
      outputDir: 'D:/Downloads',
      title: '任务 A'
    })
    emit?.({
      type: 'started',
      id: 'sd-ext-2',
      url: 'https://example.com/b',
      title: '任务 B',
      merge: true,
      outputDir: 'D:/Downloads'
    })
    // 第一条暂停失败（进程刚退出），第二条仍要被处理
    ;(window.electronAPI!.streamDownloadPause as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(false)

    expect(await store.pauseAllTasks()).toEqual({ paused: 1, failed: 1 })
    expect(store.pausedTasks).toHaveLength(1)
  })

  it('resumeAllTasks 在没有任何暂停任务时是空操作', async () => {
    const store = useStreamTaskStore()
    expect(await store.resumeAllTasks()).toEqual({ resumed: 0, failed: 0 })
    expect(window.electronAPI!.streamDownloadResume).not.toHaveBeenCalled()
  })
})
