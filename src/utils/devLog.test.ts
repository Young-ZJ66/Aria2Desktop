import { afterEach, describe, expect, it, vi } from 'vitest'

// devLog 的 isDev 在模块加载时求值，所以每个用例都要 resetModules 后动态 import
async function loadDevLog() {
  vi.resetModules()
  return await import('./devLog')
}

describe('devLog', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('开发态把参数原样转给 console.log', async () => {
    vi.stubEnv('DEV', true)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { devLog } = await loadDevLog()
    devLog('任务完成', 42, { gid: 'abc' })
    expect(log).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith('任务完成', 42, { gid: 'abc' })
  })

  it('生产态完全静默（打包后用户看不到控制台，输出没有意义）', async () => {
    vi.stubEnv('DEV', false)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { devLog } = await loadDevLog()
    devLog('不该出现')
    expect(log).not.toHaveBeenCalled()
  })

  it('不传参数时也不抛错', async () => {
    vi.stubEnv('DEV', true)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { devLog } = await loadDevLog()
    expect(() => devLog()).not.toThrow()
    expect(log).toHaveBeenCalledTimes(1)
  })
})
