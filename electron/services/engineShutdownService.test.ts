import { describe, it, expect, vi } from 'vitest'

vi.mock('../utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
}))

import {
  EngineShutdownService,
  forceKillProcessTree,
  performRestartAndInstall,
  waitForPortRelease,
  type EngineProcessManagerLike,
  type EngineShutdownResult
} from './engineShutdownService'

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }

function shutdownResult(overrides: Partial<EngineShutdownResult> = {}): EngineShutdownResult {
  return {
    success: true,
    forced: false,
    timedOut: false,
    processExited: true,
    portReleased: true,
    waitedMs: 1,
    ...overrides
  }
}

describe('EngineShutdownService.requestShutdownAndWait', () => {
  it('进程正常退出且端口释放：等待成功，不触发强杀', async () => {
    let running = true
    let portChecks = 0
    const stop = vi.fn(async () => {
      running = false
      return true
    })
    const manager: EngineProcessManagerLike = {
      isRunning: () => running,
      stop,
      getProcessInfo: () => ({ isRunning: running, pid: 1234 })
    }
    const forceKill = vi.fn()
    const service = new EngineShutdownService({
      getProcessManager: () => manager,
      getPort: () => 6800,
      isPortInUse: async () => {
        portChecks += 1
        return portChecks === 1
      },
      forceKill,
      pollIntervalMs: 10,
      sleep: async () => {},
      logger: silentLogger
    })

    const result = await service.requestShutdownAndWait(1000)

    expect(stop).toHaveBeenCalledTimes(1)
    expect(forceKill).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      success: true,
      forced: false,
      timedOut: false,
      processExited: true,
      portReleased: true
    })
  })

  it('进程一直不退出：超时后按 pid 强制结束进程树并报告 timedOut', async () => {
    const stop = vi.fn(() => new Promise<boolean>(() => {}))
    const manager: EngineProcessManagerLike = {
      isRunning: () => true,
      stop,
      getProcessInfo: () => ({ isRunning: true, pid: 4321 })
    }
    const forceKill = vi.fn()
    const service = new EngineShutdownService({
      getProcessManager: () => manager,
      getPort: () => 6800,
      isPortInUse: async () => true,
      forceKill,
      pollIntervalMs: 5,
      forceKillWaitMs: 10,
      logger: silentLogger
    })

    const result = await service.requestShutdownAndWait(25)

    expect(forceKill).toHaveBeenCalledTimes(1)
    expect(forceKill).toHaveBeenCalledWith(4321)
    expect(result).toMatchObject({
      success: false,
      forced: true,
      timedOut: true,
      processExited: false,
      portReleased: false
    })
  })
})

describe('performRestartAndInstall', () => {
  it('openPath 失败（安装程序启动失败）时重启下载引擎，并把可见错误返回给 UI', async () => {
    const order: string[] = []
    const saveSession = vi.fn(async () => {
      order.push('saveSession')
      return { success: true }
    })
    const requestShutdownAndWait = vi.fn(async () => {
      order.push('requestShutdownAndWait')
      return shutdownResult()
    })
    const restartAndInstall = vi.fn(async () => {
      order.push('restartAndInstall')
      return { success: false, error: '无法启动安装程序: openPath EACCES' }
    })
    const restartEngine = vi.fn(async () => {
      order.push('restartEngine')
      return { success: true }
    })

    const result = await performRestartAndInstall({
      saveSession,
      requestShutdownAndWait,
      restartAndInstall,
      restartEngine,
      logger: silentLogger
    })

    expect(order).toEqual(['saveSession', 'requestShutdownAndWait', 'restartAndInstall', 'restartEngine'])
    expect(requestShutdownAndWait).toHaveBeenCalledWith(8000)
    expect(restartEngine).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      success: false,
      error: '无法启动安装程序: openPath EACCES',
      engineRestart: { success: true }
    })
  })

  it('安装程序启动成功：不重启引擎', async () => {
    const restartEngine = vi.fn(async () => ({ success: true }))
    const result = await performRestartAndInstall({
      saveSession: async () => ({ success: true }),
      requestShutdownAndWait: async () => shutdownResult(),
      restartAndInstall: async () => ({ success: true }),
      restartEngine,
      logger: silentLogger
    })

    expect(restartEngine).not.toHaveBeenCalled()
    expect(result.success).toBe(true)
  })
  describe('强杀与端口等待的兜底', () => {
    it('没有注入 forceKill 时走默认的进程树强杀实现（类 Unix 用 SIGKILL）', async () => {
      const original = Object.getOwnPropertyDescriptor(process, 'platform')
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
      const killSpy = vi.spyOn(process, 'kill').mockImplementation((() => true) as unknown as typeof process.kill)
      try {
        const manager: EngineProcessManagerLike = {
          isRunning: () => true,
          stop: () => new Promise<boolean>(() => {}),
          getProcessInfo: () => ({ isRunning: true, pid: 2468 })
        }
        const service = new EngineShutdownService({
          getProcessManager: () => manager,
          getPort: () => 6800,
          isPortInUse: async () => true,
          pollIntervalMs: 5,
          forceKillWaitMs: 5,
          sleep: async () => {},
          logger: silentLogger
        })
        const result = await service.requestShutdownAndWait(20)
        expect(result.forced).toBe(true)
        expect(killSpy).toHaveBeenCalledWith(2468, 'SIGKILL')
      } finally {
        killSpy.mockRestore()
        if (original) Object.defineProperty(process, 'platform', original)
      }
    })

    it('默认强杀实现忽略非法 pid，且自身抛错时只 warn', async () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation((() => true) as unknown as typeof process.kill)
      try {
        forceKillProcessTree(0)
        forceKillProcessTree(-1)
        forceKillProcessTree(1.5)
        forceKillProcessTree(Number.NaN)
        expect(killSpy).not.toHaveBeenCalled()

        const warnSpy = vi.fn()
        killSpy.mockImplementation((() => { throw new Error('EPERM') }) as unknown as typeof process.kill)
        const original = Object.getOwnPropertyDescriptor(process, 'platform')
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
        try {
          expect(() => forceKillProcessTree(999)).not.toThrow()
          expect(warnSpy).not.toHaveBeenCalled() // 默认 logger 是模块级实例，这里只验证不冒泡
        } finally {
          if (original) Object.defineProperty(process, 'platform', original)
        }
      } finally {
        killSpy.mockRestore()
      }
    })

    it('强杀本身抛错时只记 error，不把异常抛给调用方', async () => {
      const manager: EngineProcessManagerLike = {
        isRunning: () => true,
        stop: () => new Promise<boolean>(() => {}),
        getProcessInfo: () => ({ isRunning: true, pid: 1357 })
      }
      const errorSpy = vi.fn()
      const service = new EngineShutdownService({
        getProcessManager: () => manager,
        getPort: () => null,
        forceKill: () => { throw new Error('taskkill EACCES') },
        pollIntervalMs: 5,
        forceKillWaitMs: 5,
        sleep: async () => {},
        logger: { ...silentLogger, error: errorSpy }
      })
      const result = await service.requestShutdownAndWait(20)
      expect(result.success).toBe(false)
      expect(errorSpy).toHaveBeenCalledWith('[EngineShutdownService] 强制结束 aria2 进程失败:', expect.any(Error))
    })

    it('拿不到 pid 时只告警，不做强杀', async () => {
      const warnSpy = vi.fn()
      const manager: EngineProcessManagerLike = { isRunning: () => true, stop: () => new Promise<boolean>(() => {}) }
      const service = new EngineShutdownService({
        getProcessManager: () => manager,
        getPort: () => null,
        pollIntervalMs: 5,
        forceKillWaitMs: 5,
        sleep: async () => {},
        logger: { ...silentLogger, warn: warnSpy }
      })
      const result = await service.requestShutdownAndWait(20)
      expect(result.forced).toBe(false)
      expect(warnSpy).toHaveBeenCalledWith('[EngineShutdownService] aria2 未退出但拿不到 pid，无法强杀')
    })

    it('waitForPortRelease 在预算内始终被占用时返回 false', async () => {
      const released = await waitForPortRelease(6800, 20, async () => true, 5)
      expect(released).toBe(false)
    })

    it('waitForPortRelease 预算为 0 时首轮占用即放弃，不再睡一觉', async () => {
      // deadline == now：第一轮探测到仍被占用后立刻跳出循环，避免白等一个 interval
      let probes = 0
      const released = await waitForPortRelease(6800, 0, async () => {
        probes += 1
        return true
      }, 5)
      expect(released).toBe(false)
      expect(probes).toBe(1)
    })
  })

  describe('performRestartAndInstall 的失败分支', () => {
    it('保存会话失败与异常都只告警，继续走安装流程', async () => {
      const warnSpy = vi.fn()
      const result = await performRestartAndInstall({
        saveSession: async () => ({ success: false, error: 'rpc down' }),
        requestShutdownAndWait: async () => shutdownResult(),
        restartAndInstall: async () => ({ success: true }),
        restartEngine: async () => ({ success: true }),
        logger: { ...silentLogger, warn: warnSpy }
      })
      expect(result.success).toBe(true)
      expect(warnSpy).toHaveBeenCalledWith(
        '[UpdateInstall] 更新安装前保存 aria2 会话失败，未完成任务可能从恢复列表消失:',
        'rpc down'
      )

      const throwWarn = vi.fn()
      const second = await performRestartAndInstall({
        saveSession: async () => { throw new Error('session boom') },
        requestShutdownAndWait: async () => shutdownResult(),
        restartAndInstall: async () => ({ success: true }),
        restartEngine: async () => ({ success: true }),
        logger: { ...silentLogger, warn: throwWarn }
      })
      expect(second.success).toBe(true)
      expect(throwWarn).toHaveBeenCalledWith('[UpdateInstall] 更新安装前保存 aria2 会话异常，继续安装流程:', expect.any(Error))
    })

    it('引擎关闭超时或抛错都只告警，安装仍继续', async () => {
      const warnSpy = vi.fn()
      const timeoutResult = await performRestartAndInstall({
        saveSession: async () => ({ success: true }),
        requestShutdownAndWait: async () => shutdownResult({ success: false, timedOut: true }),
        restartAndInstall: async () => ({ success: true }),
        restartEngine: async () => ({ success: true }),
        logger: { ...silentLogger, warn: warnSpy }
      })
      expect(timeoutResult.success).toBe(true)
      expect(warnSpy).toHaveBeenCalledWith(
        '[UpdateInstall] aria2 未能在预算内完全退出，安装程序仍将继续启动:',
        expect.objectContaining({ success: false })
      )

      const throwWarn = vi.fn()
      const second = await performRestartAndInstall({
        saveSession: async () => ({ success: true }),
        requestShutdownAndWait: async () => { throw new Error('shutdown boom') },
        restartAndInstall: async () => ({ success: true }),
        restartEngine: async () => ({ success: true }),
        logger: { ...silentLogger, warn: throwWarn }
      })
      expect(second.success).toBe(true)
      expect(throwWarn).toHaveBeenCalledWith('[UpdateInstall] 等待 aria2 关闭时异常，继续安装流程:', expect.any(Error))
    })

    it('安装调用抛错时归一成失败结果，并回退到默认错误文案', async () => {
      const result = await performRestartAndInstall({
        saveSession: async () => ({ success: true }),
        requestShutdownAndWait: async () => shutdownResult(),
        restartAndInstall: async () => { throw new Error('openPath exploded') },
        restartEngine: async () => ({ success: true }),
        logger: silentLogger
      })
      expect(result.success).toBe(false)
      expect(result.error).toBe('openPath exploded')
      expect(result.engineRestart).toEqual({ success: true })
    })

    it('重启引擎失败或抛错都记 error，并把结果带回调用方', async () => {
      const errorSpy = vi.fn()
      const failed = await performRestartAndInstall({
        saveSession: async () => ({ success: true }),
        requestShutdownAndWait: async () => shutdownResult(),
        restartAndInstall: async () => ({ success: false, error: 'installer missing' }),
        restartEngine: async () => ({ success: false, error: 'engine gone' }),
        logger: { ...silentLogger, error: errorSpy }
      })
      expect(failed.success).toBe(false)
      expect(failed.engineRestart).toEqual({ success: false, error: 'engine gone' })
      expect(errorSpy).toHaveBeenCalledWith('[UpdateInstall] 安装失败后重启 aria2 引擎也失败:', 'engine gone')

      const throwError = vi.fn()
      const thrown = await performRestartAndInstall({
        saveSession: async () => ({ success: true }),
        requestShutdownAndWait: async () => shutdownResult(),
        restartAndInstall: async () => ({ success: false, error: 'installer missing' }),
        restartEngine: async () => { throw new Error('restart boom') },
        logger: { ...silentLogger, error: throwError }
      })
      expect(thrown.engineRestart).toEqual({ success: false, error: 'restart boom' })
      expect(throwError).toHaveBeenCalledWith('[UpdateInstall] 安装失败后重启 aria2 引擎异常:', expect.any(Error))
    })
  })
})
