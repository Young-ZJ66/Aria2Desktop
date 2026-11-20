import { describe, expect, it } from 'vitest'
import type { Aria2File, Aria2Task } from '@/types/aria2'
import { createBatchOutcome, needsBatchResult, recordBatchFailure, recordFailure } from './batchResult'

function makeFile(path: string): Aria2File {
  return { index: '1', path, length: '0', completedLength: '0', selected: 'true', uris: [] }
}

function makeTask(gid: string, files: Aria2File[] = []): Aria2Task {
  return {
    gid,
    status: 'error',
    totalLength: '0',
    completedLength: '0',
    uploadLength: '0',
    downloadSpeed: '0',
    uploadSpeed: '0',
    connections: '0',
    dir: 'D:/Downloads',
    files
  }
}

describe('batchResult', () => {
  it('createBatchOutcome 从全 0 开始，且每次返回独立对象', () => {
    const a = createBatchOutcome()
    const b = createBatchOutcome()
    expect(a).toEqual({ success: 0, failed: 0, skipped: 0, failures: [] })
    a.failed += 1
    expect(b.failed).toBe(0)
  })

  it('recordBatchFailure 累加失败计数并记录任务名与原因', () => {
    const outcome = createBatchOutcome()
    recordBatchFailure(outcome, makeTask('g1', [makeFile('D:/dl/movie.mkv')]), 'RPC 错误')
    const torrentTask = makeTask('g2')
    torrentTask.bittorrent = { info: { name: 'ubuntu.iso' } }
    recordBatchFailure(outcome, torrentTask, '文件被占用')

    expect(outcome.failed).toBe(2)
    expect(outcome.failures).toEqual([
      { name: 'movie.mkv', reason: 'RPC 错误' },
      { name: 'ubuntu.iso', reason: '文件被占用' }
    ])
  })

  it('recordBatchFailure 在没有文件名时回落到 gid，不出现空行', () => {
    const outcome = createBatchOutcome()
    recordBatchFailure(outcome, makeTask('gid-only'), '未知错误')
    expect(outcome.failures[0]?.name).toBe('gid-only')
  })

  it('recordFailure 允许直接给名字（删除服务只回 taskName，没有完整任务对象）', () => {
    const outcome = createBatchOutcome()
    recordFailure(outcome, 'file.zip', '删除任务记录失败：RPC Error')
    expect(outcome.failed).toBe(1)
    expect(outcome.failures[0]).toEqual({ name: 'file.zip', reason: '删除任务记录失败：RPC Error' })
  })

  it('needsBatchResult 只在有失败或跳过时需要面板', () => {
    expect(needsBatchResult(null)).toBe(false)
    expect(needsBatchResult(createBatchOutcome())).toBe(false)
    // 全部成功：已有 success 提示，不必再占一块面板
    expect(needsBatchResult({ success: 3, failed: 0, skipped: 0, failures: [] })).toBe(false)
    expect(needsBatchResult({ success: 0, failed: 2, skipped: 0, failures: [] })).toBe(true)
    expect(needsBatchResult({ success: 1, failed: 0, skipped: 2, failures: [] })).toBe(true)
  })
})
