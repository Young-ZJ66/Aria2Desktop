import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
}))
vi.mock('../utils/aria2Rpc', () => ({ callAria2Rpc: vi.fn() }))
vi.mock('../utils/settingsAccessor', () => ({
  getSettingsFresh: vi.fn(() => ({ aria2: { host: '127.0.0.1', port: 6800, secret: 's3cret' } }))
}))

import { callAria2Rpc } from '../utils/aria2Rpc'
import { GLOBAL_LIMIT_OPTION, GLOBAL_LIMIT_READ_TIMEOUT_MS, readGlobalSpeedLimitBytes } from './globalSpeedLimit'

const mockedRpc = vi.mocked(callAria2Rpc)

/** 让 RPC 返回一份全局选项表（limit 为 undefined 时模拟引擎没给这个键） */
function rpcReturns(limit: string | undefined): void {
  mockedRpc.mockResolvedValue(limit === undefined ? {} : { [GLOBAL_LIMIT_OPTION]: limit })
}

beforeEach(() => {
  mockedRpc.mockReset()
})

describe('readGlobalSpeedLimitBytes：把 aria2 的全局选项翻译成 yt-dlp 能用的字节数', () => {
  it('带单位后缀按 1024 进制换算', async () => {
    rpcReturns('1024K')
    expect(await readGlobalSpeedLimitBytes()).toBe(1048576)
  })

  it('纯数字按字节原样返回', async () => {
    rpcReturns('524288')
    expect(await readGlobalSpeedLimitBytes()).toBe(524288)
  })

  it('限速为 0 表示不限速，返回 0 让调用方跳过 --limit-rate', async () => {
    rpcReturns('0')
    expect(await readGlobalSpeedLimitBytes()).toBe(0)
  })

  it('引擎没给这个键时按不限速处理', async () => {
    rpcReturns(undefined)
    expect(await readGlobalSpeedLimitBytes()).toBe(0)
  })

  it('引擎不可达时返回 0 而不是抛错（不能因为读不到限速就让下载失败）', async () => {
    mockedRpc.mockRejectedValue(new Error('ECONNREFUSED'))
    await expect(readGlobalSpeedLimitBytes()).resolves.toBe(0)
  })

  it('RPC 目标端口与密钥来自设置直读', async () => {
    rpcReturns('0')
    await readGlobalSpeedLimitBytes()
    expect(mockedRpc).toHaveBeenCalledWith(
      expect.objectContaining({ port: 6800, secret: 's3cret', method: 'aria2.getGlobalOption' })
    )
  })

  it('默认读超时比普通 RPC 短：这段等待直接压在「点下载到进程启动」之间', async () => {
    rpcReturns('0')
    await readGlobalSpeedLimitBytes()
    expect(mockedRpc).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: GLOBAL_LIMIT_READ_TIMEOUT_MS }))
    expect(GLOBAL_LIMIT_READ_TIMEOUT_MS).toBeLessThan(5000)
  })

  it('调用方可以覆盖读超时', async () => {
    rpcReturns('0')
    await readGlobalSpeedLimitBytes(200)
    expect(mockedRpc).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 200 }))
  })
})
