import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import os from 'node:os'
import path from 'node:path'

/**
 * 插件宿主的安全与生命周期不变式（D-04 / D-05 / D-16）。
 *
 * 这些用例直接驱动"主进程 ↔ utilityProcess"的消息路径，因为最危险的两个缺口
 * 恰好只存在于生产路径上：
 *
 * 1. worker 侧 settings.get / notify 不经过 vm 沙箱的权限裁剪——若主进程不校验，
 *    权限系统在生产环境等于不存在；
 * 2. 旧 worker 的 exit 事件会把新 worker 的引用清空，插件变成既无进程也不重启的僵尸。
 */

const realFs = await vi.importActual<typeof import('node:fs')>('node:fs')

class FakeWorker {
  messages: unknown[] = []
  killed = false
  private listeners = new Map<string, Array<(...args: unknown[]) => void>>()

  postMessage(message: unknown): void {
    this.messages.push(message)
  }

  on(event: string, listener: (...args: unknown[]) => void): void {
    const list = this.listeners.get(event) ?? []
    list.push(listener)
    this.listeners.set(event, list)
  }

  kill(): boolean {
    this.killed = true
    return true
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args)
  }

  sentOfType(type: string): Array<Record<string, unknown>> {
    return this.messages.filter((item): item is Record<string, unknown> =>
      !!item && typeof item === 'object' && (item as { type?: string }).type === type)
  }
}

const holder = vi.hoisted(() => ({
  userData: '',
  appPath: '',
  notifySupported: false,
  notifications: [] as Array<{ title?: string; body?: string }>,
  workers: [] as unknown[],
  settings: {} as Record<string, unknown>
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
    private readonly options: { title?: string; body?: string }
    constructor(options: { title?: string; body?: string }) {
      this.options = options
      holder.notifications.push(options)
    }
    show(): void {
      void this.options
    }
  },
  get utilityProcess() {
    return {
      get fork() {
        return () => {
          const worker = new FakeWorker()
          holder.workers.push(worker)
          return worker
        }
      }
    }
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

vi.mock('../utils/aria2Rpc', () => ({ callAria2Rpc: vi.fn() }))
vi.mock('../utils/settingsAccessor', () => ({
  getSettingsFresh: vi.fn(() => holder.settings)
}))
vi.mock('../utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
}))

// 单测里 __dirname 指向 electron/services，编译产物 pluginHost.js 并不存在；
// 若不做这层替换，activateWithWorker 会静默回退到 vm，本文件就测不到生产路径。
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

interface ManagedLike {
  worker?: FakeWorker
  generation: number
  status: string
  enabled: boolean
}

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

function writePlugin(userData: string, permissions: string[]): void {
  const dir = path.join(userData, 'plugins', 'demo')
  realFs.mkdirSync(dir, { recursive: true })
  realFs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    id: 'demo',
    name: 'Demo',
    version: '1.0.0',
    main: 'index.js',
    permissions
  }), 'utf8')
  realFs.writeFileSync(path.join(dir, 'index.js'), 'module.exports = { onActivate() {} }\n', 'utf8')
}

let userData: string
let builtinRoot: string

beforeEach(() => {
  userData = realFs.mkdtempSync(path.join(os.tmpdir(), 'plugin-security-test-'))
  builtinRoot = realFs.mkdtempSync(path.join(os.tmpdir(), 'plugin-security-builtin-'))
  holder.userData = userData
  holder.appPath = builtinRoot
  holder.notifySupported = false
  holder.notifications = []
  holder.workers = []
  holder.settings = {
    aria2: { port: 6800, secret: 'rpc-secret' },
    webConsole: {
      enabled: true,
      port: 6801,
      token: 'console-admin-token',
      tokens: [{ name: 'phone', token: 'phone-token' }]
    },
    connectionProfiles: [{ id: 'default', config: { host: 'localhost', port: 6800, secret: 'profile-secret' } }]
  }
})

afterEach(() => {
  realFs.rmSync(userData, { recursive: true, force: true })
  realFs.rmSync(builtinRoot, { recursive: true, force: true })
  vi.useRealTimers()
})

/** 启动管理器并把第一个 worker 推进到"已加载"状态 */
function bootManager(permissions: string[]): { manager: PluginManager; worker: FakeWorker } {
  writePlugin(userData, permissions)
  const manager = new PluginManager(makeStore())
  manager.loadAll()
  const worker = holder.workers[0] as FakeWorker
  expect(worker).toBeDefined()
  worker.emit('spawn')
  worker.emit('message', { type: 'loaded', ok: true })
  return { manager, worker }
}

function managed(manager: PluginManager): ManagedLike {
  const plugin = (manager as unknown as { plugins: Map<string, ManagedLike> }).plugins.get('demo')
  expect(plugin).toBeDefined()
  return plugin as ManagedLike
}

describe('settings.get 脱敏与白名单（D-05）', () => {
  it('webConsole 的 token 与 tokens[].token 不会进入插件', () => {
    const { worker } = bootManager(['settings:read'])

    worker.emit('message', { type: 'api', id: 1, method: 'settings.get', args: ['webConsole'] })

    const [response] = worker.sentOfType('api-response')
    expect(response?.ok).toBe(true)
    const value = response?.value as { token?: string; tokens?: Array<{ token?: string }>; port?: number }
    expect(value.token).toBeUndefined()
    expect(value.port).toBe(6801)
    expect(value.tokens?.[0]?.token).toBeUndefined()
    expect(JSON.stringify(response)).not.toContain('console-admin-token')
    expect(JSON.stringify(response)).not.toContain('phone-token')
  })

  it('不在白名单的键（连接预设）返回 undefined，插件读不到主机信息', () => {
    const { manager, worker } = bootManager(['settings:read'])
    void manager

    worker.emit('message', { type: 'api', id: 2, method: 'settings.get', args: ['connectionProfiles'] })

    const [response] = worker.sentOfType('api-response')
    expect(response?.ok).toBe(true)
    expect(response?.value).toBeUndefined()
    expect(JSON.stringify(response)).not.toContain('localhost')
  })

  it('未声明 settings:read 权限时直接拒绝', () => {
    const { worker } = bootManager([])

    worker.emit('message', { type: 'api', id: 3, method: 'settings.get', args: ['webConsole'] })

    const [response] = worker.sentOfType('api-response')
    expect(response?.ok).toBe(false)
    expect(String(response?.error)).toContain('settings:read')
  })
})

describe('notify 权限校验（D-05）', () => {
  it('未声明 notify 权限的 worker 发通知会被丢弃', () => {
    holder.notifySupported = true
    const { worker } = bootManager([])

    worker.emit('message', { type: 'notify', title: 'hello', body: 'world' })

    expect(holder.notifications).toHaveLength(0)
  })

  it('声明了 notify 权限的 worker 可以正常通知', () => {
    holder.notifySupported = true
    const { worker } = bootManager(['notify'])

    worker.emit('message', { type: 'notify', title: 'hello', body: 'world' })

    expect(holder.notifications).toHaveLength(1)
    expect(holder.notifications[0]?.title).toContain('hello')
  })
})

describe('worker 代次（D-04）', () => {
  it('旧 worker 的 exit 不会清掉新 worker，也不会触发重启', () => {
    const { manager, worker: first } = bootManager([])

    expect(manager.disable('demo')).toBe(true)
    expect(manager.enable('demo')).toBe(true)

    const second = holder.workers[1] as FakeWorker
    expect(second).toBeDefined()
    second.emit('spawn')
    second.emit('message', { type: 'loaded', ok: true })
    expect(managed(manager).status).toBe('running')

    // 旧进程此时才真正退出：这一代早已作废，必须被忽略
    first.emit('exit', 1)

    expect(holder.workers).toHaveLength(2)
    expect(managed(manager).worker).toBe(second)
    expect(managed(manager).status).toBe('running')
    expect(second.killed).toBe(false)

    // 新 worker 仍然可用：再发一次 API 能正常拿到响应
    second.emit('message', { type: 'api', id: 9, method: 'settings.get', args: ['webConsole'] })
    expect(second.sentOfType('api-response')).toHaveLength(1)
  })

  it('worker 报告加载失败时立即终止该进程，不留下空转的 vm 上下文', () => {
    vi.useFakeTimers()
    writePlugin(userData, [])
    const manager = new PluginManager(makeStore())
    manager.loadAll()
    const worker = holder.workers[0] as FakeWorker
    worker.emit('spawn')

    // runInContext 3s 超时后 worker 会回一条 loaded{ok:false}
    worker.emit('message', { type: 'loaded', ok: false, error: 'Script execution timed out after 3000ms' })

    expect(managed(manager).status).toBe('error')
    expect(worker.sentOfType('deactivate')).toHaveLength(1)
    vi.advanceTimersByTime(500)
    expect(worker.killed).toBe(true)
  })

  it('加载超时先请 worker 自行终止，再兜底 kill', () => {
    vi.useFakeTimers()
    writePlugin(userData, [])
    const manager = new PluginManager(makeStore())
    manager.loadAll()
    const worker = holder.workers[0] as FakeWorker
    worker.emit('spawn')

    // 一直不回复 loaded：10s 后必须终止该代次
    vi.advanceTimersByTime(10_000)

    expect(worker.sentOfType('terminate')).toHaveLength(1)
    vi.advanceTimersByTime(300)
    expect(worker.killed).toBe(true)
    expect(managed(manager).status).toBe('error')
    expect(String((managed(manager) as unknown as { error?: string }).error)).toContain('timed out')
  })
})
