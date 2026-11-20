import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
}))
vi.mock('../utils/aria2Rpc', () => ({ callAria2Rpc: vi.fn().mockResolvedValue({}) }))
vi.mock('../utils/settingsAccessor', () => ({ getSettingsFresh: vi.fn() }))
vi.mock('../utils/activeRpcConfig', () => ({
  activeRpcOptions: vi.fn(() => ({ host: '127.0.0.1', port: 6801, protocol: 'http', path: '/jsonrpc', secret: 'test-secret' }))
}))

import { callAria2Rpc } from '../utils/aria2Rpc'
import { getSettingsFresh } from '../utils/settingsAccessor'
import { DownloadScheduler } from './downloadScheduler'

const mockedRpc = vi.mocked(callAria2Rpc)
const mockedSettings = vi.mocked(getSettingsFresh)

// 规则窗口 01:00–02:00：测试时间固定在窗口外或窗口内由各用例自行设定
const RULE = {
  name: '夜间限速时段',
  days: [] as number[],
  startTime: '01:00',
  endTime: '02:00',
  downloadLimit: 0,
  uploadLimit: 0,
  enabled: true
}

/** 只声明调度器真正读的字段，避免整份 settings 的形状在这里扩散 */
function settingsWith(rules: unknown[], enabled = true) {
  return {
    aria2: { port: 6801, secret: 'test-secret' },
    downloadSchedule: { enabled, rules }
  } as unknown as ReturnType<typeof getSettingsFresh>
}

function methodsCalled(): string[] {
  return mockedRpc.mock.calls.map(call => String((call[0] as { method?: string }).method))
}

beforeEach(() => {
  vi.useFakeTimers()
  // 固定到周三 03:00（窗口外）
  vi.setSystemTime(new Date('2026-05-20T03:00:00'))
  mockedRpc.mockClear()
  mockedRpc.mockResolvedValue({})
  mockedSettings.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('DownloadScheduler 定时下载', () => {
  it('调度未启用时一次 RPC 都不发', () => {
    mockedSettings.mockReturnValue(settingsWith([RULE], false))
    new DownloadScheduler().check()
    expect(mockedRpc).not.toHaveBeenCalled()
  })

  it('窗口外首次检查就对齐全局暂停（应用在窗口外启动也必须暂停）', async () => {
    mockedSettings.mockReturnValue(settingsWith([RULE]))
    new DownloadScheduler().check()
    await vi.runAllTimersAsync()
    expect(methodsCalled()).toContain('aria2.pauseAll')
  })

  it('窗口内首次检查对齐成恢复全部', async () => {
    vi.setSystemTime(new Date('2026-05-20T01:30:00'))
    mockedSettings.mockReturnValue(settingsWith([RULE]))
    new DownloadScheduler().check()
    await vi.runAllTimersAsync()
    expect(methodsCalled()).toContain('aria2.unpauseAll')
    expect(methodsCalled()).not.toContain('aria2.pauseAll')
  })

  it('状态没翻转时不重复下发指令', async () => {
    mockedSettings.mockReturnValue(settingsWith([RULE]))
    const scheduler = new DownloadScheduler()
    scheduler.check()
    await vi.runAllTimersAsync()
    const first = mockedRpc.mock.calls.length
    expect(first).toBeGreaterThan(0)

    scheduler.check()
    await vi.runAllTimersAsync()
    expect(mockedRpc.mock.calls.length).toBe(first)
  })

  it('从窗口外进入窗口内时下发恢复全部', async () => {
    mockedSettings.mockReturnValue(settingsWith([RULE]))
    const scheduler = new DownloadScheduler()
    scheduler.check()
    await vi.runAllTimersAsync()
    mockedRpc.mockClear()

    vi.setSystemTime(new Date('2026-05-20T01:30:00'))
    scheduler.check()
    await vi.runAllTimersAsync()
    expect(methodsCalled()).toContain('aria2.unpauseAll')
  })

  it('从窗口内走到窗口外时下发暂停全部', async () => {
    vi.setSystemTime(new Date('2026-05-20T01:30:00'))
    mockedSettings.mockReturnValue(settingsWith([RULE]))
    const scheduler = new DownloadScheduler()
    scheduler.check()
    await vi.runAllTimersAsync()
    mockedRpc.mockClear()

    vi.setSystemTime(new Date('2026-05-20T03:00:00'))
    scheduler.check()
    await vi.runAllTimersAsync()
    expect(methodsCalled()).toContain('aria2.pauseAll')
  })

  it('窗口结束时记下用户手动暂停的任务，恢复时按回暂停', async () => {
    mockedRpc.mockImplementation(async (options: unknown) => {
      const method = String((options as { method?: string }).method)
      if (method === 'aria2.tellWaiting') {
        return [
          { gid: 'gid-paused-by-user', status: 'paused' },
          { gid: 'gid-active', status: 'active' }
        ]
      }
      return {}
    })
    mockedSettings.mockReturnValue(settingsWith([RULE]))
    const scheduler = new DownloadScheduler()
    scheduler.check()
    await vi.runAllTimersAsync()
    expect(methodsCalled()).toContain('aria2.pauseAll')

    mockedRpc.mockClear()
    vi.setSystemTime(new Date('2026-05-20T01:30:00'))
    scheduler.check()
    await vi.runAllTimersAsync()
    const pauseCalls = mockedRpc.mock.calls.filter(
      call => (call[0] as { method?: string }).method === 'aria2.pause'
    )
    expect(pauseCalls).toHaveLength(1)
    expect((pauseCalls[0][0] as { params?: unknown[] }).params).toEqual(['gid-paused-by-user'])
  })

  it('读取暂停列表失败时不影响暂停动作本身', async () => {
    mockedRpc.mockImplementation(async (options: unknown) => {
      const method = String((options as { method?: string }).method)
      if (method === 'aria2.tellWaiting') throw new Error('engine down')
      return {}
    })
    mockedSettings.mockReturnValue(settingsWith([RULE]))
    new DownloadScheduler().check()
    await vi.runAllTimersAsync()
    expect(methodsCalled()).toContain('aria2.pauseAll')
  })

  it('pause-all 下发失败时不更新记忆，下一轮仍会重试', async () => {
    mockedRpc.mockImplementation(async (options: unknown) => {
      const method = String((options as { method?: string }).method)
      if (method === 'aria2.tellWaiting') return []
      if (method === 'aria2.pauseAll') throw new Error('engine down')
      return {}
    })
    mockedSettings.mockReturnValue(settingsWith([RULE]))
    const scheduler = new DownloadScheduler()
    scheduler.check()
    await vi.runAllTimersAsync()

    mockedRpc.mockClear()
    mockedRpc.mockResolvedValue({})
    scheduler.check()
    await vi.runAllTimersAsync()
    expect(methodsCalled()).toContain('aria2.pauseAll')
  })

  it('窗口外关闭调度时把此前暂停的任务恢复回来', async () => {
    mockedSettings.mockReturnValue(settingsWith([RULE]))
    const scheduler = new DownloadScheduler()
    scheduler.check()
    await vi.runAllTimersAsync()

    mockedRpc.mockClear()
    mockedSettings.mockReturnValue(settingsWith([RULE], false))
    scheduler.check()
    await vi.runAllTimersAsync()
    expect(methodsCalled()).toContain('aria2.unpauseAll')
  })

  it('窗口内关闭调度不额外恢复（本来就没暂停过）', async () => {
    vi.setSystemTime(new Date('2026-05-20T01:30:00'))
    mockedSettings.mockReturnValue(settingsWith([RULE]))
    const scheduler = new DownloadScheduler()
    scheduler.check()
    await vi.runAllTimersAsync()

    mockedRpc.mockClear()
    mockedSettings.mockReturnValue(settingsWith([RULE], false))
    scheduler.check()
    await vi.runAllTimersAsync()
    expect(methodsCalled()).not.toContain('aria2.unpauseAll')
  })

  it('start() 会立即检查一次并可按 stop() 停掉定时器', async () => {
    mockedSettings.mockReturnValue(settingsWith([RULE]))
    const scheduler = new DownloadScheduler()
    scheduler.start()
    // 注意不能用 runAllTimersAsync：start() 挂了 1 分钟间隔的 setInterval，会一直跑到上限
    await vi.advanceTimersByTimeAsync(0)
    expect(mockedRpc).toHaveBeenCalled()
    scheduler.stop()
    mockedRpc.mockClear()
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
    expect(mockedRpc).not.toHaveBeenCalled()
  })

  it('reapply() 清空记忆后按当前状态重新对齐（引擎重启会拉起被暂停的任务）', async () => {
    mockedSettings.mockReturnValue(settingsWith([RULE]))
    const scheduler = new DownloadScheduler()
    scheduler.check()
    await vi.runAllTimersAsync()

    mockedRpc.mockClear()
    scheduler.reapply()
    await vi.runAllTimersAsync()
    expect(methodsCalled()).toContain('aria2.pauseAll')
  })
})
