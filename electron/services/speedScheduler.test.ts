import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
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
    expect(mockedRpc).toHaveBeenCalledWith({
      port: 6801,
      secret: 'test-secret',
      method: 'aria2.changeGlobalOption',
      params: [{ 'max-overall-download-limit': '1048576' }]
    })

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
