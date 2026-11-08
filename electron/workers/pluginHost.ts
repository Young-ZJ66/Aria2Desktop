/**
 * 插件宿主进程（utilityProcess）入口。
 *
 * 设计目标：插件代码在独立 OS 进程内执行，主进程只通过消息端口暴露白名单 API。
 * 即使插件死循环、崩溃或利用 vm 逃逸，也只会杀死本进程，不会冻结主进程。
 *
 * 注意：本文件由 electron-builder 作为普通 Node 模块加载，不能依赖 Electron 渲染层 API。
 */
import * as vm from 'node:vm'
import type { PluginManifest } from '../types/plugin'

interface LoadMessage { type: 'load'; pluginId: string; manifest: PluginManifest; code: string }
interface EventMessage { type: 'event'; event: 'downloadStart' | 'downloadComplete' | 'downloadError'; data: { gid: string; name: string } }
interface DeactivateMessage { type: 'deactivate' }

type Incoming = LoadMessage | EventMessage | DeactivateMessage | { type: 'api-response'; id: number; ok: boolean; value?: unknown; error?: string }
type Outgoing =
  | { type: 'ready' }
  | { type: 'loaded'; ok: boolean; error?: string }
  | { type: 'api'; id: number; method: string; args: unknown[] }
  | { type: 'notify'; title: string; body: string }
  | { type: 'log'; level: 'log' | 'warn' | 'error'; args: unknown[] }
  | { type: 'activate-error'; error: string }
  | { type: 'event-error'; error: string }
  | { type: 'deactivated' }

const parentPort = (process as unknown as { parentPort: { postMessage: (message: Outgoing) => void; on: (event: 'message', listener: (event: { data: Incoming }) => void) => void } }).parentPort

let instance: Record<string, unknown> = {}
let nextRequestId = 1
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()

function send(message: Outgoing): void {
  parentPort.postMessage(message)
}

function callApi(method: string, ...args: unknown[]): Promise<unknown> {
  const id = nextRequestId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    send({ type: 'api', id, method, args })
  })
}

function serializeError(error: unknown): string {
  if (error instanceof Error) return error.stack || error.message
  return String(error)
}

function createContext(): Record<string, unknown> {
  const log = (level: 'log' | 'warn' | 'error') => (...args: unknown[]) => {
    // 只传可结构化克隆的字符串，避免插件传入函数/循环对象导致 postMessage 抛错
    send({ type: 'log', level, args: args.map(value => {
      try {
        if (typeof value === 'string') return value
        return JSON.stringify(value)
      } catch {
        return String(value)
      }
    }) })
  }
  const aria2 = {
    getGlobalStat: () => callApi('aria2.getGlobalStat'),
    getActiveTasks: () => callApi('aria2.getActiveTasks'),
    getWaitingTasks: () => callApi('aria2.getWaitingTasks'),
    getStoppedTasks: () => callApi('aria2.getStoppedTasks'),
    addUri: (uris: string[], options?: Record<string, string>) => callApi('aria2.addUri', uris, options || {}),
    pause: (gid: string) => callApi('aria2.pause', gid),
    unpause: (gid: string) => callApi('aria2.unpause', gid),
    remove: (gid: string) => callApi('aria2.remove', gid)
  }
  return {
    module: { exports: {} as Record<string, unknown> },
    exports: {} as Record<string, unknown>,
    console: { log: log('log'), warn: log('warn'), error: log('error') },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Date,
    Math,
    JSON,
    Promise,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    TypeError,
    RangeError,
    URIError,
    SyntaxError,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    aria2,
    settings: { get: (key: string) => callApi('settings.get', key) },
    notify: { send: (title: string, body: string) => send({ type: 'notify', title: String(title ?? ''), body: String(body ?? '') }) }
  }
}

function loadPlugin(message: LoadMessage): void {
  try {
    const sandbox = createContext()
    const context = vm.createContext(sandbox)
    const script = new vm.Script(message.code, { filename: `plugin:${message.manifest.id}` })
    script.runInContext(context, { timeout: 3000, breakOnSigint: true })
    const exported = (sandbox.module as { exports: unknown }).exports || sandbox.exports
    instance = (exported && typeof exported === 'object') ? exported as Record<string, unknown> : {}
    send({ type: 'loaded', ok: true })
    const activate = instance.onActivate
    if (typeof activate === 'function') {
      Promise.resolve(activate()).catch(error => send({ type: 'activate-error', error: serializeError(error) }))
    }
  } catch (error) {
    instance = {}
    send({ type: 'loaded', ok: false, error: serializeError(error) })
  }
}

function handleEvent(event: 'downloadStart' | 'downloadComplete' | 'downloadError', data: { gid: string; name: string }): void {
  const handler = event === 'downloadComplete'
    ? instance.onDownloadComplete
    : event === 'downloadError'
      ? instance.onDownloadError
      : instance.onDownloadStart
  if (typeof handler !== 'function') return
  try {
    const result = handler(data)
    if (result && typeof (result as Promise<unknown>).catch === 'function') {
      void (result as Promise<unknown>).catch(error => send({ type: 'event-error', error: serializeError(error) }))
    }
  } catch (error) {
    send({ type: 'event-error', error: serializeError(error) })
  }
}

async function deactivate(): Promise<void> {
  const handler = instance.onDeactivate
  if (typeof handler === 'function') {
    try { await handler() } catch (error) { send({ type: 'event-error', error: serializeError(error) }) }
  }
  send({ type: 'deactivated' })
}

parentPort.on('message', (event) => {
  const message = event.data
  if (!message || typeof message !== 'object') return
  if (message.type === 'load') { loadPlugin(message); return }
  if (message.type === 'event') { handleEvent(message.event, message.data); return }
  if (message.type === 'deactivate') { void deactivate(); return }
  if (message.type === 'api-response') {
    const response = message as unknown as { id: number; ok: boolean; value?: unknown; error?: string }
    const item = pending.get(response.id)
    if (!item) return
    pending.delete(response.id)
    if (response.ok) item.resolve(response.value)
    else item.reject(new Error(response.error || 'Plugin API call failed'))
  }
})

send({ type: 'ready' })
