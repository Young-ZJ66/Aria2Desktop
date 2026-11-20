import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface Watcher {
  source: () => unknown
  cb: (value: unknown, old?: unknown) => void
}

type MockFn = ReturnType<typeof vi.fn>
type FakeApi = Record<string, MockFn> & { aria2: { restart: MockFn } }

const h = vi.hoisted(() => {
  const state = {
    settings: {
      language: 'en-US',
      refreshInterval: 1000,
      clipboardMonitorEnabled: false,
      downloadCompleteAction: 'none',
      autoConnect: false
    } as Record<string, unknown>,
    activeTasks: [] as Array<Record<string, string>>,
    waitingTasks: [] as Array<Record<string, string>>,
    completedTasks: [] as Array<Record<string, string>>,
    allTasks: [] as Array<Record<string, unknown>>,
    isConnected: false,
    showConnectionDialog: false,
    showUpdateDialog: false,
    completionDecision: 'wait' as string,
    errorKind: 'unknown' as string
  }
  const spies = {
    setLocale: vi.fn(),
    normalizeLocale: vi.fn((value: string) => (value ? value : null)),
    initialize: vi.fn(() => Promise.resolve()),
    applyTheme: vi.fn(),
    connect: vi.fn(() => Promise.resolve()),
    disconnect: vi.fn(),
    loadProfiles: vi.fn(),
    loadAllTasks: vi.fn(),
    pauseAllTasks: vi.fn(),
    unpauseAllTasks: vi.fn(),
    unsubDownloadComplete: vi.fn(),
    unsubDownloadError: vi.fn(),
    loadGlobalStat: vi.fn(),
    loadVersion: vi.fn(),
    loadGlobalOptions: vi.fn(),
    openNewTask: vi.fn(),
    openSettings: vi.fn(),
    openNewTaskWithUrl: vi.fn(),
    openNewTaskWithFile: vi.fn(),
    openUpdateDialog: vi.fn(),
    push: vi.fn(),
    record: vi.fn(),
    streamPauseAll: vi.fn(),
    streamResumeAll: vi.fn(),
    resetHistory: vi.fn(),
    startMonitor: vi.fn(),
    stopMonitor: vi.fn(),
    startAutoUpdate: vi.fn(),
    startSlowUpdate: vi.fn(),
    stopAutoUpdate: vi.fn(),
    stopAll: vi.fn(),
    clipboardStart: vi.fn(),
    clipboardStop: vi.fn(),
    handleDetectedUrl: vi.fn(),
    shortcutsStart: vi.fn(),
    shortcutsStop: vi.fn(),
    initLocalService: vi.fn(),
    stopStatusCheck: vi.fn(),
    flushTasks: vi.fn(() => Promise.resolve()),
    flushTimes: vi.fn(),
    evaluateCompletion: vi.fn(() => state.completionDecision),
    shouldCancelShutdown: vi.fn(() => false),
    classifyError: vi.fn(() => state.errorKind),
    messageError: vi.fn(() => ({ destroy: vi.fn() })),
    messageWarning: vi.fn(() => ({ destroy: vi.fn() })),
    messageInfo: vi.fn(() => ({ destroy: vi.fn() }))
  }
  return {
    state,
    spies,
    mounted: [] as Array<() => unknown>,
    unmounted: [] as Array<() => unknown>,
    watchers: [] as Watcher[],
    cbs: {} as Record<string, (gid: string) => void>,
    window: {} as {
      electronAPI: FakeApi
      __flushPendingTaskData?: () => Promise<void>
    }
  }
})

vi.mock('vue', () => ({
  onMounted: (fn: () => unknown) => { h.mounted.push(fn) },
  onUnmounted: (fn: () => unknown) => { h.unmounted.push(fn) },
  watch: (source: () => unknown, cb: (value: unknown, old?: unknown) => void) => {
    h.watchers.push({ source, cb })
    return () => {}
  }
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? key + '|' + JSON.stringify(params) : key)
  })
}))

vi.mock('@/i18n', () => ({ setLocale: h.spies.setLocale }))
vi.mock('@/shared/locale', () => ({ normalizeLocale: h.spies.normalizeLocale }))
vi.mock('@/shared/aria2Error', () => ({ classifyAria2Error: h.spies.classifyError }))
vi.mock('@/shared/downloadCompletion', () => ({
  evaluateDownloadCompletion: h.spies.evaluateCompletion,
  shouldCancelPendingShutdown: h.spies.shouldCancelShutdown
}))
vi.mock('@/utils/feedback', () => ({
  message: {
    error: h.spies.messageError,
    warning: h.spies.messageWarning,
    info: h.spies.messageInfo
  }
}))
vi.mock('@/composables/useAria2LocalService', () => ({
  initLocalService: h.spies.initLocalService,
  stopStatusCheck: h.spies.stopStatusCheck
}))
vi.mock('@/composables/useTrafficMonitor', () => ({
  useTrafficMonitor: () => ({
    resetHistory: h.spies.resetHistory,
    startMonitor: h.spies.startMonitor,
    stopMonitor: h.spies.stopMonitor
  })
}))
vi.mock('@/composables/useAutoRefresh', () => ({
  useAutoRefresh: () => ({
    startAutoUpdate: h.spies.startAutoUpdate,
    startSlowUpdate: h.spies.startSlowUpdate,
    stopAutoUpdate: h.spies.stopAutoUpdate,
    stopAll: h.spies.stopAll
  })
}))
vi.mock('@/composables/useClipboardMonitor', () => ({
  useClipboardMonitor: () => ({
    start: h.spies.clipboardStart,
    stop: h.spies.clipboardStop,
    handleDetectedUrl: h.spies.handleDetectedUrl
  })
}))
vi.mock('@/composables/useKeyboardShortcuts', () => ({
  useKeyboardShortcuts: () => ({
    start: h.spies.shortcutsStart,
    stop: h.spies.shortcutsStop
  })
}))
vi.mock('@/services/taskPersistenceService', () => ({
  taskPersistenceService: { flush: h.spies.flushTasks }
}))
vi.mock('@/services/taskTimeService', () => ({
  stopTimeCleanupTimer: vi.fn(),
  taskTimeService: { flush: h.spies.flushTimes }
}))

vi.mock('@/stores/connectionStore', () => ({
  useConnectionStore: () => ({
    get isConnected() { return h.state.isConnected },
    get showConnectionDialog() { return h.state.showConnectionDialog },
    set showConnectionDialog(value: boolean) { h.state.showConnectionDialog = value },
    connect: h.spies.connect,
    disconnect: h.spies.disconnect,
    loadProfiles: h.spies.loadProfiles
  })
}))

vi.mock('@/stores/taskStore', () => ({
  useTaskStore: () => ({
    get activeTasks() { return h.state.activeTasks },
    get waitingTasks() { return h.state.waitingTasks },
    get completedTasks() { return h.state.completedTasks },
    get allTasks() { return h.state.allTasks },
    loadAllTasks: h.spies.loadAllTasks,
    pauseAllTasks: h.spies.pauseAllTasks,
    unpauseAllTasks: h.spies.unpauseAllTasks,
    onDownloadComplete: (cb: (gid: string) => void) => {
      h.cbs.downloadComplete = cb
      return h.spies.unsubDownloadComplete
    },
    onDownloadError: (cb: (gid: string) => void) => {
      h.cbs.downloadError = cb
      return h.spies.unsubDownloadError
    }
  })
}))

vi.mock('@/stores/statsStore', () => ({
  useStatsStore: () => ({
    loadGlobalStat: h.spies.loadGlobalStat,
    loadVersion: h.spies.loadVersion,
    loadGlobalOptions: h.spies.loadGlobalOptions
  })
}))

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => ({
    get settings() { return h.state.settings },
    initialize: h.spies.initialize,
    getSetting: (key: string) => h.state.settings[key],
    applyTheme: h.spies.applyTheme,
    updateSetting: (key: string, value: unknown) => {
      h.state.settings[key] = value
      return Promise.resolve()
    }
  })
}))

vi.mock('@/stores/uiStore', () => ({
  useUiStore: () => ({
    get showUpdateDialog() { return h.state.showUpdateDialog },
    openNewTask: h.spies.openNewTask,
    openSettings: h.spies.openSettings,
    openNewTaskWithUrl: h.spies.openNewTaskWithUrl,
    openNewTaskWithFile: h.spies.openNewTaskWithFile,
    openUpdateDialog: h.spies.openUpdateDialog
  })
}))

vi.mock('@/stores/notificationStore', () => ({
  useNotificationStore: () => ({ push: h.spies.push }),
  resolveNotificationTitle: (
    task: { name?: string, files?: Array<{ path?: string }>, gid: string },
    fallback: (prefix: string) => string
  ) => {
    if (task.name) return task.name
    const filePath = task.files?.[0]?.path
    if (filePath) return filePath.split(/[\\/]/).pop() || filePath
    return fallback(task.gid.slice(0, 8))
  }
}))

vi.mock('@/stores/downloadHistoryStore', () => ({
  useDownloadHistoryStore: () => ({ record: h.spies.record })
}))

vi.mock('@/stores/streamTaskStore', () => ({
  useStreamTaskStore: () => ({
    pauseAllTasks: h.spies.streamPauseAll,
    resumeAllTasks: h.spies.streamResumeAll
  })
}))

const { useAppLifecycle } = await import('./useAppLifecycle')

function fakeWindow(): { electronAPI: FakeApi } {
  return {
    electronAPI: {
      notifyAppReady: vi.fn(),
      checkUpdatesOnStartup: vi.fn(() => Promise.resolve({ success: true, hasUpdate: false })),
      onPendingDownloadUrl: vi.fn(() => vi.fn()),
      onPendingTaskFile: vi.fn(() => vi.fn()),
      onEngineCrashed: vi.fn(() => vi.fn()),
      onEngineGaveUp: vi.fn(() => vi.fn()),
      onEngineStarted: vi.fn(() => vi.fn()),
      onClipboardUrlDetected: vi.fn(() => vi.fn()),
      onTrayAction: vi.fn(() => vi.fn()),
      onConfigChanged: vi.fn(() => vi.fn()),
      sendNotification: vi.fn(),
      extractArchive: vi.fn(),
      deleteFiles: vi.fn(() => Promise.resolve({ success: true })),
      setTaskbarProgress: vi.fn(),
      systemCancelShutdown: vi.fn(() => Promise.resolve({ success: true })),
      systemShutdown: vi.fn(() => Promise.resolve({ success: true })),
      systemHibernate: vi.fn(() => Promise.resolve({ success: true })),
      close: vi.fn(),
      openFile: vi.fn(() => Promise.resolve({ success: true })),
      openInExplorer: vi.fn(() => Promise.resolve({ success: true })),
      openPath: vi.fn(() => Promise.resolve({ success: true })),
      aria2: { restart: vi.fn(() => Promise.resolve()) }
    } as unknown as FakeApi
  }
}

function themeManager() {
  return {
    initSystemThemeListener: vi.fn(),
    disposeSystemThemeListener: vi.fn()
  }
}

async function setup() {
  const manager = themeManager()
  useAppLifecycle(manager as unknown as Parameters<typeof useAppLifecycle>[0])
  return manager
}

async function mountApp() {
  const manager = await setup()
  await h.mounted[0]()
  return manager
}

function runWatcher(index: number, value: unknown, old?: unknown) {
  h.watchers[index].cb(value, old)
}

function runConnectionWatcher(connected: boolean, old: boolean) {
  h.state.isConnected = connected
  runWatcher(2, connected, old)
}

function runCompletionWatcher() {
  runWatcher(1, [
    h.state.activeTasks.length,
    h.state.waitingTasks.length,
    h.state.isConnected,
    h.state.completedTasks.length
  ])
}

function api() {
  return h.window.electronAPI
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  h.state.settings = {
    language: 'en-US',
    refreshInterval: 1000,
    clipboardMonitorEnabled: false,
    downloadCompleteAction: 'none',
    autoConnect: false
  }
  h.state.activeTasks = []
  h.state.waitingTasks = []
  h.state.completedTasks = []
  h.state.allTasks = []
  h.state.isConnected = false
  h.state.showConnectionDialog = false
  h.state.showUpdateDialog = false
  h.state.completionDecision = 'wait'
  h.state.errorKind = 'unknown'
  h.mounted = []
  h.unmounted = []
  h.watchers = []
  h.cbs = {}
  h.window = fakeWindow()
  vi.stubGlobal('window', h.window)
  vi.stubGlobal('console', { ...console, warn: vi.fn(), error: vi.fn() })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('挂载时的初始化', () => {
  it('先初始化设置再同步语言与主题', async () => {
    const manager = await mountApp()
    expect(h.spies.initialize).toHaveBeenCalledTimes(1)
    expect(h.spies.setLocale).toHaveBeenCalledWith('en-US')
    expect(h.spies.applyTheme).toHaveBeenCalledTimes(1)
    expect(manager.initSystemThemeListener).toHaveBeenCalledTimes(1)
    expect(h.spies.initialize.mock.invocationCallOrder[0])
      .toBeLessThan(h.spies.setLocale.mock.invocationCallOrder[0])
    expect(api().notifyAppReady).toHaveBeenCalledTimes(1)
    expect(h.spies.shortcutsStart).toHaveBeenCalledTimes(1)
    expect(h.spies.initLocalService).toHaveBeenCalledTimes(1)
    expect(h.spies.loadProfiles).toHaveBeenCalledTimes(1)
  })

  it('语言无法归一化时不调用 setLocale', async () => {
    h.state.settings.language = ''
    await mountApp()
    expect(h.spies.normalizeLocale).toHaveBeenCalledWith('')
    expect(h.spies.setLocale).not.toHaveBeenCalled()
  })

  it('未开启自动连接时不主动连接', async () => {
    await mountApp()
    expect(h.spies.connect).not.toHaveBeenCalled()
  })

  it('开启自动连接时连接成功后不弹对话框', async () => {
    h.state.settings.autoConnect = true
    await mountApp()
    expect(h.spies.connect).toHaveBeenCalledTimes(1)
    expect(h.state.showConnectionDialog).toBe(false)
  })

  it('自动连接失败时弹出连接对话框且不抛出', async () => {
    h.state.settings.autoConnect = true
    h.spies.connect.mockRejectedValueOnce(new Error('refused'))
    await expect(mountApp()).resolves.toBeTruthy()
    expect(h.state.showConnectionDialog).toBe(true)
  })
})

describe('启动更新检查', () => {
  it('发现新版本时打开更新弹窗', async () => {
    api().checkUpdatesOnStartup.mockResolvedValueOnce({
      success: true,
      hasUpdate: true,
      version: '1.5.0',
      notes: 'notes',
      alreadyDownloaded: false,
      manualDownload: true
    })
    await mountApp()
    await vi.runAllTicks()
    expect(h.spies.openUpdateDialog).toHaveBeenCalledWith({
      version: '1.5.0',
      notes: 'notes',
      state: 'prompt',
      manualDownload: true
    })
  })

  it('已下载过时直接进入已下载状态', async () => {
    api().checkUpdatesOnStartup.mockResolvedValueOnce({
      success: true,
      hasUpdate: true,
      version: '1.5.0',
      alreadyDownloaded: true
    })
    await mountApp()
    await vi.runAllTicks()
    expect(h.spies.openUpdateDialog.mock.calls[0][0]).toMatchObject({ state: 'downloaded' })
  })

  it('没有新版本时不弹窗', async () => {
    await mountApp()
    await vi.runAllTicks()
    expect(h.spies.openUpdateDialog).not.toHaveBeenCalled()
  })

  it('更新弹窗已打开时不重复检查', async () => {
    h.state.showUpdateDialog = true
    await mountApp()
    expect(api().checkUpdatesOnStartup).not.toHaveBeenCalled()
  })

  it('检查抛错只告警不影响启动', async () => {
    api().checkUpdatesOnStartup.mockRejectedValueOnce(new Error('offline'))
    await mountApp()
    await vi.runAllTicks()
    expect(h.spies.openUpdateDialog).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalled()
  })
})

describe('连接状态联动', () => {
  it('连接成功后启动刷新、加载数据与流量采集', async () => {
    await mountApp()
    runConnectionWatcher(true, false)
    expect(h.spies.startAutoUpdate).toHaveBeenCalledWith(1000)
    expect(h.spies.startSlowUpdate).toHaveBeenCalledTimes(1)
    expect(h.spies.loadGlobalStat).toHaveBeenCalledTimes(1)
    expect(h.spies.loadVersion).toHaveBeenCalledTimes(1)
    expect(h.spies.loadAllTasks).toHaveBeenCalledTimes(1)
    expect(h.spies.resetHistory).toHaveBeenCalledTimes(1)
    expect(h.spies.startMonitor).toHaveBeenCalledTimes(1)
    expect(h.spies.unsubDownloadComplete).toBeTruthy()
    expect(typeof h.cbs.downloadComplete).toBe('function')
    expect(typeof h.cbs.downloadError).toBe('function')
  })

  it('刷新间隔按设置下发', async () => {
    h.state.settings.refreshInterval = 3000
    await mountApp()
    runConnectionWatcher(true, false)
    expect(h.spies.startAutoUpdate).toHaveBeenCalledWith(3000)
  })

  it('首次连接会关掉残留的连接对话框，重连不再关', async () => {
    await mountApp()
    h.state.showConnectionDialog = true
    runConnectionWatcher(true, false)
    expect(h.state.showConnectionDialog).toBe(false)
    h.state.showConnectionDialog = true
    runConnectionWatcher(true, true)
    expect(h.state.showConnectionDialog).toBe(true)
  })

  it('断开连接后停刷新、停采集并退订全部订阅', async () => {
    await mountApp()
    const clipboardUnsub = vi.fn()
    const trayUnsub = vi.fn()
    api().onClipboardUrlDetected.mockReturnValueOnce(clipboardUnsub)
    api().onTrayAction.mockReturnValueOnce(trayUnsub)
    runConnectionWatcher(true, false)
    runConnectionWatcher(false, true)
    expect(h.spies.stopAll).toHaveBeenCalledTimes(1)
    expect(h.spies.stopMonitor).toHaveBeenCalledTimes(1)
    expect(h.spies.resetHistory).toHaveBeenCalledTimes(2)
    expect(h.spies.clipboardStop).toHaveBeenCalledTimes(1)
    expect(clipboardUnsub).toHaveBeenCalledTimes(1)
    expect(trayUnsub).toHaveBeenCalledTimes(1)
    expect(h.spies.unsubDownloadComplete).toHaveBeenCalledTimes(1)
    expect(h.spies.unsubDownloadError).toHaveBeenCalledTimes(1)
  })

  it('剪贴板监控默认不启动，开启后启动并接收推送链接', async () => {
    await mountApp()
    runConnectionWatcher(true, false)
    expect(h.spies.clipboardStart).not.toHaveBeenCalled()
    expect(h.spies.handleDetectedUrl).not.toHaveBeenCalled()
    const push = api().onClipboardUrlDetected.mock.calls[0][0]
    push('magnet:?xt=urn:btih:abc')
    expect(h.spies.handleDetectedUrl).toHaveBeenCalledWith('magnet:?xt=urn:btih:abc')
  })

  it('开启剪贴板监控后连接即启动', async () => {
    h.state.settings.clipboardMonitorEnabled = true
    await mountApp()
    runConnectionWatcher(true, false)
    expect(h.spies.clipboardStart).toHaveBeenCalledTimes(1)
  })

  it('切换剪贴板开关立即生效', async () => {
    await mountApp()
    runConnectionWatcher(true, false)
    h.state.settings.clipboardMonitorEnabled = true
    runWatcher(3, true)
    expect(h.spies.clipboardStart).toHaveBeenCalledTimes(1)
    h.state.settings.clipboardMonitorEnabled = false
    runWatcher(3, false)
    expect(h.spies.clipboardStop).toHaveBeenCalledTimes(1)
  })

  it('未连接时切换剪贴板开关不动作', async () => {
    await mountApp()
    runWatcher(3, true)
    expect(h.spies.clipboardStart).not.toHaveBeenCalled()
  })
})

describe('托盘动作', () => {
  async function trayAction(action: string) {
    await mountApp()
    runConnectionWatcher(true, false)
    const handler = api().onTrayAction.mock.calls[0][0]
    handler(action)
  }

  it('new-task 打开新建下载弹窗', async () => {
    await trayAction('new-task')
    expect(h.spies.openNewTask).toHaveBeenCalledTimes(1)
  })

  it('settings 打开设置弹窗', async () => {
    await trayAction('settings')
    expect(h.spies.openSettings).toHaveBeenCalledWith()
  })

  it('open-engine-settings 直接定位到引擎页', async () => {
    await trayAction('open-engine-settings')
    expect(h.spies.openSettings).toHaveBeenCalledWith('engine')
  })

  it('pause-all 同时暂停 aria2 与流媒体任务', async () => {
    await trayAction('pause-all')
    expect(h.spies.pauseAllTasks).toHaveBeenCalledTimes(1)
    expect(h.spies.streamPauseAll).toHaveBeenCalledTimes(1)
  })

  it('resume-all 同时恢复 aria2 与流媒体任务', async () => {
    await trayAction('resume-all')
    expect(h.spies.unpauseAllTasks).toHaveBeenCalledTimes(1)
    expect(h.spies.streamResumeAll).toHaveBeenCalledTimes(1)
  })

  it('speed-limit-changed 重载全局选项', async () => {
    await trayAction('speed-limit-changed')
    expect(h.spies.loadGlobalOptions).toHaveBeenCalledTimes(1)
  })

  it('restart-engine 走引擎重启 IPC', async () => {
    await trayAction('restart-engine')
    expect(api().aria2.restart).toHaveBeenCalledTimes(1)
  })
})

describe('下载完成与失败处理', () => {
  it('下载完成写通知中心、记历史并发系统通知', async () => {
    h.state.allTasks = [{ gid: 'g1', bittorrent: { info: { name: 'ubuntu.iso' } }, totalLength: '1048576', files: [] }]
    await mountApp()
    runConnectionWatcher(true, false)
    h.cbs.downloadComplete('g1')
    expect(h.spies.push).toHaveBeenCalledWith({ type: 'complete', gid: 'g1', name: 'ubuntu.iso' })
    expect(h.spies.record).toHaveBeenCalledWith(1048576)
    expect(api().sendNotification).toHaveBeenCalledWith('notification.downloadComplete', 'ubuntu.iso (1 MB)')
  })

  it('任务名缺失时回退到文件名', async () => {
    h.state.allTasks = [{ gid: 'g2', files: [{ path: 'D:/dl/report.zip' }], totalLength: '0' }]
    await mountApp()
    runConnectionWatcher(true, false)
    h.cbs.downloadComplete('g2')
    expect(h.spies.push.mock.calls[0][0].name).toBe('report.zip')
  })

  it('未开启自动解压时不调用解压接口', async () => {
    h.state.allTasks = [{ gid: 'g1', files: [{ path: 'D:/dl/a.zip' }], totalLength: '10' }]
    await mountApp()
    runConnectionWatcher(true, false)
    h.cbs.downloadComplete('g1')
    expect(api().extractArchive).not.toHaveBeenCalled()
  })

  it('开启自动解压且全部解出时提示并删除压缩包', async () => {
    h.state.settings.download = { autoExtract: true, autoDeleteArchive: true }
    h.state.allTasks = [{ gid: 'g1', files: [{ path: 'D:/dl/a.zip' }], totalLength: '10' }]
    api().extractArchive.mockResolvedValueOnce({ extracted: true, skipped: 0 })
    await mountApp()
    runConnectionWatcher(true, false)
    h.cbs.downloadComplete('g1')
    await vi.runAllTicks()
    expect(api().extractArchive).toHaveBeenCalledWith('D:/dl/a.zip')
    expect(api().sendNotification).toHaveBeenCalledWith('notification.archiveExtracted', 'a.zip')
    expect(api().deleteFiles).toHaveBeenCalledWith(['D:/dl/a.zip'])
  })

  it('有文件被跳过时保留压缩包并提示部分解压', async () => {
    h.state.settings.download = { autoExtract: true, autoDeleteArchive: true }
    h.state.allTasks = [{ gid: 'g1', files: [{ path: 'D:/dl/a.zip' }], totalLength: '10' }]
    api().extractArchive.mockResolvedValueOnce({ extracted: true, skipped: 2 })
    await mountApp()
    runConnectionWatcher(true, false)
    h.cbs.downloadComplete('g1')
    await vi.runAllTicks()
    expect(api().sendNotification).toHaveBeenCalledWith('notification.archiveExtractedPartial|{"count":2}', 'a.zip')
    expect(api().deleteFiles).not.toHaveBeenCalled()
  })

  it('格式不支持时不打扰用户', async () => {
    h.state.settings.download = { autoExtract: true }
    h.state.allTasks = [{ gid: 'g1', files: [{ path: 'D:/dl/a.bin' }], totalLength: '10' }]
    api().extractArchive.mockResolvedValueOnce({ success: false, reason: 'unsupported_format' })
    await mountApp()
    runConnectionWatcher(true, false)
    h.cbs.downloadComplete('g1')
    await vi.runAllTicks()
    expect(h.spies.messageError).not.toHaveBeenCalled()
  })

  it('真正失败时提示原因', async () => {
    h.state.settings.download = { autoExtract: true }
    h.state.allTasks = [{ gid: 'g1', files: [{ path: 'D:/dl/a.tar' }], totalLength: '10' }]
    api().extractArchive.mockResolvedValueOnce({ success: false, reason: 'tar_not_available' })
    await mountApp()
    runConnectionWatcher(true, false)
    h.cbs.downloadComplete('g1')
    await vi.runAllTicks()
    expect(h.spies.messageError).toHaveBeenCalledWith('generalSettings.autoExtractUnavailable|{"error":"tar_not_available"}')
  })

  it('下载失败按错误码分类给出可操作提示', async () => {
    h.state.errorKind = 'network'
    h.state.allTasks = [{ gid: 'g9', bittorrent: { info: { name: 'seed.torrent' } }, errorCode: '1' }]
    await mountApp()
    runConnectionWatcher(true, false)
    h.cbs.downloadError('g9')
    expect(h.spies.classifyError).toHaveBeenCalledWith('1')
    expect(h.spies.push).toHaveBeenCalledWith({
      type: 'error',
      gid: 'g9',
      name: 'seed.torrent',
      detail: 'taskDetail.aria2Error.network'
    })
    expect(api().sendNotification).toHaveBeenCalledWith('notification.downloadFailed', 'seed.torrent · taskDetail.aria2Error.network')
  })

  it('未知错误码只报任务名', async () => {
    h.state.allTasks = [{ gid: 'g9', bittorrent: { info: { name: 'x' } } }]
    await mountApp()
    runConnectionWatcher(true, false)
    h.cbs.downloadError('g9')
    expect(h.spies.push.mock.calls[0][0].detail).toBe('')
    expect(api().sendNotification).toHaveBeenCalledWith('notification.downloadFailed', 'x')
  })
})

describe('引擎状态提示', () => {
  it('崩溃提示带次数并在下一条到来时销毁上一条', async () => {
    const first = { destroy: vi.fn() }
    h.spies.messageWarning.mockReturnValueOnce(first)
    await mountApp()
    const onCrashed = api().onEngineCrashed.mock.calls[0][0]
    onCrashed({ retryCount: 1 })
    expect(h.spies.messageWarning).toHaveBeenCalledWith('notification.engineCrashed|{"count":1}', { duration: 8000 })
    onCrashed({ retryCount: 2 })
    expect(first.destroy).toHaveBeenCalledTimes(1)
  })

  it('放弃重启的提示不会自动消失，引擎恢复后两条提示都退场', async () => {
    const gaveUp = { destroy: vi.fn() }
    h.spies.messageError.mockReturnValueOnce(gaveUp)
    await mountApp()
    api().onEngineGaveUp.mock.calls[0][0]({ attempts: 5 })
    expect(h.spies.messageError).toHaveBeenCalledWith('notification.engineGaveUp|{"count":5}', { duration: 0 })
    api().onEngineStarted.mock.calls[0][0]()
    expect(gaveUp.destroy).toHaveBeenCalledTimes(1)
  })
})

describe('外部推送', () => {
  it('协议链接只接受 magnet 与 http', async () => {
    await mountApp()
    const push = api().onPendingDownloadUrl.mock.calls[0][0]
    push('magnet:?xt=urn:btih:abc')
    push('https://example.com/a.iso')
    push('ftp://example.com/a.iso')
    push('')
    expect(h.spies.openNewTaskWithUrl).toHaveBeenCalledTimes(2)
  })

  it('文件关联把 base64 还原成 File 后走拖拽预填', async () => {
    await mountApp()
    const push = api().onPendingTaskFile.mock.calls[0][0]
    const payload = Buffer.from('d4c3b2a1', 'hex').toString('base64')
    push({ kind: 'torrent', name: 'a.torrent', data: payload })
    expect(h.spies.openNewTaskWithFile).toHaveBeenCalledTimes(1)
    const file = h.spies.openNewTaskWithFile.mock.calls[0][0] as File
    expect(file.name).toBe('a.torrent')
    expect(file.type).toBe('application/x-bittorrent')
  })

  it('magnet 元链接文件用 metalink 类型', async () => {
    await mountApp()
    const push = api().onPendingTaskFile.mock.calls[0][0]
    push({ kind: 'metalink', name: 'a.meta4', data: '' })
    const file = h.spies.openNewTaskWithFile.mock.calls[0][0] as File
    expect(file.type).toBe('application/metalink4+xml')
  })

  it('坏载荷只打日志不抛错', async () => {
    await mountApp()
    const push = api().onPendingTaskFile.mock.calls[0][0]
    const atobSpy = vi.spyOn(globalThis, 'atob').mockImplementation(() => { throw new Error('bad') })
    expect(() => push({ kind: 'torrent', name: 'a.torrent', data: '!!!' })).not.toThrow()
    expect(console.error).toHaveBeenCalled()
    expect(h.spies.openNewTaskWithFile).not.toHaveBeenCalled()
    atobSpy.mockRestore()
  })
})

describe('配置热重载', () => {
  it('主题变更后重新应用主题', async () => {
    await mountApp()
    const onConfig = api().onConfigChanged.mock.calls[0][0]
    onConfig({ key: 'theme', value: 'dark' })
    await vi.runAllTicks()
    expect(h.state.settings.theme).toBe('dark')
    expect(h.spies.applyTheme).toHaveBeenCalledTimes(2)
  })

  it('刷新间隔为 NaN 时兜底 1 秒而不是 0 毫秒死循环', async () => {
    await mountApp()
    runConnectionWatcher(true, false)
    const onConfig = api().onConfigChanged.mock.calls[0][0]
    onConfig({ key: 'refreshInterval', value: 'abc' })
    expect(h.spies.stopAutoUpdate).toHaveBeenCalledTimes(1)
    expect(h.spies.startAutoUpdate).toHaveBeenLastCalledWith(1000)
  })

  it('刷新间隔过小时同样兜底 1 秒', async () => {
    await mountApp()
    runConnectionWatcher(true, false)
    const onConfig = api().onConfigChanged.mock.calls[0][0]
    onConfig({ key: 'refreshInterval', value: 50 })
    expect(h.spies.startAutoUpdate).toHaveBeenLastCalledWith(1000)
  })

  it('引擎参数变更提示需要重启', async () => {
    await mountApp()
    const onConfig = api().onConfigChanged.mock.calls[0][0]
    onConfig({ key: 'engine-restart-required', value: true })
    expect(h.spies.messageWarning).toHaveBeenCalledWith('settings.backup.restartHint', { duration: 8000 })
  })
})

describe('任务栏进度', () => {
  it('没有活动任务时清空进度', async () => {
    await mountApp()
    runWatcher(0, [])
    expect(api().setTaskbarProgress).toHaveBeenCalledWith(-1)
  })

  it('按整体完成比例下发进度', async () => {
    h.state.activeTasks = [
      { gid: 'a', totalLength: '100', completedLength: '25' },
      { gid: 'b', totalLength: '100', completedLength: '25' }
    ]
    await mountApp()
    runWatcher(0, h.state.activeTasks)
    expect(api().setTaskbarProgress).toHaveBeenCalledWith(0.25)
  })

  it('进度没变化时不重复发 IPC', async () => {
    h.state.activeTasks = [{ gid: 'a', totalLength: '100', completedLength: '50' }]
    await mountApp()
    runWatcher(0, h.state.activeTasks)
    runWatcher(0, h.state.activeTasks)
    expect(api().setTaskbarProgress).toHaveBeenCalledTimes(1)
  })
})

describe('下载完成后动作', () => {
  it('动作设为 none 时不执行任何系统操作', async () => {
    await mountApp()
    runConnectionWatcher(true, false)
    h.state.activeTasks = [{ gid: 'a1' }]
    runCompletionWatcher()
    h.cbs.downloadComplete('a1')
    h.state.activeTasks = []
    h.state.completedTasks = [{ gid: 'a1' }]
    h.state.completionDecision = 'fire'
    runCompletionWatcher()
    await vi.advanceTimersByTimeAsync(3000)
    expect(api().close).not.toHaveBeenCalled()
    expect(api().systemShutdown).not.toHaveBeenCalled()
  })

  it('动作设为 close 时延迟 3 秒关闭应用', async () => {
    h.state.settings.downloadCompleteAction = 'close'
    await mountApp()
    runConnectionWatcher(true, false)
    h.state.activeTasks = [{ gid: 'a1' }]
    runCompletionWatcher()
    h.cbs.downloadComplete('a1')
    h.state.activeTasks = []
    h.state.completedTasks = [{ gid: 'a1' }]
    h.state.completionDecision = 'fire'
    runCompletionWatcher()
    expect(api().close).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(3000)
    expect(api().close).toHaveBeenCalledTimes(1)
  })

  it('本批次有任务没收到完成事件时不触发动作', async () => {
    h.state.settings.downloadCompleteAction = 'close'
    await mountApp()
    runConnectionWatcher(true, false)
    h.state.activeTasks = [{ gid: 'a1' }, { gid: 'a2' }]
    runCompletionWatcher()
    h.cbs.downloadComplete('a1')
    h.state.activeTasks = []
    h.state.completedTasks = [{ gid: 'a1' }, { gid: 'a2' }]
    h.state.completionDecision = 'fire'
    runCompletionWatcher()
    await vi.advanceTimersByTimeAsync(3000)
    expect(api().close).not.toHaveBeenCalled()
  })

  it('关机失败时把原因告诉用户', async () => {
    h.state.settings.downloadCompleteAction = 'shutdown'
    api().systemShutdown.mockResolvedValueOnce({ success: false, error: 'policy' })
    await mountApp()
    runConnectionWatcher(true, false)
    h.state.activeTasks = [{ gid: 'a1' }]
    runCompletionWatcher()
    h.cbs.downloadComplete('a1')
    h.state.activeTasks = []
    h.state.completedTasks = [{ gid: 'a1' }]
    h.state.completionDecision = 'fire'
    runCompletionWatcher()
    await vi.advanceTimersByTimeAsync(3000)
    expect(h.spies.messageError).toHaveBeenCalledWith('generalSettings.shutdownFailed|{"error":"policy"}')
  })
})

describe('卸载与退出刷盘', () => {
  it('卸载时退订全部监听并断开连接', async () => {
    const manager = await mountApp()
    runConnectionWatcher(true, false)
    h.unmounted[0]()
    expect(h.spies.stopAll).toHaveBeenCalled()
    expect(h.spies.stopStatusCheck).toHaveBeenCalledTimes(1)
    expect(h.spies.shortcutsStop).toHaveBeenCalledTimes(1)
    expect(manager.disposeSystemThemeListener).toHaveBeenCalledTimes(1)
    expect(h.spies.disconnect).toHaveBeenCalledTimes(1)
  })

  it('挂载时注册的退出刷盘入口能落盘任务与时间', async () => {
    await mountApp()
    await h.window.__flushPendingTaskData?.()
    expect(h.spies.flushTasks).toHaveBeenCalledTimes(1)
    expect(h.spies.flushTimes).toHaveBeenCalledTimes(1)
  })
})
