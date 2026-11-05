import { dialog, shell, app, Notification, clipboard, session } from 'electron'
import { execFile } from 'child_process'
import { WindowController } from './WindowController'
import { TrayController } from './TrayController'
import { Aria2Controller } from './Aria2Controller'
import { UpdateController } from './UpdateController'
import Store from 'electron-store'
import * as path from 'path'
import * as fs from 'fs'
import { registerSecureHandler, registerSecureListener } from '../utils/ipcSecurity'
import { getSettingsFresh, saveSettings } from '../utils/settingsAccessor'
import { probeDownloadFileName, resolveConflictingFileName } from '../utils/downloadNameProbe'
import { isAllowedExternalUrl } from '../utils/externalUrlCore'
import { undoDuplicatedSegment } from '../utils/pathRepair'
import { isPathInside } from '../utils/pathContainment'
import { checkYtdlpAvailable, getVideoInfo, getFormatUrl, installYtdlp, checkYtdlpUpdate } from '../services/ytdlpService'
import { checkFfmpegAvailable, installFfmpeg, checkFfmpegUpdate } from '../services/ffmpegService'
import { startStreamDownload, cancelStreamDownload, type StreamDownloadRequest } from '../services/streamDownloadService'
import { extractArchive } from '../services/archiveService'
import { upnpService } from '../services/upnpService'
import { getAutoLaunchEnabled, setAutoLaunchEnabled } from '../services/autoLaunch'
import { PluginManager } from '../services/pluginManager'
import { createLogger, getLogFilePaths } from '../utils/logger'
// 主进程产物是 CJS，运行时无法解析 @/ 别名，必须用相对路径引入 src/shared
import { resolveBaseDownloadDir } from '../../src/shared/fileCategories'
import type { ExtensionConnection } from '../../src/shared/extensionVersion'
import type { StoreData, AppSettings } from '../types/store'

// 本文件日志文案自带 [IpcController] 前缀（历史风格），故 scope 传空避免前缀重复
const logger = createLogger('')

/** 允许通过 get/set-store-value 访问的 store 键白名单 */
const ALLOWED_STORE_KEYS = new Set([
  'settings',
  'windowState'
])

/**
 * 系统代理探测目标（多候选）：PAC 脚本常按域名分流（国内直连/国外代理），
 * 单一目标的结果会失真，依次探测并取第一个非 DIRECT 的结果。
 */
const PROXY_PROBE_URLS = [
  'http://www.msftconnecttest.com/connecttest.txt',
  'http://www.baidu.com/',
  'http://www.google.com/generate_204'
]

/**
 * 执行系统命令并等待其结束。
 *
 * 为什么不用 child_process 的 exec 那种"整条字符串走 shell"的形式：
 * 1) exec 的错误是**异步**投递到回调的，外层 try/catch 根本捕不到——
 *    关机/休眠失败时仍会返回 `{ success: true }`，用户以为已经生效
 *    （"下载完成后关机"失效却毫无提示）；
 * 2) 字符串形式要走 shell 解释。本模块全部调用点都是**字面量常量**
 *    （shutdown/osascript/systemctl，见下方各 handler），不存在用户输入参与拼接，
 *    但静态审查无法证明这一点——execFile + 数组参数不经 shell，
 *    从机制上杜绝"命令与参数被 shell 二次解释"的可能。
 */
function runSystemCommand(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

/**
 * 判定路径是否位于下载根目录内（realpath + 大小写不敏感比较）。
 *
 * 与 delete-files 用同一口径：先解析符号链接，再做前缀比较，
 * 避免"校验时是链接、删除时已指向别处"的 TOCTOU 绕过。
 */
async function isInsideDownloadRoot(targetPath: string, rootDir: string): Promise<boolean> {
  const realPathIfExists = async (p: string): Promise<string> => {
    try {
      return fs.existsSync(p) ? await fs.promises.realpath(p) : p
    } catch {
      return p
    }
  }
  const isWindows = process.platform === 'win32'
  const normalizeCase = (p: string): string => (isWindows ? p.toLowerCase() : p)

  const root = normalizeCase(await realPathIfExists(path.resolve(rootDir)))
  const target = normalizeCase(await realPathIfExists(path.resolve(targetPath)))
  return isPathInside(target, root, false)
}

export class IpcController {
  private windowController: WindowController
  private trayController: TrayController
  private aria2Controller: Aria2Controller
  private updateController: UpdateController
  private store: Store<StoreData>
  private pluginManager: PluginManager
  /** 浏览器扩展最近连接取值器：由 main 在构造扩展接口服务后注入（见 attachExtensionStatusProvider） */
  private extensionConnectionProvider: (() => ExtensionConnection) | null = null

  constructor(
    windowController: WindowController,
    trayController: TrayController,
    aria2Controller: Aria2Controller,
    store: Store<StoreData>
  ) {
    this.windowController = windowController
    this.trayController = trayController
    this.aria2Controller = aria2Controller
    this.updateController = new UpdateController(() => windowController.getMainWindow())
    this.store = store
    this.pluginManager = new PluginManager(store)
  }

  /**
   * 注入"扩展最近连接"的取值器。
   *
   * 为什么不在构造参数里给：扩展接口服务（ExtensionApiServer）需要本控制器已建好的
   * 引擎信息等依赖，构造顺序只能是先控制器、后服务；用注入避免把两者拧成循环依赖。
   */
  public attachExtensionStatusProvider(provider: () => ExtensionConnection): void {
    this.extensionConnectionProvider = provider
  }

  /** 关闭插件管理器与应用退出时的收尾（应用退出时调用） */
  public shutdown(): void {
    this.pluginManager.shutdown()
    this.updateController.stopScheduledCheck()
  }

  public registerHandlers() {
    this.registerAppHandlers()
    this.registerFileHandlers()
    this.registerPersistedTasksHandlers()
    this.registerYtdlpHandlers()
    this.registerPluginHandlers()
    this.aria2Controller.registerIpcHandlers()
    this.pluginManager.loadAll()
    // 每日更新复查：托盘常驻的用户可能数天不重启，只靠启动检查会长期错过新版本
    this.updateController.startScheduledCheck()
  }

  /**
   * 供 ipcSecurity 工厂使用的窗口取值器。
   * 所有通道共用同一个闭包（与原先单个 validateSender 字段一致），
   * 且延迟到事件触发时才取主窗口——因此构造期 this.windowController 尚未赋值也无影响。
   */
  private windowRef = () => this.windowController.getMainWindow()

  /**
   * 应用类通道。
   *
   * 统一经 ipcSecurity 的工厂注册：来源校验由工厂在结构上保证，不再逐条手写
   * `if (!this.validateSender(event)) return ...`（迁移前的 45 处样板）。
   * `failureValue` 为校验失败时返回渲染层的值，逐一对应迁移前的形态——渲染层依赖这些语义，
   * 因此**不能**统一处理；省略即表示沿用默认的 `{success:false,error:'Unauthorized'}`。
   * 无额外入参的 handler 已去掉未使用的 event 形参。
   */
  private registerAppHandlers() {
    registerSecureHandler('get-app-version', () => app.getVersion(), { getMainWindow: this.windowRef })

    // 浏览器扩展最近一次连接（版本 + 时间）：用于设置页提示"扩展是不是旧版"。
    // 扩展接口服务在本控制器之后构造，因此用 attach 注入取值器，而不是构造参数
    registerSecureHandler('get-extension-status', () => ({
      appVersion: app.getVersion(),
      connection: this.extensionConnectionProvider?.() ?? { version: null, lastSeenAt: null }
    }), { getMainWindow: this.windowRef })

    // 应用默认下载目录（Windows 系统"下载"文件夹）
    registerSecureHandler('get-default-download-dir', () => ({
      success: true,
      path: app.getPath('downloads').replace(/\\/g, '/')
    }), { getMainWindow: this.windowRef })

    // 开机自启：查询当前状态（Windows/macOS 走系统登录项，Linux 查 XDG autostart 文件）
    registerSecureHandler('get-auto-launch', () => {
      try {
        return { success: true, enabled: getAutoLaunchEnabled() }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    }, { getMainWindow: this.windowRef })

    // 开机自启：设置启用/禁用（三平台，见 services/autoLaunch 的说明）
    registerSecureHandler('set-auto-launch', (event, enabled: boolean) => {
      try {
        setAutoLaunchEnabled(!!enabled)
        // 回报真实状态：写入可能被系统策略拦下，避免"显示已开启但实际没生效"
        return { success: true, enabled: getAutoLaunchEnabled() }
      } catch (e) {
        logger.warn('[IpcController] 设置开机自启失败:', e)
        return { success: false, error: String(e) }
      }
    }, { getMainWindow: this.windowRef })

    // 自动更新：检查更新（只检查不下载，由用户确认后再下载）
    registerSecureHandler('check-for-updates', async () => await this.updateController.checkForUpdates(), {
      getMainWindow: this.windowRef,
      failureValue: { success: false, hasUpdate: false, error: 'Unauthorized' }
    })

    // 自动更新：启动时后台检查（只提醒，不下载）
    registerSecureHandler('check-updates-on-startup', async () => await this.updateController.checkForUpdatesOnStartup(), {
      getMainWindow: this.windowRef,
      failureValue: { success: false, hasUpdate: false, error: 'Unauthorized' }
    })

    // 自动更新：下载最新版本安装包（用户在更新弹窗中确认后调用）
    registerSecureHandler('download-update', async () => await this.updateController.downloadUpdate(), {
      getMainWindow: this.windowRef
    })

    // 自动更新：重启更新（启动安装程序并退出应用）
    // 安装流程用 app.exit() 跳过 before-quit 的优雅关闭（为避免 NSIS 安装程序与旧进程死锁），
    // 因此这里要手动补两件事：
    //   1) 保存会话——否则未完成任务会从下次启动的恢复列表里消失；
    //   2) 请求 aria2 关闭（不等退出）——否则它会成为孤儿进程继续占着 RPC 端口，
    //      更新后的新版本启动引擎就会因端口占用失败。
    // 只发 RPC、不等待进程退出，所以不会拖慢退出，也不会与安装程序互等（原注释担心的死锁）。
    registerSecureHandler('restart-and-install', async () => {
      const saved = await this.aria2Controller.saveSession(3000)
      if (!saved.success) {
        logger.warn('[IpcController] 更新安装前保存 aria2 会话失败，未完成任务可能从恢复列表消失:', saved.error)
      }
      this.aria2Controller.requestShutdown()
      return await this.updateController.restartAndInstall()
    }, { getMainWindow: this.windowRef })

    registerSecureHandler('set-tray-enabled', (event, enabled: boolean) => {
      if (enabled) {
        this.trayController.createTray()
      } else {
        this.trayController.destroy()
      }
      // 如实回报：托盘可能创建失败（图标缺失、系统限制），
      // 一律返回 success 会让用户以为托盘已启用，最小化后却找不到图标。
      const active = this.trayController.getTray() !== null
      return { success: active === !!enabled, enabled: active }
    }, { getMainWindow: this.windowRef })

    registerSecureHandler('set-window-theme', (event, isDark: boolean) => {
      this.windowController.setWindowTheme(isDark)
      return { success: true }
    }, { getMainWindow: this.windowRef })

    // fire-and-forget 通道：渲染层不消费返回值，故失败时显式返回 undefined（而非默认的 Unauthorized 对象）
    registerSecureHandler('set-taskbar-progress', (event, progress: number, mode?: string) => {
      this.windowController.setTaskbarProgress(progress, (mode as 'normal' | 'error' | 'paused') || 'normal')
    }, { getMainWindow: this.windowRef, failureValue: undefined })

    registerSecureHandler('system-shutdown', async () => {
      try {
        if (process.platform === 'win32') {
          await runSystemCommand('shutdown', ['/s', '/t', '60']) // 60 秒后关机
        } else if (process.platform === 'darwin') {
          await runSystemCommand('osascript', ['-e', 'tell app "System Events" to shut down'])
        } else {
          await runSystemCommand('shutdown', ['-h', '+1'])
        }
        return { success: true }
      } catch (e) {
        logger.warn('[IpcController] 关机命令执行失败:', e)
        return { success: false, error: String(e) }
      }
    }, { getMainWindow: this.windowRef })

    registerSecureHandler('system-hibernate', async () => {
      try {
        if (process.platform === 'win32') {
          await runSystemCommand('shutdown', ['/h'])
        } else if (process.platform === 'darwin') {
          await runSystemCommand('osascript', ['-e', 'tell app "System Events" to sleep'])
        } else {
          await runSystemCommand('systemctl', ['suspend'])
        }
        return { success: true }
      } catch (e) {
        logger.warn('[IpcController] 休眠命令执行失败:', e)
        return { success: false, error: String(e) }
      }
    }, { getMainWindow: this.windowRef })

    registerSecureHandler('read-clipboard', () => {
      try {
        return clipboard.readText() || ''
      } catch {
        return ''
      }
    }, { getMainWindow: this.windowRef, failureValue: '' })

    // 写剪贴板：sandbox:true 下渲染层 preload 拿不到 clipboard 模块，统一经主进程。
    // 用途：设置页「复制密钥」——用户要把 RPC 密钥填进浏览器扩展，手工选中很费劲。
    registerSecureHandler('write-clipboard', (_event, text: string) => {
      try {
        // 只接受字符串并限制长度：剪贴板是共享资源，避免被塞入异常内容
        clipboard.writeText(String(text ?? '').slice(0, 64 * 1024))
        return true
      } catch {
        return false
      }
    }, { getMainWindow: this.windowRef, failureValue: false })

    registerSecureHandler('detect-system-proxy', async () => {
      try {
        for (const target of PROXY_PROBE_URLS) {
          let proxy = ''
          try {
            proxy = await session.defaultSession.resolveProxy(target)
          } catch {
            continue // 单个目标探测失败，尝试下一个
          }
          if (proxy && proxy !== 'DIRECT') {
            // proxy 格式如 "PROXY host:port" 或 "SOCKS5 host:port"
            const match = proxy.match(/^(?:PROXY|SOCKS5?|HTTPS)\s+(.+)$/i)
            const proxyUrl = match ? match[1] : proxy
            const protocol = proxy.startsWith('SOCKS') ? 'socks5' : 'http'
            return { success: true, proxy: `${protocol}://${proxyUrl}` }
          }
        }
        return { success: true, proxy: '' }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    }, { getMainWindow: this.windowRef })

    // 系统通知（通过 Electron Notification API，比 Web API 更可靠）
    // 注：点击回调里的 getMainWindow()/show()/focus() 与来源校验无关，保持原样
    registerSecureHandler('send-notification', (event, title: string, body: string) => {
      try {
        if (Notification.isSupported()) {
          const notification = new Notification({ title, body, silent: false })
          notification.show()
          notification.on('click', () => {
            const win = this.windowController.getMainWindow()
            if (win && !win.isDestroyed()) {
              win.show()
              win.focus()
            }
          })
        }
      } catch (e) {
        logger.warn('[IpcController] Failed to send notification:', e)
      }
    }, { getMainWindow: this.windowRef, failureValue: undefined })

    registerSecureHandler('system-cancel-shutdown', async () => {
      if (process.platform !== 'win32') {
        // 其它平台没有等价的"取消关机"语义，如实回报而不是假装成功
        return { success: false, error: 'Cancel shutdown is only supported on Windows' }
      }
      try {
        await runSystemCommand('shutdown', ['/a'])
        return { success: true }
      } catch (e) {
        logger.warn('[IpcController] 取消关机失败（可能本就没有待执行的关机）:', e)
        return { success: false, error: String(e) }
      }
    }, { getMainWindow: this.windowRef })

    registerSecureHandler('get-store-value', (event, key: string) => {
      if (!ALLOWED_STORE_KEYS.has(key)) {
        logger.warn(`[IpcController] Blocked access to store key: ${key}`)
        return undefined
      }
      // settings 含 RPC secret：返回前解密。此处走**直读**——渲染层可能刚写入 settings 就回读，
      // 不能拿可能过期的缓存值
      if (key === 'settings') {
        return getSettingsFresh()
      }
      return this.store.get(key)
    }, { getMainWindow: this.windowRef, failureValue: undefined })

    registerSecureHandler('set-store-value', (event, key: string, value: unknown) => {
      if (!ALLOWED_STORE_KEYS.has(key)) {
        logger.warn(`[IpcController] Blocked write to store key: ${key}`)
        return { success: false, error: 'Key not allowed' }
      }
      // settings 含 RPC secret：写入前加密，磁盘上不保存明文；
      // 写入口统一走 settingsAccessor，由它保证"写入即刷新缓存"
      if (key === 'settings') {
        saveSettings(value as AppSettings)
      } else {
        this.store.set(key, value)
      }
      return { success: true }
    }, { getMainWindow: this.windowRef })

    // 注：守卫后的 `!window` 分支同样返回 {canceled:true}——与校验失败值同形但语义不同，
    // 这个业务分支必须保留
    registerSecureHandler('show-save-dialog', async (event, options: Electron.SaveDialogOptions) => {
      const window = this.windowController.getMainWindow()
      if (window) {
        return await dialog.showSaveDialog(window, options)
      }
      return { canceled: true }
    }, { getMainWindow: this.windowRef, failureValue: { canceled: true } })

    registerSecureHandler('show-open-dialog', async (event, options: Electron.OpenDialogOptions) => {
      const window = this.windowController.getMainWindow()
      if (window) {
        return await dialog.showOpenDialog(window, options)
      }
      return { canceled: true }
    }, { getMainWindow: this.windowRef, failureValue: { canceled: true } })

    // 渲染层异常日志落 electron-log：打包后用户打不开 devtools，没有这条通道，
    // 渲染进程的报错就完全不可见（用户只能描述"白屏了/不动了"）。
    // 只记录文案与堆栈，来源可信面为主窗口本身（工厂已校验）；限长防异常大对象刷爆日志。
    registerSecureListener('renderer-error', (_event, payload: { message: string; stack?: string; kind?: string }) => {
      const kind = payload?.kind ?? 'error'
      const text = String(payload?.message ?? '').slice(0, 2000)
      const stack = String(payload?.stack ?? '').slice(0, 6000)
      logger.error(`[Renderer:${kind}] ${text}${stack ? `\n${stack}` : ''}`)
    }, { getMainWindow: this.windowRef })
  }

  private registerFileHandlers() {
    /**
     * 打开外部链接（目前只用于设置页的「获取浏览器扩展」跳商店）。
     *
     * URL 由渲染层传入，所以校验必须在主进程：`shell.openExternal` 会把链接交给系统
     * 处理程序，等于把"打开任意站点、甚至唤起本机其它程序"的能力交给渲染层。
     * 判定口径（https + 站点白名单）在 utils/externalUrlCore，是可单测的纯逻辑。
     */
    registerSecureHandler('open-external-url', async (event, url: string) => {
      if (!isAllowedExternalUrl(url)) {
        // 只记协议不记原文：这是外部输入，拼进日志会带来日志注入与隐私问题
        const protocol = typeof url === 'string' ? (url.match(/^[a-z][a-z0-9+.-]*:/i)?.[0] ?? '(无协议)') : typeof url
        logger.warn('[IpcController] 已拦截非白名单外链，协议:', protocol)
        return { success: false, error: 'url_not_allowed' }
      }
      try {
        await shell.openExternal(url)
        return { success: true }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    }, { getMainWindow: this.windowRef })

    registerSecureHandler('show-item-in-folder', async (event, filePath: string) => {
      try {
        const normalizedPath = path.normalize(filePath)
        if (!fs.existsSync(normalizedPath)) return { success: false, error: 'Path not found' }
        shell.showItemInFolder(normalizedPath)
        return { success: true }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    }, { getMainWindow: this.windowRef })

    registerSecureHandler('open-in-explorer', async (event, filePath: string) => {
      try {
        const normalizedPath = path.normalize(filePath)
        if (fs.existsSync(normalizedPath)) {
          // 文件存在时在资源管理器中定位并选中它
          shell.showItemInFolder(normalizedPath)
          return { success: true }
        }
        // 文件尚未生成时，退化为打开其所在目录
        const dir = path.dirname(normalizedPath)
        if (fs.existsSync(dir)) {
          await shell.openPath(dir)
          return { success: true }
        }
        return { success: false, error: 'Path not found' }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    }, { getMainWindow: this.windowRef })

    registerSecureHandler('open-path', async (event, filePath: string) => {
      try {
        const normalizedPath = path.normalize(filePath)
        if (!fs.existsSync(normalizedPath)) {
          // 目标文件不存在时，尝试打开其所在目录，提高可用性
          const dir = path.dirname(normalizedPath)
          if (fs.existsSync(dir)) {
            await shell.openPath(dir)
            return { success: true }
          }
          return { success: false, error: 'Path not found' }
        }
        await shell.openPath(normalizedPath)
        return { success: true }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    }, { getMainWindow: this.windowRef })

    // 下载文件名探测：网盘直链/跳转链接的 URL 里没有文件名（如 /file/<hash>?...），
    // 自动分类与 aria2 的 out 都需要真实文件名——它只在服务器响应的 Content-Disposition 头里。
    // 渲染层在"智能识别不出分类"时调用；探测器内部自带超时，任何失败都返回空串（降级为原行为）。
    // 显式标注泛型：异步 handler + 字符串失败值，需要 R=Promise<string> 才能通过工厂的类型检查
    registerSecureHandler<[string], Promise<string>>(
      'download-probe-filename',
      async (_event, url) => await probeDownloadFileName(url),
      { getMainWindow: this.windowRef, failureValue: '' }
    )

    // 下载重名处理：continue=true 时 aria2 会把已存在的同名完整文件当作"可续传的同一任务"，
    // 大小一致就秒完成——auto-file-renaming 根本不会生效。渲染层提交前用它检查目标文件，
    // 存在且无 .aria2 控制文件时拿到带序号的空闲名字（浏览器风格），让重复下载得到一份新副本；
    // 存在 .aria2 控制文件说明上次下载被中断，保持原名让 aria2 正常续传。
    registerSecureHandler<[string, string], Promise<{ fileName: string; conflict: boolean }>>(
      'resolve-download-conflict',
      async (_event, dir, fileName) => await resolveConflictingFileName(dir, fileName),
      { getMainWindow: this.windowRef, failureValue: { fileName: '', conflict: false } }
    )

    // 磁盘剩余空间查询（渲染层新建任务提交前预检，见 utils/diskSpace.ts 的判定）。
    // 只读 statfs，只返回聚合数值（free/total 字节数），不泄露目录内容；
    // 非绝对路径 / 超长路径直接返回未知哨兵，statfs 失败（目录尚未创建等）同样回落——
    // 预检是尽力而为，不能因此阻塞正常任务。
    registerSecureHandler<[string], Promise<{ free: number; total: number }>>(
      'get-disk-free-space',
      async (_event, dir) => {
        if (typeof dir !== 'string' || !path.isAbsolute(dir) || dir.length > 4096) {
          return { free: -1, total: -1 }
        }
        try {
          const stats = await fs.promises.statfs(path.normalize(dir))
          return {
            free: Number(stats.bavail) * Number(stats.bsize),
            total: Number(stats.blocks) * Number(stats.bsize)
          }
        } catch {
          return { free: -1, total: -1 }
        }
      },
      { getMainWindow: this.windowRef, failureValue: { free: -1, total: -1 } }
    )

    // UPnP 端口映射状态查询与手动重映射（BT 设置页展示）
    registerSecureHandler<[], Promise<{ state: string; externalIp?: string; ports?: number[]; message?: string }>>(
      'get-upnp-status',
      async () => await Promise.resolve(upnpService.getStatus()),
      { getMainWindow: this.windowRef, failureValue: { state: 'error', message: 'unauthorized' } }
    )
    registerSecureHandler<[], Promise<{ state: string; externalIp?: string; ports?: number[]; message?: string }>>(
      'upnp-remap',
      async () => await upnpService.mapNow(),
      { getMainWindow: this.windowRef, failureValue: { state: 'error', message: 'unauthorized' } }
    )

    /**
     * 下载完成后自动解压（渲染层在任务完成时调用，仅在设置开启时触发）。
     *
     * 与 delete-files 同一套路径边界：压缩包必须落在用户配置的下载目录内，
     * 否则等于把"解压任意目录下的文件"能力交给了渲染层。
     * 具体格式支持与执行细节见 services/archiveService。
     */
    registerSecureHandler<[string], Promise<{ success: boolean; extracted: boolean; reason?: string; targetDir?: string }>>(
      'archive-extract',
      async (_event, filePath) => {
        if (typeof filePath !== 'string' || !filePath.trim()) {
          return { success: false, extracted: false, reason: 'invalid_path' }
        }
        // 基础目录口径与新建任务/引擎默认目录一致：设置未配置时回落到系统「下载」目录
        //（aria2.conf 的 dir 默认值同样是 app.getPath('downloads')，否则全新配置下
        //  「自动解压 / 删除文件」会把所有路径都判为越界）
        const baseDir = resolveBaseDownloadDir(getSettingsFresh() ?? undefined) || app.getPath('downloads')
        const target = path.resolve(path.normalize(filePath.trim()))
        if (!baseDir || !(await isInsideDownloadRoot(target, baseDir))) {
          logger.warn('[IpcController] 拦截解压：路径不在下载目录内')
          return { success: false, extracted: false, reason: 'path_not_allowed' }
        }
        return await extractArchive(target)
      },
      { getMainWindow: this.windowRef, failureValue: { success: false, extracted: false, reason: 'Unauthorized' } }
    )

    registerSecureHandler('delete-files', async (event, filePaths: string[], taskDir?: string) => {
      // 允许删除文件的根目录集合：基础下载目录 + 调用方传入的任务实际目录
      // （任务可下载到非默认目录，按任务目录放宽白名单）
      // 走**直读**：此值参与安全判定，用户刚改完下载目录就点删除时不能用到旧值。
      // 基础目录口径与渲染层/扩展接口统一走 resolveBaseDownloadDir
      const settings = getSettingsFresh()
      const allowedRoots: string[] = []
      // 与 archive-extract 同一口径：设置未配置时用系统「下载」目录兜底
      const settingDir = resolveBaseDownloadDir(settings ?? undefined) || app.getPath('downloads')
      if (settingDir) allowedRoots.push(path.resolve(settingDir))
      // 未配置任何允许目录时拒绝所有删除操作，防止任意路径被删
      if (allowedRoots.length === 0) {
        logger.warn('[IpcController] Blocked deletion: no download dir configured')
        return { success: false, error: 'Download dir not configured' }
      }

      // 预解析符号链接并做大小写不敏感比较（Windows 文件系统大小写不敏感）
      const isWindows = process.platform === 'win32'
      // 返回路径的真实路径；路径不存在或 realpath 失败时保留原路径
      const realPathIfExists = async (p: string): Promise<string> => {
        try {
          return fs.existsSync(p) ? await fs.promises.realpath(p) : p
        } catch {
          return p
        }
      }
      const normalizedRoots = (await Promise.all(allowedRoots.map(realPathIfExists)))
        .map(real => (isWindows ? real.toLowerCase() : real))
      // 判定路径是否落在任一允许根目录下（下载目录就是盘符根时也不会误判）
      const isAllowed = (norm: string): boolean =>
        normalizedRoots.some(root => isPathInside(norm, root, false))

      // taskDir 由渲染进程传入，必须落在已配置下载目录的子树内，防止删除任意目录文件
      if (taskDir && taskDir.trim()) {
        const realTaskDir = await realPathIfExists(path.resolve(taskDir.trim()))
        const normTaskDir = isWindows ? realTaskDir.toLowerCase() : realTaskDir
        if (!isAllowed(normTaskDir)) {
          logger.warn(`[IpcController] Blocked taskDir outside allowed roots: ${realTaskDir}`)
          return { success: false, error: 'taskDir outside allowed root' }
        }
        // 校验通过后放宽白名单，允许删除该任务目录下文件
        allowedRoots.push(path.resolve(taskDir.trim()))
        normalizedRoots.push(normTaskDir)
      }

      const results: unknown[] = []
      for (const p of filePaths) {
        try {
          const normalized = path.resolve(path.normalize(p))

          // 校验文件路径是否在允许的目录范围内
          const target = await realPathIfExists(normalized)
          const normTarget = isWindows ? target.toLowerCase() : target
          if (!isAllowed(normTarget)) {
            logger.warn(`[IpcController] Blocked deletion of path outside allowed dirs: ${target}`)
            results.push({ path: p, success: false, error: 'Path outside allowed directory' })
            continue
          }

          // 删除时使用校验阶段的 realpath 目标（target），而非二次 path.normalize，
          // 减小 TOCTOU 窗口：符号链接在校验与被删之间被替换时，不会沿新链接删除目录外文件
          try {
            // 先 stat 确认存在：不存在时返回 Not found，而不是让 trashItem 抛出模糊错误
            await fs.promises.stat(target)
            // 移到系统回收站（Windows 回收站 / macOS 废纸篓 / Linux Trash），误删可恢复
            await shell.trashItem(target)
            results.push({ path: p, success: true })
          } catch (statErr) {
            if ((statErr as NodeJS.ErrnoException).code === 'ENOENT') {
              // aria2 偶尔上报"首层目录重复"的路径（如 D:\Downloads\Downloads\x）。
              // 只在原路径确实不存在时才用修正结果兜底：无条件改写会把用户真的放在
              // 同名子目录里的文件，删成上层目录里的另一个同名文件（见 utils/pathRepair.ts）。
              const repaired = undoDuplicatedSegment(target)
              const repairedReal = repaired ? await realPathIfExists(repaired) : null
              const repairedNorm = repairedReal
                ? (isWindows ? repairedReal.toLowerCase() : repairedReal)
                : null
              if (repairedReal && repairedNorm && isAllowed(repairedNorm)) {
                try {
                  await fs.promises.stat(repairedReal)
                  await shell.trashItem(repairedReal)
                  logger.info(`[IpcController] 原路径不存在，已按修正后的路径删除: ${repairedReal}`)
                  results.push({ path: p, success: true, repairedPath: repairedReal })
                  continue
                } catch (repairErr) {
                  if ((repairErr as NodeJS.ErrnoException).code !== 'ENOENT') throw repairErr
                }
              }
              results.push({ path: p, success: false, error: 'Not found' })
            } else {
              throw statErr
            }
          }
        } catch (e) {
          results.push({ path: p, success: false, error: String(e) })
        }
      }
      return { success: true, results }
    }, { getMainWindow: this.windowRef })
  }

  /** 已完成任务记录持久化到 userData（替代 localStorage，规避配额限制） */
  private registerPersistedTasksHandlers() {
    const filePath = path.join(app.getPath('userData'), 'persisted-tasks.json')

    // 失败态为 {}（渲染层按对象消费），非默认的 Unauthorized 对象
    registerSecureHandler('persisted-tasks-load', async () => {
      try {
        if (!fs.existsSync(filePath)) return {}
        // 使用异步 IO，避免大文件（上限 10MB）读写阻塞主进程事件循环
        const content = await fs.promises.readFile(filePath, 'utf-8')
        return JSON.parse(content || '{}')
      } catch (e) {
        logger.error('[IpcController] Failed to load persisted tasks:', e)
        return {}
      }
    }, { getMainWindow: this.windowRef, failureValue: {} })

    registerSecureHandler('persisted-tasks-save', async (event, data: unknown) => {
      try {
        const serialized = JSON.stringify(data ?? {})
        // 序列化大小上限：防止异常/恶意数据写超大文件到 userData
        if (serialized.length > 10 * 1024 * 1024) return { success: false, error: 'Data too large' }
        const dir = path.dirname(filePath)
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
        await fs.promises.writeFile(filePath, serialized, { encoding: 'utf-8', mode: 0o600 })
        return { success: true }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    }, { getMainWindow: this.windowRef })
  }

  /** yt-dlp / ffmpeg 流媒体能力（按需下载） */
  private registerYtdlpHandlers() {
    registerSecureHandler('ytdlp-check', async () => await checkYtdlpAvailable(), {
      getMainWindow: this.windowRef,
      failureValue: { available: false, installable: false, error: 'Unauthorized' }
    })

    // 下载/校验/替换都在主进程完成；进度经独立事件推给渲染层（invoke 本身只返回最终结果）
    registerSecureHandler('ytdlp-install', async (event) => {
      return await installYtdlp((progress) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('ytdlp-install-progress', progress)
        }
      })
    }, {
      getMainWindow: this.windowRef,
      failureValue: { success: false, error: 'Unauthorized' }
    })

    registerSecureHandler('ytdlp-check-update', async () => await checkYtdlpUpdate(), {
      getMainWindow: this.windowRef,
      failureValue: { success: false, updateAvailable: false, checkable: false, error: 'Unauthorized' }
    })

    registerSecureHandler('ffmpeg-check', async () => await checkFfmpegAvailable(), {
      getMainWindow: this.windowRef,
      failureValue: { available: false, installable: false, error: 'Unauthorized' }
    })

    registerSecureHandler('ffmpeg-check-update', async () => await checkFfmpegUpdate(), {
      getMainWindow: this.windowRef,
      failureValue: { success: false, updateAvailable: false, checkable: false, error: 'Unauthorized' }
    })

    registerSecureHandler('ffmpeg-install', async (event) => {
      return await installFfmpeg((progress) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('ffmpeg-install-progress', progress)
        }
      })
    }, {
      getMainWindow: this.windowRef,
      failureValue: { success: false, error: 'Unauthorized' }
    })

    // yt-dlp 下载模式（需要合并音轨时使用）：进度/完成/失败/取消走事件通道
    registerSecureHandler('stream-download-start', async (event, request: unknown) => {
      const input = request as Partial<StreamDownloadRequest> | null
      if (
        !input
        || typeof input.url !== 'string'
        || (input.formatId !== undefined && typeof input.formatId !== 'string')
        || (input.merge !== undefined && typeof input.merge !== 'boolean')
        || (input.title !== undefined && typeof input.title !== 'string')
        || typeof input.outputDir !== 'string'
      ) {
        return { success: false, code: 'invalid_request', error: 'Invalid request' }
      }
      return await startStreamDownload(
        { url: input.url, formatId: input.formatId, merge: input.merge, title: input.title, outputDir: input.outputDir },
        (streamEvent) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send('stream-download-event', streamEvent)
          }
        }
      )
    }, {
      getMainWindow: this.windowRef,
      failureValue: { success: false, code: 'invalid_request', error: 'Unauthorized' }
    })

    registerSecureHandler('stream-download-cancel', (event, id: unknown) => {
      if (typeof id !== 'string' || !id) return false
      return cancelStreamDownload(id)
    }, {
      getMainWindow: this.windowRef,
      failureValue: false
    })

    registerSecureHandler('ytdlp-video-info', async (event, url: string) => await getVideoInfo(url), {
      getMainWindow: this.windowRef
    })

    registerSecureHandler('ytdlp-format-url', async (event, url: string, formatId: string) =>
      await getFormatUrl(url, formatId), { getMainWindow: this.windowRef })
  }

  /** 插件管理 */
  private registerPluginHandlers() {
    // 下载事件转发：aria2 的通知由渲染层的 WebSocket 收到，这里接过来喂给插件系统。
    // 入参逐项校验（IPC 边界不信任调用方），非法值一律丢弃。
    registerSecureListener('download-event', (_event, kind: unknown, gid: unknown, name: unknown) => {
      if (kind !== 'downloadComplete' && kind !== 'downloadStart') return
      if (typeof gid !== 'string' || !gid) return
      this.pluginManager.emit(kind, { gid, name: typeof name === 'string' ? name : '' })
    }, { getMainWindow: this.windowRef })

    // 失败态为 []（渲染层按数组消费）
    registerSecureHandler('plugins-list', () => this.pluginManager.getPlugins(), {
      getMainWindow: this.windowRef,
      failureValue: []
    })

    registerSecureHandler('plugins-enable', (event, pluginId: string) => ({
      success: this.pluginManager.enable(pluginId)
    }), { getMainWindow: this.windowRef })

    registerSecureHandler('plugins-disable', (event, pluginId: string) => ({
      success: this.pluginManager.disable(pluginId)
    }), { getMainWindow: this.windowRef })

    registerSecureHandler('plugins-uninstall', (event, pluginId: string) => ({
      success: this.pluginManager.uninstall(pluginId)
    }), { getMainWindow: this.windowRef })

    // 插件目录：返回真实路径供渲染层展示；打开目录也由主进程完成
    // （渲染层此前用 '%APPDATA%/...' 提示文本直接调 open-path，环境变量未展开必然失败）
    registerSecureHandler('plugins-dir', () => ({
      success: true,
      path: this.pluginManager.getPluginDir()
    }), { getMainWindow: this.windowRef })

    registerSecureHandler('plugins-open-dir', async () => {
      const dir = this.pluginManager.getPluginDir()
      try {
        // 目录正常情况下已由 PluginManager 创建，这里兜底防止被手动删除
        await fs.promises.mkdir(dir, { recursive: true })
        const error = await shell.openPath(dir)
        return error ? { success: false, error } : { success: true }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    }, { getMainWindow: this.windowRef })

    // 应用自身日志（<userData>/logs/main.log）：报障时用户得把这个文件附上，
    // 但它藏在深层目录里。路径由主进程从 electron-log 解析，渲染层只负责展示与打开
    registerSecureHandler('get-logs-path', () => {
      const { file, dir } = getLogFilePaths()
      return { success: true, file, dir }
    }, { getMainWindow: this.windowRef })

    registerSecureHandler('open-logs-dir', async () => {
      const { dir } = getLogFilePaths()
      try {
        // 首次启动、尚未产生任何日志时目录可能还不存在
        await fs.promises.mkdir(dir, { recursive: true })
        const error = await shell.openPath(dir)
        return error ? { success: false, error } : { success: true, dir }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    }, { getMainWindow: this.windowRef })
  }
}
