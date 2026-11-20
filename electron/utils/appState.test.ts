import { describe, expect, it, vi } from 'vitest'

// 模块持有进程级单例状态，每个用例前重新 import 拿到干净实例
async function freshState() {
  vi.resetModules()
  const mod = await import('./appState')
  return mod.appState
}

describe('appState 退出流程标记', () => {
  it('默认既未退出也未进入优雅关闭', async () => {
    const appState = await freshState()
    expect(appState.isQuitting()).toBe(false)
    expect(appState.hasShutdownStarted()).toBe(false)
  })

  it('markQuitting 后 isQuitting 为真（托盘「退出」在 app.quit() 前调用）', async () => {
    const appState = await freshState()
    appState.markQuitting()
    expect(appState.isQuitting()).toBe(true)
    // 两个标记互相独立：标记退出不等于已开始优雅关闭
    expect(appState.hasShutdownStarted()).toBe(false)
  })

  it('markShutdownStarted 后 hasShutdownStarted 为真，保证关闭只执行一次', async () => {
    const appState = await freshState()
    appState.markShutdownStarted()
    expect(appState.hasShutdownStarted()).toBe(true)
    expect(appState.isQuitting()).toBe(false)
  })

  it('重复标记幂等', async () => {
    const appState = await freshState()
    appState.markQuitting()
    appState.markQuitting()
    appState.markShutdownStarted()
    appState.markShutdownStarted()
    expect(appState.isQuitting()).toBe(true)
    expect(appState.hasShutdownStarted()).toBe(true)
  })
})
