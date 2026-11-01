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
})
