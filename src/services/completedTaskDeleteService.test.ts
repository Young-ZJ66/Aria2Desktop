import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Aria2Task } from '@/types/aria2'

const deleteFilesMock = vi.fn(async () => ({ success: true, results: [] as Array<{ success: boolean; path: string }> }))
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
})
