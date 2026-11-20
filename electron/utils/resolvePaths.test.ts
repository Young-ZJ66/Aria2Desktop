import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

// resolvePaths 的三种运行模式（打包 / 未打包文件加载 / 开发态）由 isPackagedApp 决定，
// 这里把它换成可控变量，避免依赖真实的 app.isPackaged。
const env = vi.hoisted(() => ({ packaged: false }))
const appPath = vi.hoisted(() => ({ value: '' }))

vi.mock('electron', () => ({ app: { getAppPath: () => appPath.value } }))
vi.mock('./appEnv', () => ({
  get isPackagedApp() {
    return env.packaged
  },
  isDevMode: false
}))

const { resolveAppIconPath, resolveRendererIndexPath, resolveTrayIconPath } = await import('./resolvePaths')

let repoRoot = ''
const originalResourcesPath = process.resourcesPath
const originalPlatform = process.platform

function setPlatform(platform: string) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

beforeEach(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aria2-paths-'))
  appPath.value = repoRoot
  env.packaged = false
  setPlatform('win32')
})

afterEach(() => {
  setPlatform(originalPlatform)
  Object.defineProperty(process, 'resourcesPath', { value: originalResourcesPath, configurable: true })
  fs.rmSync(repoRoot, { recursive: true, force: true })
})

describe('渲染层入口路径', () => {
  it('打包态用 resources/app.asar/dist/vue/index.html', () => {
    env.packaged = true
    Object.defineProperty(process, 'resourcesPath', { value: 'C:\\App\\resources', configurable: true })
    expect(resolveRendererIndexPath()).toBe(
      path.join('C:\\App\\resources', 'app.asar', 'dist', 'vue', 'index.html')
    )
  })

  it('未打包但按文件加载时用 app.getAppPath()/dist/vue/index.html（不拼 asar 路径）', () => {
    env.packaged = false
    expect(resolveRendererIndexPath()).toBe(path.join(repoRoot, 'dist', 'vue', 'index.html'))
    expect(resolveRendererIndexPath()).not.toContain('app.asar')
  })
})

describe('应用/托盘图标路径', () => {
  it('Windows 未打包时找 build/Icon.ico，存在则返回该路径', () => {
    fs.mkdirSync(path.join(repoRoot, 'build'), { recursive: true })
    const icon = path.join(repoRoot, 'build', 'Icon.ico')
    fs.writeFileSync(icon, 'ico')
    expect(resolveAppIconPath()).toBe(icon)
  })

  it('macOS/Linux 未打包时找 build/icon.png（.ico 只有 Windows 认）', () => {
    setPlatform('linux')
    fs.mkdirSync(path.join(repoRoot, 'build'), { recursive: true })
    const icon = path.join(repoRoot, 'build', 'icon.png')
    fs.writeFileSync(icon, 'png')
    expect(resolveAppIconPath()).toBe(icon)
  })

  it('图标缺失时返回 null 而不是抛错（窗口忽略图标，托盘回退空图像）', () => {
    expect(resolveAppIconPath()).toBeNull()
  })

  it('打包态图标在 resources 根下（extraResources 映射）', () => {
    env.packaged = true
    Object.defineProperty(process, 'resourcesPath', { value: repoRoot, configurable: true })
    fs.writeFileSync(path.join(repoRoot, 'Icon.ico'), 'ico')
    expect(resolveAppIconPath()).toBe(path.join(repoRoot, 'Icon.ico'))
  })

  it('托盘图标与窗口图标同源', () => {
    fs.mkdirSync(path.join(repoRoot, 'build'), { recursive: true })
    fs.writeFileSync(path.join(repoRoot, 'build', 'Icon.ico'), 'ico')
    expect(resolveTrayIconPath()).toBe(resolveAppIconPath())
  })
})
