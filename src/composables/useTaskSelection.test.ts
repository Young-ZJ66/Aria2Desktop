import { describe, expect, it } from 'vitest'
import type { Aria2Task } from '@/types/aria2'
import { useTaskSelection } from './useTaskSelection'

function makeTask(gid: string): Aria2Task {
  return {
    gid,
    status: 'active',
    totalLength: '1',
    completedLength: '0',
    uploadLength: '0',
    downloadSpeed: '0',
    uploadSpeed: '0',
    connections: '0',
    numSeeders: '0',
    dir: 'D:/Downloads',
    files: []
  } as Aria2Task
}

describe('useTaskSelection 作用域隔离', () => {
  it('下载页与完成页的勾选互不影响', () => {
    const downloading = useTaskSelection('test-downloading')
    const completed = useTaskSelection('test-completed')
    const task = makeTask('g1')

    downloading.selectTask(task)

    expect(downloading.isTaskSelected('g1')).toBe(true)
    expect(completed.isTaskSelected('g1')).toBe(false)
    expect(completed.selectedCount.value).toBe(0)

    downloading.clearSelection()
    expect(downloading.selectedCount.value).toBe(0)
  })

  it('清理不存在的任务只影响本作用域', () => {
    const downloading = useTaskSelection('test-cleanup-downloading')
    const completed = useTaskSelection('test-cleanup-completed')
    downloading.selectTask(makeTask('active-1'))
    completed.selectTask(makeTask('done-1'))

    downloading.cleanupNonExistentTasks(['active-1'])

    expect(downloading.isTaskSelected('active-1')).toBe(true)
    expect(completed.isTaskSelected('done-1')).toBe(true)
  })
})
