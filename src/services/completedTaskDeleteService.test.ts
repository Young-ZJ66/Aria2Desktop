import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Aria2Task } from '@/types/aria2'

interface DeleteFileItem { path: string; success: boolean; error?: string; missing?: boolean; repairedPath?: string }
const deleteFilesMock = vi.fn(async (): Promise<{ success: boolean; results: DeleteFileItem[]; error?: string }> => ({
  success: true,
  results: []
}))
const removePersistedTask = vi.fn()
const removeTaskTime = vi.fn()

vi.mock('./taskPersistenceService', () => ({
  taskPersistenceService: { removePersistedTask: (gid: string) => removePersistedTask(gid) }
}))
vi.mock('./taskTimeService', () => ({
  taskTimeService: { removeTaskTime: (gid: string) => removeTaskTime(gid) }
}))

const { completedTaskDeleteService } = await import('./completedTaskDeleteService')

const task = {
  gid: 'gid-1',
  status: 'complete',
  dir: 'D:/Downloads',
  files: [{ path: 'D:/Downloads/movie.mkv', completedLength: '100', length: '100', selected: 'true' }]
} as unknown as Aria2Task

describe('删除已完成任务时与引擎的配合', () => {
  beforeEach(() => {
    removePersistedTask.mockReset()
    removeTaskTime.mockReset()
    vi.stubGlobal('window', { electronAPI: { deleteFiles: deleteFilesMock } })
    deleteFilesMock.mockClear()
  })

  it('引擎没答应删除时不删文件、也不清本地记录（否则界面会说删了、刷新又回来）', async () => {
    const service = {
      removeDownloadResult: async () => {
        throw new Error('RPC Error: timeout')
      },
      remove: async () => {
        throw new Error('RPC Error: timeout')
      },
      tellStatus: async () => ({ gid: 'gid-1', status: 'complete' })
    }

    const result = await completedTaskDeleteService.deleteCompletedTask(task, true, service)

    expect(result.success).toBe(false)
    expect(result.errors.join(' ')).toContain('timeout')
    expect(deleteFilesMock).not.toHaveBeenCalled()
    expect(removePersistedTask).not.toHaveBeenCalled()
    expect(removeTaskTime).not.toHaveBeenCalled()
  })

  it('引擎确认删掉后才动文件和本地记录', async () => {
    const service = {
      removeDownloadResult: async () => 'OK',
      remove: async () => 'OK',
      tellStatus: async () => {
        throw new Error('GID gid-1 is not found')
      }
    }

    const result = await completedTaskDeleteService.deleteCompletedTask(task, true, service)

    expect(result.success).toBe(true)
    expect(deleteFilesMock).toHaveBeenCalledTimes(1)
    expect(removePersistedTask).toHaveBeenCalledWith('gid-1')
    expect(removeTaskTime).toHaveBeenCalledWith('gid-1')
  })

  it('引擎里查不到这个任务（重启后常见）时照常删除，不当成失败', async () => {
    const service = {
      removeDownloadResult: async () => {
        throw new Error('GID gid-1 is not found')
      },
      remove: async () => {
        throw new Error('GID gid-1 is not found')
      },
      tellStatus: async () => {
        throw new Error('GID gid-1 is not found')
      }
    }

    const result = await completedTaskDeleteService.deleteCompletedTask(task, false, service)

    expect(result.success).toBe(true)
    expect(removePersistedTask).toHaveBeenCalledWith('gid-1')
  })

  it('文件删除失败时保留任务记录并返回失败，方便用户重试', async () => {
    deleteFilesMock.mockResolvedValueOnce({
      success: true,
      results: [{ path: 'D:/Downloads/movie.mkv', success: false, error: 'EPERM' }]
    })
    const service = {
      removeDownloadResult: async () => 'OK',
      remove: async () => 'OK',
      tellStatus: async () => {
        throw new Error('GID gid-1 is not found')
      }
    }

    const result = await completedTaskDeleteService.deleteCompletedTask(task, true, service)

    expect(result.success).toBe(false)
    expect(result.errors.join(' ')).toContain('EPERM')
    expect(removePersistedTask).not.toHaveBeenCalled()
    expect(removeTaskTime).not.toHaveBeenCalled()
  })

  it('文件本来就不在（下载失败、一个字节都没写）时仍算删除成功', async () => {
    // 主进程对"已经不存在的路径"返回 success + missing：用户要的结果已经成立。
    // 早期主进程返回 Not found，渲染层据此拒绝删除整个任务——失败任务因此删不掉。
    deleteFilesMock.mockResolvedValueOnce({
      success: true,
      results: [
        { path: 'C:/Downloads/a.bin', success: true, missing: true },
        { path: 'C:/Downloads/a.bin.aria2', success: true, missing: true }
      ]
    })
    const service = {
      removeDownloadResult: async () => 'OK',
      remove: async () => 'OK',
      tellStatus: async () => {
        throw new Error('GID gid-1 is not found')
      }
    }

    const result = await completedTaskDeleteService.deleteCompletedTask(task, true, service)

    expect(result.success).toBe(true)
    expect(result.errors).toEqual([])
    expect(removePersistedTask).toHaveBeenCalledWith('gid-1')
  })
})

describe('批量删除已完成任务', () => {
  beforeEach(() => {
    removePersistedTask.mockReset()
    removeTaskTime.mockReset()
    vi.stubGlobal('window', { electronAPI: { deleteFiles: deleteFilesMock } })
    deleteFilesMock.mockClear()
    deleteFilesMock.mockResolvedValue({ success: true, results: [] })
  })

  const engineOk = {
    removeDownloadResult: async () => 'OK',
    remove: async () => 'OK',
    tellStatus: async () => {
      throw new Error('GID x is not found')
    }
  }

  it('逐条删除并汇总成功数、失败数与文件数', async () => {
    const tasks = [
      { ...task, gid: 'gid-1' },
      { ...task, gid: 'gid-2' },
      { ...task, gid: 'gid-3' }
    ] as unknown as Aria2Task[]
    deleteFilesMock
      .mockResolvedValueOnce({ success: true, results: [{ path: 'a', success: true }, { path: 'b', success: true }] })
      .mockResolvedValueOnce({ success: true, results: [{ path: 'c', success: true }] })
      .mockResolvedValueOnce({ success: true, results: [{ path: 'd', success: true }] })

    const result = await completedTaskDeleteService.batchDeleteCompletedTasks(tasks, true, engineOk)

    expect(result.totalTasks).toBe(3)
    expect(result.successfulTasks).toBe(3)
    expect(result.failedTasks).toBe(0)
    expect(result.totalFilesDeleted).toBe(4)
    expect(result.results).toHaveLength(3)
    expect(result.errors).toEqual([])
  })

  it('单条失败不打断整批，失败项进 errors', async () => {
    const tasks = [
      { ...task, gid: 'gid-1' },
      { ...task, gid: 'gid-2' }
    ] as unknown as Aria2Task[]
    deleteFilesMock
      .mockResolvedValueOnce({ success: false, results: [], error: 'EACCES' })
      .mockResolvedValueOnce({ success: true, results: [{ path: 'ok', success: true }] })

    const result = await completedTaskDeleteService.batchDeleteCompletedTasks(tasks, true, engineOk)

    expect(result.successfulTasks).toBe(1)
    expect(result.failedTasks).toBe(1)
    expect(result.totalFilesDeleted).toBe(1)
    expect(result.errors.join(' ')).toContain('EACCES')
  })

  it('某一条抛异常时只记失败，其余照常处理', async () => {
    const tasks = [
      { ...task, gid: 'gid-1' },
      { ...task, gid: 'gid-2' }
    ] as unknown as Aria2Task[]
    // 让第一条的文件删除直接抛异常（IPC 层崩了），而不是返回失败结果
    deleteFilesMock
      .mockRejectedValueOnce(new Error('IPC 崩了'))
      .mockResolvedValueOnce({ success: true, results: [{ path: 'ok', success: true }] })

    const result = await completedTaskDeleteService.batchDeleteCompletedTasks(tasks, true, engineOk)

    expect(result.totalTasks).toBe(2)
    expect(result.failedTasks).toBeGreaterThanOrEqual(1)
    expect(result.successfulTasks).toBeGreaterThanOrEqual(1)
    expect(result.errors.join(' ')).toContain('IPC 崩了')
  })

  it('空任务列表返回全零，不报错', async () => {
    const result = await completedTaskDeleteService.batchDeleteCompletedTasks([], true, engineOk)

    expect(result).toEqual({
      totalTasks: 0,
      successfulTasks: 0,
      failedTasks: 0,
      totalFilesDeleted: 0,
      results: [],
      errors: []
    })
  })
})

describe('任务文件信息', () => {
  it('hasDeleteableFiles 在有文件时为 true', () => {
    expect(completedTaskDeleteService.hasDeleteableFiles(task)).toBe(true)
  })

  it('没有文件的任务没有可删除项', () => {
    const empty = { gid: 'gid-2', status: 'complete', dir: 'D:/Downloads', files: [] } as unknown as Aria2Task
    expect(completedTaskDeleteService.hasDeleteableFiles(empty)).toBe(false)
  })

  it('getTaskFilesSummary 同时给出数量与路径列表', () => {
    const summary = completedTaskDeleteService.getTaskFilesSummary(task)

    expect(summary.fileCount).toBe(summary.filePaths.length)
    expect(summary.filePaths.length).toBeGreaterThan(0)
    expect(summary.filePaths.some((item) => item.endsWith('movie.mkv'))).toBe(true)
  })

  it('相对路径按任务下载目录拼接，并补出同名 .aria2 控制文件', () => {
    const relative = {
      gid: 'gid-3',
      status: 'complete',
      dir: 'D:/Downloads',
      files: [{ path: 'sub/file.zip', completedLength: '1', length: '1', selected: 'true' }]
    } as unknown as Aria2Task

    const paths = completedTaskDeleteService.getTaskFilePaths(relative)

    expect(paths).toContain('D:\\Downloads\\sub\\file.zip')
    expect(paths).toContain('D:\\Downloads\\sub\\file.zip.aria2')
  })

  it('BT 未选中的文件不参与删除（aria2 根本没创建它们）', () => {
    const partial = {
      gid: 'gid-4',
      status: 'complete',
      dir: 'D:/Downloads',
      files: [
        { path: 'D:/Downloads/picked.bin', completedLength: '1', length: '1', selected: 'true' },
        { path: 'D:/Downloads/skipped.bin', completedLength: '0', length: '1', selected: 'false' }
      ]
    } as unknown as Aria2Task

    const paths = completedTaskDeleteService.getTaskFilePaths(partial)

    expect(paths.some((item) => item.includes('picked.bin'))).toBe(true)
    expect(paths.some((item) => item.includes('skipped.bin'))).toBe(false)
  })
})
