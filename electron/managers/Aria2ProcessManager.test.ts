import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'

const h = vi.hoisted(() => {
  const state = {
    exists: true,
    portOpen: false,
    rpcThrows: false,
    reloadResult: true,
    removeResult: false,
    relevant: {} as Record<string, string | undefined>,
    configValues: {} as Record<string, string | undefined>,
    statThrows: false,
    statMtime: 1000,
    children: [] as any[],
    kills: [] as string[],
    spawnCalls: [] as any[],
    spawnSyncCalls: [] as any[],
    chmodCalls: [] as any[],
    logs: { debug: [] as any[], info: [] as any[], warn: [] as any[], error: [] as any[] },
    configManagers: [] as any[]
  }
  return { state }
})

const { state } = h

function makeChild(pid: number) {
  const child = new EventEmitter() as any
  child.pid = pid
  child.exitCode = null
  child.signalCode = null
  child.killed = false
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn((signal: string) => {
    child.killed = true
    state.kills.push(signal)
    return true
  })
  child.exitWith = (code: number | null, signal: string | null = null) => {
    child.exitCode = code
    child.signalCode = signal
    child.emit('exit', code, signal)
  }
  return child
}

vi.mock('child_process', () => ({
  spawn: vi.fn((file: string, args: string[], options: unknown) => {
    state.spawnCalls.push({ file, args, options })
    const child = makeChild(1000 + state.children.length)
    state.children.push(child)
    return child
  }),
  spawnSync: vi.fn((file: string, args: string[]) => {
    state.spawnSyncCalls.push({ file, args })
    return { status: 0 }
  })
}))

vi.mock('net', () => ({
  Socket: class FakeSocket {
    handlers: Record<string, (arg?: unknown) => void> = {}
    destroyed = false
    timeoutMs = 0
    setTimeout(ms: number) { this.timeoutMs = ms; return this }
    once(event: string, cb: (arg?: unknown) => void) { this.handlers[event] = cb; return this }
    on(event: string, cb: (arg?: unknown) => void) { this.handlers[event] = cb; return this }
    connect() {
      if (state.portOpen) this.handlers.connect?.()
      else this.handlers.error?.(new Error('ECONNREFUSED'))
    }
    destroy() { this.destroyed = true }
  }
}))

vi.mock('fs', () => ({
  existsSync: vi.fn(() => state.exists),
  chmodSync: vi.fn((file: string, mode: number) => { state.chmodCalls.push({ file, mode }) }),
  statSync: vi.fn(() => {
    if (state.statThrows) throw new Error('ENOENT')
    return { mode: 0o644, mtimeMs: state.statMtime }
  })
}))

vi.mock('electron', () => ({ app: { getPath: vi.fn(() => 'E:/downloads') } }))

vi.mock('../utils/resourceManager', () => ({
  ResourceManager: {
    getInstance: () => ({
      initializeResources: () => ({
        executablePath: 'E:/resources/aria2/aria2c.exe',
        configPath: 'E:/userData/aria2/aria2.conf'
      }),
      getSessionFilePath: () => 'E:\\userData\\aria2\\aria2.session',
      isAria2Available: () => true,
      getResourceInfo: () => ({ available: true })
    })
  }
}))

vi.mock('../utils/aria2ConfigManager', () => ({
  Aria2ConfigManager: class FakeConfigManager {
    getConfigValue = vi.fn((key: string) => state.configValues[key])
    setConfigValue = vi.fn()
    setMultipleConfigs = vi.fn()
    commentConfigValue = vi.fn()
    removeConfigKey = vi.fn(() => state.removeResult)
    flushSave = vi.fn()
    reload = vi.fn(() => state.reloadResult)
    getRelevantConfigs = vi.fn(() => state.relevant)
    getConfigFilePath = vi.fn(() => 'E:/userData/aria2/aria2.conf')
    constructor(public configPath?: string) {
      state.configManagers.push(this)
    }
  }
}))

vi.mock('../utils/aria2Rpc', () => ({
  callAria2Rpc: vi.fn(async () => {
    if (state.rpcThrows) throw new Error('rpc down')
    return { version: '1.37.0' }
  }),
  Aria2RpcError: class Aria2RpcError extends Error {}
}))

vi.mock('../utils/logger', () => ({
  createLogger: () => ({
    debug: (...args: unknown[]) => { state.logs.debug.push(args) },
    info: (...args: unknown[]) => { state.logs.info.push(args) },
    warn: (...args: unknown[]) => { state.logs.warn.push(args) },
    error: (...args: unknown[]) => { state.logs.error.push(args) }
  })
}))

vi.mock('../utils/mainErrorCopy', () => ({
  mainError: (locale: string, key: string, params?: Record<string, unknown>) =>
    locale + ':' + key + (params ? '|' + JSON.stringify(params) : '')
}))

vi.mock('../utils/mainLocaleRuntime', () => ({ runtimeMainLocale: () => 'zh' }))

type Manager = import('./Aria2ProcessManager').Aria2ProcessManager

async function loadManager(config: Record<string, unknown> = {}): Promise<Manager> {
  vi.resetModules()
  const mod = await import('./Aria2ProcessManager')
  return new mod.Aria2ProcessManager(config)
}

async function flush(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

function resetState(): void {
  state.exists = true
  state.portOpen = false
  state.rpcThrows = false
  state.reloadResult = true
  state.removeResult = false
  state.relevant = {}
  state.configValues = {}
  state.statThrows = false
  state.statMtime = 1000
  state.children = []
  state.kills = []
  state.spawnCalls = []
  state.spawnSyncCalls = []
  state.chmodCalls = []
  state.configManagers = []
  state.logs = { debug: [], info: [], warn: [], error: [] }
}

beforeEach(() => {
  resetState()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('配置归一与读取', () => {
  it('默认配置给出内置引擎路径、6800 端口与保守开关', async () => {
    const manager = await loadManager()
    const config = manager.getConfig()
    expect(config.executablePath).toBe('E:/resources/aria2/aria2c.exe')
    expect(config.configPath).toBe('E:/userData/aria2/aria2.conf')
    expect(config.port).toBe(6800)
    expect(config.secret).toBe('')
    expect(config.downloadDir).toBe('')
    expect(config.enableRpc).toBe(true)
    expect(config.rpcAllowOriginAll).toBe(true)
    expect(config.rpcListenAll).toBe(false)
    expect(config.rpcSecure).toBe(false)
    expect(config.autoStart).toBe(true)
  })

  it('显式配置优先于默认值', async () => {
    const manager = await loadManager({ port: 7100, autoStart: false })
    const config = manager.getConfig()
    expect(config.port).toBe(7100)
    // 下载目录以 aria2.conf 的 dir 为准，文件里没写就是空串（不拿内存值假装已生效）
    expect(config.downloadDir).toBe('')
    expect(config.autoStart).toBe(false)
  })

  it('配置文件没有 rpc-secret 时密钥为空串（不把内存值当已生效）', async () => {
    const manager = await loadManager({ secret: 'abc' })
    expect(manager.getConfig().secret).toBe('')
    state.relevant = { secret: 'from-file' }
    expect(manager.getConfig().secret).toBe('from-file')
  })

  it('getConfig 以配置文件为准，缺失时回退内存值', async () => {
    const manager = await loadManager({ port: 6800 })
    state.relevant = {
      port: '7100',
      secret: 'from-file',
      dir: 'E:/file-dir',
      enableRpc: 'FALSE',
      rpcAllowOriginAll: 'false',
      rpcListenAll: 'true',
      rpcSecure: 'true'
    }
    const config = manager.getConfig()
    expect(config.port).toBe(7100)
    expect(config.secret).toBe('from-file')
    expect(config.downloadDir).toBe('E:/file-dir')
    expect(config.enableRpc).toBe(false)
    expect(config.rpcAllowOriginAll).toBe(false)
    expect(config.rpcListenAll).toBe(true)
    expect(config.rpcSecure).toBe(true)
  })

  it('配置文件 mtime 未变时不重复重载', async () => {
    const manager = await loadManager()
    manager.getConfig()
    const first = state.configManagers[0].reload.mock.calls.length
    manager.getConfig()
    expect(state.configManagers[0].reload.mock.calls.length).toBe(first)
  })

  it('配置文件读不到时仍尝试重载且不缓存 mtime', async () => {
    const manager = await loadManager()
    state.statThrows = true
    manager.getConfig()
    manager.getConfig()
    expect(state.configManagers[0].reload.mock.calls.length).toBe(2)
  })

  it('syncConfig 只在值变化时替换内存配置', async () => {
    const manager = await loadManager({ port: 6800 })
    manager.syncConfig({ port: 6800 })
    expect(manager.getConfig().port).toBe(6800)
    manager.syncConfig({ port: 7100 })
    expect(manager.getConfig().port).toBe(7100)
  })
})

describe('启动引擎', () => {
  it('可执行文件存在且 RPC 就绪时启动成功并带上配置文件参数', async () => {
    state.portOpen = true
    const manager = await loadManager({ port: 7100 })
    const started = await manager.start()
    expect(started).toBe(true)
    expect(state.spawnCalls).toHaveLength(1)
    expect(state.spawnCalls[0].file).toBe('E:/resources/aria2/aria2c.exe')
    expect(state.spawnCalls[0].args).toEqual(['--conf-path=E:/userData/aria2/aria2.conf'])
    expect(state.spawnCalls[0].options.windowsHide).toBe(true)
    expect(manager.isRunning()).toBe(true)
  })

  it('已在运行时再次启动直接返回 true 且不重复 spawn', async () => {
    state.portOpen = true
    const manager = await loadManager()
    await manager.start()
    expect(await manager.start()).toBe(true)
    expect(state.spawnCalls).toHaveLength(1)
  })

  it('可执行文件不存在时启动失败并给出路径', async () => {
    state.exists = false
    const manager = await loadManager()
    expect(await manager.start()).toBe(false)
    expect(state.spawnCalls).toHaveLength(0)
    const errors = state.logs.error.map(args => String(args[0]) + String(args[1] ?? ''))
    expect(errors.some(text => text.includes('engine.executableMissing'))).toBe(true)
  })

  it('配置里 enable-rpc=false 时启动失败', async () => {
    state.portOpen = true
    state.configValues = { 'enable-rpc': 'false' }
    const manager = await loadManager()
    expect(await manager.start()).toBe(false)
    expect(state.spawnCalls).toHaveLength(1)
  })

  it('端口被其它服务占用时启动失败并给出占用提示', async () => {
    state.portOpen = true
    state.rpcThrows = true
    const manager = await loadManager()
    const pending = manager.start()
    await vi.advanceTimersByTimeAsync(16000)
    expect(await pending).toBe(false)
    const errors = state.logs.error.map(args => String(args[0]))
    expect(errors.some(text => text.includes('端口 6800 上有服务在监听'))).toBe(true)
  })

  it('进程在等待 RPC 期间退出时启动失败', async () => {
    const manager = await loadManager()
    const pending = manager.start()
    await flush()
    state.children[0].exitWith(1)
    await vi.advanceTimersByTimeAsync(500)
    expect(await pending).toBe(false)
  })

  it('POSIX 上缺执行位时补上所有者执行位', async () => {
    const original = process.platform
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    try {
      state.portOpen = true
      const manager = await loadManager()
      await manager.start()
      expect(state.chmodCalls).toHaveLength(1)
      expect(state.chmodCalls[0].mode).toBe(0o744)
    } finally {
      Object.defineProperty(process, 'platform', { value: original, configurable: true })
    }
  })

  it('Windows 上不碰执行位', async () => {
    const original = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    try {
      state.portOpen = true
      const manager = await loadManager()
      await manager.start()
      expect(state.chmodCalls).toHaveLength(0)
    } finally {
      Object.defineProperty(process, 'platform', { value: original, configurable: true })
    }
  })

  it('启动前把会话文件写成绝对路径并清理废弃选项', async () => {
    state.portOpen = true
    state.removeResult = true
    const manager = await loadManager()
    await manager.start()
    const configManager = state.configManagers[0]
    const written = Object.fromEntries(configManager.setConfigValue.mock.calls)
    expect(written['input-file']).toBe('E:/userData/aria2/aria2.session')
    expect(written['save-session']).toBe('E:/userData/aria2/aria2.session')
    expect(configManager.removeConfigKey).toHaveBeenCalledWith('max-piece-length')
    expect(configManager.removeConfigKey).toHaveBeenCalledWith('metalink-servers')
  })

  it('引擎启动成功后回调一次，回调抛错不影响启动结果', async () => {
    state.portOpen = true
    const manager = await loadManager()
    const listener = vi.fn(() => { throw new Error('listener boom') })
    manager.setEngineStartedListener(listener)
    expect(await manager.start()).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('进程退出与自动重启', () => {
  it('正常退出（code=0）不安排重启', async () => {
    state.portOpen = true
    const manager = await loadManager()
    await manager.start()
    const crash = vi.fn()
    manager.setEngineCrashListener(crash)
    state.children[0].exitWith(0)
    expect(crash).not.toHaveBeenCalled()
    expect(manager.isRunning()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('异常退出后按退避间隔安排重启并通知崩溃回调', async () => {
    state.portOpen = true
    const manager = await loadManager()
    await manager.start()
    const crash = vi.fn()
    manager.setEngineCrashListener(crash)
    state.children[0].exitWith(1)
    expect(crash).toHaveBeenCalledWith(1)
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(3000)
    await flush()
    expect(state.spawnCalls).toHaveLength(2)
  })

  it('连续三次崩溃后放弃自动重启并上报次数', async () => {
    state.portOpen = true
    const manager = await loadManager()
    const gaveUp = vi.fn()
    manager.setEngineGaveUpListener(gaveUp)
    await manager.start()
    for (let i = 0; i < 3; i++) {
      state.children[i].exitWith(1)
      await vi.advanceTimersByTimeAsync(30000)
      await flush()
    }
    state.children[3].exitWith(1)
    expect(gaveUp).toHaveBeenCalledWith(3)
    expect(state.spawnCalls).toHaveLength(4)
  })

  it('存活超过稳定阈值后重试计数清零', async () => {
    state.portOpen = true
    const manager = await loadManager()
    const crash = vi.fn()
    manager.setEngineCrashListener(crash)
    await manager.start()
    state.children[0].exitWith(1)
    expect(crash).toHaveBeenLastCalledWith(1)
    await vi.advanceTimersByTimeAsync(3000)
    await flush()
    expect(state.spawnCalls).toHaveLength(2)
    vi.setSystemTime(Date.now() + 61000)
    state.children[1].exitWith(1)
    expect(crash).toHaveBeenLastCalledWith(1)
  })

  it('旧代次进程的迟到 exit 不影响当前进程引用', async () => {
    state.portOpen = true
    const manager = await loadManager()
    await manager.start()
    const first = state.children[0]
    first.exitWith(0)
    await manager.start()
    expect(state.children).toHaveLength(2)
    first.exitWith(1)
    expect(manager.isRunning()).toBe(true)
    const warns = state.logs.warn.map(args => String(args[0]))
    expect(warns.some(text => text.includes('忽略旧进程'))).toBe(true)
  })

  it('stderr 只保留最近 30 行', async () => {
    state.portOpen = true
    const manager = await loadManager()
    await manager.start()
    const stderr = state.children[0].stderr
    for (let i = 0; i < 35; i++) stderr.emit('data', Buffer.from('line-' + i))
    const text = manager.getLastStderr()
    expect(text.split('\n')).toHaveLength(30)
    expect(text).toContain('line-34')
    expect(text).not.toContain('line-0\n')
  })

  it('stdout 过滤噪音后只记 debug', async () => {
    state.portOpen = true
    const manager = await loadManager()
    await manager.start()
    const stdout = state.children[0].stdout
    stdout.emit('data', Buffer.from('[INFO] Serialized session'))
    stdout.emit('data', Buffer.from('real output'))
    expect(state.logs.debug).toHaveLength(1)
    expect(String(state.logs.debug[0][1])).toBe('real output')
  })
})

describe('停止引擎', () => {
  it('没有进程时停止直接返回 true', async () => {
    const manager = await loadManager()
    expect(await manager.stop()).toBe(true)
  })

  it('优雅关闭钩子成功后进程自行退出', async () => {
    state.portOpen = true
    const manager = await loadManager()
    await manager.start()
    const child = state.children[0]
    manager.setGracefulShutdown(async () => { child.exitWith(0) })
    expect(await manager.stop()).toBe(true)
    expect(child.kill).not.toHaveBeenCalled()
    expect(manager.isRunning()).toBe(false)
  })

  it('优雅关闭超时后回退 SIGTERM', async () => {
    state.portOpen = true
    const manager = await loadManager()
    await manager.start()
    const child = state.children[0]
    manager.setGracefulShutdown(async () => {})
    const pending = manager.stop()
    await vi.advanceTimersByTimeAsync(8100)
    await flush()
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    child.exitWith(0, 'SIGTERM')
    await vi.advanceTimersByTimeAsync(100)
    expect(await pending).toBe(true)
  })

  it('SIGTERM 后进程仍不退时按 PID 强杀并报告失败', async () => {
    const original = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    try {
      state.portOpen = true
      const manager = await loadManager()
      await manager.start()
      const pending = manager.stop()
      await vi.advanceTimersByTimeAsync(8100)
      await flush()
      await vi.advanceTimersByTimeAsync(8100)
      await flush()
      expect(await pending).toBe(false)
      expect(state.spawnSyncCalls[0].args).toEqual(['/F', '/T', '/PID', String(state.children[0].pid)])
      expect(manager.isRunning()).toBe(true)
    } finally {
      Object.defineProperty(process, 'platform', { value: original, configurable: true })
    }
  })

  it('并发 stop 复用同一个 Promise，优雅钩子只执行一次', async () => {
    state.portOpen = true
    const manager = await loadManager()
    await manager.start()
    const hook = vi.fn(async () => { state.children[0].exitWith(0) })
    manager.setGracefulShutdown(hook)
    const first = manager.stop()
    const second = manager.stop()
    expect(first).toBe(second)
    expect(await first).toBe(true)
    expect(hook).toHaveBeenCalledTimes(1)
  })

  it('stop 会取消待执行的重启定时器', async () => {
    state.portOpen = true
    const manager = await loadManager()
    await manager.start()
    state.children[0].exitWith(1)
    expect(vi.getTimerCount()).toBe(1)
    await manager.stop()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('killIfRunning 与 getProcessInfo', () => {
  it('有存活进程时发 SIGTERM', async () => {
    state.portOpen = true
    const manager = await loadManager()
    await manager.start()
    manager.killIfRunning()
    expect(state.kills).toEqual(['SIGTERM'])
  })

  it('没有进程时不做任何事', async () => {
    const manager = await loadManager()
    manager.killIfRunning()
    expect(state.kills).toEqual([])
  })

  it('getProcessInfo 汇总运行状态与重试次数', async () => {
    state.portOpen = true
    const manager = await loadManager()
    await manager.start()
    const info = manager.getProcessInfo()
    expect(info.isRunning).toBe(true)
    expect(info.pid).toBe(state.children[0].pid)
    expect(info.retryCount).toBe(0)
    expect(info.isAria2Available).toBe(true)
    expect(info.resourceInfo).toEqual({ available: true })
  })
})

describe('updateConfig 与重启判定', () => {
  it('写入需要重启的字段并落盘', async () => {
    const manager = await loadManager()
    manager.updateConfig({ port: 7100, enableRpc: false, rpcListenAll: true, rpcSecure: true, rpcAllowOriginAll: false })
    const configManager = state.configManagers[0]
    expect(configManager.setMultipleConfigs).toHaveBeenCalledWith({
      'rpc-listen-port': 7100,
      'enable-rpc': 'false',
      'rpc-listen-all': 'true',
      'rpc-secure': 'true',
      'rpc-allow-origin-all': 'false'
    })
    expect(configManager.flushSave).toHaveBeenCalled()
  })

  it('密钥清空时注释掉配置行而不是写空值', async () => {
    const manager = await loadManager()
    manager.updateConfig({ secret: '   ' })
    expect(state.configManagers[0].commentConfigValue).toHaveBeenCalledWith('rpc-secret')
  })

  it('下载目录反斜杠统一成斜杠', async () => {
    const manager = await loadManager()
    manager.updateConfig({ downloadDir: 'E:\\Downloads\\aria2' })
    expect(state.configManagers[0].setMultipleConfigs).toHaveBeenCalledWith({ dir: 'E:/Downloads/aria2' })
  })

  it('运行中改端口会安排一次延迟重启', async () => {
    state.portOpen = true
    const manager = await loadManager()
    await manager.start()
    manager.updateConfig({ port: 7100 })
    expect(vi.getTimerCount()).toBe(1)
  })

  it('只改 autoStart 不触发重启', async () => {
    state.portOpen = true
    const manager = await loadManager()
    await manager.start()
    manager.updateConfig({ autoStart: false })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('1.5 秒内改两次配置只保留一个重启定时器', async () => {
    state.portOpen = true
    const manager = await loadManager()
    await manager.start()
    manager.updateConfig({ port: 7100 })
    manager.updateConfig({ port: 7200 })
    expect(vi.getTimerCount()).toBe(1)
  })

  it('flushConfig 直接落盘', async () => {
    const manager = await loadManager()
    manager.flushConfig()
    expect(state.configManagers[0].flushSave).toHaveBeenCalledTimes(1)
  })
})

describe('重启', () => {
  it('并发 restart 合并成一次', async () => {
    state.portOpen = true
    const manager = await loadManager()
    const first = manager.restart()
    const second = manager.restart()
    expect(first).toBe(second)
    await vi.advanceTimersByTimeAsync(12000)
    await flush()
    expect(await first).toBe(true)
    expect(state.spawnCalls).toHaveLength(1)
  })

  it('启动中不接受重启', async () => {
    const manager = await loadManager()
    const starting = manager.start()
    await flush()
    expect(await manager.restart()).toBe(false)
    await vi.advanceTimersByTimeAsync(16000)
    await starting
  })

  it('停止失败时重启失败', async () => {
    state.portOpen = true
    const manager = await loadManager()
    await manager.start()
    const pending = manager.restart()
    await vi.advanceTimersByTimeAsync(8100)
    await flush()
    await vi.advanceTimersByTimeAsync(8100)
    await flush()
    expect(await pending).toBe(false)
  })

  it('resetRestartCounter 清零重试计数', async () => {
    state.portOpen = true
    const manager = await loadManager()
    await manager.start()
    state.children[0].exitWith(1)
    expect(manager.getProcessInfo().retryCount).toBe(1)
    manager.resetRestartCounter()
    expect(manager.getProcessInfo().retryCount).toBe(0)
  })
})

describe('全局选项落盘的白名单', () => {
  it('拒绝执行外部命令的钩子选项与大写键名', async () => {
    const manager = await loadManager()
    manager.saveGlobalOptionsToConfig({
      'on-download-complete': 'rm -rf /',
      'on-bt-download-complete': 'calc.exe',
      'Bad-Key': 'x',
      'max-overall-download-limit': '1048576'
    })
    expect(state.configManagers[0].setMultipleConfigs).toHaveBeenCalledWith({ 'max-overall-download-limit': '1048576' })
  })

  it('拒绝 NaN 与非有限数字', async () => {
    const manager = await loadManager()
    manager.saveGlobalOptionsToConfig({ 'dht-listen-port': Number.NaN, 'bt-max-peers': 'Infinity' })
    expect(state.configManagers[0].setMultipleConfigs).not.toHaveBeenCalled()
  })

  it('空值表示清除该选项', async () => {
    const manager = await loadManager()
    manager.saveGlobalOptionsToConfig({ 'rpc-secret': '', 'max-mmap-limit': null })
    expect(state.configManagers[0].commentConfigValue).toHaveBeenCalledWith('rpc-secret')
    expect(state.configManagers[0].commentConfigValue).toHaveBeenCalledWith('max-mmap-limit')
  })

  it('配置基线读不到时抛错而不是覆盖用户配置', async () => {
    const manager = await loadManager()
    state.reloadResult = false
    expect(() => manager.saveGlobalOptionsToConfig({ 'max-mmap-limit': '1G' })).toThrow(/engine.configReadFailed/)
  })

  it('空对象直接返回', async () => {
    const manager = await loadManager()
    manager.saveGlobalOptionsToConfig({})
    expect(state.configManagers[0].reload).not.toHaveBeenCalled()
  })
})

describe('单例', () => {
  it('重复获取返回同一实例，带配置时同步内存值', async () => {
    vi.resetModules()
    const mod = await import('./Aria2ProcessManager')
    const first = mod.getAria2ProcessManager({ port: 6800 })
    const second = mod.getAria2ProcessManager({ port: 7100 })
    expect(second).toBe(first)
    expect(second.getConfig().port).toBe(7100)
  })
})
