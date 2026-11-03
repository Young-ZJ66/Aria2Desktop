import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
}))
vi.mock('../utils/aria2Rpc', () => ({ callAria2Rpc: vi.fn() }))
vi.mock('../utils/settingsAccessor', () => ({
  getSettingsFresh: vi.fn(() => ({ aria2: { port: 6800, secret: 's3cret' } }))
}))

import { callAria2Rpc } from '../utils/aria2Rpc'
import { readSpeedLimit, toggleSpeedLimit } from './traySpeedLimit'

const mockedRpc = vi.mocked(callAria2Rpc)

function rpcGetGlobalOption(limit: string | undefined) {
  mockedRpc.mockImplementation(async ({ method }) => {
    if (method === 'aria2.getGlobalOption') {
      return { 'max-overall-download-limit': limit }
    }
    return {}
  })
}

beforeEach(() => {
  mockedRpc.mockReset()
})

describe('readSpeedLimit', () => {
  it('限速中：返回 limited 与字节数（带单位后缀正确解析）', async () => {
    rpcGetGlobalOption('1024K')
    const snap = await readSpeedLimit()
    expect(snap).toEqual({ limited: true, limitBytes: 1048576 })
  })

  it('不限速：limited=false、bytes=0', async () => {
    rpcGetGlobalOption('0')
    expect(await readSpeedLimit()).toEqual({ limited: false, limitBytes: 0 })
  })

  it('引擎不可达：返回 null（调用方保持菜单原文案）', async () => {
    mockedRpc.mockRejectedValue(new Error('ECONNREFUSED'))
    expect(await readSpeedLimit()).toBeNull()
  })

  it('RPC 密钥来自设置直读', async () => {
    rpcGetGlobalOption('0')
    await readSpeedLimit()
    expect(mockedRpc).toHaveBeenCalledWith(expect.objectContaining({ port: 6800, secret: 's3cret' }))
  })
})

describe('toggleSpeedLimit', () => {
  it('限速中切换 → 下发 0', async () => {
    rpcGetGlobalOption('2M')
    const snap = await toggleSpeedLimit()
    expect(snap).toEqual({ limited: false, limitBytes: 0 })
    expect(mockedRpc).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'aria2.changeGlobalOption',
        params: [{ 'max-overall-download-limit': '0' }]
      })
    )
  })

  it('不限速切换 → 恢复记忆值（跨调用记忆上一次见到的非零值）', async () => {
    rpcGetGlobalOption('2M')
    await toggleSpeedLimit() // 关：记住 2M
    rpcGetGlobalOption('0')
    const snap = await toggleSpeedLimit() // 开：恢复 2M
    expect(snap).toEqual({ limited: true, limitBytes: 2 * 1048576 })
    expect(mockedRpc).toHaveBeenLastCalledWith(
      expect.objectContaining({
        method: 'aria2.changeGlobalOption',
        params: [{ 'max-overall-download-limit': '2M' }]
      })
    )
  })

  it('切换时引擎不可达 → 返回 null 不抛错', async () => {
    mockedRpc.mockRejectedValue(new Error('ECONNREFUSED'))
    expect(await toggleSpeedLimit()).toBeNull()
  })
})
