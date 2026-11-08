import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * 插件管理器的状态一致性。
 *
 * 这里只验"启用/停用/卸载"对持久化状态的影响——沙箱本身不是安全边界（见 pluginManager.ts 文件头），
 * 它的逃逸风险属于已知设计取舍，不做断言。
 */

const holder = vi.hoisted(() => ({ userData: '', appPath: '' }))

vi.mock('electron', () => ({
  app: {
    getPath: () => holder.userData,
    getAppPath: () => holder.appPath,
    isPackaged: false
  },
  Notification: { isSupported: () => false, show: () => {} }
}))

vi.mock('electron-store', () => ({
  default: class FakeStore {
    private data = new Map<string, unknown>()
    get(key: string) {
      return this.data.get(key)
    }
    set(key: string, value: unknown) {
      this.data.set(key, value)
    }
  }
}))

vi.mock('../utils/aria2Rpc', () => ({ callAria2Rpc: vi.fn() }))
vi.mock('../utils/settingsAccessor', () => ({
  getSettingsFresh: vi.fn(() => ({ aria2: { port: 6800, secret: 'test-secret' } }))
}))
vi.mock('../utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
}))

import { PluginManager } from './pluginManager'

type StoreLike = ConstructorParameters<typeof PluginManager>[0]

const MANIFEST = {
  id: 'demo',
  name: 'Demo',
  version: '1.0.0',
  main: 'index.js',
  permissions: []
}

function writePlugin(userData: string): void {
  const dir = path.join(userData, 'plugins', 'demo')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(MANIFEST), 'utf8')
  fs.writeFileSync(path.join(dir, 'index.js'), 'module.exports = { onActivate() {} }\n', 'utf8')
}

function disabledList(store: StoreLike): string[] {
  return (store.get('disabledPlugins') as string[] | undefined) ?? []
}

let userData: string
let builtinRoot: string
let store: StoreLike

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-manager-test-'))
  builtinRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-manager-builtin-'))
  holder.userData = userData
  holder.appPath = builtinRoot
  writePlugin(userData)
  store = new (class {
    private data = new Map<string, unknown>()
    get(key: string) {
      return this.data.get(key)
    }
    set(key: string, value: unknown) {
      this.data.set(key, value)
    }
  })() as unknown as StoreLike
})

afterEach(() => {
  fs.rmSync(userData, { recursive: true, force: true })
  fs.rmSync(builtinRoot, { recursive: true, force: true })
})

describe('PluginManager 启用状态', () => {
  it('新插件默认启用，禁用后写入停用列表，再启用会清掉', () => {
    const manager = new PluginManager(store)
    manager.loadAll()

    expect(manager.getPlugins().map((p) => p.manifest.id)).toEqual(['demo'])
    expect(manager.getPlugins()[0]?.enabled).toBe(true)

    expect(manager.disable('demo')).toBe(true)
    expect(disabledList(store)).toContain('demo')

    expect(manager.enable('demo')).toBe(true)
    expect(disabledList(store)).not.toContain('demo')
  })

  it('内置示例插件首次启动播种、默认停用，卸载后不再自动重装', () => {
    const sourceDir = path.join(builtinRoot, 'plugins', 'example')
    fs.mkdirSync(sourceDir, { recursive: true })
    fs.writeFileSync(path.join(sourceDir, 'manifest.json'), JSON.stringify({
      id: 'builtin-demo',
      name: 'Builtin Demo',
      version: '1.0.0',
      main: 'index.js',
      permissions: ['notify']
    }), 'utf8')
    fs.writeFileSync(path.join(sourceDir, 'index.js'), 'module.exports = { onActivate() {} }\n', 'utf8')

    const manager = new PluginManager(store)
    manager.loadAll()

    const seeded = manager.getPlugins().find(plugin => plugin.manifest.id === 'builtin-demo')
    expect(seeded).toBeDefined()
    expect(seeded?.enabled).toBe(false)
    expect(disabledList(store)).toContain('builtin-demo')
    expect((store.get('seededBuiltinPlugins') as string[] | undefined) ?? []).toContain('builtin-demo')

    expect(manager.uninstall('builtin-demo')).toBe(true)
    const reloaded = new PluginManager(store)
    reloaded.loadAll()
    expect(reloaded.getPlugins().some(plugin => plugin.manifest.id === 'builtin-demo')).toBe(false)
  })

  it('卸载后不再残留停用记录，重装同 id 的插件是新装状态', () => {
    const manager = new PluginManager(store)
    manager.loadAll()

    expect(manager.uninstall('demo')).toBe(true)
    expect(fs.existsSync(path.join(userData, 'plugins', 'demo'))).toBe(false)
    expect(manager.getPlugins()).toEqual([])
    // 卸载时会把插件标记为停用，但记录必须跟着一起清掉——否则重装后它一直是停用的
    expect(disabledList(store)).not.toContain('demo')

    writePlugin(userData)
    const reloaded = new PluginManager(store)
    reloaded.loadAll()

    const [plugin] = reloaded.getPlugins()
    expect(plugin?.manifest.id).toBe('demo')
    expect(plugin?.enabled).toBe(true)
  })
})
