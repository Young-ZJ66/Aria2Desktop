/**
 * 插件管理器
 * 负责插件的加载、卸载、启用、禁用和沙箱执行。
 * 使用 Node.js vm 模块实现沙箱隔离，限制插件对系统资源的访问。
 */

import { app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import * as vm from 'vm'
import * as http from 'http'
import Store from 'electron-store'
import type { PluginManifest, PluginInstance, PluginInfo, PluginContext } from '../types/plugin'
import type { StoreData, AppSettings } from '../types/store'
import { decryptSettingsSecrets } from '../utils/secretCipher'

const PLUGIN_DIR_NAME = 'plugins'

export class PluginManager {
  private store: Store<StoreData>
  private plugins: Map<string, { manifest: PluginManifest; instance: PluginInstance; enabled: boolean; path: string }> = new Map()
  private pluginDir: string

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
          console.warn(`[PluginManager] Failed to load plugin "${entry.name}":`, error)
        }
      }
    } catch (error) {
      console.error('[PluginManager] Failed to read plugin directory:', error)
    }

    console.log(`[PluginManager] Loaded ${this.plugins.size} plugin(s)`)
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
      console.error(`[PluginManager] Path traversal detected in plugin "${pluginId}": ${mainFile}`)
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
      const context = this.createSandbox(plugin.manifest)
      const instance = this.executeInSandbox(code, context)

      plugin.instance = instance
      plugin.enabled = true

      // 调用 onActivate 生命周期钩子
      if (instance.onActivate) {
        Promise.resolve(instance.onActivate()).catch(err => {
          console.error(`[PluginManager] Plugin "${pluginId}" onActivate error:`, err)
        })
      }

      console.log(`[PluginManager] Activated plugin: ${pluginId}`)
    } catch (error) {
      console.error(`[PluginManager] Failed to activate plugin "${pluginId}":`, error)
      plugin.enabled = false
    }
  }

  /** 创建沙箱上下文（按权限裁剪 API） */
  private createSandbox(manifest: PluginManifest): PluginContext {
    const permissions = new Set(manifest.permissions || [])
    const settings = decryptSettingsSecrets(this.store.get('settings', {}) as AppSettings)
    const port = Number(settings.aria2?.port) || 6800
    const secret = String(settings.aria2?.secret || '')

    const rpc = <T>(method: string, params?: unknown[]) =>
      this.callAria2Rpc(port, secret, method, params) as Promise<T>

    const ctx: PluginContext = {
      console: {
        log: (...args: unknown[]) => console.log(`[Plugin:${manifest.id}]`, ...args),
        warn: (...args: unknown[]) => console.warn(`[Plugin:${manifest.id}]`, ...args),
        error: (...args: unknown[]) => console.error(`[Plugin:${manifest.id}]`, ...args)
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
        get: (key: string) => (settings as Record<string, unknown>)[key]
      },
      notify: {
        send: (title: string, body: string) => {
          // 通知通过 IPC 发送到渲染进程
          console.log(`[Plugin:${manifest.id}] Notification: ${title} - ${body}`)
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

  /** 在沙箱中执行插件代码 */
  private executeInSandbox(code: string, context: PluginContext): PluginInstance {
    const sandbox = {
      module: { exports: {} as Record<string, unknown> },
      exports: {} as Record<string, unknown>,
      console: context.console,
      setTimeout: global.setTimeout,
      clearTimeout: global.clearTimeout,
      setInterval: global.setInterval,
      clearInterval: global.clearInterval,
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
    return new Promise((resolve, reject) => {
      const rpcParams = secret ? [`token:${secret}`, ...params] : params
      const body = JSON.stringify({ jsonrpc: '2.0', id: Date.now().toString(36), method, params: rpcParams })

      const req = http.request({
        hostname: 'localhost',
        port,
        path: '/jsonrpc',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      }, (res) => {
        let data = ''
        res.on('data', (chunk) => { data += chunk })
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data)
            if (parsed.error) reject(new Error(parsed.error.message))
            else resolve(parsed.result)
          } catch (e) { reject(e) }
        })
      })

      req.on('error', reject)
      req.setTimeout(5000, () => req.destroy(new Error('timeout')))
      req.write(body)
      req.end()
    })
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
        console.error(`[PluginManager] Plugin "${pluginId}" onDeactivate error:`, err)
      })
    }

    plugin.enabled = false
    plugin.instance = {}

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
      console.error(`[PluginManager] Refusing to delete path outside plugin directory: ${resolvedPath}`)
      return false
    }

    try {
      fs.rmSync(resolvedPath, { recursive: true, force: true })
      this.plugins.delete(pluginId)
      return true
    } catch (error) {
      console.error(`[PluginManager] Failed to uninstall plugin "${pluginId}":`, error)
      return false
    }
  }

  /** 触发事件（通知所有启用的插件） */
  emit(event: 'downloadComplete' | 'downloadStart', data: { gid: string; name: string }): void {
    for (const [id, plugin] of this.plugins) {
      if (!plugin.enabled) continue
      try {
        if (event === 'downloadComplete' && plugin.instance.onDownloadComplete) {
          plugin.instance.onDownloadComplete(data)
        } else if (event === 'downloadStart' && plugin.instance.onDownloadStart) {
          plugin.instance.onDownloadStart(data)
        }
      } catch (error) {
        console.error(`[PluginManager] Plugin "${id}" event "${event}" error:`, error)
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
          console.error(`[PluginManager] Plugin "${id}" onDeactivate error:`, error)
        }
      }
    }
    this.plugins.clear()
  }
}
