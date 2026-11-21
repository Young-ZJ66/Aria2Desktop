import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import os from 'node:os'
import path from 'node:path'

/**
 * 插件运行时的两条路径（vm 沙箱 / utilityProcess）与生命周期。
 *
 * 这里覆盖的是 pluginManager.test.ts（启用状态持久化）、pluginManager.security.test.ts
 * （worker 代次与脱敏）之外的空白：沙箱 API 的权限裁剪是否真的生效、插件注册的定时器
 * 会不会在禁用后继续跑、worker 崩溃的重启配额、以及 emit 的事件分发。
 */

const realFs = await vi.importActual<typeof import('node:fs')>('node:fs')

class FakeWorker {
  messages: Array<Record<string, unknown>> = []
  killed = false
  private listeners = new Map<string, Array<(...args: any[]) => void>>()

  postMessage(message: unknown): void {
    this.messages.push(message as Record<string, unknown>)
  }

  on(event: string, listener: (...args: any[]) => void): void {
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
  settings: {} as Record<string, unknown>,
  notifySupported: true,
  notifications: [] as Array<{ title?: string; body?: string }>,
  workers: [] as unknown[],
  utilityProcess: undefined as unknown,
  rpcCalls: [] as Array<{ method: string; params?: unknown[]; port?: number; secret?: string }>,
  rpcImpl: null as null | ((options: { method: string }) => Promise<unknown>),
  logs: { info: [] as unknown[][], warn: [] as unknown[][], error: [] as unknown[][], debug: [] as unknown[][] }
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => holder.userData,
    getAppPath: () => holder.appPath,
    isPackaged: false
  },
  Notification: class {
    static isSupported(): boolean {
      return holder.notifySupported
    }
    constructor(options: { title?: string; body?: string }) {
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

// 单测里 __dirname 指向 electron/services，编译产物 pluginHost.js 并不存在；
// 若不替换 existsSync，activateWithWorker 会静默回退到 vm，worker 路径就测不到。
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  const nodePath = await import('node:path')
  const actualExists = actual.existsSync as (target: string) => boolean
  return {
    ...actual,
    existsSync: (target: string) =>
      typeof target === 'string' && target.endsWith(nodePath.join('workers', 'pluginHost.js'))
        ? true
        : actualExists(target)
  }
})

import { PluginManager } from './pluginManager'

type StoreLike = ConstructorParameters<typeof PluginManager>[0]

function makeStore(): StoreLike {
  return new (class {
    private data = new Map<string, unknown>()
    get(key: string) {
      return this.data.get(key)
    }
    set(key: string, value: unknown) {
      this.data.set(key, value)
    }
  })() as unknown as StoreLike
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

function managed(manager: PluginManager): Record<string, any> {
  const plugin = (manager as unknown as { plugins: Map<string, Record<string, any>> }).plugins.get('demo')
  expect(plugin).toBeDefined()
  return plugin as Record<string, any>
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve()
}

/** 日志断言用原文拼接：JSON.stringify 会把文案里的双引号转义，匹配不上原文 */
function logText(level: 'info' | 'warn' | 'error'): string {
  return holder.logs[level].map(args => args.map(item => String(item)).join(' ')).join('\n')
}

function bootWorker(permissions: string[] = [], code = 'module.exports = { onActivate() {} }'): { manager: PluginManager; worker: FakeWorker } {
  holder.utilityProcess = {
    fork: () => {
      const worker = new FakeWorker()
      holder.workers.push(worker)
      return worker
    }
  }
  writePlugin({ permissions, code })
  const manager = new PluginManager(makeStore())
  manager.loadAll()
  const worker = holder.workers[0] as FakeWorker
  expect(worker).toBeDefined()
  worker.emit('spawn')
  worker.emit('message', { type: 'loaded', ok: true })
  return { manager, worker }
}

let userData: string
let builtinRoot: string

beforeEach(() => {
  userData = realFs.mkdtempSync(path.join(os.tmpdir(), 'plugin-runtime-test-'))
  builtinRoot = realFs.mkdtempSync(path.join(os.tmpdir(), 'plugin-runtime-builtin-'))
  holder.userData = userData
  holder.appPath = builtinRoot
  holder.settings = {
    aria2: { port: 6800, secret: 'rpc-secret' },
    connectionProfiles: [{ id: 'default', config: { host: 'localhost', port: 6800, secret: 'profile-secret' } }],
    webConsole: { enabled: true, port: 6801, token: 'console-admin-token', tokens: [{ name: 'phone', token: 'phone-token' }] },
    download: { dir: 'E:/downloads' }
  }
  holder.notifySupported = true
  holder.notifications = []
  holder.workers = []
  holder.utilityProcess = undefined
  holder.rpcCalls = []
  holder.rpcImpl = null
  holder.logs = { info: [], warn: [], error: [], debug: [] }
})

afterEach(() => {
  realFs.rmSync(userData, { recursive: true, force: true })
  realFs.rmSync(builtinRoot, { recursive: true, force: true })
  vi.useRealTimers()
})

describe('插件目录与加载', () => {
  it('getPluginDir 返回用户目录下的 plugins', () => {
    const manager = new PluginManager(makeStore())
    expect(manager.getPluginDir()).toBe(path.join(userData, 'plugins'))
  })

  it('只有 package.json 没有 manifest.json 时按 package.json 注册', () => {
    const dir = path.join(userData, 'plugins', 'pkg-only')
    realFs.mkdirSync(dir, { recursive: true })
    realFs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
      id: 'pkg-only', name: 'Pkg Only', version: '2.0.0', main: 'index.js', permissions: []
    }), 'utf8')
    realFs.writeFileSync(path.join(dir, 'index.js'), 'module.exports = { onActivate() {} }', 'utf8')

    const manager = new PluginManager(makeStore())
    manager.loadAll()

    const info = manager.getPlugins().find(item => item.manifest.id === 'pkg-only')
    expect(info?.manifest.version).toBe('2.0.0')
    expect(info?.status).toBe('running')
  })

  it('manifest 缺字段时跳过该插件，不影响其它插件加载', () => {
    writePlugin({ dir: 'broken', rawManifest: JSON.stringify({ id: 'broken', version: '1.0.0' }) })
    writePlugin({ code: 'module.exports = { onActivate() {} }' })

    const manager = new PluginManager(makeStore())
    manager.loadAll()

    expect(manager.getPlugins().map(item => item.manifest.id)).toEqual(['demo'])
    expect(JSON.stringify(holder.logs.warn)).toContain('Failed to load plugin')
  })

  it('重复 id 的插件被拒绝注册', () => {
    writePlugin({ dir: 'first', code: 'module.exports = {}' })
    writePlugin({ dir: 'second', code: 'module.exports = {}' })

    const manager = new PluginManager(makeStore())
    manager.loadAll()

    expect(manager.getPlugins()).toHaveLength(1)
    expect(JSON.stringify(holder.logs.warn)).toContain('Failed to load plugin')
  })
})

describe('vm 沙箱的权限裁剪', () => {
  it('未声明 aria2:read 时读取任务列表被拒绝', async () => {
    writePlugin({
      permissions: ['notify'],
      code: [
        'module.exports = { onActivate() {',
        '  aria2.getActiveTasks().then(',
        '    function () { notify.send("ok", "allowed") },',
        '    function (error) { notify.send("denied", String(error.message)) }',
        '  )',
        '} }'
      ].join('\n')
    })

    const manager = new PluginManager(makeStore())
    manager.loadAll()
    await flush()

    expect(holder.rpcCalls).toHaveLength(0)
    expect(holder.notifications).toHaveLength(1)
    expect(holder.notifications[0]?.body).toContain('Permission denied: aria2:read')
  })

  it('有 aria2:read 时按白名单方法名转发 RPC，等待任务取满 1000 条', async () => {
    writePlugin({
      permissions: ['aria2:read', 'notify'],
      code: [
        'module.exports = { onActivate() {',
        '  aria2.getWaitingTasks().then(function () { notify.send("done", "ok") })',
        '} }'
      ].join('\n')
    })

    const manager = new PluginManager(makeStore())
    manager.loadAll()
    await flush()

    expect(holder.rpcCalls).toHaveLength(1)
    expect(holder.rpcCalls[0]?.method).toBe('aria2.tellWaiting')
    expect(holder.rpcCalls[0]?.params).toEqual([0, 1000])
  })

  it('未声明 aria2:write 时提交任务被拒绝', async () => {
    writePlugin({
      permissions: ['aria2:read', 'notify'],
      code: [
        'module.exports = { onActivate() {',
        '  aria2.addUri(["https://example.com/a.zip"]).then(',
        '    function () { notify.send("ok", "allowed") },',
        '    function (error) { notify.send("denied", String(error.message)) }',
        '  )',
        '} }'
      ].join('\n')
    })

    const manager = new PluginManager(makeStore())
    manager.loadAll()
    await flush()

    expect(holder.notifications[0]?.body).toContain('Permission denied: aria2:write')
  })

  it('未声明 settings:read 时读设置被拒绝', async () => {
    writePlugin({
      permissions: ['notify'],
      code: [
        'module.exports = { onActivate() {',
        '  try { settings.get("download") } catch (error) { notify.send("denied", String(error.message)) }',
        '} }'
      ].join('\n')
    })

    const manager = new PluginManager(makeStore())
    manager.loadAll()
    await flush()

    expect(holder.notifications[0]?.body).toContain('Permission denied: settings:read')
  })

  it('有 settings:read 时只放行白名单键，且密钥字段被剔除', async () => {
    writePlugin({
      permissions: ['settings:read', 'notify'],
      code: [
        'module.exports = { onActivate() {',
        '  var consoleSettings = settings.get("webConsole")',
        '  var profiles = settings.get("connectionProfiles")',
        '  var download = settings.get("download")',
        '  notify.send("snapshot", JSON.stringify({ consoleSettings: consoleSettings, profiles: profiles, download: download }))',
        '} }'
      ].join('\n')
    })

    const manager = new PluginManager(makeStore())
    manager.loadAll()
    await flush()

    const body = String(holder.notifications[0]?.body)
    // webConsole 在白名单内：放行，但 token / tokens[].token 必须已被剔除
    expect(body).toContain('6801')
    expect(body).not.toContain('console-admin-token')
    expect(body).not.toContain('phone-token')
    // connectionProfiles 不在白名单内：整键拒绝，主机信息进不了插件
    expect(body).not.toContain('localhost')
    expect(body).not.toContain('"profiles":{')
    // download 在白名单内：原样可读
    expect(body).toContain('E:/downloads')
  })

  it('未声明 notify 时发送通知被拒绝，且不会弹出系统通知', async () => {
    writePlugin({
      code: [
        'module.exports = { onActivate() {',
        '  try { notify.send("title", "body") } catch (error) { console.error("blocked", String(error.message)) }',
        '} }'
      ].join('\n')
    })

    const manager = new PluginManager(makeStore())
    manager.loadAll()
    await flush()

    expect(holder.notifications).toHaveLength(0)
    const errors = JSON.stringify(holder.logs.error)
    expect(errors).toContain('blocked')
    expect(errors).toContain('Permission denied: notify')
  })

  it('有 notify 权限时弹通知，标题带插件名前缀且超长被截断', async () => {
    const longTitle = 'x'.repeat(400)
    const longBody = 'y'.repeat(900)
    writePlugin({
      permissions: ['notify'],
      code: 'module.exports = { onActivate() { notify.send("' + longTitle + '", "' + longBody + '") } }'
    })

    const manager = new PluginManager(makeStore())
    manager.loadAll()
    await flush()

    const notification = holder.notifications[0]
    expect(notification?.title?.startsWith('[Demo] ')).toBe(true)
    expect(String(notification?.title).length).toBeLessThanOrEqual(120)
    expect(String(notification?.body).length).toBe(500)
  })

  it('插件内的 console 输出带上插件 id 前缀', async () => {
    writePlugin({
      code: 'module.exports = { onActivate() { console.log("hello"); console.warn("careful"); console.error("bad") } }'
    })

    const manager = new PluginManager(makeStore())
    manager.loadAll()
    await flush()

    expect(JSON.stringify(holder.logs.info)).toContain('[Plugin:demo]')
    expect(JSON.stringify(holder.logs.info)).toContain('hello')
    expect(JSON.stringify(holder.logs.warn)).toContain('careful')
    expect(JSON.stringify(holder.logs.error)).toContain('bad')
  })
})

describe('插件定时器与关闭', () => {
  it('禁用插件后它注册的定时器不再触发', async () => {
    vi.useFakeTimers()
    writePlugin({
      permissions: ['notify'],
      code: 'module.exports = { onActivate() { setInterval(function () { notify.send("tick", "1") }, 1000) } }'
    })

    const manager = new PluginManager(makeStore())
    manager.loadAll()
    await flush()
    vi.advanceTimersByTime(1000)
    expect(holder.notifications).toHaveLength(1)

    expect(manager.disable('demo')).toBe(true)
    vi.advanceTimersByTime(5000)
    expect(holder.notifications).toHaveLength(1)
  })

  it('重复激活不会叠加定时器', async () => {
    vi.useFakeTimers()
    writePlugin({
      permissions: ['notify'],
      code: 'module.exports = { onActivate() { setInterval(function () { notify.send("tick", "1") }, 1000) } }'
    })

    const manager = new PluginManager(makeStore())
    manager.loadAll()
    await flush()
    ;(manager as unknown as { activatePlugin: (id: string) => void }).activatePlugin('demo')
    await flush()

    vi.advanceTimersByTime(1000)
    expect(holder.notifications).toHaveLength(1)
  })

  it('shutdown 调用 onDeactivate 并清空插件表', async () => {
    writePlugin({
      permissions: ['notify'],
      code: 'module.exports = { onDeactivate() { notify.send("bye", "bye") } }'
    })

    const manager = new PluginManager(makeStore())
    manager.loadAll()
    manager.shutdown()
    await flush()

    expect(holder.notifications).toHaveLength(1)
    expect(holder.notifications[0]?.body).toBe('bye')
    expect(manager.getPlugins()).toEqual([])
  })
})

describe('worker 消息分发与 API 白名单', () => {
  it('loaded 成功后状态变为 running 且允许接收事件', () => {
    const { manager } = bootWorker()
    expect(managed(manager).status).toBe('running')
    expect(managed(manager).workerReady).toBe(true)
  })

  it('API 方法映射成 aria2 真实方法名并回传结果', async () => {
    const { worker } = bootWorker(['aria2:read'])

    worker.emit('message', { type: 'api', id: 1, method: 'aria2.getStoppedTasks', args: [] })
    await flush()

    expect(holder.rpcCalls[0]?.method).toBe('aria2.tellStopped')
    expect(holder.rpcCalls[0]?.params).toEqual([0, 1000])
    const [response] = worker.sentOfType('api-response')
    expect(response?.ok).toBe(true)
    expect(response?.value).toBe('rpc-ok')
  })

  it('未知方法直接拒绝，不会触达 RPC', async () => {
    const { worker } = bootWorker(['aria2:read'])

    worker.emit('message', { type: 'api', id: 2, method: 'aria2.shutdown', args: [] })
    await flush()

    expect(holder.rpcCalls).toHaveLength(0)
    const [response] = worker.sentOfType('api-response')
    expect(response?.ok).toBe(false)
    expect(String(response?.error)).toContain('Unknown plugin API')
  })

  it('缺少权限时按权限名拒绝', async () => {
    const { worker } = bootWorker([])

    worker.emit('message', { type: 'api', id: 3, method: 'aria2.getGlobalStat', args: [] })
    await flush()

    const [response] = worker.sentOfType('api-response')
    expect(String(response?.error)).toContain('Permission denied: aria2:read')
  })

  it('RPC 抛错时把错误文本回给插件并记日志', async () => {
    const { worker } = bootWorker(['aria2:read'])
    holder.rpcImpl = () => Promise.reject(new Error('RPC 挂了'))

    worker.emit('message', { type: 'api', id: 4, method: 'aria2.getGlobalStat', args: [] })
    await flush()

    const [response] = worker.sentOfType('api-response')
    expect(response?.ok).toBe(false)
    expect(String(response?.error)).toContain('RPC 挂了')
    expect(JSON.stringify(holder.logs.warn)).toContain('API aria2.getGlobalStat failed')
  })

  it('log 消息按级别转发，activate-error 与 event-error 写入插件错误', () => {
    const { manager, worker } = bootWorker([])

    worker.emit('message', { type: 'log', level: 'warn', args: ['from plugin'] })
    expect(JSON.stringify(holder.logs.warn)).toContain('from plugin')

    worker.emit('message', { type: 'activate-error', error: 'onActivate 崩了' })
    expect(managed(manager).error).toContain('onActivate 崩了')

    worker.emit('message', { type: 'event-error', error: '事件崩了' })
    expect(managed(manager).error).toContain('事件崩了')
  })

  it('非对象消息被忽略，不抛错', () => {
    const { worker } = bootWorker([])
    expect(() => {
      worker.emit('message', null)
      worker.emit('message', 'plain string')
    }).not.toThrow()
  })
})

describe('worker 崩溃重启配额', () => {
  it('崩溃后按 1s/2s/3s 重启，第 4 次放弃', () => {
    vi.useFakeTimers()
    const { manager } = bootWorker([])

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const current = holder.workers[holder.workers.length - 1] as FakeWorker
      current.emit('exit', 1)
      expect(managed(manager).restarts).toBe(attempt)
      expect(String(managed(manager).error)).toContain('restarting (' + attempt + '/3)')
      vi.advanceTimersByTime(1000 * attempt)
    }

    expect(holder.workers).toHaveLength(4)
    const last = holder.workers[holder.workers.length - 1] as FakeWorker
    last.emit('exit', 2)
    expect(managed(manager).status).toBe('error')
    expect(String(managed(manager).error)).toContain('restart limit reached')
    expect(holder.workers).toHaveLength(4)
  })

  it('已停用的插件进程退出后状态回到 disabled，不重启', () => {
    const { manager, worker } = bootWorker([])
    managed(manager).enabled = false

    worker.emit('exit', 3)

    expect(managed(manager).status).toBe('disabled')
    expect(holder.workers).toHaveLength(1)
  })
})

describe('emit 事件分发', () => {
  it('vm 插件收到下载完成/失败/开始事件', async () => {
    writePlugin({
      permissions: ['notify'],
      code: [
        'module.exports = {',
        '  onDownloadComplete(data) { notify.send("complete", data.name) },',
        '  onDownloadError(data) { notify.send("error", data.name) },',
        '  onDownloadStart(data) { notify.send("start", data.name) }',
        '}'
      ].join('\n')
    })

    const manager = new PluginManager(makeStore())
    manager.loadAll()
    manager.emit('downloadComplete', { gid: 'g1', name: 'a.zip' })
    manager.emit('downloadError', { gid: 'g2', name: 'b.zip' })
    manager.emit('downloadStart', { gid: 'g3', name: 'c.zip' })
    await flush()

    expect(holder.notifications.map(item => item.body)).toEqual(['a.zip', 'b.zip', 'c.zip'])
  })

  it('钩子同步抛错被捕获，不影响其它插件', async () => {
    writePlugin({ dir: 'thrower', id: 'thrower', code: 'module.exports = { onDownloadComplete() { throw new Error("boom") } }' })
    writePlugin({ permissions: ['notify'], code: 'module.exports = { onDownloadComplete(data) { notify.send("ok", data.name) } }' })

    const manager = new PluginManager(makeStore())
    manager.loadAll()
    manager.emit('downloadComplete', { gid: 'g1', name: 'a.zip' })
    await flush()

    expect(holder.notifications).toHaveLength(1)
    expect(logText('error')).toContain('event "downloadComplete" error')
  })

  it('钩子返回 rejected promise 被捕获，不产生未处理拒绝', async () => {
    writePlugin({
      code: 'module.exports = { onDownloadError() { return Promise.reject(new Error("async boom")) } }'
    })

    const manager = new PluginManager(makeStore())
    manager.loadAll()
    manager.emit('downloadError', { gid: 'g1', name: 'a.zip' })
    await flush()

    expect(JSON.stringify(holder.logs.error)).toContain('async error')
  })

  it('worker 插件在 ready 之后才收到事件消息', () => {
    const { manager, worker } = bootWorker([])

    manager.emit('downloadComplete', { gid: 'g1', name: 'a.zip' })
    expect(worker.sentOfType('event')).toHaveLength(1)
    expect(worker.sentOfType('event')[0]?.event).toBe('downloadComplete')

    managed(manager).workerReady = false
    manager.emit('downloadComplete', { gid: 'g2', name: 'b.zip' })
    expect(worker.sentOfType('event')).toHaveLength(1)
  })

  it('worker 事件投递失败只记日志', () => {
    const { manager, worker } = bootWorker([])
    worker.postMessage = () => { throw new Error('port closed') }

    expect(() => manager.emit('downloadComplete', { gid: 'g1', name: 'a.zip' })).not.toThrow()
    expect(JSON.stringify(holder.logs.warn)).toContain('event send failed')
  })
})

describe('停用与卸载的边界', () => {
  it('停用 vm 插件会调用 onDeactivate，抛错只记日志', async () => {
    writePlugin({ code: 'module.exports = { onDeactivate() { throw new Error("deactivate boom") } }' })

    const manager = new PluginManager(makeStore())
    manager.loadAll()
    expect(manager.disable('demo')).toBe(true)
    await flush()

    expect(JSON.stringify(holder.logs.error)).toContain('onDeactivate error')
  })

  it('卸载不存在的插件返回 false', () => {
    const manager = new PluginManager(makeStore())
    expect(manager.uninstall('missing')).toBe(false)
  })

  it('插件路径在插件目录之外时拒绝删除', () => {
    const outside = realFs.mkdtempSync(path.join(os.tmpdir(), 'plugin-outside-'))
    writePlugin({ code: 'module.exports = {}' })

    const manager = new PluginManager(makeStore())
    manager.loadAll()
    managed(manager).path = outside

    expect(manager.uninstall('demo')).toBe(false)
    expect(realFs.existsSync(outside)).toBe(true)
    realFs.rmSync(outside, { recursive: true, force: true })
  })
})
