import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const logs = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }))

vi.mock('../utils/logger', () => ({
  createLogger: () => logs
}))
vi.mock('../utils/aria2Rpc', () => ({ callAria2Rpc: vi.fn().mockResolvedValue({}) }))
vi.mock('../utils/settingsAccessor', () => ({ getSettingsFresh: vi.fn() }))

import { callAria2Rpc } from '../utils/aria2Rpc'
import { getSettingsFresh } from '../utils/settingsAccessor'
import { SpeedScheduler } from './speedScheduler'

const mockedRpc = vi.mocked(callAria2Rpc)
const mockedSettings = vi.mocked(getSettingsFresh)

const RULE = {
  name: '工作时段',
  days: [] as number[],
  startTime: '00:00',
  endTime: '23:59',
  downloadLimit: 1048576,
  uploadLimit: 0
}

/** 只声明调度器真正读的字段，避免整份 settings 的形状在这里扩散 */
function settingsWith(rules: unknown[], enabled = true) {
  return {
    aria2: { port: 6801, secret: 'test-secret' },
    speedSchedule: { enabled, rules }
  } as unknown as ReturnType<typeof getSettingsFresh>
}

beforeEach(() => {
  // 固定到上午 10:30：规则 00:00–23:59 必然命中，且不受运行时刻影响
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-05-20T10:30:00'))
  mockedRpc.mockClear()
  mockedSettings.mockReset()
  logs.warn.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('SpeedScheduler', () => {
  it('调度未启用时一次 RPC 都不发', () => {
    mockedSettings.mockReturnValue(settingsWith([RULE], false))
    new SpeedScheduler().check()

    expect(mockedRpc).not.toHaveBeenCalled()
  })

  it('没有规则覆盖当前时间时不发限速指令', () => {
    mockedSettings.mockReturnValue(settingsWith([{ ...RULE, startTime: '12:00', endTime: '13:00' }]))
    new SpeedScheduler().check()

    expect(mockedRpc).not.toHaveBeenCalled()
  })

  it('规则命中时下发下载限速，且同一规则不重复下发', () => {
    mockedSettings.mockReturnValue(settingsWith([RULE]))
    const scheduler = new SpeedScheduler()

    scheduler.check()
    expect(mockedRpc).toHaveBeenCalledTimes(1)
    expect(mockedRpc).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 6801,
        secret: 'test-secret',
        method: 'aria2.changeGlobalOption',
        params: [{ 'max-overall-download-limit': '1048576' }]
      })
    )

    // 每分钟一轮检查，规则没变就不应该重复打扰引擎
    scheduler.check()
    expect(mockedRpc).toHaveBeenCalledTimes(1)
  })

  it('reapply() 会重新下发同一条规则的限速（引擎重启后全局选项已被重置）', () => {
    mockedSettings.mockReturnValue(settingsWith([RULE]))
    const scheduler = new SpeedScheduler()

    scheduler.check()
    expect(mockedRpc).toHaveBeenCalledTimes(1)

    scheduler.reapply()
    expect(mockedRpc).toHaveBeenCalledTimes(2)
    expect(mockedRpc).toHaveBeenLastCalledWith(
      expect.objectContaining({
        params: [{ 'max-overall-download-limit': '1048576' }]
      })
    )
  })

  it('reapply() 时若规则已不覆盖当前时间，不会下发指令', () => {
    mockedSettings.mockReturnValue(settingsWith([{ ...RULE, startTime: '12:00', endTime: '13:00' }]))
    const scheduler = new SpeedScheduler()

    scheduler.reapply()

    expect(mockedRpc).not.toHaveBeenCalled()
  })
})

/** 让 applyLimit / clearLimit 里的 Promise 链跑完 */
const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

describe('SpeedScheduler 生命周期', () => {
  it('start() 立即检查一次，之后每分钟重复检查', async () => {
    mockedSettings.mockReturnValue(settingsWith([RULE]))
    const scheduler = new SpeedScheduler()

    scheduler.start()
    await flush()
    expect(mockedRpc).toHaveBeenCalledTimes(1)

    // 时间窗换掉后，定时器到点应把限速回滚（证明 setInterval 真的在跑）
    mockedSettings.mockReturnValue(settingsWith([{ ...RULE, startTime: '12:00', endTime: '13:00' }]))
    await vi.advanceTimersByTimeAsync(60 * 1000)
    await flush()

    expect(mockedRpc).toHaveBeenCalledTimes(2)
    expect(mockedRpc).toHaveBeenLastCalledWith(
      expect.objectContaining({ params: [{ 'max-overall-download-limit': '0' }] })
    )

    scheduler.stop()
  })

  it('重复 start() 不会叠加定时器', async () => {
    mockedSettings.mockReturnValue(settingsWith([RULE]))
    const scheduler = new SpeedScheduler()

    scheduler.start()
    scheduler.start()
    await flush()
    expect(mockedRpc).toHaveBeenCalledTimes(1)

    mockedSettings.mockReturnValue(settingsWith([]))
    await vi.advanceTimersByTimeAsync(60 * 1000)
    await flush()

    // 若叠了两个定时器，同一时刻会发两次回滚指令
    expect(mockedRpc).toHaveBeenCalledTimes(2)

    scheduler.stop()
  })

  it('stop() 把已下发的下载与上传限速一并恢复，并停掉定时器', async () => {
    mockedSettings.mockReturnValue(settingsWith([{ ...RULE, uploadLimit: 524288 }]))
    const scheduler = new SpeedScheduler()

    scheduler.start()
    await flush()
    expect(mockedRpc).toHaveBeenCalledTimes(1)

    scheduler.stop()
    await flush()

    expect(mockedRpc).toHaveBeenCalledTimes(2)
    expect(mockedRpc).toHaveBeenLastCalledWith(
      expect.objectContaining({
        method: 'aria2.changeGlobalOption',
        params: [{ 'max-overall-download-limit': '0', 'max-overall-upload-limit': '0' }]
      })
    )

    // 定时器已停：再推进 5 分钟也不会有新指令
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
    await flush()
    expect(mockedRpc).toHaveBeenCalledTimes(2)
  })

  it('没下发过限速时 stop() 不发多余的 RPC', async () => {
    mockedSettings.mockReturnValue(settingsWith([]))
    const scheduler = new SpeedScheduler()

    scheduler.start()
    scheduler.stop()
    await flush()

    expect(mockedRpc).not.toHaveBeenCalled()
  })

  it('关闭调度后立即回滚已生效的限速', async () => {
    mockedSettings.mockReturnValue(settingsWith([RULE]))
    const scheduler = new SpeedScheduler()

    scheduler.check()
    await flush()
    expect(mockedRpc).toHaveBeenCalledTimes(1)

    mockedSettings.mockReturnValue(settingsWith([RULE], false))
    scheduler.check()
    await flush()

    expect(mockedRpc).toHaveBeenCalledTimes(2)
    expect(mockedRpc).toHaveBeenLastCalledWith(
      expect.objectContaining({ params: [{ 'max-overall-download-limit': '0' }] })
    )
  })

  it('规则窗口结束后只回滚本调度器改过的项', async () => {
    mockedSettings.mockReturnValue(settingsWith([{ ...RULE, uploadLimit: 524288 }]))
    const scheduler = new SpeedScheduler()

    scheduler.check()
    await flush()

    mockedSettings.mockReturnValue(settingsWith([{ ...RULE, startTime: '12:00', endTime: '13:00' }]))
    scheduler.check()
    await flush()

    expect(mockedRpc).toHaveBeenLastCalledWith(
      expect.objectContaining({
        params: [{ 'max-overall-download-limit': '0', 'max-overall-upload-limit': '0' }]
      })
    )
  })

  it('下发失败不记为已生效，下一轮检查会重试', async () => {
    mockedSettings.mockReturnValue(settingsWith([RULE]))
    mockedRpc.mockRejectedValueOnce(new Error('engine down'))
    const scheduler = new SpeedScheduler()

    scheduler.check()
    await flush()
    expect(mockedRpc).toHaveBeenCalledTimes(1)

    scheduler.check()
    await flush()
    expect(mockedRpc).toHaveBeenCalledTimes(2)
    expect(mockedRpc).toHaveBeenLastCalledWith(
      expect.objectContaining({ params: [{ 'max-overall-download-limit': '1048576' }] })
    )
  })

  it('同一条规则下发未返回时不会重复下发', async () => {
    const gate: { release?: () => void } = {}
    mockedRpc.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          gate.release = () => resolve({})
        })
    )
    mockedSettings.mockReturnValue(settingsWith([RULE]))
    const scheduler = new SpeedScheduler()

    scheduler.check()
    scheduler.check()
    scheduler.check()
    expect(mockedRpc).toHaveBeenCalledTimes(1)

    gate.release?.()
    await flush()

    // 生效之后同一规则也不重复下发
    scheduler.check()
    expect(mockedRpc).toHaveBeenCalledTimes(1)
  })

  it('reapply() 强制重发同一条规则，上传限速一并带上', async () => {
    mockedSettings.mockReturnValue(settingsWith([{ ...RULE, uploadLimit: 524288 }]))
    const scheduler = new SpeedScheduler()

    scheduler.check()
    await flush()
    expect(mockedRpc).toHaveBeenCalledTimes(1)

    scheduler.reapply()
    await flush()

    expect(mockedRpc).toHaveBeenCalledTimes(2)
    expect(mockedRpc).toHaveBeenLastCalledWith(
      expect.objectContaining({
        params: [{ 'max-overall-download-limit': '1048576', 'max-overall-upload-limit': '524288' }]
      })
    )
  })

  it('回滚失败只记录日志，不抛出', async () => {
    mockedSettings.mockReturnValue(settingsWith([RULE]))
    const scheduler = new SpeedScheduler()

    scheduler.check()
    await flush()

    mockedRpc.mockRejectedValueOnce(new Error('engine gone'))
    expect(() => scheduler.check()).not.toThrow()
    await flush()
  })

  it('清除限速的 RPC 失败时只记录日志，不抛出', async () => {
    // 上一条用例可能留下未消费的 mockRejectedValueOnce，先清空实现再铺默认成功
    mockedRpc.mockReset()
    mockedRpc.mockResolvedValue({})
    mockedSettings.mockReturnValue(settingsWith([RULE]))
    const scheduler = new SpeedScheduler()

    scheduler.check()
    await flush()
    expect(mockedRpc).toHaveBeenCalledTimes(1)

    // 规则被删空：走 clearLimit，而这一次下发失败
    mockedSettings.mockReturnValue(settingsWith([]))
    mockedRpc.mockRejectedValueOnce(new Error('engine gone'))
    expect(() => scheduler.check()).not.toThrow()
    await flush()

    expect(mockedRpc).toHaveBeenCalledTimes(2)
    expect(logs.warn).toHaveBeenCalledWith('[SpeedScheduler] Failed to clear speed limit:', expect.any(Error))
  })
})
