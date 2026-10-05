/**
 * 插件管理器
 * 负责插件的加载、卸载、启用、禁用和权限裁剪。
 *
 * 【信任模型说明 —— 重要】
 * 插件代码在主进程通过 Node.js vm 模块执行。vm 不是安全边界：
 * 注入的宿主原生对象（setTimeout/Error 等）可通过 constructor 链逃逸，
 * 因此插件必须被视为"与本机用户等权的完全可信代码"，权限裁剪（permissions）
 * 仅是防误操作约束，不构成对恶意插件的防护。
 * 请勿安装来源不明的插件；插件目录位于 userData/plugins。
 *
 * 后续如需真正的隔离，应将插件迁移到 Electron utilityProcess（官方推荐），
 * 通过 IPC 代理受限 API。
 */

import { app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import * as vm from 'vm'
import Store from 'electron-store'
import { callAria2Rpc } from '../utils/aria2Rpc'
import { getSettingsFresh } from '../utils/settingsAccessor'
import { createLogger } from '../utils/logger'
import type { PluginManifest, PluginInstance, PluginInfo, PluginContext } from '../types/plugin'
import type { StoreData, AppSettings } from '../types/store'

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

export class PluginManager {
  private store: Store<StoreData>
  private plugins: Map<string, { manifest: PluginManifest; instance: PluginInstance; enabled: boolean; path: string }> = new Map()
  private pluginDir: string
  /** 每个插件注册的定时器（禁用时统一清理，防止插件遗留定时器常驻主进程） */
  private pluginTimers: Map<string, Set<NodeJS.Timeout>> = new Map()

  constructor(store: Store<StoreData>) {
    this.store = store
    this.pluginDir = path.join(app.getPath('userData'), PLUGIN_DIR_NAME)
    this.ensurePluginDir()
  }

  private ensurePluginDir(): void {
    if (!fs.existsSync(this.pluginDir)) {
      fs.mkdirSync(this.pluginDir, { recursive: true })
    }
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
      path: pluginPath
    })

    if (enabled) {
      this.activatePlugin(manifest.id)
    }
  }

  /** 激活插件（加载并执行入口脚本） */
  private activatePlugin(pluginId: string): void {
    const plugin = this.plugins.get(pluginId)
    if (!plugin) return

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
    }
  }

  /** 创建沙箱上下文（按权限裁剪 API） */
  private createSandbox(manifest: PluginManifest): PluginContext {
    const permissions = new Set(manifest.permissions || [])
    // 提供给插件的是脱敏快照：保留配置结构，但不含任何密钥字段
    const pluginSettings = toPluginSafeSettings(getSettingsFresh())

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
      const port = Number(settings.aria2?.port) || 6800
      const secret = String(settings.aria2?.secret || '')
      return this.callAria2Rpc(port, secret, method, params) as Promise<T>
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
        getWaitingTasks: () => rpc<unknown[]>('aria2.tellWaiting', [0, 100]),
        getStoppedTasks: () => rpc<unknown[]>('aria2.tellStopped', [0, 100]),
        addUri: (uris, options) => rpc<string>('aria2.addUri', [uris, options || {}]),
        pause: (gid) => rpc<string>('aria2.pause', [gid]),
        unpause: (gid) => rpc<string>('aria2.unpause', [gid]),
        remove: (gid) => rpc<string>('aria2.remove', [gid])
      },
      settings: {
        // 脱敏后的配置快照（已剔除 aria2.secret 与连接预设中的 secret）
        get: (key: string) => pluginSettings[key]
      },
      notify: {
        send: (title: string, body: string) => {
          // 通知通过 IPC 发送到渲染进程
          logger.info(`[Plugin:${manifest.id}] Notification: ${title} - ${body}`)
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
    script.runInContext(vmContext)

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

  /** 获取所有插件信息 */
  getPlugins(): PluginInfo[] {
    return Array.from(this.plugins.values()).map(p => ({
      manifest: p.manifest,
      enabled: p.enabled,
      path: p.path
    }))
  }

  /** 启用插件 */
  enable(pluginId: string): boolean {
    const plugin = this.plugins.get(pluginId)
    if (!plugin) return false

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

    // 调用 onDeactivate 生命周期钩子
    if (plugin.instance.onDeactivate) {
      Promise.resolve(plugin.instance.onDeactivate()).catch(err => {
        logger.error(`[PluginManager] Plugin "${pluginId}" onDeactivate error:`, err)
      })
    }

    plugin.enabled = false
    plugin.instance = {}
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
  emit(event: 'downloadComplete' | 'downloadStart', data: { gid: string; name: string }): void {
    for (const [id, plugin] of this.plugins) {
      if (!plugin.enabled || !plugin.instance) continue
      const handler = event === 'downloadComplete'
        ? plugin.instance.onDownloadComplete
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
    for (const [id, plugin] of this.plugins) {
      if (!plugin.enabled) continue
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
