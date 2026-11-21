import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'

const h = vi.hoisted(() => {
  const state = {
    exists: true,
    portMode: 'error' as 'connect' | 'error' | 'timeout',
    rpcMode: 'ok' as 'ok' | 'error' | 'rpcError',
    reloadResult: true,
    removeResult: false,
    relevant: {} as Record<string, string | undefined>,
    configValues: {} as Record<string, string | undefined>,
    statThrows: false,
    statMode: 0o644,
    chmodThrows: false,
    spawnThrows: '' as string,
    childPid: 1000 as number | undefined,
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

function makeChild(pid: number | undefined) {
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
    if (state.spawnThrows) throw new Error(state.spawnThrows)
    const child = makeChild(state.childPid === undefined ? undefined : state.childPid + state.children.length)
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
    setTimeout() { return this }
    once(event: string, cb: (arg?: unknown) => void) { this.handlers[event] = cb; return this }
    on(event: string, cb: (arg?: unknown) => void) { this.handlers[event] = cb; return this }
    connect() {
      if (state.portMode === 'connect') this.handlers.connect?.()
      else if (state.portMode === 'timeout') this.handlers.timeout?.()
      else this.handlers.error?.(new Error('ECONNREFUSED'))
    }
    destroy() { this.destroyed = true }
  }
}))

vi.mock('fs', () => ({
  existsSync: vi.fn(() => state.exists),
  chmodSync: vi.fn((file: string, mode: number) => {
    if (state.chmodThrows) throw new Error('EPERM: operation not permitted')
    state.chmodCalls.push({ file, mode })
  }),
  statSync: vi.fn(() => {
    if (state.statThrows) throw new Error('ENOENT')
    return { mode: state.statMode, mtimeMs: 1000 }
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

vi.mock('../utils/aria2Rpc', () => {
  class Aria2RpcError extends Error {}
  return {
    Aria2RpcError,
    callAria2Rpc: vi.fn(async () => {
      if (state.rpcMode === 'error') throw new Error('rpc down')
      if (state.rpcMode === 'rpcError') throw new Aria2RpcError('Unauthorized')
      return { version: '1.37.0' }
    })
  }
})

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
type Internals = {
  probePort: (port: number) => Promise<boolean>
  waitForPortRelease: (port: number, timeoutMs: number) => Promise<void>
  waitForProcessCleanup: () => Promise<void>
  waitForConfigFileSync: () => Promise<void>
  forceKillByPid: (pid: number | undefined) => void
  process: unknown
}

async function loadManager(config: Record<string, unknown> = {}): Promise<Manager> {
  vi.resetModules()
  const mod = await import('./Aria2ProcessManager')
  return new mod.Aria2ProcessManager(config)
}

function internalsOf(manager: Manager): Internals {
  return manager as unknown as Internals
}

function latestChild(): any {
  return state.children[state.children.length - 1]
}

async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

function logText(level: 'debug' | 'info' | 'warn' | 'error'): string {
  return state.logs[level].map((args: unknown[]) => args.map(String).join(' ')).join('\n')
}

function setPlatform(value: NodeJS.Platform): NodeJS.Platform {
  const original = process.platform
  Object.defineProperty(process, 'platform', { value, configurable: true })
  return original
}

function resetState(): void {
  state.exists = true
  state.portMode = 'error'
  state.rpcMode = 'ok'
  state.reloadResult = true
  state.removeResult = false
  state.relevant = {}
  state.configValues = {}
  state.statThrows = false
  state.statMode = 0o644
  state.chmodThrows = false
  state.spawnThrows = ''
  state.childPid = 1000
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

describe('启动的并发闸门', () => {
  it('启动尚未完成时再次调用因进程已存活而直接返回 true（不重复 spawn）', async () => {
    const manager = await loadManager()
    const first = manager.start()
    await flush()
    expect(await manager.start()).toBe(true)
    expect(state.spawnCalls).toHaveLength(1)
    expect(logText('info')).toContain('Aria2 进程已经在运行')
    await vi.advanceTimersByTimeAsync(16000)
    expect(await first).toBe(false)
  })

  it('停止进行中忽略启动请求（返回 false 而不是谎报成功）', async () => {
    state.portMode = 'connect'
    const manager = await loadManager()
    await manager.start()
    // 进程已退出但句柄未清，isProcessAlive() 为假，才能走到 isStopping 闸门
    latestChild().exitCode = 1
    let release!: () => void
    manager.setGracefulShutdown(() => new Promise<void>((resolve) => { release = resolve }))
    const stopping = manager.stop()
    await flush()
    expect(await manager.start()).toBe(false)
    expect(logText('warn')).toContain('Aria2 进程正在停止中，忽略本次启动请求')
    release()
    await flush()
    expect(await stopping).toBe(true)
  })
})

describe('启动失败的日志分类', () => {
  it('spawn 抛 EACCES 时给出权限不足提示', async () => {
    state.spawnThrows = 'EACCES: permission denied, spawn aria2c'
    const manager = await loadManager()
    expect(await manager.start()).toBe(false)
    expect(logText('error')).toContain('权限不足')
  })

  it('spawn 抛「异常退出」时提示检查配置文件', async () => {
    state.spawnThrows = 'Aria2 启动后异常退出 (code=1)'
    const manager = await loadManager()
    expect(await manager.start()).toBe(false)
    expect(logText('error')).toContain('启动后立即退出')
  })

  it('spawn 抛「启动超时」时提示端口占用或配置问题', async () => {
    state.spawnThrows = 'Aria2 启动超时'
    const manager = await loadManager()
    expect(await manager.start()).toBe(false)
    expect(logText('error')).toContain('启动超时，可能是端口被占用')
  })

  it('未归类的错误原样记录错误信息', async () => {
    state.spawnThrows = 'boom from spawn'
    const manager = await loadManager()
    expect(await manager.start()).toBe(false)
    expect(logText('error')).toContain('boom from spawn')
  })

  it('端口一直连不上且进程存活时记录「进程仍在运行」并失败', async () => {
    const manager = await loadManager()
    const pending = manager.start()
    await vi.advanceTimersByTimeAsync(16000)
    expect(await pending).toBe(false)
    expect(logText('error')).toContain('在 15000ms 内未就绪，进程仍在运行')
  })

  it('端口有服务但不是本引擎时提示更换 rpc-listen-port', async () => {
    state.portMode = 'connect'
    state.rpcMode = 'error'
    const manager = await loadManager()
    const pending = manager.start()
    await vi.advanceTimersByTimeAsync(16000)
    expect(await pending).toBe(false)
    expect(logText('error')).toContain('上有服务在监听但不是本引擎')
  })

  it('超时前进程已被杀掉时按 startTimeout 记录', async () => {
    const manager = await loadManager()
    const pending = manager.start()
    await flush()
    latestChild().killed = true
    await vi.advanceTimersByTimeAsync(16000)
    expect(await pending).toBe(false)
    expect(logText('error')).toContain('engine.startTimeout')
  })

  it('RPC 不就绪但进程仍活着时强制终止并清掉引用', async () => {
    state.portMode = 'connect'
    state.configValues = { 'enable-rpc': 'false' }
    const manager = await loadManager()
    expect(await manager.start()).toBe(false)
    expect(state.kills).toContain('SIGKILL')
    expect(manager.isRunning()).toBe(false)
  })

  it('RPC 探测抛出 Aria2RpcError 时记录端口级告警', async () => {
    state.portMode = 'connect'
    state.rpcMode = 'rpcError'
    const manager = await loadManager()
    const pending = manager.start()
    await vi.advanceTimersByTimeAsync(16000)
    expect(await pending).toBe(false)
    expect(logText('warn')).toContain('RPC 探测失败（端口 6800）')
    expect(logText('warn')).toContain('Unauthorized')
  })
})

describe('执行位修复的边界', () => {
  it('已有执行位时不改写权限', async () => {
    const original = setPlatform('linux')
    try {
      state.portMode = 'connect'
      state.statMode = 0o755
      const manager = await loadManager()
      expect(await manager.start()).toBe(true)
      expect(state.chmodCalls).toHaveLength(0)
    } finally {
      setPlatform(original)
    }
  })

  it('补执行位失败只留说明且不阻断启动', async () => {
    const original = setPlatform('linux')
    try {
      state.portMode = 'connect'
      state.chmodThrows = true
      const manager = await loadManager()
      expect(await manager.start()).toBe(true)
      expect(logText('error')).toContain('自动修复也失败')
    } finally {
      setPlatform(original)
    }
  })
})

describe('端口探测与等待释放', () => {
  it('探测超时按端口未就绪处理', async () => {
    state.portMode = 'timeout'
    const manager = await loadManager()
    expect(await internalsOf(manager).probePort(6800)).toBe(false)
  })

  it('端口始终不释放时记录超时告警并继续', async () => {
    state.portMode = 'connect'
    const manager = await loadManager()
    const pending = internalsOf(manager).waitForPortRelease(6800, 300)
    await vi.advanceTimersByTimeAsync(400)
    await pending
    expect(logText('warn')).toContain('等待端口 6800 释放超时')
  })
})

describe('进程事件处理器的边界', () => {
  it('spawn 失败派发的 error 事件清掉没有 pid 的进程引用', async () => {
    state.childPid = undefined
    const manager = await loadManager()
    const pending = manager.start()
    await flush()
    const child = latestChild()
    child.pid = undefined
    child.emit('error', new Error('spawn ENOENT'))
    expect(logText('error')).toContain('Aria2 进程错误')
    expect(manager.isRunning()).toBe(false)
    await vi.advanceTimersByTimeAsync(500)
    expect(await pending).toBe(false)
  })

  it('崩溃回调抛错只记日志，不影响自动重启安排', async () => {
    state.portMode = 'connect'
    const manager = await loadManager()
    await manager.start()
    manager.setEngineCrashListener(() => { throw new Error('cb boom') })
    latestChild().exitWith(1)
    expect(logText('error')).toContain('引擎崩溃回调执行失败')
    expect(vi.getTimerCount()).toBe(1)
  })

  it('放弃重启回调抛错只记日志', async () => {
    state.portMode = 'connect'
    const manager = await loadManager()
    manager.setEngineGaveUpListener(() => { throw new Error('gave up boom') })
    await manager.start()
    for (let i = 0; i < 3; i++) {
      latestChild().exitWith(1)
      await vi.advanceTimersByTimeAsync(30000)
      await flush()
    }
    latestChild().exitWith(1)
    expect(logText('error')).toContain('引擎放弃重启回调执行失败')
  })
})

describe('停止流程的竞态与兜底', () => {
  it('stop 会取消待执行的配置自动重启定时器', async () => {
    state.portMode = 'connect'
    const manager = await loadManager()
    await manager.start()
    manager.updateConfig({ port: 7100 })
    expect(vi.getTimerCount()).toBe(1)
    const stopping = manager.stop()
    await flush()
    latestChild().exitWith(0)
    await vi.advanceTimersByTimeAsync(200)
    expect(await stopping).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('优雅关闭期间进程引用已被清空时视为停止成功', async () => {
    state.portMode = 'connect'
    const manager = await loadManager()
    await manager.start()
    manager.setGracefulShutdown(async () => {
      internalsOf(manager).process = null
      throw new Error('rpc down')
    })
    expect(await manager.stop()).toBe(true)
    expect(logText('info')).toContain('Aria2 进程已在优雅关闭等待期间退出')
  })

  it('优雅关闭抛错但进程已在退出中时直接算停止成功', async () => {
    state.portMode = 'connect'
    const manager = await loadManager()
    await manager.start()
    manager.setGracefulShutdown(async () => {
      latestChild().exitCode = 1
      throw new Error('rpc down')
    })
    expect(await manager.stop()).toBe(true)
  })

  it('发信号失败时记录停止失败并保留进程引用', async () => {
    state.portMode = 'connect'
    const manager = await loadManager()
    await manager.start()
    latestChild().kill.mockImplementation(() => { throw new Error('kill EPERM') })
    expect(await manager.stop()).toBe(false)
    expect(logText('error')).toContain('停止 Aria2 进程失败')
    expect(manager.isRunning()).toBe(true)
  })

  it('优雅关闭进行中 killIfRunning 不发信号', async () => {
    state.portMode = 'connect'
    const manager = await loadManager()
    await manager.start()
    let release!: () => void
    manager.setGracefulShutdown(() => new Promise<void>((resolve) => { release = resolve }))
    const stopping = manager.stop()
    await flush()
    manager.killIfRunning()
    expect(state.kills).toEqual([])
    release()
    await flush()
    latestChild().exitWith(0)
    await vi.advanceTimersByTimeAsync(200)
    await stopping
  })

  it('按 PID 强杀在 POSIX 上走 process.kill，失败只记日志', async () => {
    const original = setPlatform('linux')
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
    try {
      const manager = await loadManager()
      const internals = internalsOf(manager)
      internals.forceKillByPid(undefined)
      expect(killSpy).not.toHaveBeenCalled()
      internals.forceKillByPid(4321)
      expect(killSpy).toHaveBeenCalledWith(4321, 'SIGKILL')
      expect(logText('info')).toContain('已按 PID 强制终止')
      killSpy.mockImplementation(() => { throw new Error('ESRCH') })
      internals.forceKillByPid(4321)
      expect(logText('error')).toContain('按 PID 强制终止失败')
    } finally {
      setPlatform(original)
    }
  })
})

describe('配置写入与自动重启', () => {
  it('设置密钥时把 rpc-secret 写进配置', async () => {
    const manager = await loadManager()
    manager.updateConfig({ secret: 'abc' })
    expect(state.configManagers[0].setMultipleConfigs).toHaveBeenCalledWith({ 'rpc-secret': 'abc' })
  })

  it('运行中改端口会在缓冲后自动重启成功', async () => {
    state.portMode = 'connect'
    const manager = await loadManager()
    await manager.start()
    manager.setGracefulShutdown(async () => { latestChild().exitWith(0) })
    manager.updateConfig({ port: 7100 })
    await vi.advanceTimersByTimeAsync(1500)
    await flush()
    await vi.advanceTimersByTimeAsync(1000)
    await flush()
    await vi.advanceTimersByTimeAsync(20000)
    await flush()
    expect(state.spawnCalls.length).toBeGreaterThanOrEqual(2)
    expect(logText('info')).toContain('Aria2 进程重启成功')
  })

  it('配置文件一直读不到时同步校验抛错并记录原因', async () => {
    state.reloadResult = false
    const manager = await loadManager()
    const pending = internalsOf(manager).waitForConfigFileSync()
    const assertion = expect(pending).rejects.toThrow(/engine.configSyncVerifyFailed/)
    await vi.advanceTimersByTimeAsync(3000)
    await assertion
    expect(logText('error')).toContain('配置文件同步验证失败')
  })

  it('自动重启失败只记日志不抛出', async () => {
    state.portMode = 'connect'
    const manager = await loadManager()
    await manager.start()
    state.reloadResult = false
    manager.updateConfig({ port: 7100 })
    await vi.advanceTimersByTimeAsync(1500)
    await flush()
    await vi.advanceTimersByTimeAsync(3000)
    await flush()
    expect(logText('error')).toContain('自动重启 Aria2 失败')
  })

  it('重启时启动失败会抛 startProcessFailed 并记录', async () => {
    state.portMode = 'connect'
    const manager = await loadManager()
    await manager.start()
    manager.setGracefulShutdown(async () => { latestChild().exitWith(0) })
    state.exists = false
    const restarting = manager.restart()
    await vi.advanceTimersByTimeAsync(20000)
    await flush()
    expect(await restarting).toBe(false)
    expect(logText('error')).toContain('重启 Aria2 进程失败')
  })

  it('清理等待会轮询到上限再缓冲', async () => {
    state.portMode = 'connect'
    const manager = await loadManager()
    await manager.start()
    const pending = internalsOf(manager).waitForProcessCleanup()
    await vi.advanceTimersByTimeAsync(20 * 500 + 500)
    await pending
    expect(manager.isRunning()).toBe(true)
  })

  it('isAria2Available 透传资源管理器结论', async () => {
    const manager = await loadManager()
    expect(manager.isAria2Available()).toBe(true)
  })
})
