import { beforeEach, describe, expect, it, vi } from 'vitest'

// useI18n 只能在组件 setup 里调用；这里把 t 换成「key + 参数」的可读拼接，
// 断言的是「用了哪个文案 key」而不是具体译文。
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params && 'error' in params ? key + '|' + String(params.error) : key
  })
}))

const feedback = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }))
vi.mock('@/utils/feedback', () => ({ message: feedback }))

interface Aria2Bridge {
  getStatus: () => Promise<unknown>
  start: () => Promise<{ success: boolean; error?: string }>
  stop: () => Promise<{ success: boolean; error?: string }>
  restart: () => Promise<{ success: boolean; error?: string }>
  updateConfig: (config: unknown) => Promise<{ success: boolean; code?: string; error?: string }>
}

function runningStatus() {
  return {
    isRunning: true,
    pid: 4321,
    retryCount: 0,
    config: {
      executablePath: 'C:/aria2/aria2c.exe',
      configPath: 'C:/user/aria2/aria2.conf',
      port: 6800,
      secret: 'abc',
      downloadDir: 'C:/downloads',
      enableRpc: true,
      rpcAllowOriginAll: false,
      autoStart: true
    }
  }
}

const bridge: Aria2Bridge = {
  getStatus: async () => runningStatus(),
  start: async () => ({ success: true }),
  stop: async () => ({ success: true }),
  restart: async () => ({ success: true }),
  updateConfig: async () => ({ success: true })
}

function installBridge(api: Partial<Aria2Bridge> | null) {
  ;(globalThis as { window?: unknown }).window = api === null ? {} : { electronAPI: { aria2: { ...bridge, ...api } } }
}

// 模块级单例（processInfo / 并发锁 / 轮询定时器）跨用例共享，每个用例重新加载模块才互不污染
async function load() {
  vi.resetModules()
  return await import('./useAria2LocalService')
}

describe('useAria2LocalService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installBridge({})
  })

  it('初始状态为未运行，能力开关随状态推导', async () => {
    const { useAria2LocalService } = await load()
    const service = useAria2LocalService()
    expect(service.processInfo.value.isRunning).toBe(false)
    expect(service.isRunning.value).toBe(false)
    expect(service.hasError.value).toBe(false)
    expect(service.canStart.value).toBe(true)
    expect(service.canStop.value).toBe(false)
    // 源码这里直接返回 window.electronAPI && window.electronAPI.aria2，是对象不是布尔值
    expect(service.isElectronAvailable.value).toBeTruthy()
  })

  it('getStatus 把主进程返回的进程信息整体写进 processInfo', async () => {
    const { useAria2LocalService } = await load()
    const service = useAria2LocalService()
    await service.getStatus()
    expect(service.processInfo.value.pid).toBe(4321)
    expect(service.isRunning.value).toBe(true)
    expect(service.canStop.value).toBe(true)
    expect(service.canStart.value).toBe(false)
  })

  it('getStatus 失败时把错误写进 processInfo.error（不抛给调用方）', async () => {
    installBridge({ getStatus: async () => { throw new Error('引擎没响应') } })
    const { useAria2LocalService } = await load()
    const service = useAria2LocalService()
    await expect(service.getStatus()).resolves.toBeUndefined()
    expect(service.hasError.value).toBe(true)
    expect(service.processInfo.value.error).toBe('引擎没响应')
  })

  it('没有 electronAPI 时 getStatus 只告警，不抛错', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    installBridge(null)
    const { useAria2LocalService } = await load()
    const service = useAria2LocalService()
    expect(service.isElectronAvailable.value).toBeFalsy()
    await service.getStatus()
    expect(warn.mock.calls.flat().join(' ')).toContain('Electron API not available')
    warn.mockRestore()
  })

  it('start 成功后刷新状态，且启动成功不弹提示（与原行为一致）', async () => {
    const { useAria2LocalService } = await load()
    const service = useAria2LocalService()
    await expect(service.start()).resolves.toBe(true)
    expect(service.isRunning.value).toBe(true)
    expect(feedback.success).not.toHaveBeenCalled()
    expect(feedback.error).not.toHaveBeenCalled()
  })

  it('stop 成功后提示 serviceStopped', async () => {
    const { useAria2LocalService } = await load()
    const service = useAria2LocalService()
    await service.stop()
    expect(feedback.success).toHaveBeenCalledWith('localService.serviceStopped')
  })

  it('restart 成功后提示 restartSuccess', async () => {
    const { useAria2LocalService } = await load()
    const service = useAria2LocalService()
    await service.restart()
    expect(feedback.success).toHaveBeenCalledWith('localService.restartSuccess')
  })

  it('IPC 返回失败时用对应失败文案并带上原始错误，返回 false', async () => {
    installBridge({ start: async () => ({ success: false, error: '端口被占用' }) })
    const { useAria2LocalService } = await load()
    const service = useAria2LocalService()
    await expect(service.start()).resolves.toBe(false)
    expect(feedback.error).toHaveBeenCalledWith('localService.startFailed|端口被占用')
  })

  it('IPC 抛错同样收敛成失败提示，不冒泡', async () => {
    installBridge({ stop: async () => { throw new Error('IPC 断了') } })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { useAria2LocalService } = await load()
    const service = useAria2LocalService()
    await expect(service.stop()).resolves.toBe(false)
    expect(feedback.error).toHaveBeenCalledWith('localService.stopFailed|IPC 断了')
    error.mockRestore()
  })

  it('操作进行中重复点击被拦下并给出等待提示（不重复调 IPC）', async () => {
    let resolveStart: (value: { success: boolean }) => void = () => {}
    const start = vi.fn(() => new Promise<{ success: boolean }>((resolve) => { resolveStart = resolve }))
    installBridge({ start })
    const { useAria2LocalService } = await load()
    const service = useAria2LocalService()
    const first = service.start()
    await expect(service.start()).resolves.toBe(false)
    expect(feedback.warning).toHaveBeenCalledWith('localService.startingWait')
    expect(start).toHaveBeenCalledTimes(1)
    resolveStart({ success: true })
    await expect(first).resolves.toBe(true)
    expect(service.isStarting.value).toBe(false)
  })

  // 停止过程中的 restart 会被 isStopping 拦住（restart 同时检查两把锁）。
  // 反方向（restart 进行中允许 stop）是当前实现的行为，不在这里固化。
  it('停止进行中重启被拦下并给出 operatingWait 提示', async () => {
    let resolveStop: (value: { success: boolean }) => void = () => {}
    installBridge({ stop: () => new Promise((resolve) => { resolveStop = resolve }) })
    const { useAria2LocalService } = await load()
    const service = useAria2LocalService()
    const pending = service.stop()
    await expect(service.restart()).resolves.toBe(false)
    expect(feedback.warning).toHaveBeenCalledWith('localService.operatingWait')
    resolveStop({ success: true })
    await pending
  })

  it('没有 electronAPI 时启动直接给 electronUnavailable，不调 IPC', async () => {
    installBridge(null)
    const { useAria2LocalService } = await load()
    const service = useAria2LocalService()
    await expect(service.start()).resolves.toBe(false)
    expect(feedback.error).toHaveBeenCalledWith('localService.electronUnavailable')
  })

  it('updateConfig 只透传五个已知字段，并显式带上 clearSecret 意图', async () => {
    const updateConfig = vi.fn(async () => ({ success: true }))
    installBridge({ updateConfig })
    const { useAria2LocalService } = await load()
    const service = useAria2LocalService()
    await expect(service.updateConfig({ port: 6801, secret: '', clearSecret: true, autoStart: false })).resolves.toBe(true)
    expect(updateConfig).toHaveBeenCalledWith({
      port: 6801,
      secret: '',
      downloadDir: undefined,
      autoStart: false,
      clearSecret: true
    })
  })

  it('updateConfig 按主进程错误码给出针对性提示（不匹配中文文案）', async () => {
    const cases: Array<[string | undefined, string]> = [
      ['invalid_download_dir', 'localService.invalidDir'],
      ['invalid_port', 'localService.invalidPort'],
      ['config_write_failed', 'localService.writeConfigFailed|写不进去'],
      ['unknown_code', 'localService.updateConfigFailed|出了点问题'],
      [undefined, 'localService.updateConfigFailed|出了点问题']
    ]
    for (const [code, expected] of cases) {
      vi.clearAllMocks()
      installBridge({ updateConfig: async () => ({ success: false, code, error: code === 'config_write_failed' ? '写不进去' : '出了点问题' }) })
      const { useAria2LocalService } = await load()
      const service = useAria2LocalService()
      await expect(service.updateConfig({})).resolves.toBe(false)
      expect(feedback.error).toHaveBeenCalledWith(expected)
    }
  })

  it('updateConfig 抛错时收敛成 updateConfigFailed', async () => {
    installBridge({ updateConfig: async () => { throw new Error('IPC 断了') } })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { useAria2LocalService } = await load()
    const service = useAria2LocalService()
    await expect(service.updateConfig({ port: 6800 })).resolves.toBe(false)
    expect(feedback.error).toHaveBeenCalledWith('localService.updateConfigFailed|IPC 断了')
    error.mockRestore()
  })

  it('initLocalService 只初始化一次，并在首次拉取后开启 5s 轮询；stopStatusCheck 能停掉', async () => {
    const getStatus = vi.fn(async () => runningStatus())
    installBridge({ getStatus })
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    const { initLocalService, stopStatusCheck, useAria2LocalService } = await load()
    const service = useAria2LocalService()
    initLocalService()
    initLocalService()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(getStatus).toHaveBeenCalledTimes(1)
    expect(setIntervalSpy).toHaveBeenCalledTimes(1)
    expect(setIntervalSpy.mock.calls[0][1]).toBe(5000)
    stopStatusCheck()
    expect(service.isRunning.value).toBe(true)
    setIntervalSpy.mockRestore()
  })
})
