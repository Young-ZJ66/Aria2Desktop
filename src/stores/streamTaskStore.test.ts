import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { StreamDownloadEvent } from '@/types/electron'
import { useStreamTaskStore } from './streamTaskStore'

/** 主进程事件订阅回调（测试里手动触发） */
let emit: ((event: StreamDownloadEvent) => void) | null = null

beforeEach(() => {
  setActivePinia(createPinia())
  emit = null
  vi.stubGlobal('window', {
    electronAPI: {
      streamDownloadStart: vi.fn(async () => ({ success: true, id: 'sd-test-1' })),
      streamDownloadCancel: vi.fn(async () => true),
      deleteFiles: vi.fn(async (paths: string[]) => ({ success: true, results: paths.map(path => ({ path, success: true })) })),
      onStreamDownloadEvent: vi.fn((callback: (event: StreamDownloadEvent) => void) => {
        emit = callback
        return () => { emit = null }
      })
    }
  })
})

afterEach(() => {
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

  it('removeTask 对进行中的任务先取消再移除（顺序不能反）', async () => {
    const store = useStreamTaskStore()
    await store.startTask({
      url: 'https://example.com/video',
      formatId: '30080',
      merge: true,
      outputDir: 'D:/Downloads',
      title: '测试视频'
    })
    const calls: string[] = []
    ;(window.electronAPI!.streamDownloadCancel as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      calls.push('cancel')
      return true
    })

    await store.removeTask('sd-test-1')

    expect(calls).toEqual(['cancel'])
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

  it('removeTask 勾选删除文件时调用 deleteFiles，并把输出目录作为白名单参数', async () => {
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
    expect(window.electronAPI!.deleteFiles).toHaveBeenCalledWith(['E:/Media/测试视频.mp4'], 'E:/Media')
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
    ;(window.electronAPI!.deleteFiles as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      results: [{ path: 'D:/Downloads/测试视频.mp4', success: false, error: 'Access denied' }]
    })

    const result = await store.removeTask('sd-test-1', true)

    expect(result.success).toBe(false)
    expect(result.error).toBe('Access denied')
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

    expect(window.electronAPI!.deleteFiles).not.toHaveBeenCalled()
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
      outputDir: 'D:/Downloads'
    })
    expect(store.findByGid('sd-test-1')).toBeUndefined()
    expect(store.findByGid('sd-retry-1')).toBeDefined()
  })
})
