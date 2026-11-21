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

describe('useTaskSelection 派生状态与清理', () => {
  it('selectedCount 与 hasSelection 跟随选择变化', () => {
    const s = useTaskSelection('test-count')
    expect(s.selectedCount.value).toBe(0)
    expect(s.hasSelection.value).toBe(false)
    s.selectTask(makeTask('g1'))
    expect(s.selectedCount.value).toBe(1)
    expect(s.hasSelection.value).toBe(true)
    s.clearSelection()
    expect(s.hasSelection.value).toBe(false)
  })

  it('cleanupNonExistentTasks 有失效项时换成新 Map 并丢掉它们', () => {
    const s = useTaskSelection('test-cleanup-changed')
    s.selectTasks([makeTask('a'), makeTask('b')])
    const before = s.selectedTasks.value
    s.cleanupNonExistentTasks(['a'])
    expect(s.selectedTasks.value).not.toBe(before)
    expect(s.selectedTaskGids.value.has('a')).toBe(true)
    expect(s.selectedTaskGids.value.has('b')).toBe(false)
    expect(s.selectedCount.value).toBe(1)
  })
})

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

function makeTaskOf(gid: string, status: Aria2Task['status']): Aria2Task {
  return { ...makeTask(gid), status } as Aria2Task
}

describe('useTaskSelection 选择操作', () => {
  it('toggle 在已选与未选之间来回切换', () => {
    const sel = useTaskSelection('test-toggle')
    const task = makeTask('t1')

    sel.toggleTask(task)
    expect(sel.isTaskSelected('t1')).toBe(true)
    expect(sel.selectedCount.value).toBe(1)

    sel.toggleTask(task)
    expect(sel.isTaskSelected('t1')).toBe(false)
    expect(sel.selectedCount.value).toBe(0)
  })

  it('unselectTask 只移除指定 gid', () => {
    const sel = useTaskSelection('test-unselect')
    sel.selectTasks([makeTask('u1'), makeTask('u2')])

    sel.unselectTask('u1')

    expect(sel.isTaskSelected('u1')).toBe(false)
    expect(sel.isTaskSelected('u2')).toBe(true)
    expect(sel.selectedCount.value).toBe(1)
  })

  it('selectTask 存的是任务快照，后续源对象变化不影响已选项', () => {
    const sel = useTaskSelection('test-snapshot')
    const task = makeTask('s1')
    sel.selectTask(task)

    task.status = 'complete'

    // 选择时浅拷贝：轮询拿到的新对象不会静默改写抽屉里的旧数据
    expect(sel.selectedTasks.value[0].status).toBe('active')
  })

  it('selectAll 覆盖式选择，selectTasks 追加式选择', () => {
    const sel = useTaskSelection('test-select-all')
    sel.selectTasks([makeTask('a1')])

    sel.selectAll([makeTask('b1'), makeTask('b2')])
    expect(sel.selectedTaskGids.value.has('a1')).toBe(false)
    expect(sel.selectedTaskGids.value.size).toBe(2)

    sel.selectTasks([makeTask('c1')])
    expect(sel.selectedTaskGids.value.size).toBe(3)
  })

  it('selectedTaskGids 返回 Set 语义，供 allChecked 直接 .has 查询', () => {
    const sel = useTaskSelection('test-gid-set')
    sel.selectTask(makeTask('g1'))

    expect(sel.selectedTaskGids.value).toBeInstanceOf(Set)
    expect(sel.selectedTaskGids.value.has('g1')).toBe(true)
  })

  it('批量操作可用性：暂停只认 active，继续认 paused/waiting/error', () => {
    const sel = useTaskSelection('test-batch-flags')

    sel.selectTask(makeTaskOf('p1', 'paused'))
    expect(sel.canBatchPause.value).toBe(false)
    expect(sel.canBatchStart.value).toBe(true)

    sel.selectAll([makeTaskOf('a1', 'active'), makeTaskOf('a2', 'active')])
    expect(sel.canBatchPause.value).toBe(true)
    expect(sel.canBatchStart.value).toBe(false)

    sel.selectAll([makeTaskOf('e1', 'error'), makeTaskOf('w1', 'waiting')])
    expect(sel.canBatchStart.value).toBe(true)
  })

  it('updateSelectedTaskData 只更新已选中的任务', () => {
    const sel = useTaskSelection('test-update-one')
    sel.selectTask(makeTask('upd1'))

    sel.updateSelectedTaskData(makeTaskOf('upd1', 'complete'))
    sel.updateSelectedTaskData(makeTaskOf('other', 'complete'))

    expect(sel.selectedTasks.value).toHaveLength(1)
    expect(sel.selectedTasks.value[0].status).toBe('complete')
  })

  it('updateSelectedTasksData 一次批量刷新，未选中的任务被忽略', () => {
    const sel = useTaskSelection('test-update-many')
    sel.selectTasks([makeTask('m1'), makeTask('m2')])

    sel.updateSelectedTasksData([
      makeTaskOf('m1', 'complete'),
      makeTaskOf('m2', 'paused'),
      makeTaskOf('m3', 'active')
    ])

    expect(sel.selectedCount.value).toBe(2)
    expect(sel.selectedTasks.value.map(t => t.status).sort()).toEqual(['complete', 'paused'])
  })

  it('没有任何选中项时批量刷新是空操作', () => {
    const sel = useTaskSelection('test-update-empty')
    const before = sel.selectedTasks.value

    sel.updateSelectedTasksData([makeTask('x1')])

    // 空选择直接返回，不构造新 Map（避免每秒轮询触发下游 computed 重算）
    expect(sel.selectedTasks.value).toBe(before)
    expect(sel.selectedCount.value).toBe(0)
  })

  it('cleanupNonExistentTasks 在没有失效项时不换引用', () => {
    const sel = useTaskSelection('test-cleanup-noop')
    sel.selectTask(makeTask('keep'))
    const before = sel.selectedTasks.value

    sel.cleanupNonExistentTasks(['keep'])

    expect(sel.selectedTasks.value).toBe(before)
  })
})
