import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { h } = vi.hoisted(() => ({
  h: {
    rpc: vi.fn(),
    settings: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
  }
}))

vi.mock('../utils/logger', () => ({
  createLogger: () => ({ info: h.info, warn: h.warn, error: vi.fn(), debug: vi.fn() })
}))
vi.mock('../utils/aria2Rpc', () => ({ callAria2Rpc: h.rpc }))
vi.mock('../utils/settingsAccessor', () => ({ getSettingsFresh: h.settings }))
vi.mock('../utils/activeRpcConfig', () => ({
  activeRpcOptions: () => ({ host: '127.0.0.1', port: 6801, protocol: 'http', path: '/jsonrpc', secret: 'test-secret' })
}))

import { DownloadScheduler } from './downloadScheduler'

const RULE = {
  name: '夜间限速时段',
  days: [] as number[],
  startTime: '01:00',
  endTime: '02:00',
  downloadLimit: 0,
  uploadLimit: 0,
  enabled: true
}

function settingsWith(rules: unknown[], enabled = true) {
  return {
    aria2: { port: 6801, secret: 'test-secret' },
    downloadSchedule: { enabled, rules }
  } as never
}

function methodsCalled(): string[] {
  return h.rpc.mock.calls.map(call => String((call[0] as { method?: string }).method))
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-05-20T03:00:00'))
  h.rpc.mockReset()
  h.rpc.mockResolvedValue({})
  h.settings.mockReset()
  h.info.mockReset()
  h.warn.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('DownloadScheduler 定时器与配置缺失', () => {
  it('start() 挂上一分钟间隔的定时器，到点复查并按新状态下发', async () => {
    h.settings.mockReturnValue(settingsWith([RULE]))
    const scheduler = new DownloadScheduler()
    scheduler.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(methodsCalled()).toContain('aria2.pauseAll')

    // 状态没翻转时，每分钟那次复查不应重复下发
    h.rpc.mockClear()
    await vi.advanceTimersByTimeAsync(60 * 1000)
    expect(h.rpc).not.toHaveBeenCalled()

    // 时间进入窗口后，下一次复查（由 setInterval 触发）必须下发恢复
    vi.setSystemTime(new Date('2026-05-20T01:30:00'))
    await vi.advanceTimersByTimeAsync(60 * 1000)
    expect(methodsCalled()).toContain('aria2.unpauseAll')
    scheduler.stop()
  })

  it('设置里没有 downloadSchedule 时按未启用处理，一次 RPC 都不发', async () => {
    h.settings.mockReturnValue({ aria2: { port: 6801, secret: 'test-secret' } } as never)
    expect(() => new DownloadScheduler().check()).not.toThrow()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.rpc).not.toHaveBeenCalled()
  })
})

describe('DownloadScheduler 下发失败的重试', () => {
  it('unpause-all 失败只记警告，下一轮检查仍会重试', async () => {
    vi.setSystemTime(new Date('2026-05-20T01:30:00'))
    h.rpc.mockImplementation(async (options: unknown) => {
      if (String((options as { method?: string }).method) === 'aria2.unpauseAll') throw new Error('engine down')
      return {}
    })
    h.settings.mockReturnValue(settingsWith([RULE]))
    const scheduler = new DownloadScheduler()
    scheduler.check()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.warn).toHaveBeenCalledWith(
      '[DownloadScheduler] unpause-all 下发失败，将在一分钟后重试（引擎未运行？）:',
      expect.any(Error)
    )

    // 失败不写记忆：下一轮仍会重试同一条指令
    h.rpc.mockClear()
    scheduler.check()
    await vi.advanceTimersByTimeAsync(0)
    expect(methodsCalled()).toContain('aria2.unpauseAll')
  })

  it('关闭调度后恢复任务失败只记警告，不抛给调用方', async () => {
    h.settings.mockReturnValue(settingsWith([RULE]))
    const scheduler = new DownloadScheduler()
    scheduler.check()
    await vi.advanceTimersByTimeAsync(0)
    expect(methodsCalled()).toContain('aria2.pauseAll')

    h.rpc.mockImplementation(async (options: unknown) => {
      if (String((options as { method?: string }).method) === 'aria2.unpauseAll') throw new Error('engine down')
      return {}
    })
    h.settings.mockReturnValue(settingsWith([RULE], false))
    expect(() => scheduler.check()).not.toThrow()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.warn).toHaveBeenCalledWith(
      '[DownloadScheduler] 关闭调度后恢复任务失败（引擎未运行？）:',
      expect.any(Error)
    )
  })
})
