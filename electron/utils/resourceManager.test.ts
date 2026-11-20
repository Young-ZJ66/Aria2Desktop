import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

// ResourceManager 是单例，构造时就做路径解析与目录创建，所以每个用例都 resetModules 重新 import。
// 引擎路径分三种口径（打包 / 开发新布局 / 开发旧布局），这三种口径决定「引擎找不到」的报错对不对，
// 因此这里用真实临时目录铺出每种布局，而不是断言拼接出来的字符串。
const env = vi.hoisted(() => ({ packaged: false, appPath: '', userData: '', resourcesPath: '' }))

vi.mock('electron', () => ({
  app: {
    getAppPath: () => env.appPath,
    getPath: () => env.userData
  }
}))
vi.mock('./logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
}))
vi.mock('./appEnv', () => ({
  get isPackagedApp() {
    return env.packaged
  },
  isDevMode: false
}))

const { getEngineArchDir } = await import('./platform')

let root = ''
let originalResourcesPath: PropertyDescriptor | undefined

function exeName() {
  return process.platform === 'win32' ? 'aria2c.exe' : 'aria2c'
}

function scopedEnginePath() {
  const archDir = getEngineArchDir(process.platform, process.arch)
  return path.join(root, 'resources', 'aria2', process.platform, archDir, exeName())
}

function writeFile(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, 'binary')
}

async function load() {
  vi.resetModules()
  const mod = await import('./resourceManager')
  return mod.ResourceManager.getInstance()
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aria2-rm-'))
  env.appPath = root
  env.userData = path.join(root, 'userData')
  env.resourcesPath = path.join(root, 'packaged')
  env.packaged = false
  fs.mkdirSync(env.userData, { recursive: true })
  originalResourcesPath = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
  Object.defineProperty(process, 'resourcesPath', { value: env.resourcesPath, configurable: true })
})

afterEach(() => {
  if (originalResourcesPath) Object.defineProperty(process, 'resourcesPath', originalResourcesPath)
  fs.rmSync(root, { recursive: true, force: true })
})

describe('ResourceManager 开发态引擎路径', () => {
  it('优先使用 resources/aria2/<platform>/<arch>/ 下的引擎', async () => {
    writeFile(scopedEnginePath())
    const manager = await load()
    expect(manager.getResourceInfo().executablePath).toBe(scopedEnginePath())
    expect(manager.isAria2Available()).toBe(true)
  })

  it('新布局缺失时回落到旧的 resources/aria2c[.exe]（避免旧检出直接报引擎不存在）', async () => {
    const legacy = path.join(root, 'resources', exeName())
    writeFile(legacy)
    const manager = await load()
    expect(manager.getResourceInfo().executablePath).toBe(legacy)
    expect(manager.isAria2Available()).toBe(true)
  })

  it('两种布局都不存在时返回新布局路径（报错里给出「应该放在哪」）', async () => {
    const manager = await load()
    expect(manager.getResourceInfo().executablePath).toBe(scopedEnginePath())
    expect(manager.isAria2Available()).toBe(false)
  })
})

describe('ResourceManager 打包态引擎路径', () => {
  it('打包态直接在 resources 根目录找引擎（extraResources 按平台/架构映射过去）', async () => {
    env.packaged = true
    const packedEngine = path.join(env.resourcesPath, exeName())
    writeFile(packedEngine)
    const manager = await load()
    expect(manager.getResourceInfo().executablePath).toBe(packedEngine)
    expect(manager.isAria2Available()).toBe(true)
  })
})

describe('ResourceManager 配置与会话文件', () => {
  it('配置与会话文件都在 userData/aria2 下（不写 exe 旁的只读目录）', async () => {
    writeFile(scopedEnginePath())
    const manager = await load()
    const info = manager.getResourceInfo()
    const configDir = path.join(env.userData, 'aria2')
    expect(info.configPath).toBe(path.join(configDir, 'aria2.conf'))
    expect(info.sessionFilePath).toBe(path.join(configDir, 'aria2.session'))
    expect(info.userDataPath).toBe(env.userData)
  })

  it('首次运行自动创建 aria2 目录与空会话文件', async () => {
    const manager = await load()
    const sessionFile = manager.getSessionFilePath()
    expect(fs.existsSync(sessionFile)).toBe(true)
    expect(fs.readFileSync(sessionFile, 'utf-8')).toBe('')
  })

  it('已有会话文件不被清空（重启后要恢复断点任务）', async () => {
    const sessionFile = path.join(env.userData, 'aria2', 'aria2.session')
    fs.mkdirSync(path.dirname(sessionFile), { recursive: true })
    fs.writeFileSync(sessionFile, 'gid=abc\n', 'utf-8')
    const manager = await load()
    expect(fs.readFileSync(manager.getSessionFilePath(), 'utf-8')).toBe('gid=abc\n')
  })

  it('getInstance 重复调用返回同一实例（避免反复重建路径状态）', async () => {
    vi.resetModules()
    const mod = await import('./resourceManager')
    const first = mod.ResourceManager.getInstance()
    const second = mod.ResourceManager.getInstance()
    expect(second).toBe(first)
  })
})
