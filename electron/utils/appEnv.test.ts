import { afterEach, describe, expect, it, vi } from 'vitest'

// appEnv 的两个常量在模块加载时就求值，所以每个用例都要 resetModules 后动态 import。
// electron 在 vitest 里是 undefined，必须打桩，否则 app.isPackaged 直接抛 TypeError。
const env = vi.hoisted(() => ({ packaged: true }))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return env.packaged
    }
  }
}))

const originalNodeEnv = process.env.NODE_ENV

async function load() {
  vi.resetModules()
  return await import('./appEnv')
}

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = originalNodeEnv
})

describe('appEnv', () => {
  it('打包态且非 development 时 isPackagedApp 为真', async () => {
    env.packaged = true
    process.env.NODE_ENV = 'production'
    const { isDevMode, isPackagedApp } = await load()
    expect(isDevMode).toBe(false)
    expect(isPackagedApp).toBe(true)
  })

  it('NODE_ENV=development 时即使 app.isPackaged 为真也不算打包态（Electron 43 下 electron.exe <目录> 会误报）', async () => {
    env.packaged = true
    process.env.NODE_ENV = 'development'
    const { isDevMode, isPackagedApp } = await load()
    expect(isDevMode).toBe(true)
    expect(isPackagedApp).toBe(false)
  })

  it('未打包且非 development 时两者都为假', async () => {
    env.packaged = false
    delete process.env.NODE_ENV
    const { isDevMode, isPackagedApp } = await load()
    expect(isDevMode).toBe(false)
    expect(isPackagedApp).toBe(false)
  })

  it('NODE_ENV 只有严格等于 development 才算开发态', async () => {
    env.packaged = false
    process.env.NODE_ENV = 'dev'
    const { isDevMode } = await load()
    expect(isDevMode).toBe(false)
  })
})
