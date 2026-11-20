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
import { DEFAULT_TRUSTED_PLUGIN_PUBLISHERS } from '../../src/shared/appSettings'

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

/** 已随早期版本分发、现在被新内置插件取代的示例（仅清理确认由本应用播种的目录） */
const LEGACY_BUILTIN_PLUGINS: Array<{ dir: string; id: string }> = [
  { dir: 'download-notifier', id: 'com.aria2desktop.download-notifier' }
]

// 本文件日志文案自带 [PluginManager] / [Plugin:<id>] 前缀（含动态插件名，无法用固定 scope），
// 故 scope 传空避免前缀重复
const logger = createLogger('')

/**
 * 构造提供给插件的设置快照。
 * 插件读取应用配置属常规需求（若只放行固定几个键会破坏既有插件），
 * 因此保留完整配置结构，但必须剔除密钥类字段——RPC 凭据不能进入插件上下文。
 *
 * 凭据清单（D-05）：
 * - aria2.secret：aria2 RPC 密钥；
 * - connectionProfiles[].config.secret：连接预设密钥；
 * - webConsole.token / webConsole.tokens[].token：Web 控制台令牌。
 *   这两项此前被漏掉——任何带 settings:read 权限的插件都能直接读走用户的
 *   Web 控制台 admin token，从而在浏览器里拿到整机下载控制权。
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
  if (settings.webConsole) {
    const { token: _consoleToken, tokens: _consoleTokens, ...consoleRest } = settings.webConsole
    void _consoleToken
    safe.webConsole = {
      ...consoleRest,
      tokens: Array.isArray(_consoleTokens)
        ? _consoleTokens.map(item => {
          const { token: _itemToken, ...itemRest } = item
          void _itemToken
          return itemRest
        })
        : []
    }
  }
  return safe
}

/**
 * 插件可通过 settings.get 读取的键白名单（D-05）。
 *
 * 之前 settings.get 直接返回整份脱敏快照的任意键，等于"脱敏了密钥但没限制范围"：
 * 插件能读连接预设的 host/port、活动预设 id 等与自身功能无关的隐私配置。
 * 白名单只放行插件正常工作真正需要的分类，敏感键（connectionProfiles /
 * activeProfileId / trustedPluginPublishers / webConsole 之外的安全项）一律拒绝。
 */
const PLUGIN_SETTINGS_KEY_ALLOWLIST: ReadonlySet<string> = new Set([
  'language',
  'theme',
  'refreshInterval',
  'download',
  'category',
  'queue',
  'bt',
  'taskTemplates',
  'completionRules',
  'pluginMarket',
  // webConsole 只暴露 enabled/port/allowedIps（token 已被 toPluginSafeSettings 剔除）
  'webConsole'
])

/**
 * 读取单个设置项给插件用；不在白名单内的键返回 undefined（调用方按"无此设置"处理）。
 * worker（utilityProcess）与 vm 两条路径都走这里，避免两条路径的脱敏口径分叉。
 */
function readPluginSetting(settings: AppSettings, key: string): unknown {
  if (!PLUGIN_SETTINGS_KEY_ALLOWLIST.has(key)) {
    logger.warn(`[PluginManager] settings.get 拒绝未授权键: ${key}`)
    return undefined
  }
  return toPluginSafeSettings(settings)[key]
}

/**
 * 注册表（plugin-registry.json）自身的签名校验（D-02）。
 *
 * 只把 URL 固定到 tag 防不住内容被篡改：仓库被接管、CDN 劫持、镜像同步错误
 * 都会让客户端拿到一份"地址合法但内容被换过"的 registry，进而把攻击者的
 * entryUrl 当成官方插件装进来。所以 registry 也带 Ed25519 签名，客户端用
 * 内置公钥验签，验不过就拒绝整个列表（不是逐条跳过——列表本身不可信）。
 *
 * 规范必须与 scripts/plugin-registry/sign-registry.mjs 完全一致：
 * 载荷 = registry 去掉 signature 字段后的规范化 JSON（键字典序、数组保序、
 * 无多余空白、UTF-8），签名算法 Ed25519，signature 为 base64。
 * 两处实现分叉会让所有签名同时失效，故两侧都有对应测试固定该规范。
 */
export function canonicalizeRegistry(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(item => canonicalizeRegistry(item)).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).filter(key => record[key] !== undefined).sort()
  const body = keys.map(key => `${JSON.stringify(key)}:${canonicalizeRegistry(record[key])}`).join(',')
  return `{${body}}`
}

/** 取参与签名的字节：去掉 signature 字段后规范化 */
export function registrySignaturePayload(registry: unknown): Buffer {
  const rest: Record<string, unknown> = { ...((registry ?? {}) as Record<string, unknown>) }
  delete rest.signature
  return Buffer.from(canonicalizeRegistry(rest), 'utf8')
}

/**
 * 用 Ed25519 公钥校验 registry 签名。
 * 只接受 Ed25519：RSA/ECDSA 会让 verify 走不同分支，统一按"验证失败"处理，
 * 杜绝"换个算法也能过"的降级路径。
 */
export function verifyRegistrySignature(registry: unknown, publicKeyPem: string): boolean {
  const signature = (registry as { signature?: unknown } | null | undefined)?.signature
  if (typeof signature !== 'string' || signature.length === 0) return false
  try {
    const key = crypto.createPublicKey(publicKeyPem)
    if (key.asymmetricKeyType !== 'ed25519') return false
    return crypto.verify(null, registrySignaturePayload(registry), key, Buffer.from(signature, 'base64'))
  } catch {
    return false
  }
}

/**
 * 校验 registry 是否由任一可信发布者签名。
 * 与 installFromRegistry 一致：传入清单为空时回落到内置官方公钥，
 * 因此"调用方忘记传"不会退化成"跳过验签"。
 */
export function verifyRegistryTrust(registry: unknown, trustedPublishers: readonly string[] = []): boolean {
  const configured = trustedPublishers.map(key => String(key || '').trim()).filter(Boolean)
  const publishers = configured.length > 0 ? configured : [...DEFAULT_TRUSTED_PLUGIN_PUBLISHERS]
  return publishers.some(publicKey => verifyRegistrySignature(registry, publicKey))
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
  /**
   * worker 代次（D-04）。每次启动/停止 worker 都递增；消息、退出、超时回调
   * 只在代次仍匹配时生效，避免"旧 worker 的 exit 事件清掉新 worker 引用"导致
   * 插件变成僵尸（既无进程也不重启），或旧 worker 的消息污染新实例状态。
   */
  generation: number
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

      // 升级清理：旧版内置插件与原生通知功能重复，已被 auto-retry 取代。
      // 只删除 seededBuiltinPlugins 里记录过的目录，避免误删用户自行安装的同名插件。
      for (const legacy of LEGACY_BUILTIN_PLUGINS) {
        if (!seededIds.has(legacy.id)) continue
        const legacyDir = path.join(this.pluginDir, legacy.dir)
        try {
          if (fs.existsSync(legacyDir)) {
            fs.rmSync(legacyDir, { recursive: true, force: true })
            logger.info(`[PluginManager] Removed legacy builtin plugin: ${legacy.id}`)
          }
        } catch (error) {
          logger.warn(`[PluginManager] Failed to remove legacy builtin plugin ${legacy.id}:`, error)
        }
        seededIds.delete(legacy.id)
        disabled.delete(legacy.id)
        changed = true
      }

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
      stopping: false,
      generation: 0
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
    // 代次（D-04）：本次启动的所有回调只认这一代，旧 worker 的 message/exit
    // 即便晚到也不能改动新 worker 的引用或状态。
    const generation = ++plugin.generation
    const isCurrent = (): boolean => plugin.generation === generation && plugin.worker === child
    let child: PluginWorker
    try {
      child = utilityProcess.fork(workerPath, [], {
        serviceName: `Aria2Desktop Plugin: ${plugin.manifest.name}`,
        env: { ...process.env }
      }) as unknown as PluginWorker
    } catch (error) {
      this.markPluginError(plugin, `Failed to start plugin process: ${String(error)}`)
      return
    }
    plugin.worker = child
    try {
      child.on('message', (message) => {
        if (!isCurrent()) {
          logger.warn(`[PluginManager] 忽略旧代次 worker 消息: ${pluginId} (gen ${generation})`)
          return
        }
        this.handleWorkerMessage(pluginId, plugin, message)
      })
      child.on('exit', (code) => {
        if (plugin.generation !== generation) {
          // 旧进程退出：只记录，绝不清掉新 worker 的引用，也不触发重启
          logger.warn(`[PluginManager] 旧代次 worker 已退出: ${pluginId} (gen ${generation}, code ${code})`)
          return
        }
        this.handleWorkerExit(pluginId, plugin, code)
      })
      child.on('spawn', () => {
        if (!isCurrent()) return
        try {
          child.postMessage({ type: 'load', pluginId, manifest: plugin.manifest, code })
        } catch (error) {
          this.markPluginError(plugin, `Failed to send plugin code: ${String(error)}`)
        }
      })
      // 加载超时保护（D-16）：插件入口死循环时先请 worker 自己终止（它会清理
      // 已注册的定时器），再强制 kill；超时后该代次作废，不会被后续消息误判。
      const timer = setTimeout(() => {
        if (!isCurrent() || plugin.workerReady || plugin.status !== 'running') return
        this.markPluginError(plugin, 'Plugin load timed out after 10s')
        this.terminateWorker(plugin, generation)
      }, 10_000)
      timer.unref?.()
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
          // 成功加载才重置重启计数：否则"偶发崩溃一次后永久只剩 2 次配额"，
          // 长期运行的应用里插件会被慢慢耗尽重启机会
          plugin.restarts = 0
          logger.info(`[PluginManager] Activated plugin in utilityProcess: ${pluginId}`)
        } else {
          /**
           * 加载失败（含 3s runInContext 超时，D-16）：这个 worker 已经没有可用
           * 实例了，但它的 vm 上下文里可能还留着死循环/半初始化定时器。仅标记
           * error 会把进程留在后台空转，所以这里直接终止它；stopWorker 递增
           * generation，随后到达的 exit 属于旧代次，不会触发重启风暴。
           */
          this.markPluginError(plugin, String(message.error || 'Plugin load failed'))
          this.stopWorker(plugin, true)
        }
        break
      case 'api':
        void this.handleWorkerApi(pluginId, plugin, message as unknown as WorkerApiMessage)
        break
      case 'notify': {
        /**
         * 权限校验（D-05）：worker 侧 notify.send 不经过 createSandbox 的权限裁剪
         * （那是 vm 路径），此前 utilityProcess 里的插件只要发一条 notify 消息
         * 就能弹系统通知，无需声明 notify 权限——等于权限系统在生产路径上失效。
         */
        const permissions = new Set(plugin.manifest.permissions || [])
        if (!permissions.has('notify')) {
          logger.warn(`[Plugin:${pluginId}] 插件未声明 notify 权限，通知已丢弃`)
          break
        }
        this.showPluginNotification(plugin, String(message.title ?? ''), String(message.body ?? ''))
        break
      }
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
    // 绑定调用发生时的 worker：异步 RPC 返回时插件可能已被重启，
    // 此时回复必须发给"发起请求的那一代"，否则新实例会收到不属于它的响应。
    const worker = plugin.worker
    const generation = plugin.generation
    const respond = (ok: boolean, value?: unknown, error?: string): void => {
      if (!worker || plugin.generation !== generation) return
      try {
        worker.postMessage({ type: 'api-response', id: message.id, ok, value, error })
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
        // 白名单 + 脱敏（D-05）：未授权键返回 undefined，密钥字段永不出主进程
        respond(true, readPluginSetting(getSettingsFresh(), key))
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

  /**
   * 停止插件进程；kill=false 仅断开引用（调用方负责 postMessage）。
   *
   * 这里递增 generation（D-04）：一旦停用，旧 worker 后续的 message/exit
   * 都属于过期代次，必须被忽略——否则"禁用后立刻启用"时，旧进程的 exit
   * 事件会把刚建好的新 worker 引用清空，插件变成既无进程也不会重启的僵尸。
   */
  private stopWorker(plugin: ManagedPlugin, kill: boolean): void {
    const worker = plugin.worker
    plugin.generation += 1
    plugin.worker = undefined
    plugin.workerReady = false
    if (!worker) return
    try { worker.postMessage({ type: 'deactivate' }) } catch { /* ignore */ }
    if (kill) {
      const timer = setTimeout(() => { try { worker.kill() } catch { /* ignore */ } }, 400)
      timer.unref?.()
    }
  }

  /**
   * 终止指定代次的 worker（D-16 加载超时路径）。
   *
   * 先发 terminate 让 worker 自己清理已注册的定时器并退出，再兜底 kill：
   * 插件入口死循环时只 kill 进程，宿主侧不会留下任何残留状态。
   * 代次不匹配说明该 worker 早已被替换，直接忽略，避免误杀新进程。
   */
  private terminateWorker(plugin: ManagedPlugin, generation: number): void {
    if (plugin.generation !== generation) return
    const worker = plugin.worker
    plugin.generation += 1
    plugin.worker = undefined
    plugin.workerReady = false
    if (!worker) return
    try { worker.postMessage({ type: 'terminate' }) } catch { /* ignore */ }
    const timer = setTimeout(() => { try { worker.kill() } catch { /* ignore */ } }, 200)
    timer.unref?.()
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
        // 与 worker 路径共用 readPluginSetting：白名单 + 密钥剔除口径必须一致。
        get: (key: string) => readPluginSetting(getSettingsFresh(), key)
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
    options: { upgrade?: boolean; developerMode?: boolean } = {}
  ): Promise<{ success: boolean; error?: string; plugin?: PluginInfo; warning?: string }> {
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

      /**
       * 签名校验（D-02）：**默认强制**。
       *
       * 此前只有在调用方传入了可信发布者时才校验签名，而默认配置的清单是空数组，
       * 于是"默认安装任何未签名插件"——市场里被投毒的条目可以直接执行。
       * 现在：调用方传空清单时回落到内置官方公钥集合，未签名包一律拒绝；
       * 唯一例外是用户显式开启的开发者模式（本地自建插件），且安装结果带警告。
       */
      const configured = trustedPublishers.map(key => String(key || '').trim()).filter(Boolean)
      const publishers = configured.length > 0 ? configured : [...DEFAULT_TRUSTED_PLUGIN_PUBLISHERS]
      const developerMode = options.developerMode ?? getSettingsFresh().pluginMarket?.developerMode === true
      let warning: string | undefined
      if (!entry.signature) {
        if (!developerMode) return { success: false, error: 'SIGNATURE_REQUIRED' }
        warning = 'UNSIGNED_DEVELOPER_MODE'
        logger.warn(`[PluginManager] 开发者模式：允许安装未签名插件 ${id}`)
      } else if (!publishers.some(publicKey => this.verifyPluginSignature(buffer, entry.signature as string, publicKey))) {
        if (!developerMode) return { success: false, error: 'SIGNATURE_INVALID' }
        warning = 'SIGNATURE_INVALID_DEVELOPER_MODE'
        logger.warn(`[PluginManager] 开发者模式：允许安装签名无效的插件 ${id}`)
      }

      const mainName = path.basename(String(entry.main || 'index.js'))
      if (!/^[a-zA-Z0-9._-]+\.js$/.test(mainName)) return { success: false, error: 'INVALID_MAIN' }

      const manifest: PluginManifest = {
        id,
        name: String(entry.name || id),
        version: String(entry.version || '0.0.0'),
        description: entry.description,
        author: entry.author,
        main: mainName,
        permissions: Array.isArray(entry.permissions) ? entry.permissions : []
      }

      /**
       * 安装/升级的原子性（D-02 验收项：升级写入失败时旧插件仍可用）。
       *
       * 旧实现是"先 rmSync 旧目录，再 mkdir + 写文件"：一旦写盘中途失败
       * （磁盘满、被杀毒软件锁文件、断电），用户既没有新版本也没有旧版本，
       * 插件目录变成半个空壳。现在改为：
       *   1. 全部内容先写到同级临时目录（同分区才能 rename）；
       *   2. 校验通过后把旧目录 rename 成备份；
       *   3. 临时目录 rename 成正式目录；
       *   4. 成功才删备份；任何一步失败都把备份 rename 回去并清理临时目录。
       * 在 rename 成功之前不触碰 plugins Map 与停用列表，所以失败时旧插件
       * 依然在运行/可启用，用户看到的是一个明确的错误而不是插件消失。
       */
      const tempPath = `${targetPath}.tmp-${Date.now()}-${process.pid}`
      const backupPath = `${targetPath}.bak-${Date.now()}-${process.pid}`
      const existing = alreadyExists ? this.plugins.get(id) : undefined
      const wasEnabled = existing?.enabled === true
      try {
        fs.mkdirSync(tempPath, { recursive: false })
        fs.writeFileSync(path.join(tempPath, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8')
        fs.writeFileSync(path.join(tempPath, mainName), buffer)
        fs.writeFileSync(path.join(tempPath, '.market.json'), JSON.stringify({
          publisher: entry.publisher ?? null,
          signature: entry.signature ?? null,
          sha256: expected,
          installedAt: new Date().toISOString(),
          developerMode: warning ? true : undefined
        }, null, 2), 'utf-8')

        if (alreadyExists) {
          try {
            fs.renameSync(targetPath, backupPath)
          } catch (error) {
            logger.error('[PluginManager] 升级失败：无法移走旧插件目录，已保留旧版本', error)
            return { success: false, error: 'UPGRADE_FAILED' }
          }
          try {
            fs.renameSync(tempPath, targetPath)
          } catch (error) {
            logger.error('[PluginManager] 升级失败：无法写入新插件目录，正在回滚', error)
            try { fs.renameSync(backupPath, targetPath) } catch (rollbackError) {
              logger.error('[PluginManager] 回滚失败，旧插件目录保留在备份路径:', rollbackError, backupPath)
            }
            return { success: false, error: 'UPGRADE_FAILED' }
          }
          fs.rmSync(backupPath, { recursive: true, force: true })
        } else {
          try {
            fs.renameSync(tempPath, targetPath)
          } catch (error) {
            logger.error('[PluginManager] 安装失败：无法落盘插件目录', error)
            return { success: false, error: 'INSTALL_FAILED' }
          }
        }
      } finally {
        // 无论成功失败都不留临时目录（rename 成功后它已不存在）
        if (fs.existsSync(tempPath)) {
          try { fs.rmSync(tempPath, { recursive: true, force: true }) } catch { /* ignore */ }
        }
      }

      // 磁盘上的新版本已就位，此时才切换运行时状态。
      if (existing) this.stopWorker(existing, true)
      this.plugins.delete(id)
      const disabledList = this.getDisabledList()
      if (alreadyExists) {
        // 升级保留原启用状态：原来启用的从停用列表移除，原来停用的保持停用
        if (wasEnabled) disabledList.delete(id)
        else disabledList.add(id)
      } else {
        // 新装默认**不自动启用**（D-02 验收项）：插件代码来自网络，
        // 用户确认权限后再手动启用，避免"装完即运行"。
        disabledList.add(id)
      }
      this.saveDisabledList(disabledList)

      // loadPlugin 会按 disabledPlugins 状态决定是否激活；不要再调用 enable()，
      // 否则启用中的插件会被 activatePlugin 两次（两个 worker/定时器）。
      this.loadPlugin(id, disabledList)
      const plugin = this.plugins.get(id)
      return { success: true, warning, plugin: plugin ? {
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

  /**
   * 验证插件入口签名（D-02）：**只接受 Ed25519**。
   *
   * 旧实现先试 Ed25519 再回退 `crypto.verify('sha256', ...)`（RSA/ECDSA），
   * 等于给攻击者留了一条降级路径：发布者清单里混入一把 RSA 公钥，或者
   * 换个算法重签，就能绕过"官方用 Ed25519 签名"这条约定。现在密钥类型
   * 不匹配直接判失败，与 verifyRegistrySignature 的口径保持一致。
   */
  private verifyPluginSignature(data: Buffer, signatureBase64: string, publicKey: string): boolean {
    try {
      const signature = Buffer.from(signatureBase64, 'base64')
      if (signature.length === 0) return false
      const key = crypto.createPublicKey(publicKey)
      if (key.asymmetricKeyType !== 'ed25519') return false
      return crypto.verify(null, data, key, signature)
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
