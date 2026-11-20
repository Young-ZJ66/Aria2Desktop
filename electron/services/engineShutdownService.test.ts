import { describe, it, expect, vi } from 'vitest'

vi.mock('../utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
}))

import {
  EngineShutdownService,
  performRestartAndInstall,
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
})
