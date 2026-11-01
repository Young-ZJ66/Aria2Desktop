import { describe, expect, it } from 'vitest'
import { streamTaskToAria2Task, type StreamTask } from './streamTaskUtils'

function makeTask(patch: Partial<StreamTask> = {}): StreamTask {
  return {
    gid: 'sd-test-1',
    url: 'https://example.com/video',
    formatId: '30080',
    merge: true,
    outputDir: 'D:/Downloads',
    title: '【官方 MV】Never Gonna Give You Up',
    status: 'active',
    percent: 0,
    speedBytes: 0,
    speedText: '',
    eta: '',
    totalBytes: 0,
    downloadedBytes: 0,
    createdAt: 1_700_000_000_000,
    ...patch
  }
}

describe('streamTaskToAria2Task', () => {
  it('进行中任务：进度按百分比折算，速度用原始字节值', () => {
    const mapped = streamTaskToAria2Task(makeTask({
      percent: 42.5,
      totalBytes: 1_000_000,
      speedBytes: 2_048_000
    }))
    expect(mapped.status).toBe('active')
    expect(mapped.totalLength).toBe('1000000')
    expect(mapped.completedLength).toBe('425000')
    expect(mapped.downloadSpeed).toBe('2048000')
    expect(mapped.files[0]?.path).toBe('【官方 MV】Never Gonna Give You Up')
    expect(mapped.dir).toBe('D:/Downloads')
  })

  it('总大小未知时回退到已下载字节', () => {
    const mapped = streamTaskToAria2Task(makeTask({ percent: 30, totalBytes: 0, downloadedBytes: 12_000 }))
    expect(mapped.totalLength).toBe('0')
    expect(mapped.completedLength).toBe('12000')
  })

  it('完成任务：文件名取完整路径，并带上完成时间', () => {
    const mapped = streamTaskToAria2Task(makeTask({
      status: 'complete',
      percent: 100,
      totalBytes: 75_234_072,
      filePath: 'D:/Downloads/Never Gonna Give You Up.mp4',
      completedAt: 1_700_000_100_000
    }))
    expect(mapped.status).toBe('complete')
    expect(mapped.files[0]?.path).toBe('D:/Downloads/Never Gonna Give You Up.mp4')
    expect(mapped.completionTime).toBe('1700000100')
  })

  it('失败任务保留错误状态，供列表显示重试入口', () => {
    const mapped = streamTaskToAria2Task(makeTask({ status: 'error', error: 'HTTP 403' }))
    expect(mapped.status).toBe('error')
    expect(mapped.files[0]?.uris[0]?.uri).toBe('https://example.com/video')
  })
})
