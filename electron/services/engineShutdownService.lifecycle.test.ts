import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
}))

type SocketListener = (...args: unknown[]) => void

const { h } = vi.hoisted(() => ({
  h: {
    sockets: [] as {
      listeners: Map<string, SocketListener>
      timeoutMs: number
      destroyed: boolean
      emit: (event: string) => void
    }[],
    spawnSyncCalls: [] as unknown[][],
    spawnSyncThrows: null as Error | null,
    killCalls: [] as number[],
    killThrows: null as Error | null
  }
}))

vi.mock('net', () => ({
  createConnection: (options: { host: string; port: number }) => {
    const listeners = new Map<string, SocketListener>()
    const socket = {
      options,
      listeners,
      timeoutMs: 0,
      destroyed: false,
      once: (event: string, cb: SocketListener) => {
        listeners.set(event, cb)
        return socket
      },
      setTimeout: (ms: number) => {
        socket.timeoutMs = ms
        return socket
      },
      destroy: () => {
        socket.destroyed = true
      },
      emit: (event: string) => {
        listeners.get(event)?.()
      }
    }
    h.sockets.push(socket)
    return socket
  }
}))

vi.mock('child_process', () => ({
  spawnSync: (...args: unknown[]) => {
    h.spawnSyncCalls.push(args)
    if (h.spawnSyncThrows) throw h.spawnSyncThrows
    return { status: 0 }
  }
}))

import {
  EngineShutdownService,
  forceKillProcessTree,
  probeLocalPortInUse,
  waitForPortRelease,
  type EngineProcessManagerLike
} from './engineShutdownService'

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }

beforeEach(() => {
  h.sockets = []
  h.spawnSyncCalls = []
  h.spawnSyncThrows = null
  h.killCalls = []
  h.killThrows = null
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('probeLocalPortInUse', () => {
  it('连接成功说明端口被占用', async () => {
    const promise = probeLocalPortInUse(6800)
    h.sockets[0].emit('connect')

    await expect(promise).resolves.toBe(true)
    expect(h.sockets[0].destroyed).toBe(true)
    expect(h.sockets[0].timeoutMs).toBe(500)
  })

  it('连接超时按占用处理（宁可多等也不误判释放）', async () => {
    const promise = probeLocalPortInUse(6800, 200)
    h.sockets[0].emit('timeout')

    await expect(promise).resolves.toBe(true)
  })

  it('连接被拒绝说明端口已释放', async () => {
    const promise = probeLocalPortInUse(6800)
    h.sockets[0].emit('error')

    await expect(promise).resolves.toBe(false)
  })

  it('多个事件同时到达时只结算一次', async () => {
    const promise = probeLocalPortInUse(6800)
    h.sockets[0].emit('error')
    h.sockets[0].emit('connect')
    h.sockets[0].emit('timeout')

    await expect(promise).resolves.toBe(false)
  })
})

describe('waitForPortRelease', () => {
  it('端口一开始就空闲时立即返回 true，不做多余探测', async () => {
    const isPortInUse = vi.fn(async () => false)

    await expect(waitForPortRelease(6800, 1000, isPortInUse)).resolves.toBe(true)
    expect(isPortInUse).toHaveBeenCalledTimes(1)
  })

  it('端口延迟释放时在预算内返回 true', async () => {
    vi.useFakeTimers()
    let checks = 0
    const isPortInUse = vi.fn(async () => {
      checks += 1
      return checks <= 2
    })

    const promise = waitForPortRelease(6800, 1000, isPortInUse, 50)
    await vi.advanceTimersByTimeAsync(200)

    await expect(promise).resolves.toBe(true)
    expect(isPortInUse).toHaveBeenCalledTimes(3)
  })

  it('预算耗尽仍被占用时返回 false', async () => {
    vi.useFakeTimers()
    const isPortInUse = vi.fn(async () => true)

    const promise = waitForPortRelease(6800, 120, isPortInUse, 50)
    await vi.advanceTimersByTimeAsync(300)

    await expect(promise).resolves.toBe(false)
  })
})

describe('forceKillProcessTree', () => {
  it('非法的 pid 直接忽略，不执行任何系统命令', () => {
    forceKillProcessTree(0)
    forceKillProcessTree(-1)
    forceKillProcessTree(1.5)
    forceKillProcessTree(Number.NaN)

    expect(h.spawnSyncCalls).toHaveLength(0)
  })

  it('Windows 上用 taskkill 结束整棵进程树', () => {
    const original = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    try {
      forceKillProcessTree(4321)
    } finally {
      Object.defineProperty(process, 'platform', { value: original, configurable: true })
    }

    expect(h.spawnSyncCalls).toHaveLength(1)
    expect(h.spawnSyncCalls[0]).toEqual([
      'taskkill',
      ['/F', '/T', '/PID', '4321'],
      { windowsHide: true, stdio: 'ignore' }
    ])
  })

  it('类 Unix 平台发 SIGKILL', () => {
    const original = process.platform
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid: number) => {
      h.killCalls.push(pid)
      return true
    })
    try {
      forceKillProcessTree(4321)
    } finally {
      Object.defineProperty(process, 'platform', { value: original, configurable: true })
    }

    expect(killSpy).toHaveBeenCalledWith(4321, 'SIGKILL')
  })

  it('强杀本身失败时只记录日志，不向调用方抛出', () => {
    const original = process.platform
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('EPERM')
    })
    try {
      expect(() => forceKillProcessTree(4321)).not.toThrow()
    } finally {
      Object.defineProperty(process, 'platform', { value: original, configurable: true })
    }
  })
})

function makeManager(running: () => boolean, pid: number | null = 1234): EngineProcessManagerLike {
  return {
    isRunning: running,
    stop: vi.fn(async () => true),
    getProcessInfo: () => ({ isRunning: running(), pid })
  }
}

describe('EngineShutdownService 超时与强杀', () => {
  it('等满预算仍未退出时强制结束进程树，并在宽限期内确认退出', async () => {
    let running = true
    const manager = makeManager(() => running)
    const forceKill = vi.fn(() => {
      running = false
    })
    const service = new EngineShutdownService({
      getProcessManager: () => manager,
      getPort: () => null,
      forceKill,
      pollIntervalMs: 10,
      forceKillWaitMs: 200,
      sleep: async () => {},
      logger: silentLogger
    })

    const result = await service.requestShutdownAndWait(60)

    expect(forceKill).toHaveBeenCalledWith(1234)
    expect(result).toMatchObject({ success: true, forced: true, timedOut: false })
  })

  it('拿不到 pid 时只告警，不会误杀别的进程', async () => {
    const manager = makeManager(() => true, null)
    const forceKill = vi.fn()
    const service = new EngineShutdownService({
      getProcessManager: () => manager,
      getPort: () => null,
      forceKill,
      pollIntervalMs: 10,
      forceKillWaitMs: 10,
      sleep: async () => {},
      logger: silentLogger
    })

    const result = await service.requestShutdownAndWait(40)

    expect(forceKill).not.toHaveBeenCalled()
    expect(result).toMatchObject({ success: false, forced: false, timedOut: true, processExited: false })
  })

  it('端口探测抛错按占用处理，最终判定为未释放', async () => {
    const service = new EngineShutdownService({
      getProcessManager: () => null,
      getPort: () => 6800,
      isPortInUse: async () => {
        throw new Error('probe failed')
      },
      pollIntervalMs: 10,
      forceKillWaitMs: 10,
      sleep: async () => {},
      logger: silentLogger
    })

    const result = await service.requestShutdownAndWait(40)

    expect(result).toMatchObject({ success: false, portReleased: false, processExited: true })
  })

  it('getPort 返回 null 时跳过端口检查，只看进程是否退出', async () => {
    const manager = makeManager(() => false)
    const isPortInUse = vi.fn(async () => true)
    const service = new EngineShutdownService({
      getProcessManager: () => manager,
      getPort: () => null,
      isPortInUse,
      pollIntervalMs: 10,
      sleep: async () => {},
      logger: silentLogger
    })

    const result = await service.requestShutdownAndWait(200)

    expect(isPortInUse).not.toHaveBeenCalled()
    expect(result).toMatchObject({ success: true, portReleased: true })
  })

  it('manager.stop() 抛错不会中断等待流程', async () => {
    let running = true
    const manager: EngineProcessManagerLike = {
      isRunning: () => running,
      stop: vi.fn(async () => {
        throw new Error('stop exploded')
      }),
      getProcessInfo: () => ({ isRunning: running, pid: 99 })
    }
    const service = new EngineShutdownService({
      getProcessManager: () => manager,
      getPort: () => null,
      pollIntervalMs: 10,
      sleep: async () => {
        running = false
      },
      logger: silentLogger
    })

    const result = await service.requestShutdownAndWait(500)

    expect(manager.stop).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ success: true, forced: false })
  })

  it('引擎本来就没在跑时既不 stop 也不强杀', async () => {
    const manager = makeManager(() => false)
    const forceKill = vi.fn()
    const service = new EngineShutdownService({
      getProcessManager: () => manager,
      getPort: () => null,
      forceKill,
      pollIntervalMs: 10,
      sleep: async () => {},
      logger: silentLogger
    })

    const result = await service.requestShutdownAndWait(200)

    expect(manager.stop).not.toHaveBeenCalled()
    expect(forceKill).not.toHaveBeenCalled()
    expect(result).toMatchObject({ success: true, waitedMs: expect.any(Number) })
  })
})
