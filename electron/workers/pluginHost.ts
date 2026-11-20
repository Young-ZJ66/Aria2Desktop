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
/** 主进程要求本 worker 自行清理并退出（加载超时 / 插件被替换） */
interface TerminateMessage { type: 'terminate' }

type Incoming = LoadMessage | EventMessage | DeactivateMessage | TerminateMessage | { type: 'api-response'; id: number; ok: boolean; value?: unknown; error?: string }
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

/**
 * 插件注册的定时器（D-16）。
 *
 * 此前沙箱直接暴露裸 setTimeout/setInterval：插件一旦在加载阶段注册了
 * setInterval 就永远清不掉——加载失败/超时后主进程 kill 进程虽然能收尾，
 * 但在 kill 之前的窗口里定时器还在跑，且 deactivate 也无法清理。
 * 这里统一记录，加载失败与 deactivate/terminate 时全部清空。
 */
const pluginTimers = new Set<ReturnType<typeof setTimeout>>()

function clearPluginTimers(): void {
  for (const timer of pluginTimers) {
    try {
      clearTimeout(timer)
      clearInterval(timer as unknown as ReturnType<typeof setInterval>)
    } catch { /* ignore */ }
  }
  pluginTimers.clear()
}

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
  // 受跟踪的定时器包装：插件只能通过它们注册定时器，宿主才能在
  // 加载失败/停用时统一清理（签名与 Node 原生一致，插件无感知）
  const trackedSetTimeout = (handler: (...args: unknown[]) => void, timeout?: number, ...args: unknown[]): ReturnType<typeof setTimeout> => {
    const timer = setTimeout(() => {
      pluginTimers.delete(timer)
      handler(...args)
    }, timeout)
    pluginTimers.add(timer)
    return timer
  }
  const trackedSetInterval = (handler: (...args: unknown[]) => void, timeout?: number, ...args: unknown[]): ReturnType<typeof setInterval> => {
    const timer = setInterval(handler, timeout, ...args)
    pluginTimers.add(timer as unknown as ReturnType<typeof setTimeout>)
    return timer
  }
  const trackedClearTimeout = (timer?: ReturnType<typeof setTimeout>): void => {
    if (timer) pluginTimers.delete(timer)
    clearTimeout(timer as never)
  }
  const trackedClearInterval = (timer?: ReturnType<typeof setInterval>): void => {
    if (timer) pluginTimers.delete(timer as unknown as ReturnType<typeof setTimeout>)
    clearInterval(timer as never)
  }
  return {
    module: { exports: {} as Record<string, unknown> },
    exports: {} as Record<string, unknown>,
    console: { log: log('log'), warn: log('warn'), error: log('error') },
    setTimeout: trackedSetTimeout,
    clearTimeout: trackedClearTimeout,
    setInterval: trackedSetInterval,
    clearInterval: trackedClearInterval,
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
    // 加载失败（含 runInContext 的 3s 超时）必须清掉本次加载注册的定时器：
    // 否则插件的半初始化 setInterval 会在宿主进程里一直跑（D-16）
    clearPluginTimers()
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
  instance = {}
  // 停用后插件不应留下任何仍在运行的定时器（20 次启用/禁用验收项）
  clearPluginTimers()
  send({ type: 'deactivated' })
}

/**
 * 主进程要求终止（D-16）：先清理定时器、断开待处理 API 回调，再退出。
 *
 * 为什么不直接等主进程 kill：kill 是异步的（主进程给了 200~400ms 宽限），
 * 这段时间里插件的 setInterval 仍在执行，可能继续调用 API 或写文件。
 */
function terminate(): void {
  clearPluginTimers()
  instance = {}
  for (const [, item] of pending) {
    try { item.reject(new Error('Plugin worker terminated')) } catch { /* ignore */ }
  }
  pending.clear()
  // 给 deactivated 之类的消息一点发送时间，然后主动退出（父进程也会兜底 kill）
  setTimeout(() => process.exit(0), 50)
}

parentPort.on('message', (event) => {
  const message = event.data
  if (!message || typeof message !== 'object') return
  if (message.type === 'load') { loadPlugin(message); return }
  if (message.type === 'event') { handleEvent(message.event, message.data); return }
  if (message.type === 'deactivate') { void deactivate(); return }
  if (message.type === 'terminate') { terminate(); return }
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
