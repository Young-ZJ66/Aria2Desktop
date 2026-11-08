/**
 * 插件管理器
 * 负责插件的加载、卸载、启用、禁用和权限裁剪。
 *
 * 【信任模型说明 —— 重要】
 * 生产环境中每个插件运行在独立的 Electron utilityProcess 内，主进程只通过
 * 消息端口暴露白名单 API。插件死循环/崩溃只会结束它自己的进程，主进程仍可
 * 正常响应；插件也无法直接拿到主进程对象。
 *
 * 进程内仍然使用 vm 限制插件可访问的全局对象，但 vm 不是安全边界：
 * 恶意插件可能逃逸到宿主进程（仅限该插件的 utilityProcess，而非主进程）。
 * 因此插件仍应视为"与本机用户等权的代码"，权限裁剪（permissions）用于
 * 防误操作与最小权限，不构成对恶意插件的完整防护。请安装可信来源的插件。
 *
 * 单测环境（无 Electron utilityProcess）会自动回退到进程内 vm，便于测试
 * 启用/停用/卸载的状态一致性；这不影响生产隔离。
 */

import { app, Notification, utilityProcess } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import * as vm from 'vm'
import * as crypto from 'crypto'
import Store from 'electron-store'
import { callAria2Rpc } from '../utils/aria2Rpc'
import { activeRpcOptions } from '../utils/activeRpcConfig'
import { getSettingsFresh } from '../utils/settingsAccessor'
import { createLogger } from '../utils/logger'
import type { PluginManifest, PluginInstance, PluginInfo, PluginContext, PluginPermission } from '../types/plugin'
import type { StoreData, AppSettings } from '../types/store'

/** utilityProcess 的最小结构（避免依赖 Electron 命名空间类型，便于单测替换） */
interface PluginWorker {
  postMessage(message: unknown): void
  on(event: 'message', listener: (message: unknown) => void): void
  on(event: 'exit', listener: (code: number) => void): void
  on(event: 'spawn', listener: () => void): void
  kill(): boolean
}

interface WorkerApiMessage {
  type: 'api'
  id: number
  method: string
  args: unknown[]
}

const WORKER_API_PERMISSIONS: Record<string, string> = {
  'aria2.getGlobalStat': 'aria2:read',
  'aria2.getActiveTasks': 'aria2:read',
  'aria2.getWaitingTasks': 'aria2:read',
  'aria2.getStoppedTasks': 'aria2:read',
  'aria2.addUri': 'aria2:write',
  'aria2.pause': 'aria2:write',
  'aria2.unpause': 'aria2:write',
  'aria2.remove': 'aria2:write',
  'settings.get': 'settings:read'
}

const PLUGIN_DIR_NAME = 'plugins'

// 本文件日志文案自带 [PluginManager] / [Plugin:<id>] 前缀（含动态插件名，无法用固定 scope），
// 故 scope 传空避免前缀重复
const logger = createLogger('')

/**
 * 构造提供给插件的设置快照。
 * 插件读取应用配置属常规需求（若只放行固定几个键会破坏既有插件），
 * 因此保留完整配置结构，但必须剔除密钥类字段——RPC 凭据不能进入插件上下文。
 */
function toPluginSafeSettings(settings: AppSettings): Record<string, unknown> {
  const safe: Record<string, unknown> = { ...settings }
  if (settings.aria2) {
    const { secret: _aria2Secret, ...aria2Rest } = settings.aria2
    void _aria2Secret
    safe.aria2 = aria2Rest
  }
  if (Array.isArray(settings.connectionProfiles)) {
    safe.connectionProfiles = settings.connectionProfiles.map(profile => {
      if (!profile?.config) return profile
      const { secret: _profileSecret, ...configRest } = profile.config
      void _profileSecret
      return { ...profile, config: configRest }
    })
  }
  return safe
}

/** 插件市场注册表条目（由 pluginMarketService 拉取并校验） */
export interface RegistryPluginEntry {
  id: string
  name: string
  version: string
  description?: string
  author?: string
  homepage?: string
  /** 单文件入口（.js）的下载地址 */
  entryUrl: string
  /** 入口文件的 SHA-256（十六进制），必填 */
  sha256: string
  /** 入口文件的 Ed25519/RSA 签名（Base64，可选；配置了可信发布者时必填） */
  signature?: string
  /** 发布者公钥（PEM）或公钥指纹，用于匹配 trustedPluginPublishers */
  publisher?: string
  permissions?: PluginPermission[]
  main?: string
}

interface ManagedPlugin {
  manifest: PluginManifest
  instance: PluginInstance
  enabled: boolean
  path: string
  worker?: PluginWorker
  workerReady: boolean
  status: 'running' | 'stopped' | 'disabled' | 'error'
  error?: string
  restarts: number
  stopping: boolean
}

export class PluginManager {
  private store: Store<StoreData>
  private plugins: Map<string, ManagedPlugin> = new Map()
  private pluginDir: string
  /** 每个插件注册的定时器（禁用时统一清理，防止插件遗留定时器常驻主进程） */
  private pluginTimers: Map<string, Set<NodeJS.Timeout>> = new Map()
  private shuttingDown = false

  constructor(store: Store<StoreData>) {
    this.store = store
    this.pluginDir = path.join(app.getPath('userData'), PLUGIN_DIR_NAME)
    this.ensurePluginDir()
    this.seedBuiltinPlugins()
  }

  /** 单测的 electron mock 可能没有 utilityProcess；访问不存在导出会抛错，故集中兜底。 */
  private hasUtilityProcess(): boolean {
    try {
      return typeof (utilityProcess as unknown as { fork?: unknown } | undefined)?.fork === 'function'
    } catch {
      return false
    }
  }

  private ensurePluginDir(): void {
    if (!fs.existsSync(this.pluginDir)) {
      fs.mkdirSync(this.pluginDir, { recursive: true })
    }
  }

  /**
   * 播种随应用分发的内置示例插件。
   * - 从安装包 resources/plugins（开发环境为仓库 plugins/）复制到用户插件目录；
   * - 仅首次播种时写入 disabledPlugins，让用户按需启用并确认权限；
   * - 把插件 id 记入 seededBuiltinPlugins，用户卸载后不会在下次启动时被重新装回；
   * - 单测/无 Electron 路径 API 的环境静默跳过，不影响既有插件加载。
   */
  private seedBuiltinPlugins(): void {
    try {
      const seeded = this.store.get('seededBuiltinPlugins') as string[] | undefined
      const seededIds = new Set(Array.isArray(seeded) ? seeded : [])
      const appPath = typeof app.getAppPath === 'function' ? app.getAppPath() : ''
      const sourceRoot = app.isPackaged
        ? path.join(process.resourcesPath, PLUGIN_DIR_NAME)
        : (appPath ? path.join(appPath, PLUGIN_DIR_NAME) : '')
      if (!sourceRoot || !fs.existsSync(sourceRoot)) return

      let changed = false
      const disabled = new Set(this.getDisabledList())
      for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const sourceDir = path.join(sourceRoot, entry.name)
        const manifestPath = path.join(sourceDir, 'manifest.json')
        if (!fs.existsSync(manifestPath)) continue
        let manifest: { id?: string }
        try {
          manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as { id?: string }
        } catch {
          continue
        }
        const pluginId = (manifest.id || '').trim()
        if (!pluginId || seededIds.has(pluginId)) continue

        const targetDir = path.join(this.pluginDir, entry.name)
        if (!fs.existsSync(targetDir)) {
          fs.cpSync(sourceDir, targetDir, { recursive: true })
          // 内置示例默认禁用：给用户一个可选扩展，同时避免悄悄开始发通知
          disabled.add(pluginId)
        }
        seededIds.add(pluginId)
        changed = true
      }
      if (changed) {
        this.store.set('seededBuiltinPlugins', [...seededIds])
        this.store.set('disabledPlugins', [...disabled])
      }
    } catch (error) {
      logger.warn('[PluginManager] Failed to seed builtin plugins:', error)
    }
  }

  /** 插件目录的真实路径（渲染层展示/打开目录用，避免硬编码 %APPDATA% 之类的伪路径） */
  getPluginDir(): string {
    return this.pluginDir
  }

  /** 加载所有插件 */
  loadAll(): void {
    const disabledList = this.getDisabledList()

    try {
      const entries = fs.readdirSync(this.pluginDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        try {
          this.loadPlugin(entry.name, disabledList)
        } catch (error) {
          logger.warn(`[PluginManager] Failed to load plugin "${entry.name}":`, error)
        }
      }
    } catch (error) {
      logger.error('[PluginManager] Failed to read plugin directory:', error)
    }

    logger.info(`[PluginManager] Loaded ${this.plugins.size} plugin(s)`)
  }

  /** 加载单个插件 */
  private loadPlugin(dirName: string, disabledList: Set<string>): void {
    const pluginPath = path.join(this.pluginDir, dirName)
    const manifestPath = path.join(pluginPath, 'manifest.json')

    if (!fs.existsSync(manifestPath)) {
      // 尝试从 package.json 读取
      const pkgPath = path.join(pluginPath, 'package.json')
      if (!fs.existsSync(pkgPath)) return
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
      this.registerPlugin(pluginPath, pkg as PluginManifest, disabledList)
      return
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as PluginManifest
    this.registerPlugin(pluginPath, manifest, disabledList)
  }

  private registerPlugin(pluginPath: string, manifest: PluginManifest, disabledList: Set<string>): void {
    if (!manifest.id || !manifest.name || !manifest.version) {
      throw new Error('Invalid plugin manifest: missing id, name, or version')
    }

    if (this.plugins.has(manifest.id)) {
      throw new Error(`Duplicate plugin id: ${manifest.id}`)
    }

    const enabled = !disabledList.has(manifest.id)

    this.plugins.set(manifest.id, {
      manifest,
      instance: {},
      enabled,
      path: pluginPath,
      workerReady: false,
      status: enabled ? 'stopped' : 'disabled',
      restarts: 0,
      stopping: false
    })

    if (enabled) {
      this.activatePlugin(manifest.id)
    }
  }

  /** 激活插件（优先使用 utilityProcess；单测环境回退到进程内 vm） */
  private activatePlugin(pluginId: string): void {
    const plugin = this.plugins.get(pluginId)
    if (!plugin) return
    if (this.hasUtilityProcess()) {
      this.activateWithWorker(pluginId, plugin)
      return
    }
    this.activateWithVm(pluginId, plugin)
  }

  /** 生产模式：每个插件一个 utilityProcess，主进程只暴露白名单 API。 */
  private activateWithWorker(pluginId: string, plugin: ManagedPlugin): void {
    const mainFile = plugin.manifest.main || 'index.js'
    const resolvedPluginDir = path.resolve(plugin.path)
    const mainPath = path.resolve(resolvedPluginDir, mainFile)
    if (!mainPath.startsWith(resolvedPluginDir + path.sep) && mainPath !== path.join(resolvedPluginDir, 'index.js')) {
      this.markPluginError(plugin, `Path traversal detected in entry file: ${mainFile}`)
      return
    }
    if (!fs.existsSync(mainPath)) {
      this.markPluginError(plugin, `Entry file not found: ${mainFile}`)
      return
    }
    const workerPath = path.join(__dirname, '..', 'workers', 'pluginHost.js')
    if (!fs.existsSync(workerPath)) {
      // 编译产物缺失时退回 vm，保证开发环境仍可运行
      logger.warn('[PluginManager] pluginHost.js not found, falling back to in-process vm')
      this.activateWithVm(pluginId, plugin)
      return
    }
    const code = fs.readFileSync(mainPath, 'utf-8')
    // 重新激活时先让旧进程走 deactivate，再强制终止，避免旧 worker 变成
    // 没有引用的孤儿进程继续占内存或偷偷发 API 调用。
    this.stopWorker(plugin, true)
    plugin.stopping = false
    plugin.workerReady = false
    plugin.error = undefined
    plugin.status = 'running'
    try {
      const child = utilityProcess.fork(workerPath, [], {
        serviceName: `Aria2Desktop Plugin: ${plugin.manifest.name}`,
        env: { ...process.env }
      }) as unknown as PluginWorker
      plugin.worker = child
      child.on('message', (message) => this.handleWorkerMessage(pluginId, plugin, message))
      child.on('exit', (code) => this.handleWorkerExit(pluginId, plugin, code))
      child.on('spawn', () => {
        try {
          child.postMessage({ type: 'load', pluginId, manifest: plugin.manifest, code })
        } catch (error) {
          this.markPluginError(plugin, `Failed to send plugin code: ${String(error)}`)
        }
      })
      // 加载超时保护：插件入口死循环时直接杀掉该进程，主进程不受影响
      setTimeout(() => {
        if (plugin.worker === child && !plugin.workerReady && plugin.status === 'running') {
          this.markPluginError(plugin, 'Plugin load timed out after 10s')
          this.stopWorker(plugin, true)
        }
      }, 10_000).unref?.()
    } catch (error) {
      this.markPluginError(plugin, `Failed to start plugin process: ${String(error)}`)
    }
  }

  /** 开发/单测回退：进程内 vm（不是安全边界，见文件头）。 */
  private activateWithVm(pluginId: string, plugin: ManagedPlugin): void {
    plugin.workerReady = false
    const mainFile = plugin.manifest.main || 'index.js'
    const resolvedPluginDir = path.resolve(plugin.path)
    const mainPath = path.resolve(resolvedPluginDir, mainFile)
    // 防止路径穿越：入口文件必须在插件目录内
    if (!mainPath.startsWith(resolvedPluginDir + path.sep) && mainPath !== path.join(resolvedPluginDir, 'index.js')) {
      logger.error(`[PluginManager] Path traversal detected in plugin "${pluginId}": ${mainFile}`)
      plugin.enabled = false
      return
    }

    if (!fs.existsSync(mainPath)) {
      plugin.enabled = false
      plugin.instance = {}
      return
    }

    try {
      const code = fs.readFileSync(mainPath, 'utf-8')
      // 重复激活（enable 被多次调用）时先清理上一次实例的定时器，避免叠加泄漏
      this.clearPluginTimers(pluginId)
      const context = this.createSandbox(plugin.manifest)
      const instance = this.executeInSandbox(code, context, pluginId)

      plugin.instance = instance
      plugin.enabled = true
      plugin.status = 'running'
      plugin.error = undefined

      // 调用 onActivate 生命周期钩子
      if (instance.onActivate) {
        Promise.resolve(instance.onActivate()).catch(err => {
          logger.error(`[PluginManager] Plugin "${pluginId}" onActivate error:`, err)
        })
      }

      logger.info(`[PluginManager] Activated plugin: ${pluginId}`)
    } catch (error) {
      logger.error(`[PluginManager] Failed to activate plugin "${pluginId}":`, error)
      // 激活失败：清理本次执行已注册的定时器，避免半初始化插件残留
      this.clearPluginTimers(pluginId)
      plugin.enabled = false
      plugin.status = 'error'
      plugin.error = error instanceof Error ? error.message : String(error)
    }
  }

  /** 插件进程消息分发。 */
  private handleWorkerMessage(pluginId: string, plugin: ManagedPlugin, raw: unknown): void {
    if (!raw || typeof raw !== 'object') return
    const message = raw as { type?: string; [key: string]: unknown }
    switch (message.type) {
      case 'loaded':
        if (message.ok) {
          plugin.workerReady = true
          plugin.status = 'running'
          plugin.error = undefined
          logger.info(`[PluginManager] Activated plugin in utilityProcess: ${pluginId}`)
        } else {
          this.markPluginError(plugin, String(message.error || 'Plugin load failed'))
        }
        break
      case 'api':
        void this.handleWorkerApi(pluginId, plugin, message as unknown as WorkerApiMessage)
        break
      case 'notify':
        this.showPluginNotification(plugin, String(message.title ?? ''), String(message.body ?? ''))
        break
      case 'log': {
        const level = message.level === 'error' ? 'error' : message.level === 'warn' ? 'warn' : 'info'
        const args = Array.isArray(message.args) ? message.args : []
        logger[level](`[Plugin:${pluginId}]`, ...args)
        break
      }
      case 'activate-error':
        logger.error(`[PluginManager] Plugin "${pluginId}" onActivate error:`, message.error)
        plugin.error = String(message.error || 'onActivate failed')
        break
      case 'event-error':
        logger.error(`[PluginManager] Plugin "${pluginId}" event error:`, message.error)
        plugin.error = String(message.error || 'Event handler failed')
        break
      default:
        break
    }
  }

  /** 插件进程异常退出：记录错误并按次数重启（最多 3 次），避免崩溃循环。 */
  private handleWorkerExit(pluginId: string, plugin: ManagedPlugin, code: number): void {
    plugin.worker = undefined
    plugin.workerReady = false
    if (plugin.stopping || this.shuttingDown) {
      plugin.status = plugin.enabled ? 'stopped' : 'disabled'
      return
    }
    if (!plugin.enabled) {
      plugin.status = 'disabled'
      return
    }
    if (plugin.restarts < 3) {
      plugin.restarts += 1
      plugin.status = 'error'
      plugin.error = `Plugin process exited with code ${code}; restarting (${plugin.restarts}/3)`
      logger.warn(`[PluginManager] Plugin "${pluginId}" exited with code ${code}, restart ${plugin.restarts}/3`)
      const timer = setTimeout(() => {
        if (!this.shuttingDown && plugin.enabled) this.activateWithWorker(pluginId, plugin)
      }, 1000 * plugin.restarts)
      timer.unref?.()
    } else {
      plugin.status = 'error'
      plugin.error = `Plugin process exited with code ${code}; restart limit reached`
      logger.error(`[PluginManager] Plugin "${pluginId}" crashed repeatedly, giving up`)
    }
  }

  /** 处理插件经消息端口发来的 API 调用（白名单 + 权限校验）。 */
  private async handleWorkerApi(pluginId: string, plugin: ManagedPlugin, message: WorkerApiMessage): Promise<void> {
    const respond = (ok: boolean, value?: unknown, error?: string): void => {
      try {
        plugin.worker?.postMessage({ type: 'api-response', id: message.id, ok, value, error })
      } catch {
        // 进程可能已退出，忽略
      }
    }
    const permission = WORKER_API_PERMISSIONS[message.method]
    if (!permission) {
      respond(false, undefined, `Unknown plugin API: ${message.method}`)
      return
    }
    const permissions = new Set(plugin.manifest.permissions || [])
    if (!permissions.has(permission as never)) {
      respond(false, undefined, `Permission denied: ${permission}`)
      return
    }
    try {
      if (message.method === 'settings.get') {
        const key = String(message.args?.[0] ?? '')
        respond(true, toPluginSafeSettings(getSettingsFresh())[key])
        return
      }
      let method = message.method
      let params: unknown[] = Array.isArray(message.args) ? message.args : []
      if (method === 'aria2.getActiveTasks') { method = 'aria2.tellActive'; params = [] }
      else if (method === 'aria2.getWaitingTasks') { method = 'aria2.tellWaiting'; params = [0, 1000] }
      else if (method === 'aria2.getStoppedTasks') { method = 'aria2.tellStopped'; params = [0, 1000] }
      else if (method === 'aria2.getGlobalStat') { method = 'aria2.getGlobalStat'; params = [] }
      const result = await callAria2Rpc({ ...activeRpcOptions(getSettingsFresh()), method, params })
      respond(true, result)
    } catch (error) {
      logger.warn(`[Plugin:${pluginId}] API ${message.method} failed:`, error)
      respond(false, undefined, error instanceof Error ? error.message : String(error))
    }
  }

  private showPluginNotification(plugin: ManagedPlugin, title: string, body: string): void {
    try {
      if (!Notification.isSupported()) return
      new Notification({
        title: `[${plugin.manifest.name}] ${String(title).slice(0, 100)}`.slice(0, 120),
        body: String(body).slice(0, 500)
      }).show()
    } catch (error) {
      logger.warn(`[Plugin:${plugin.manifest.id}] 发送通知失败:`, error)
    }
  }

  private markPluginError(plugin: ManagedPlugin, error: string): void {
    plugin.status = 'error'
    plugin.error = error
    plugin.workerReady = false
    logger.error(`[PluginManager] Plugin "${plugin.manifest.id}": ${error}`)
  }

  /** 停止插件进程；kill=false 仅断开引用（调用方负责 postMessage）。 */
  private stopWorker(plugin: ManagedPlugin, kill: boolean): void {
    const worker = plugin.worker
    plugin.worker = undefined
    plugin.workerReady = false
    if (!worker) return
    try { worker.postMessage({ type: 'deactivate' }) } catch { /* ignore */ }
    if (kill) {
      const timer = setTimeout(() => { try { worker.kill() } catch { /* ignore */ } }, 400)
      timer.unref?.()
    }
  }

  /** 创建沙箱上下文（按权限裁剪 API） */
  private createSandbox(manifest: PluginManifest): PluginContext {
    const permissions = new Set(manifest.permissions || [])

    /**
     * RPC 句柄**每次调用时**才解析端口与密钥（不要提到闭包外一次性求值）。
     *
     * 为什么：插件是在 AppLifecycle 的 registerHandlers() 阶段被激活的，而 rpc-secret
     * 的自动生成发生在其后的引擎初始化里。一次性捕获会把"生成前的空密钥"永久绑进
     * 所有插件的闭包——此后插件每次 RPC 都 401，且插件作者看到的是 "RPC Error" 而非密钥问题。
     * 逐次直读顺带让"用户在设置页改端口/改密钥"对插件立即生效，无需重启应用。
     */
    const rpc = <T>(method: string, params?: unknown[]) => {
      const settings = getSettingsFresh()
      return callAria2Rpc({ ...activeRpcOptions(settings), method, params }) as Promise<T>
    }

    const ctx: PluginContext = {
      console: {
        log: (...args: unknown[]) => logger.info(`[Plugin:${manifest.id}]`, ...args),
        warn: (...args: unknown[]) => logger.warn(`[Plugin:${manifest.id}]`, ...args),
        error: (...args: unknown[]) => logger.error(`[Plugin:${manifest.id}]`, ...args)
      },
      aria2: {
        getGlobalStat: () => rpc<Record<string, string>>('aria2.getGlobalStat'),
        getActiveTasks: () => rpc<unknown[]>('aria2.tellActive'),
        // 取满 aria2 单次上限（1000），避免插件只能看到前 100 个等待/停止任务
        getWaitingTasks: () => rpc<unknown[]>('aria2.tellWaiting', [0, 1000]),
        getStoppedTasks: () => rpc<unknown[]>('aria2.tellStopped', [0, 1000]),
        addUri: (uris, options) => rpc<string>('aria2.addUri', [uris, options || {}]),
        pause: (gid) => rpc<string>('aria2.pause', [gid]),
        unpause: (gid) => rpc<string>('aria2.unpause', [gid]),
        remove: (gid) => rpc<string>('aria2.remove', [gid])
      },
      settings: {
        // 每次调用都重新取脱敏快照：插件在激活时缓存 settings.get 的旧值，
        // 用户随后改设置却读不到（例如插件按刷新间隔工作，会一直用旧值）。
        get: (key: string) => toPluginSafeSettings(getSettingsFresh())[key]
      },
      notify: {
        send: (title: string, body: string) => {
          /**
           * 真发系统通知（此前只写日志：README 与示例插件都承诺了"发送通知"，
           * 插件作者调用后用户什么都看不到，属于文档与实现不一致）。
           * 通知是插件行为，失败一律不外抛——不能因为通知发不出去就让插件的下载回调崩掉。
           */
          try {
            if (!Notification.isSupported()) {
              logger.warn(`[Plugin:${manifest.id}] 系统不支持通知，已忽略`)
              return
            }
            new Notification({
              // 限长：插件传入的文案不设上限会撑爆通知中心，也便于日志里定位来源
              title: `[${manifest.name}] ${String(title ?? '')}`.slice(0, 120),
              body: String(body ?? '').slice(0, 500)
            }).show()
          } catch (error) {
            logger.warn(`[Plugin:${manifest.id}] 发送通知失败:`, error)
          }
        }
      }
    }

    // 按权限裁剪：无权限的 API 替换为拒绝函数
    if (!permissions.has('aria2:read')) {
      ctx.aria2.getGlobalStat = async () => { throw new Error('Permission denied: aria2:read') }
      ctx.aria2.getActiveTasks = async () => { throw new Error('Permission denied: aria2:read') }
      ctx.aria2.getWaitingTasks = async () => { throw new Error('Permission denied: aria2:read') }
      ctx.aria2.getStoppedTasks = async () => { throw new Error('Permission denied: aria2:read') }
    }
    if (!permissions.has('aria2:write')) {
      ctx.aria2.addUri = async () => { throw new Error('Permission denied: aria2:write') }
      ctx.aria2.pause = async () => { throw new Error('Permission denied: aria2:write') }
      ctx.aria2.unpause = async () => { throw new Error('Permission denied: aria2:write') }
      ctx.aria2.remove = async () => { throw new Error('Permission denied: aria2:write') }
    }
    if (!permissions.has('settings:read')) {
      ctx.settings.get = () => { throw new Error('Permission denied: settings:read') }
    }
    if (!permissions.has('notify')) {
      ctx.notify.send = () => { throw new Error('Permission denied: notify') }
    }

    return ctx
  }

  /**
   * 创建受跟踪的定时器函数：插件注册的定时器统一记录，
   * 插件禁用/卸载时由 clearPluginTimers 清理，避免遗留定时器常驻主进程。
   * （仅防资源泄漏；vm 不是安全边界，见文件头信任模型说明）
   */
  private createTrackedTimerFns(pluginId: string) {
    const track = (t: NodeJS.Timeout): NodeJS.Timeout => {
      let set = this.pluginTimers.get(pluginId)
      if (!set) {
        set = new Set()
        this.pluginTimers.set(pluginId, set)
      }
      set.add(t)
      return t
    }
    const untrack = (t?: NodeJS.Timeout): void => {
      if (t) this.pluginTimers.get(pluginId)?.delete(t)
    }
    return {
      setTimeout: ((fn: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) =>
        track(global.setTimeout(fn, ms, ...args))) as typeof setTimeout,
      clearTimeout: ((t?: NodeJS.Timeout) => {
        untrack(t)
        if (t) global.clearTimeout(t)
      }) as typeof clearTimeout,
      setInterval: ((fn: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) =>
        track(global.setInterval(fn, ms, ...args))) as typeof setInterval,
      clearInterval: ((t?: NodeJS.Timeout) => {
        untrack(t)
        if (t) global.clearInterval(t)
      }) as typeof clearInterval
    }
  }

  /** 清理插件注册的全部定时器（Node 中 clearTimeout/clearInterval 对 Timeout 对象通用） */
  private clearPluginTimers(pluginId: string): void {
    const timers = this.pluginTimers.get(pluginId)
    if (!timers) return
    for (const t of timers) {
      global.clearTimeout(t)
    }
    this.pluginTimers.delete(pluginId)
  }

  /** 在 vm 上下文中执行插件代码（vm 非安全边界，插件视为可信代码，见文件头说明） */
  private executeInSandbox(code: string, context: PluginContext, pluginId: string): PluginInstance {
    const timerFns = this.createTrackedTimerFns(pluginId)
    const sandbox = {
      module: { exports: {} as Record<string, unknown> },
      exports: {} as Record<string, unknown>,
      console: context.console,
      setTimeout: timerFns.setTimeout,
      clearTimeout: timerFns.clearTimeout,
      setInterval: timerFns.setInterval,
      clearInterval: timerFns.clearInterval,
      Date: global.Date,
      Math: global.Math,
      JSON: global.JSON,
      Promise: global.Promise,
      Array: global.Array,
      Object: global.Object,
      String: global.String,
      Number: global.Number,
      Boolean: global.Boolean,
      RegExp: global.RegExp,
      Error: global.Error,
      TypeError: global.TypeError,
      RangeError: global.RangeError,
      URIError: global.URIError,
      SyntaxError: global.SyntaxError,
      parseInt: global.parseInt,
      parseFloat: global.parseFloat,
      isNaN: global.isNaN,
      isFinite: global.isFinite,
      encodeURIComponent: global.encodeURIComponent,
      decodeURIComponent: global.decodeURIComponent,
      // 注入插件 API
      aria2: context.aria2,
      settings: context.settings,
      notify: context.notify
    }

    const script = new vm.Script(code, { filename: 'plugin' })
    const vmContext = vm.createContext(sandbox)
    // 同步执行超时：插件入口里的死循环会冻结整个主进程（窗口无响应、下载也停摆）。
    // vm 的 timeout 能中断同步脚本；插件仍被视为可信代码（vm 非安全边界），
    // 这里只防"写错的插件拖垮应用"，不承诺抵御恶意代码。
    script.runInContext(vmContext, { timeout: 3000, breakOnSigint: true })

    // 插件导出的实例
    const exported = sandbox.module.exports || sandbox.exports
    return exported as PluginInstance
  }

  /** 调用 Aria2 RPC */
  private callAria2Rpc(port: number, secret: string, method: string, params: unknown[] = []): Promise<unknown> {
    return callAria2Rpc({ port, secret, method, params })
  }

  /** 获取已禁用插件列表 */
  private getDisabledList(): Set<string> {
    const list = this.store.get('disabledPlugins') as string[] | undefined
    return new Set(list || [])
  }

  /** 保存已禁用插件列表 */
  private saveDisabledList(list: Set<string>): void {
    this.store.set('disabledPlugins', Array.from(list))
  }

  /**
   * 从插件市场安装单个 JS 插件。
   * 安全策略：id/main 白名单校验、强制 SHA-256 完整性校验；配置了可信发布者时
   * 还要求签名可被至少一个已配置公钥验证。插件仍运行在 utilityProcess 内。
   */
  async installFromRegistry(
    entry: RegistryPluginEntry,
    trustedPublishers: string[] = [],
    options: { upgrade?: boolean } = {}
  ): Promise<{ success: boolean; error?: string; plugin?: PluginInfo }> {
    try {
      if (!entry || typeof entry !== 'object') return { success: false, error: 'INVALID_ENTRY' }
      const id = String(entry.id || '').trim()
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,80}$/.test(id)) return { success: false, error: 'INVALID_ID' }
      const targetPath = path.join(this.pluginDir, id)
      const alreadyExists = this.plugins.has(id) || fs.existsSync(targetPath)
      if (alreadyExists && !options.upgrade) {
        return { success: false, error: 'ALREADY_INSTALLED' }
      }
      const url = String(entry.entryUrl || '')
      // 插件入口是将会执行的代码，必须走 HTTPS；不允许明文 HTTP 下载。
      if (!/^https:\/\//i.test(url)) return { success: false, error: 'INVALID_URL' }
      const expected = String(entry.sha256 || '').toLowerCase()
      if (!/^[a-f0-9]{64}$/.test(expected)) return { success: false, error: 'MISSING_CHECKSUM' }

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 20000)
      let response: Response
      try {
        response = await fetch(url, { signal: controller.signal, redirect: 'follow' })
      } finally {
        clearTimeout(timer)
      }
      if (!response.ok) return { success: false, error: `HTTP_${response.status}` }
      const lengthHeader = Number(response.headers.get('content-length') || 0)
      if (lengthHeader > 2 * 1024 * 1024) return { success: false, error: 'TOO_LARGE' }
      const buffer = Buffer.from(await response.arrayBuffer())
      if (buffer.length === 0 || buffer.length > 2 * 1024 * 1024) {
        return { success: false, error: 'INVALID_SIZE' }
      }
      const digest = crypto.createHash('sha256').update(buffer).digest('hex')
      if (digest !== expected) return { success: false, error: 'CHECKSUM_MISMATCH' }

      const publishers = trustedPublishers.filter(Boolean)
      if (publishers.length > 0) {
        if (!entry.signature) return { success: false, error: 'SIGNATURE_REQUIRED' }
        const verified = publishers.some(publicKey => this.verifyPluginSignature(buffer, entry.signature as string, publicKey))
        if (!verified) return { success: false, error: 'SIGNATURE_INVALID' }
      } else if (entry.signature && entry.publisher && /-----BEGIN (?:RSA )?PUBLIC KEY-----/.test(entry.publisher)) {
        // 未配置可信发布者时，publisher 只有明确是 PEM 公钥才做机会性校验；
        // 用户名/指纹之类的元数据不能当公钥用，否则合法插件会被误判为签名无效。
        const verified = this.verifyPluginSignature(buffer, entry.signature, entry.publisher)
        if (!verified) return { success: false, error: 'SIGNATURE_INVALID' }
      }

      const mainName = path.basename(String(entry.main || 'index.js'))
      if (!/^[a-zA-Z0-9._-]+\.js$/.test(mainName)) return { success: false, error: 'INVALID_MAIN' }
      // 升级：下载与校验都成功后才替换旧目录；先停 worker，再删除旧文件。
      // 保留插件原有启用状态，避免更新后被静默禁用。
      if (alreadyExists) {
        const existing = this.plugins.get(id)
        const wasEnabled = existing?.enabled === true
        if (existing) this.disable(id)
        this.plugins.delete(id)
        fs.rmSync(targetPath, { recursive: true, force: true })
        // 恢复原启用状态：原来启用的从 disabled 列表移除；原来停用的保持停用。
        const disabledList = this.getDisabledList()
        if (wasEnabled) disabledList.delete(id)
        else disabledList.add(id)
        this.saveDisabledList(disabledList)
      }
      const pluginPath = targetPath
      fs.mkdirSync(pluginPath, { recursive: false })
      const manifest: PluginManifest = {
        id,
        name: String(entry.name || id),
        version: String(entry.version || '0.0.0'),
        description: entry.description,
        author: entry.author,
        main: mainName,
        permissions: Array.isArray(entry.permissions) ? entry.permissions : []
      }
      fs.writeFileSync(path.join(pluginPath, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8')
      fs.writeFileSync(path.join(pluginPath, mainName), buffer)
      fs.writeFileSync(path.join(pluginPath, '.market.json'), JSON.stringify({
        publisher: entry.publisher ?? null,
        signature: entry.signature ?? null,
        sha256: expected,
        installedAt: new Date().toISOString()
      }, null, 2), 'utf-8')

      // loadPlugin 会按 disabledPlugins 状态决定是否激活；不要再调用 enable()，
      // 否则启用中的插件会被 activatePlugin 两次（两个 worker/定时器）。
      this.loadPlugin(id, this.getDisabledList())
      const plugin = this.plugins.get(id)
      return { success: true, plugin: plugin ? {
        manifest: plugin.manifest,
        enabled: plugin.enabled,
        path: plugin.path,
        runtime: plugin.worker ? 'utilityProcess' : (this.hasUtilityProcess() ? 'none' : 'vm'),
        status: plugin.status,
        error: plugin.error,
        restarts: plugin.restarts
      } : undefined }
    } catch (error) {
      logger.error('[PluginManager] installFromRegistry failed:', error)
      return { success: false, error: error instanceof Error ? error.message : 'INSTALL_FAILED' }
    }
  }

  /** 验证插件入口签名：优先按 Ed25519（algorithm=null），再回退 RSA/ECDSA SHA-256 */
  private verifyPluginSignature(data: Buffer, signatureBase64: string, publicKey: string): boolean {
    try {
      const signature = Buffer.from(signatureBase64, 'base64')
      if (signature.length === 0) return false
      if (crypto.verify(null, data, publicKey, signature)) return true
    } catch { /* 尝试下一种算法 */ }
    try {
      return crypto.verify('sha256', data, publicKey, Buffer.from(signatureBase64, 'base64'))
    } catch {
      return false
    }
  }

  /** 获取所有插件信息 */
  getPlugins(): PluginInfo[] {
    return Array.from(this.plugins.values()).map(p => ({
      manifest: p.manifest,
      enabled: p.enabled,
      path: p.path,
      runtime: p.worker ? 'utilityProcess' : (this.hasUtilityProcess() ? 'none' : 'vm'),
      status: p.status,
      error: p.error,
      restarts: p.restarts
    }))
  }

  /** 启用插件 */
  enable(pluginId: string): boolean {
    const plugin = this.plugins.get(pluginId)
    if (!plugin) return false

    if (plugin.enabled && plugin.status === 'running') return true

    const disabledList = this.getDisabledList()
    disabledList.delete(pluginId)
    this.saveDisabledList(disabledList)

    this.activatePlugin(pluginId)
    return true
  }

  /** 禁用插件 */
  disable(pluginId: string): boolean {
    const plugin = this.plugins.get(pluginId)
    if (!plugin) return false

    // 优先让独立进程执行 onDeactivate，再终止进程；vm 回退路径则直接调用实例钩子
    if (plugin.worker) {
      this.stopWorker(plugin, true)
    } else if (plugin.instance.onDeactivate) {
      Promise.resolve(plugin.instance.onDeactivate()).catch(err => {
        logger.error(`[PluginManager] Plugin "${pluginId}" onDeactivate error:`, err)
      })
    }

    plugin.enabled = false
    plugin.instance = {}
    plugin.status = 'disabled'
    plugin.error = undefined
    plugin.workerReady = false
    plugin.stopping = false
    // 清理插件遗留定时器（禁用后插件不应继续在主进程后台运行）
    this.clearPluginTimers(pluginId)

    const disabledList = this.getDisabledList()
    disabledList.add(pluginId)
    this.saveDisabledList(disabledList)

    return true
  }

  /** 卸载插件（删除插件目录） */
  uninstall(pluginId: string): boolean {
    const plugin = this.plugins.get(pluginId)
    if (!plugin) return false

    this.disable(pluginId)

    // 安全校验：确保删除路径在插件目录内
    const resolvedPath = path.resolve(plugin.path)
    const resolvedPluginDir = path.resolve(this.pluginDir)
    if (!resolvedPath.startsWith(resolvedPluginDir + path.sep)) {
      logger.error(`[PluginManager] Refusing to delete path outside plugin directory: ${resolvedPath}`)
      return false
    }

    try {
      fs.rmSync(resolvedPath, { recursive: true, force: true })
      this.plugins.delete(pluginId)
      // disable() 刚把 id 写进了停用列表；卸载意味着"不再是已安装插件"，这条记录必须一起清掉。
      // 否则用户重装同 id 的插件时会得到"已安装但停用"的状态——而界面上刚点完的是"安装"。
      const disabledList = this.getDisabledList()
      if (disabledList.delete(pluginId)) this.saveDisabledList(disabledList)
      return true
    } catch (error) {
      logger.error(`[PluginManager] Failed to uninstall plugin "${pluginId}":`, error)
      return false
    }
  }

  /**
   * 触发事件（通知所有启用的插件）。
   *
   * 调用方：IpcController 的 `download-event` 通道——aria2 的下载通知由渲染层的
   * WebSocket 接收，渲染层再经 IPC 转过来。此前本方法**没有任何调用方**，
   * 于是文档里的 `onDownloadComplete` / `onDownloadStart` 永远不会触发。
   */
  emit(event: 'downloadComplete' | 'downloadStart' | 'downloadError', data: { gid: string; name: string }): void {
    for (const [id, plugin] of this.plugins) {
      if (!plugin.enabled) continue
      if (plugin.worker) {
        if (!plugin.workerReady) continue
        try {
          plugin.worker.postMessage({ type: 'event', event, data })
        } catch (error) {
          logger.warn(`[PluginManager] Plugin "${id}" event send failed:`, error)
        }
        continue
      }
      if (!plugin.instance) continue
      const handler = event === 'downloadComplete'
        ? plugin.instance.onDownloadComplete
        : event === 'downloadError'
          ? plugin.instance.onDownloadError
          : plugin.instance.onDownloadStart
      if (typeof handler !== 'function') continue

      try {
        const result = handler(data) as unknown
        // 插件把钩子写成 async 时，抛错会变成 rejected promise：不 catch 就是
        // 未处理的 Promise 拒绝（主进程中会被全局兜底记日志，但堆栈里看不到是哪个插件）
        if (result && typeof (result as Promise<unknown>).catch === 'function') {
          void (result as Promise<unknown>).catch((error) => {
            logger.error(`[PluginManager] Plugin "${id}" event "${event}" async error:`, error)
          })
        }
      } catch (error) {
        logger.error(`[PluginManager] Plugin "${id}" event "${event}" error:`, error)
      }
    }
  }

  /** 关闭所有插件 */
  shutdown(): void {
    this.shuttingDown = true
    for (const [id, plugin] of this.plugins) {
      if (!plugin.enabled) continue
      if (plugin.worker) {
        plugin.stopping = true
        this.stopWorker(plugin, true)
        continue
      }
      if (plugin.instance.onDeactivate) {
        try {
          plugin.instance.onDeactivate()
        } catch (error) {
          logger.error(`[PluginManager] Plugin "${id}" onDeactivate error:`, error)
        }
      }
    }
    // 统一清理全部插件定时器，避免退出后遗留定时器持有主进程资源
    for (const id of this.pluginTimers.keys()) {
      this.clearPluginTimers(id)
    }
    this.plugins.clear()
  }
}
