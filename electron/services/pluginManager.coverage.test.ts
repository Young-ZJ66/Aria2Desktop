import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

/**
 * pluginManager 的拒绝分支、降级路径与安装参数校验。
 *
 * 已有四个文件分别覆盖：启用状态持久化（pluginManager.test.ts）、worker 代次与
 * 脱敏（pluginManager.security.test.ts）、市场安装签名链（pluginManager.install.test.ts）、
 * 沙箱权限裁剪与生命周期（pluginManager.runtime.test.ts）。这里补的是"出错时会不会
 * 静默变成另一个状态"：入口越界、子进程起不来、加载超时、旧代次消息、安装落盘失败。
 */

const realFs = await vi.importActual<typeof import('node:fs')>('node:fs')

class FakeWorker {
  messages: Array<Record<string, unknown>> = []
  killed = false
  private listeners = new Map<string, Array<(...args: any[]) => void>>()

  postMessage(message: unknown): void {
    if (holder.failLoadMessage && (message as { type?: string } | null)?.type === 'load') {
      throw new Error('port closed')
    }
    this.messages.push(message as Record<string, unknown>)
  }

  on(event: string, listener: (...args: any[]) => void): void {
    if (holder.failOn) throw new Error('worker broken')
    const list = this.listeners.get(event) ?? []
    list.push(listener)
    this.listeners.set(event, list)
  }

  kill(): boolean {
    this.killed = true
    return true
  }

  emit(event: string, ...args: any[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args)
  }

  sentOfType(type: string): Array<Record<string, unknown>> {
    return this.messages.filter(item => item && item.type === type)
  }
}

const holder = vi.hoisted(() => ({
  userData: '',
  appPath: '',
  isPackaged: false,
  settings: {} as Record<string, unknown>,
  notifySupported: true,
  notifyThrows: false,
  notifications: [] as Array<{ title?: string; body?: string }>,
  workers: [] as unknown[],
  utilityProcess: undefined as unknown,
  forkThrows: false,
  failLoadMessage: false,
  failOn: false,
  workerHostMissing: false,
  rmThrowsFor: '',
  readdirThrowsFor: '',
  cpThrows: false,
  failRenameFrom: [] as string[],
  failRenameTo: [] as string[],
  rpcCalls: [] as Array<{ method: string; params?: unknown[] }>,
  rpcImpl: null as null | ((options: { method: string }) => Promise<unknown>),
  logs: { info: [] as unknown[][], warn: [] as unknown[][], error: [] as unknown[][], debug: [] as unknown[][] }
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => holder.userData,
    getAppPath: () => holder.appPath,
    get isPackaged() {
      return holder.isPackaged
    }
  },
  Notification: class {
    static isSupported(): boolean {
      return holder.notifySupported
    }
    constructor(options: { title?: string; body?: string }) {
      if (holder.notifyThrows) throw new Error('notification backend down')
      holder.notifications.push(options)
    }
    show(): void {
      void 0
    }
  },
  get utilityProcess() {
    return holder.utilityProcess
  }
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

vi.mock('../utils/aria2Rpc', () => ({
  callAria2Rpc: (options: { method: string; params?: unknown[] }) => {
    holder.rpcCalls.push(options)
    return holder.rpcImpl ? holder.rpcImpl(options) : Promise.resolve('rpc-ok')
  }
}))

vi.mock('../utils/activeRpcConfig', () => ({
  activeRpcOptions: () => ({ port: 6800, secret: 'rpc-secret' })
}))

vi.mock('../utils/settingsAccessor', () => ({
  getSettingsFresh: () => holder.settings
}))

vi.mock('../utils/logger', () => {
  const make = (level: 'info' | 'warn' | 'error' | 'debug') => (...args: unknown[]) => {
    holder.logs[level].push(args)
  }
  return {
    createLogger: () => ({ info: make('info'), warn: make('warn'), error: make('error'), debug: make('debug') })
  }
})

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  const nodePath = await import('node:path')
  const actualExists = actual.existsSync as (target: string) => boolean
  const actualRename = actual.renameSync as (from: string, to: string) => void
  return {
    ...actual,
    existsSync: (target: string) => {
      if (typeof target === 'string' && target.endsWith(nodePath.join('workers', 'pluginHost.js'))) {
        return !holder.workerHostMissing
      }
      return actualExists(target)
    },
    rmSync: (target: string, options?: unknown) => {
      if (holder.rmThrowsFor && String(target).includes(holder.rmThrowsFor)) {
        throw new Error('EPERM: operation not permitted')
      }
      return (actual.rmSync as (...args: unknown[]) => void)(target, options)
    },
    readdirSync: (target: string, options?: unknown) => {
      if (holder.readdirThrowsFor && String(target) === holder.readdirThrowsFor) {
        throw new Error('EACCES: permission denied')
      }
      return (actual.readdirSync as (...args: unknown[]) => unknown)(target, options)
    },
    cpSync: (from: string, to: string, options?: unknown) => {
      if (holder.cpThrows) throw new Error('ENOSPC: no space left on device')
      return (actual.cpSync as (...args: unknown[]) => void)(from, to, options)
    },
    renameSync: (from: string, to: string) => {
      const fromHit = holder.failRenameFrom.some(fragment => String(from).includes(fragment))
      const toHit = holder.failRenameTo.some(fragment => String(to).includes(fragment))
      if (fromHit || toHit) throw new Error('simulated rename failure')
      return actualRename(from, to)
    }
  }
})

import { PluginManager, verifyRegistrySignature } from './pluginManager'

type StoreLike = ConstructorParameters<typeof PluginManager>[0]

function makeStore(initial: Record<string, unknown> = {}): { store: StoreLike; data: Map<string, unknown> } {
  const data = new Map<string, unknown>(Object.entries(initial))
  const store = new (class {
    get(key: string) {
      return data.get(key)
    }
    set(key: string, value: unknown) {
      data.set(key, value)
    }
  })() as unknown as StoreLike
  return { store, data }
}

interface PluginOptions {
  dir?: string
  id?: string
  name?: string
  version?: string
  main?: string
  permissions?: string[]
  code?: string
  rawManifest?: string
}

function writePlugin(options: PluginOptions = {}): string {
  const dir = path.join(holder.userData, 'plugins', options.dir ?? 'demo')
  realFs.mkdirSync(dir, { recursive: true })
  const manifest = options.rawManifest ?? JSON.stringify({
    id: options.id ?? 'demo',
    name: options.name ?? 'Demo',
    version: options.version ?? '1.0.0',
    main: options.main ?? 'index.js',
    permissions: options.permissions ?? []
  })
  realFs.writeFileSync(path.join(dir, 'manifest.json'), manifest, 'utf8')
  if (options.code !== undefined) realFs.writeFileSync(path.join(dir, 'index.js'), options.code, 'utf8')
  return dir
}

function managed(manager: PluginManager, id = 'demo'): Record<string, any> {
  const plugin = (manager as unknown as { plugins: Map<string, Record<string, any>> }).plugins.get(id)
  expect(plugin).toBeDefined()
  return plugin as Record<string, any>
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve()
}

function logText(level: 'info' | 'warn' | 'error'): string {
  return holder.logs[level].map(args => args.map(item => String(item)).join(' ')).join('\n')
}

function installWorkerProcess(): void {
  holder.utilityProcess = {
    fork: () => {
      if (holder.forkThrows) throw new Error('spawn EPERM')
      const worker = new FakeWorker()
      holder.workers.push(worker)
      return worker
    }
  }
}

let userData: string
let builtinRoot: string

beforeEach(() => {
  userData = realFs.mkdtempSync(path.join(os.tmpdir(), 'plugin-coverage-'))
  builtinRoot = realFs.mkdtempSync(path.join(os.tmpdir(), 'plugin-coverage-builtin-'))
  holder.userData = userData
  holder.appPath = ''
  holder.isPackaged = false
  holder.settings = { aria2: { port: 6800, secret: 'rpc-secret' }, download: { dir: 'E:/downloads' } }
  holder.notifySupported = true
  holder.notifyThrows = false
  holder.notifications = []
  holder.workers = []
  holder.utilityProcess = undefined
  holder.forkThrows = false
  holder.failLoadMessage = false
  holder.failOn = false
  holder.workerHostMissing = false
  holder.rmThrowsFor = ''
  holder.readdirThrowsFor = ''
  holder.cpThrows = false
  holder.failRenameFrom = []
  holder.failRenameTo = []
  holder.rpcCalls = []
  holder.rpcImpl = null
  holder.logs = { info: [], warn: [], error: [], debug: [] }
})

afterEach(() => {
  realFs.rmSync(userData, { recursive: true, force: true })
  realFs.rmSync(builtinRoot, { recursive: true, force: true })
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('播种内置插件', () => {
  it('清理旧版内置插件目录，并把新的内置示例复制进来后默认停用', () => {
    holder.appPath = builtinRoot
    const legacyDir = path.join(userData, 'plugins', 'download-notifier')
    realFs.mkdirSync(legacyDir, { recursive: true })
    const sampleDir = path.join(builtinRoot, 'plugins', 'sample')
    realFs.mkdirSync(sampleDir, { recursive: true })
    realFs.writeFileSync(path.join(sampleDir, 'manifest.json'), JSON.stringify({
      id: 'com.example.sample', name: 'Sample', version: '1.0.0', main: 'index.js', permissions: []
    }), 'utf8')

    const { store, data } = makeStore({
      seededBuiltinPlugins: ['com.aria2desktop.download-notifier'],
      disabledPlugins: ['com.aria2desktop.download-notifier']
    })
    new PluginManager(store)

    expect(realFs.existsSync(legacyDir)).toBe(false)
    expect(realFs.existsSync(path.join(userData, 'plugins', 'sample'))).toBe(true)
    expect(data.get('seededBuiltinPlugins')).toEqual(['com.example.sample'])
    expect(data.get('disabledPlugins')).toEqual(['com.example.sample'])
    expect(logText('info')).toContain('Removed legacy builtin plugin')
  })

  it('源目录里的普通文件、缺 manifest 与坏 manifest 的目录都被跳过', () => {
    holder.appPath = builtinRoot
    const root = path.join(builtinRoot, 'plugins')
    realFs.mkdirSync(root, { recursive: true })
    realFs.writeFileSync(path.join(root, 'README.md'), 'not a plugin', 'utf8')
    realFs.mkdirSync(path.join(root, 'no-manifest'), { recursive: true })
    realFs.writeFileSync(path.join(root, 'no-manifest', 'index.js'), 'module.exports = {}', 'utf8')
    realFs.mkdirSync(path.join(root, 'bad'), { recursive: true })
    realFs.writeFileSync(path.join(root, 'bad', 'manifest.json'), '{oops', 'utf8')
    realFs.mkdirSync(path.join(root, 'good'), { recursive: true })
    realFs.writeFileSync(path.join(root, 'good', 'manifest.json'), JSON.stringify({
      id: 'good', name: 'Good', version: '1.0.0', main: 'index.js', permissions: []
    }), 'utf8')

    const { store, data } = makeStore()
    new PluginManager(store)

    expect(realFs.readdirSync(path.join(userData, 'plugins'))).toEqual(['good'])
    expect(data.get('seededBuiltinPlugins')).toEqual(['good'])
  })

  it('源目录不存在时不写播种记录', () => {
    holder.appPath = builtinRoot
    const { store, data } = makeStore()
    new PluginManager(store)
    expect(data.has('seededBuiltinPlugins')).toBe(false)
  })

  it('清理旧插件目录失败只记录警告，仍然从播种记录里移除', () => {
    holder.appPath = builtinRoot
    realFs.mkdirSync(path.join(userData, 'plugins', 'download-notifier'), { recursive: true })
    realFs.mkdirSync(path.join(builtinRoot, 'plugins'), { recursive: true })
    holder.rmThrowsFor = 'download-notifier'

    const { store, data } = makeStore({
      seededBuiltinPlugins: ['com.aria2desktop.download-notifier'],
      disabledPlugins: ['com.aria2desktop.download-notifier']
    })
    new PluginManager(store)

    expect(logText('warn')).toContain('Failed to remove legacy builtin plugin')
    expect(data.get('seededBuiltinPlugins')).toEqual([])
  })

  it('复制内置插件失败只记录警告，不中断启动', () => {
    holder.appPath = builtinRoot
    const sampleDir = path.join(builtinRoot, 'plugins', 'sample')
    realFs.mkdirSync(sampleDir, { recursive: true })
    realFs.writeFileSync(path.join(sampleDir, 'manifest.json'), JSON.stringify({
      id: 'sample', name: 'Sample', version: '1.0.0', main: 'index.js', permissions: []
    }), 'utf8')
    holder.cpThrows = true

    const { store, data } = makeStore()
    expect(() => new PluginManager(store)).not.toThrow()
    expect(logText('warn')).toContain('Failed to seed builtin plugins')
    expect(data.has('seededBuiltinPlugins')).toBe(false)
  })
})

describe('加载阶段的目录边界', () => {
  it('插件目录里的普通文件被跳过', () => {
    writePlugin({ code: 'module.exports = {}' })
    realFs.writeFileSync(path.join(userData, 'plugins', 'readme.txt'), 'hello', 'utf8')

    const { store } = makeStore()
    const manager = new PluginManager(store)
    manager.loadAll()

    expect(manager.getPlugins()).toHaveLength(1)
  })

  it('读插件目录失败时只记录错误，不影响启动', () => {
    realFs.mkdirSync(path.join(userData, 'plugins'), { recursive: true })
    holder.readdirThrowsFor = path.join(userData, 'plugins')

    const { store } = makeStore()
    const manager = new PluginManager(store)
    expect(() => manager.loadAll()).not.toThrow()
    expect(logText('error')).toContain('Failed to read plugin directory')
  })

  it('目录里既没有 manifest.json 也没有 package.json 时不注册', () => {
    realFs.mkdirSync(path.join(userData, 'plugins', 'empty'), { recursive: true })

    const { store } = makeStore()
    const manager = new PluginManager(store)
    manager.loadAll()

    expect(manager.getPlugins()).toHaveLength(0)
    expect(logText('warn')).toBe('')
  })
})

describe('worker 激活的拒绝与降级', () => {
  it('入口文件越出插件目录时标记错误且不启动子进程', () => {
    installWorkerProcess()
    writePlugin({ main: '../evil.js', code: 'module.exports = {}' })

    const { store } = makeStore()
    const manager = new PluginManager(store)
    manager.loadAll()

    const plugin = managed(manager)
    expect(plugin.status).toBe('error')
    expect(String(plugin.error)).toContain('Path traversal detected in entry file')
    expect(holder.workers).toHaveLength(0)
  })

  it('入口文件不存在时标记错误', () => {
    installWorkerProcess()
    writePlugin({ main: 'missing.js' })

    const { store } = makeStore()
    const manager = new PluginManager(store)
    manager.loadAll()

    const plugin = managed(manager)
    expect(plugin.status).toBe('error')
    expect(String(plugin.error)).toContain('Entry file not found: missing.js')
  })

  it('编译产物缺失时回退到进程内 vm', () => {
    installWorkerProcess()
    holder.workerHostMissing = true
    writePlugin({ code: 'module.exports = { onActivate() {} }' })

    const { store } = makeStore()
    const manager = new PluginManager(store)
    manager.loadAll()

    const plugin = managed(manager)
    expect(plugin.status).toBe('running')
    expect(plugin.worker).toBeUndefined()
    expect(logText('warn')).toContain('falling back to in-process vm')
  })

  it('启动子进程抛错时标记错误', () => {
    installWorkerProcess()
    holder.forkThrows = true
    writePlugin({ code: 'module.exports = {}' })

    const { store } = makeStore()
    const manager = new PluginManager(store)
    manager.loadAll()

    const plugin = managed(manager)
    expect(plugin.status).toBe('error')
    expect(String(plugin.error)).toContain('Failed to start plugin process')
  })

  it('下发插件代码失败时标记错误', () => {
    installWorkerProcess()
    holder.failLoadMessage = true
    writePlugin({ code: 'module.exports = {}' })

    const { store } = makeStore()
    const manager = new PluginManager(store)
    manager.loadAll()
    const worker = holder.workers[0] as FakeWorker
    worker.emit('spawn')

    const plugin = managed(manager)
    expect(plugin.status).toBe('error')
    expect(String(plugin.error)).toContain('Failed to send plugin code')
  })

  it('注册事件监听失败时标记错误', () => {
    installWorkerProcess()
    holder.failOn = true
    writePlugin({ code: 'module.exports = {}' })

    const { store } = makeStore()
    const manager = new PluginManager(store)
    manager.loadAll()

    const plugin = managed(manager)
    expect(plugin.status).toBe('error')
    expect(String(plugin.error)).toContain('Failed to start plugin process')
  })

  it('旧代次的 worker 消息被忽略', () => {
    installWorkerProcess()
    writePlugin({ code: 'module.exports = {}' })

    const { store } = makeStore()
    const manager = new PluginManager(store)
    manager.loadAll()
    const worker = holder.workers[0] as FakeWorker
    worker.emit('spawn')
    const plugin = managed(manager)
    plugin.generation += 1

    worker.emit('message', { type: 'loaded', ok: true })

    expect(logText('warn')).toContain('忽略旧代次 worker 消息')
    expect(plugin.workerReady).toBe(false)
  })

  it('加载超时后先请求终止再强杀', async () => {
    vi.useFakeTimers()
    installWorkerProcess()
    writePlugin({ code: 'module.exports = {}' })

    const { store } = makeStore()
    const manager = new PluginManager(store)
    manager.loadAll()
    const worker = holder.workers[0] as FakeWorker
    worker.emit('spawn')

    await vi.advanceTimersByTimeAsync(10_000)

    const plugin = managed(manager)
    expect(plugin.status).toBe('error')
    expect(String(plugin.error)).toContain('Plugin load timed out after 10s')
    expect(worker.sentOfType('terminate')).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(400)
    expect(worker.killed).toBe(true)
  })
})

describe('vm 激活的拒绝与降级', () => {
  it('入口越界时禁用插件', () => {
    writePlugin({ main: '../evil.js', code: 'module.exports = {}' })

    const { store } = makeStore()
    const manager = new PluginManager(store)
    manager.loadAll()

    const plugin = managed(manager)
    expect(plugin.enabled).toBe(false)
    expect(logText('error')).toContain('Path traversal detected in plugin')
  })

  it('入口不存在时禁用插件并留下空实例', () => {
    writePlugin({ main: 'missing.js' })

    const { store } = makeStore()
    const manager = new PluginManager(store)
    manager.loadAll()

    const plugin = managed(manager)
    expect(plugin.enabled).toBe(false)
    expect(plugin.instance).toEqual({})
  })

  it('onActivate 同步抛错按激活失败处理', () => {
    writePlugin({ code: 'module.exports = { onActivate() { throw new Error("boom") } }' })

    const { store } = makeStore()
    const manager = new PluginManager(store)
    manager.loadAll()

    const plugin = managed(manager)
    expect(plugin.status).toBe('error')
    expect(plugin.enabled).toBe(false)
    expect(logText('error')).toContain('Failed to activate plugin')
  })

  it('onActivate 返回的 Promise 被拒时只记录日志，插件保持运行', async () => {
    writePlugin({ code: 'module.exports = { onActivate() { return Promise.reject(new Error("boom")) } }' })

    const { store } = makeStore()
    const manager = new PluginManager(store)
    manager.loadAll()
    await flush()

    expect(managed(manager).status).toBe('running')
    expect(logText('error')).toContain('onActivate error')
  })

  it('插件代码语法错误时状态为 error', () => {
    writePlugin({ code: 'function (' })

    const { store } = makeStore()
    const manager = new PluginManager(store)
    manager.loadAll()

    const plugin = managed(manager)
    expect(plugin.status).toBe('error')
    expect(plugin.enabled).toBe(false)
  })
})

describe('worker 消息与 API 分发', () => {
  function bootWorker(permissions: string[] = []): { manager: PluginManager; worker: FakeWorker } {
    installWorkerProcess()
    writePlugin({ permissions, code: 'module.exports = {}' })
    const { store } = makeStore()
    const manager = new PluginManager(store)
    manager.loadAll()
    const worker = holder.workers[0] as FakeWorker
    worker.emit('spawn')
    worker.emit('message', { type: 'loaded', ok: true })
    return { manager, worker }
  }

  it('未知消息类型被忽略', () => {
    const { manager, worker } = bootWorker()
    expect(() => worker.emit('message', { type: 'mystery' })).not.toThrow()
    expect(managed(manager).status).toBe('running')
  })

  it('停用过程中进程退出不触发重启', () => {
    const { manager, worker } = bootWorker()
    const plugin = managed(manager)
    plugin.stopping = true

    worker.emit('exit', 1)

    expect(plugin.status).toBe('stopped')
    expect(holder.workers).toHaveLength(1)
  })

  it('已停用的插件进程退出标记为 disabled', () => {
    const { manager, worker } = bootWorker()
    const plugin = managed(manager)
    plugin.enabled = false

    worker.emit('exit', 1)

    expect(plugin.status).toBe('disabled')
  })

  it('getActiveTasks 映射到 tellActive 且不带参数', async () => {
    const { worker } = bootWorker(['aria2:read'])
    worker.emit('message', { type: 'api', id: 'req-1', method: 'aria2.getActiveTasks', args: [] })
    await flush()

    expect(holder.rpcCalls).toHaveLength(1)
    expect(holder.rpcCalls[0]?.method).toBe('aria2.tellActive')
    expect(holder.rpcCalls[0]?.params).toEqual([])
    expect(worker.sentOfType('api-response')[0]?.ok).toBe(true)
  })

  it('getStoppedTasks 取满 1000 条', async () => {
    const { worker } = bootWorker(['aria2:read'])
    worker.emit('message', { type: 'api', id: 'req-2', method: 'aria2.getStoppedTasks', args: [] })
    await flush()

    expect(holder.rpcCalls[0]?.method).toBe('aria2.tellStopped')
    expect(holder.rpcCalls[0]?.params).toEqual([0, 1000])
  })

  it('RPC 返回前插件被重启时不再回包', async () => {
    let release: (value: unknown) => void = () => {}
    holder.rpcImpl = () => new Promise(resolve => { release = resolve })
    const { manager, worker } = bootWorker(['aria2:read'])
    worker.emit('message', { type: 'api', id: 'req-3', method: 'aria2.getGlobalStat', args: [] })
    await flush()

    managed(manager).generation += 1
    release('late')
    await flush()

    expect(worker.sentOfType('api-response')).toHaveLength(0)
  })
})

describe('沙箱 API 的转发与拒绝', () => {
  it('有写权限时四个写方法转发到对应 RPC', async () => {
    writePlugin({
      permissions: ['aria2:write', 'notify'],
      code: [
        'module.exports = { onActivate() {',
        '  aria2.addUri(["https://example.com/a.zip"], {})',
        '  aria2.pause("g1")',
        '  aria2.unpause("g1")',
        '  aria2.remove("g1")',
        '  notify.send("done", "ok")',
        '} }'
      ].join('\n')
    })

    const { store } = makeStore()
    const manager = new PluginManager(store)
    manager.loadAll()
    await flush()

    expect(holder.rpcCalls.map(call => call.method)).toEqual([
      'aria2.addUri', 'aria2.pause', 'aria2.unpause', 'aria2.remove'
    ])
    expect(holder.notifications).toHaveLength(1)
  })

  it('有读权限时 getGlobalStat 与 getActiveTasks 都转发', async () => {
    writePlugin({
      permissions: ['aria2:read', 'notify'],
      code: [
        'module.exports = { onActivate() {',
        '  aria2.getGlobalStat()',
        '  aria2.getActiveTasks()',
        '  notify.send("done", "ok")',
        '} }'
      ].join('\n')
    })

    const { store } = makeStore()
    const manager = new PluginManager(store)
    manager.loadAll()
    await flush()

    expect(holder.rpcCalls.map(call => call.method)).toEqual(['aria2.getGlobalStat', 'aria2.tellActive'])
  })

  it('没有读权限时四个读方法都被拒绝', async () => {
    writePlugin({
      permissions: ['notify'],
      code: [
        'var rejected = []',
        'function fail(error) { rejected.push(String(error.message)) }',
        'module.exports = { onActivate() {',
        '  return Promise.all([',
        '    aria2.getGlobalStat().catch(fail),',
        '    aria2.getActiveTasks().catch(fail),',
        '    aria2.getWaitingTasks().catch(fail),',
        '    aria2.getStoppedTasks().catch(fail)',
        '  ]).then(function () { notify.send("rejected", rejected.join("|")) })',
        '} }'
      ].join('\n')
    })

    const { store } = makeStore()
    const manager = new PluginManager(store)
    manager.loadAll()
    await flush()

    expect(holder.rpcCalls).toHaveLength(0)
    const body = String(holder.notifications[0]?.body ?? '')
    expect(body.split('|')).toHaveLength(4)
    expect(body).toContain('Permission denied: aria2:read')
  })

  it('没有写权限时四个写方法都被拒绝', async () => {
    writePlugin({
      permissions: ['notify'],
      code: [
        'var rejected = []',
        'function fail(error) { rejected.push(String(error.message)) }',
        'module.exports = { onActivate() {',
        '  return Promise.all([',
        '    aria2.addUri(["https://example.com/a.zip"], {}).catch(fail),',
        '    aria2.pause("g1").catch(fail),',
        '    aria2.unpause("g1").catch(fail),',
        '    aria2.remove("g1").catch(fail)',
        '  ]).then(function () { notify.send("rejected", rejected.join("|")) })',
        '} }'
      ].join('\n')
    })

    const { store } = makeStore()
    const manager = new PluginManager(store)
    manager.loadAll()
    await flush()

    expect(holder.rpcCalls).toHaveLength(0)
    const body = String(holder.notifications[0]?.body ?? '')
    expect(body.split('|')).toHaveLength(4)
    expect(body).toContain('Permission denied: aria2:write')
  })
})

describe('通知与定时器', () => {
  it('系统不支持通知时 worker 通知被静默丢弃', () => {
    installWorkerProcess()
    writePlugin({ permissions: ['notify'], code: 'module.exports = {}' })
    const { store } = makeStore()
    const manager = new PluginManager(store)
    manager.loadAll()
    const worker = holder.workers[0] as FakeWorker
    worker.emit('spawn')
    worker.emit('message', { type: 'loaded', ok: true })
    holder.notifySupported = false

    worker.emit('message', { type: 'notify', title: '标题', body: '正文' })

    expect(holder.notifications).toHaveLength(0)
  })

  it('vm 里系统不支持通知时记录警告', async () => {
    holder.notifySupported = false
    writePlugin({
      permissions: ['notify'],
      code: 'module.exports = { onActivate() { notify.send("t", "b") } }'
    })

    const { store } = makeStore()
    const manager = new PluginManager(store)
    manager.loadAll()
    await flush()

    expect(holder.notifications).toHaveLength(0)
    expect(logText('warn')).toContain('系统不支持通知，已忽略')
  })

  it('通知后端抛错只记录警告', async () => {
    holder.notifyThrows = true
    writePlugin({
      permissions: ['notify'],
      code: 'module.exports = { onActivate() { notify.send("t", "b") } }'
    })

    const { store } = makeStore()
    const manager = new PluginManager(store)
    expect(() => manager.loadAll()).not.toThrow()
    await flush()

    expect(logText('warn')).toContain('发送通知失败')
  })

  it('插件自己清掉的定时器会从跟踪集合移除', () => {
    writePlugin({
      code: [
        'var t = setTimeout(function () {}, 1000)',
        'clearTimeout(t)',
        'var i = setInterval(function () {}, 1000)',
        'clearInterval(i)',
        'module.exports = {}'
      ].join('\n')
    })

    const { store } = makeStore()
    const manager = new PluginManager(store)
    manager.loadAll()

    const timers = (manager as unknown as { pluginTimers: Map<string, Set<unknown>> }).pluginTimers
    expect(timers.get('demo')?.size).toBe(0)
  })
})

describe('启用、停用与卸载的边界', () => {
  it('启用不存在的插件返回 false', () => {
    const { store } = makeStore()
    const manager = new PluginManager(store)
    expect(manager.enable('nope')).toBe(false)
  })

  it('已运行的插件再次启用直接返回 true 且不重复启动', () => {
    installWorkerProcess()
    writePlugin({ code: 'module.exports = {}' })
    const { store } = makeStore()
    const manager = new PluginManager(store)
    manager.loadAll()
    ;(holder.workers[0] as FakeWorker).emit('spawn')
    ;(holder.workers[0] as FakeWorker).emit('message', { type: 'loaded', ok: true })

    expect(manager.enable('demo')).toBe(true)
    expect(holder.workers).toHaveLength(1)
  })

  it('停用不存在的插件返回 false', () => {
    const { store } = makeStore()
    const manager = new PluginManager(store)
    expect(manager.disable('nope')).toBe(false)
  })

  it('卸载时删除目录失败返回 false 并记录错误', () => {
    writePlugin({ code: 'module.exports = {}' })
    const { store } = makeStore()
    const manager = new PluginManager(store)
    manager.loadAll()
    holder.rmThrowsFor = path.join(userData, 'plugins', 'demo')

    expect(manager.uninstall('demo')).toBe(false)
    expect(logText('error')).toContain('Failed to uninstall plugin')
  })
})

describe('事件分发与关闭', () => {
  it('未启用的插件不接收事件', async () => {
    writePlugin({
      permissions: ['notify'],
      code: 'module.exports = { onDownloadComplete(data) { notify.send("event", data.gid) } }'
    })
    const { store } = makeStore()
    const manager = new PluginManager(store)
    manager.loadAll()
    managed(manager).enabled = false

    manager.emit('downloadComplete', { gid: 'g1', name: 'a.zip' })
    await flush()

    expect(holder.notifications).toHaveLength(0)
  })

  it('worker 未就绪时不下发事件', () => {
    installWorkerProcess()
    writePlugin({ code: 'module.exports = {}' })
    const { store } = makeStore()
    const manager = new PluginManager(store)
    manager.loadAll()
    const worker = holder.workers[0] as FakeWorker
    worker.emit('spawn')

    manager.emit('downloadComplete', { gid: 'g1', name: 'a.zip' })

    expect(worker.sentOfType('event')).toHaveLength(0)
  })

  it('关闭时停掉 worker 并清空插件列表', async () => {
    installWorkerProcess()
    writePlugin({ code: 'module.exports = {}' })
    const { store } = makeStore()
    const manager = new PluginManager(store)
    manager.loadAll()
    const worker = holder.workers[0] as FakeWorker
    worker.emit('spawn')
    worker.emit('message', { type: 'loaded', ok: true })

    manager.shutdown()

    expect(manager.getPlugins()).toHaveLength(0)
    expect(worker.sentOfType('deactivate')).toHaveLength(1)
  })

  it('关闭时 onDeactivate 抛错只记录日志', () => {
    writePlugin({ code: 'module.exports = { onDeactivate() { throw new Error("teardown boom") } }' })
    const { store } = makeStore()
    const manager = new PluginManager(store)
    manager.loadAll()

    expect(() => manager.shutdown()).not.toThrow()
    expect(logText('error')).toContain('onDeactivate error')
    expect(manager.getPlugins()).toHaveLength(0)
  })
})

describe('从注册表安装的参数与落盘校验', () => {
  const CODE = Buffer.from('module.exports = { onActivate() {} }\n', 'utf8')
  const SHA = crypto.createHash('sha256').update(CODE).digest('hex')

  function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: 'market-demo',
      name: 'Market Demo',
      version: '2.0.0',
      entryUrl: 'https://example.com/market-demo.js',
      sha256: SHA,
      main: 'index.js',
      permissions: [],
      ...overrides
    }
  }

  function stubFetch(impl: () => Promise<Response>): void {
    vi.stubGlobal('fetch', vi.fn(impl))
  }

  function okResponse(body: Buffer = CODE, headers: Record<string, string> = {}): Response {
    return new Response(new Uint8Array(body), { status: 200, headers })
  }

  it('非法条目与非法 id 被拒绝', async () => {
    const { store } = makeStore()
    const manager = new PluginManager(store)

    await expect(manager.installFromRegistry(null as never)).resolves.toEqual({ success: false, error: 'INVALID_ENTRY' })
    await expect(manager.installFromRegistry(entry({ id: '../evil' }) as never)).resolves.toEqual({ success: false, error: 'INVALID_ID' })
  })

  it('已安装且未指定升级时拒绝', async () => {
    realFs.mkdirSync(path.join(userData, 'plugins', 'market-demo'), { recursive: true })
    const { store } = makeStore()
    const manager = new PluginManager(store)

    const result = await manager.installFromRegistry(entry() as never)
    expect(result).toEqual({ success: false, error: 'ALREADY_INSTALLED' })
  })

  it('入口地址不是 https 时拒绝', async () => {
    const { store } = makeStore()
    const manager = new PluginManager(store)
    const result = await manager.installFromRegistry(entry({ entryUrl: 'http://example.com/a.js' }) as never)
    expect(result).toEqual({ success: false, error: 'INVALID_URL' })
  })

  it('校验和格式非法时拒绝', async () => {
    const { store } = makeStore()
    const manager = new PluginManager(store)
    const result = await manager.installFromRegistry(entry({ sha256: 'not-a-sha' }) as never)
    expect(result).toEqual({ success: false, error: 'MISSING_CHECKSUM' })
  })

  it('HTTP 非 2xx 时带回状态码', async () => {
    stubFetch(async () => new Response('nope', { status: 500 }))
    const { store } = makeStore()
    const manager = new PluginManager(store)
    const result = await manager.installFromRegistry(entry() as never)
    expect(result).toEqual({ success: false, error: 'HTTP_500' })
  })

  it('响应头声明体积过大时拒绝且不读正文', async () => {
    stubFetch(async () => okResponse(CODE, { 'content-length': String(3 * 1024 * 1024) }))
    const { store } = makeStore()
    const manager = new PluginManager(store)
    const result = await manager.installFromRegistry(entry() as never)
    expect(result).toEqual({ success: false, error: 'TOO_LARGE' })
  })

  it('空响应体按非法大小拒绝', async () => {
    stubFetch(async () => okResponse(Buffer.alloc(0)))
    const { store } = makeStore()
    const manager = new PluginManager(store)
    const result = await manager.installFromRegistry(entry() as never)
    expect(result).toEqual({ success: false, error: 'INVALID_SIZE' })
  })

  it('校验和不匹配时拒绝', async () => {
    stubFetch(async () => okResponse(Buffer.from('other code', 'utf8')))
    const { store } = makeStore()
    const manager = new PluginManager(store)
    const result = await manager.installFromRegistry(entry() as never)
    expect(result).toEqual({ success: false, error: 'CHECKSUM_MISMATCH' })
  })

  it('开发者模式下签名无效的包被放行并带警告', async () => {
    stubFetch(async () => okResponse())
    const { store } = makeStore()
    const manager = new PluginManager(store)
    const result = await manager.installFromRegistry(
      entry({ signature: Buffer.from('bogus').toString('base64') }) as never,
      [],
      { developerMode: true }
    )
    expect(result.success).toBe(true)
    expect(result.warning).toBe('SIGNATURE_INVALID_DEVELOPER_MODE')
    expect(logText('warn')).toContain('允许安装签名无效的插件')
  })

  it('入口文件名非法时拒绝', async () => {
    stubFetch(async () => okResponse())
    const { store } = makeStore()
    const manager = new PluginManager(store)
    const result = await manager.installFromRegistry(entry({ main: 'evil.exe' }) as never, [], { developerMode: true })
    expect(result).toEqual({ success: false, error: 'INVALID_MAIN' })
  })

  it('安装成功后默认停用并写入市场元数据', async () => {
    stubFetch(async () => okResponse())
    const { store, data } = makeStore()
    const manager = new PluginManager(store)
    const result = await manager.installFromRegistry(entry() as never, [], { developerMode: true })

    expect(result.success).toBe(true)
    expect(result.warning).toBe('UNSIGNED_DEVELOPER_MODE')
    const target = path.join(userData, 'plugins', 'market-demo')
    expect(realFs.existsSync(path.join(target, 'index.js'))).toBe(true)
    const market = JSON.parse(realFs.readFileSync(path.join(target, '.market.json'), 'utf8')) as Record<string, unknown>
    expect(market.sha256).toBe(SHA)
    expect(data.get('disabledPlugins')).toEqual(['market-demo'])
    expect(manager.getPlugins().find(item => item.manifest.id === 'market-demo')?.enabled).toBe(false)
  })

  it('升级时无法移走旧目录返回 UPGRADE_FAILED', async () => {
    stubFetch(async () => okResponse())
    const { store } = makeStore()
    const manager = new PluginManager(store)
    await manager.installFromRegistry(entry() as never, [], { developerMode: true })

    holder.failRenameTo = ['.bak-']
    const result = await manager.installFromRegistry(entry({ version: '2.1.0' }) as never, [], {
      developerMode: true, upgrade: true
    })

    expect(result).toEqual({ success: false, error: 'UPGRADE_FAILED' })
    expect(logText('error')).toContain('无法移走旧插件目录')
  })

  it('升级写入失败时回滚，回滚也失败只记录错误', async () => {
    stubFetch(async () => okResponse())
    const { store } = makeStore()
    const manager = new PluginManager(store)
    await manager.installFromRegistry(entry() as never, [], { developerMode: true })

    holder.failRenameFrom = ['.tmp-', '.bak-']
    const result = await manager.installFromRegistry(entry({ version: '2.1.0' }) as never, [], {
      developerMode: true, upgrade: true
    })

    expect(result).toEqual({ success: false, error: 'UPGRADE_FAILED' })
    expect(logText('error')).toContain('正在回滚')
    expect(logText('error')).toContain('回滚失败')
  })

  it('全新安装落盘失败返回 INSTALL_FAILED', async () => {
    stubFetch(async () => okResponse())
    const { store } = makeStore()
    const manager = new PluginManager(store)
    holder.failRenameFrom = ['.tmp-']

    const result = await manager.installFromRegistry(entry() as never, [], { developerMode: true })

    expect(result).toEqual({ success: false, error: 'INSTALL_FAILED' })
    expect(logText('error')).toContain('无法落盘插件目录')
  })

  it('网络异常时把原始错误带回调用方', async () => {
    stubFetch(async () => { throw new Error('network down') })
    const { store } = makeStore()
    const manager = new PluginManager(store)

    const result = await manager.installFromRegistry(entry() as never, [], { developerMode: true })

    expect(result).toEqual({ success: false, error: 'network down' })
    expect(logText('error')).toContain('installFromRegistry failed')
  })

  it('签名解出来是空字节时按签名无效拒绝', async () => {
    stubFetch(async () => okResponse())
    const { store } = makeStore()
    const manager = new PluginManager(store)

    const result = await manager.installFromRegistry(entry({ signature: '!!!' }) as never)

    expect(result).toEqual({ success: false, error: 'SIGNATURE_INVALID' })
  })

  it('拉取入口超过 20 秒就中止请求并把错误带回调用方', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_url: string, init: { signal?: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('This operation was aborted')))
      })))
    const { store } = makeStore()
    const manager = new PluginManager(store)

    const pending = manager.installFromRegistry(entry() as never, [], { developerMode: true })
    await vi.advanceTimersByTimeAsync(20_000)

    await expect(pending).resolves.toEqual({ success: false, error: 'This operation was aborted' })
  })

  it('升级已启用的插件后仍然保持启用', async () => {
    stubFetch(async () => okResponse())
    const { store, data } = makeStore()
    const manager = new PluginManager(store)
    await manager.installFromRegistry(entry() as never, [], { developerMode: true })
    expect(manager.enable('market-demo')).toBe(true)

    const upgraded = await manager.installFromRegistry(entry({ version: '2.1.0' }) as never, [], {
      developerMode: true, upgrade: true
    })

    expect(upgraded.success).toBe(true)
    expect(manager.getPlugins().find(item => item.manifest.id === 'market-demo')?.enabled).toBe(true)
    expect((data.get('disabledPlugins') as string[] | undefined) ?? []).not.toContain('market-demo')
  })
})

describe('运行时残留分支', () => {
  it('公钥解析失败与算法不匹配都判签名无效', () => {
    expect(verifyRegistrySignature({ signature: 'c2ln' }, 'not-a-pem')).toBe(false)
    const { publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    })
    expect(verifyRegistrySignature({ signature: 'c2ln' }, publicKey)).toBe(false)
  })

  it('激活不存在的插件时直接返回', () => {
    const manager = new PluginManager(makeStore().store)
    const api = manager as unknown as { activatePlugin: (pluginId: string) => void }
    expect(() => api.activatePlugin('missing')).not.toThrow()
  })

  it('旧代次 worker 的 spawn 事件不再下发插件代码', () => {
    installWorkerProcess()
    writePlugin({ code: 'module.exports = {}' })
    const manager = new PluginManager(makeStore().store)
    manager.loadAll()
    const worker = holder.workers[0] as FakeWorker
    managed(manager).generation += 1

    worker.emit('spawn')

    expect(worker.sentOfType('load')).toHaveLength(0)
  })

  it('加载成功后超时定时器不再判失败', async () => {
    vi.useFakeTimers()
    installWorkerProcess()
    writePlugin({ code: 'module.exports = {}' })
    const manager = new PluginManager(makeStore().store)
    manager.loadAll()
    const worker = holder.workers[0] as FakeWorker
    worker.emit('spawn')
    worker.emit('message', { type: 'loaded', ok: true })

    await vi.advanceTimersByTimeAsync(10_000)

    expect(managed(manager).status).toBe('running')
    expect(worker.sentOfType('terminate')).toHaveLength(0)
  })

  it('getWaitingTasks 映射到 tellWaiting 且取满 1000 条', async () => {
    installWorkerProcess()
    writePlugin({ permissions: ['aria2:read'], code: 'module.exports = {}' })
    const manager = new PluginManager(makeStore().store)
    manager.loadAll()
    const worker = holder.workers[0] as FakeWorker
    worker.emit('spawn')
    worker.emit('message', { type: 'loaded', ok: true })

    worker.emit('message', { type: 'api', id: 'req-wait', method: 'aria2.getWaitingTasks', args: [] })
    await flush()

    expect(holder.rpcCalls[0]?.method).toBe('aria2.tellWaiting')
    expect(holder.rpcCalls[0]?.params).toEqual([0, 1000])
  })

  it('worker 通知后端抛错只记录警告', () => {
    installWorkerProcess()
    writePlugin({ permissions: ['notify'], code: 'module.exports = {}' })
    const manager = new PluginManager(makeStore().store)
    manager.loadAll()
    const worker = holder.workers[0] as FakeWorker
    worker.emit('spawn')
    worker.emit('message', { type: 'loaded', ok: true })
    holder.notifyThrows = true

    worker.emit('message', { type: 'notify', title: '标题', body: '正文' })

    expect(holder.notifications).toHaveLength(0)
    expect(logText('warn')).toContain('发送通知失败')
  })

  it('终止非当前代次的 worker 时直接忽略', () => {
    installWorkerProcess()
    writePlugin({ code: 'module.exports = {}' })
    const manager = new PluginManager(makeStore().store)
    manager.loadAll()
    const worker = holder.workers[0] as FakeWorker
    const plugin = managed(manager)
    const api = manager as unknown as { terminateWorker: (target: unknown, generation: number) => void }

    api.terminateWorker(plugin, plugin.generation + 5)
    expect(plugin.worker).toBe(worker)

    api.terminateWorker(plugin, plugin.generation)
    expect(plugin.worker).toBeUndefined()

    api.terminateWorker(plugin, plugin.generation)
    expect(worker.sentOfType('terminate')).toHaveLength(1)
  })

  it('vm 里 getStoppedTasks 也取满 1000 条', async () => {
    writePlugin({
      permissions: ['aria2:read'],
      code: 'module.exports = { onActivate() { aria2.getStoppedTasks() } }'
    })
    const manager = new PluginManager(makeStore().store)
    manager.loadAll()

    await flush()

    expect(holder.rpcCalls[0]?.method).toBe('aria2.tellStopped')
    expect(holder.rpcCalls[0]?.params).toEqual([0, 1000])
  })

  it('私有 RPC 包装把参数原样转给模块级调用', async () => {
    const manager = new PluginManager(makeStore().store)
    const api = manager as unknown as {
      callAria2Rpc: (port: number, secret: string, method: string) => Promise<unknown>
    }

    await expect(api.callAria2Rpc(6800, 'sec', 'aria2.getVersion')).resolves.toBe('rpc-ok')
    expect(holder.rpcCalls[0]).toEqual({ port: 6800, secret: 'sec', method: 'aria2.getVersion', params: [] })
  })

  it('vm 停用时 onDeactivate 异步拒绝只记录日志', async () => {
    writePlugin({
      code: 'module.exports = { onDeactivate() { return Promise.reject(new Error("async teardown boom")) } }'
    })
    const manager = new PluginManager(makeStore().store)
    manager.loadAll()

    expect(manager.disable('demo')).toBe(true)
    await flush()

    expect(logText('error')).toContain('onDeactivate error')
  })

  it('实例缺失或没有对应钩子时事件被跳过', () => {
    writePlugin({ code: 'module.exports = {}' })
    const manager = new PluginManager(makeStore().store)
    manager.loadAll()
    const plugin = managed(manager)

    plugin.instance = null
    expect(() => manager.emit('downloadComplete', { gid: 'g1', name: 'a.zip' })).not.toThrow()
    plugin.instance = {}
    expect(() => manager.emit('downloadComplete', { gid: 'g1', name: 'a.zip' })).not.toThrow()
  })

  it('关闭时跳过未启用的插件并清掉遗留定时器', () => {
    writePlugin({ code: 'setTimeout(function () {}, 60000)\nmodule.exports = {}' })
    const manager = new PluginManager(makeStore().store)
    manager.loadAll()
    const timers = (manager as unknown as { pluginTimers: Map<string, Set<unknown>> }).pluginTimers
    expect(timers.get('demo')?.size).toBe(1)

    managed(manager).enabled = false
    expect(() => manager.shutdown()).not.toThrow()

    expect(timers.size).toBe(0)
  })
})
