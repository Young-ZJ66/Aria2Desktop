import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useUiStore } from './uiStore'

describe('uiStore 设置弹窗关闭守卫', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('注册守卫后 requestCloseSettings 交给守卫处理，不直接关闭', () => {
    const store = useUiStore()
    const guard = vi.fn()
    store.registerSettingsCloseGuard(guard)
    store.openSettings()

    store.requestCloseSettings()

    expect(guard).toHaveBeenCalledTimes(1)
    expect(store.showSettings).toBe(true)
  })

  it('没有守卫时回退为直接关闭', () => {
    const store = useUiStore()
    store.openSettings()

    store.requestCloseSettings()

    expect(store.showSettings).toBe(false)
  })
})

describe('uiStore 页内浮层状态', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('新建下载弹窗：带 URL 打开会清掉上一次预填的文件', () => {
    const ui = useUiStore()
    ui.openNewTaskWithFile(new File(['x'], 'a.torrent'))
    expect(ui.showNewTask).toBe(true)
    expect(ui.newTaskPrefilledFile).not.toBeNull()

    ui.openNewTaskWithUrl('https://example.com/a.zip')
    expect(ui.newTaskPrefilledUrl).toBe('https://example.com/a.zip')
    // 同一个弹窗只有一种预填来源，切换时必须清掉另一种，否则会同时带上文件和 URL
    expect(ui.newTaskPrefilledFile).toBeNull()
  })

  it('新建下载弹窗：带文件打开会清掉上一次预填的 URL', () => {
    const ui = useUiStore()
    ui.openNewTaskWithUrl('https://example.com/a.zip')
    ui.openNewTaskWithFile(new File(['x'], 'b.torrent'))

    expect(ui.newTaskPrefilledFile).not.toBeNull()
    expect(ui.newTaskPrefilledUrl).toBe('')
  })

  it('关闭新建下载弹窗会一并清掉预填内容', () => {
    const ui = useUiStore()
    ui.openNewTaskWithUrl('https://example.com/a.zip')
    ui.closeNewTask()

    expect(ui.showNewTask).toBe(false)
    // 预填内容不清会让下次普通「新建」复用上一次的链接
    expect(ui.newTaskPrefilledUrl).toBe('')
    expect(ui.newTaskPrefilledFile).toBeNull()
  })

  it('openNewTask 只是打开弹窗，不写入任何预填内容', () => {
    const ui = useUiStore()
    ui.openNewTaskWithUrl('https://example.com/a.zip')
    ui.closeNewTask()

    ui.openNewTask()
    expect(ui.showNewTask).toBe(true)
    expect(ui.newTaskPrefilledUrl).toBe('')
  })

  it('设置弹窗：指定页签时切换并记住，不指定时保留上次位置', () => {
    const ui = useUiStore()
    expect(ui.settingsTab).toBe('general')

    ui.openSettings('download')
    expect(ui.showSettings).toBe(true)
    expect(ui.settingsTab).toBe('download')

    ui.closeSettings()
    ui.openSettings()
    expect(ui.showSettings).toBe(true)
    expect(ui.settingsTab).toBe('download')
  })

  it('注销关闭守卫后恢复直接关闭，且不会继续调用旧守卫', () => {
    const ui = useUiStore()
    ui.openSettings()
    const guard = vi.fn()
    ui.registerSettingsCloseGuard(guard)
    ui.unregisterSettingsCloseGuard()

    ui.requestCloseSettings()
    expect(guard).not.toHaveBeenCalled()
    expect(ui.showSettings).toBe(false)
  })

  it('任务详情抽屉：打开记录 gid，关闭清空 gid', () => {
    const ui = useUiStore()
    ui.openTaskDetail('g1')
    expect(ui.showTaskDetail).toBe(true)
    expect(ui.taskDetailGid).toBe('g1')

    ui.closeTaskDetail()
    expect(ui.showTaskDetail).toBe(false)
    // 留着旧 gid 会让下次打开先闪一帧上一个任务的信息
    expect(ui.taskDetailGid).toBeNull()
  })

  it('通知中心开关', () => {
    const ui = useUiStore()
    ui.openNotifications()
    expect(ui.showNotifications).toBe(true)
    ui.closeNotifications()
    expect(ui.showNotifications).toBe(false)
  })

  it('更新弹窗：默认从 prompt 阶段开始并清零进度', () => {
    const ui = useUiStore()
    ui.updatePercent = 88

    ui.openUpdateDialog({ version: '1.5.0' })

    expect(ui.showUpdateDialog).toBe(true)
    expect(ui.updateVersion).toBe('1.5.0')
    expect(ui.updateNotes).toBe('')
    expect(ui.updateDialogState).toBe('prompt')
    expect(ui.updateManualDownload).toBe(false)
    // 上一次下载残留的百分比不清零，重新打开时会先显示 88% 再跳回 0
    expect(ui.updatePercent).toBe(0)
  })

  it('更新弹窗：可跳过已完成阶段并标记为手动下载', () => {
    const ui = useUiStore()
    ui.openUpdateDialog({
      version: '1.5.0',
      notes: '修复若干问题',
      state: 'downloaded',
      manualDownload: true
    })

    expect(ui.updateDialogState).toBe('downloaded')
    expect(ui.updateNotes).toBe('修复若干问题')
    expect(ui.updateManualDownload).toBe(true)
  })

  it('关闭更新弹窗只隐藏，不清掉版本信息', () => {
    const ui = useUiStore()
    ui.openUpdateDialog({ version: '1.5.0' })
    ui.closeUpdateDialog()

    expect(ui.showUpdateDialog).toBe(false)
    expect(ui.updateVersion).toBe('1.5.0')
  })
})
