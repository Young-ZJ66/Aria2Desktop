import { dialog, shell, app, Notification, clipboard, session } from 'electron'
import { exec } from 'child_process'
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
import { checkYtdlpAvailable, getVideoInfo, getFormatUrl } from '../services/ytdlpService'
import { PluginManager } from '../services/pluginManager'
import { createLogger } from '../utils/logger'
// 主进程产物是 CJS，运行时无法解析 @/ 别名，必须用相对路径引入 src/shared
import { resolveBaseDownloadDir } from '../../src/shared/fileCategories'
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
 * 为什么不能直接 `exec(cmd)` 了事：exec 的错误是**异步**投递到回调的，
 * 外层 try/catch 根本捕不到——关机/休眠失败时仍会返回 `{ success: true }`，
 * 用户以为已经生效（"下载完成后关机"失效却毫无提示）。
 */
function runSystemCommand(command: string): Promise<void> {
  return new Promise((resolve, reject) => {
    exec(command, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

export class IpcController {
  private windowController: WindowController
  private trayController: TrayController
  private aria2Controller: Aria2Controller
  private updateController: UpdateController
  private store: Store<StoreData>
  private pluginManager: PluginManager

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

  /** 关闭插件管理器（应用退出时调用） */
  public shutdown(): void {
    this.pluginManager.shutdown()
  }

  public registerHandlers() {
    this.registerAppHandlers()
    this.registerFileHandlers()
    this.registerPersistedTasksHandlers()
    this.registerYtdlpHandlers()
    this.registerPluginHandlers()
    this.aria2Controller.registerIpcHandlers()
    this.pluginManager.loadAll()
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

    // 应用默认下载目录（Windows 系统"下载"文件夹）
    registerSecureHandler('get-default-download-dir', () => ({
      success: true,
      path: app.getPath('downloads').replace(/\\/g, '/')
    }), { getMainWindow: this.windowRef })

    // 开机自启：查询当前是否已启用（仅 Windows 支持）
    registerSecureHandler('get-auto-launch', () => {
      try {
        const openAtLogin = app.getLoginItemSettings().openAtLogin
        return { success: true, enabled: openAtLogin }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    }, { getMainWindow: this.windowRef })

    // 开机自启：设置启用/禁用（仅 Windows 支持）
    registerSecureHandler('set-auto-launch', (event, enabled: boolean) => {
      try {
        app.setLoginItemSettings({
          openAtLogin: !!enabled,
          path: process.execPath
        })
        return { success: true, enabled: !!enabled }
      } catch (e) {
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
          await runSystemCommand('shutdown /s /t 60') // 60 秒后关机
        } else if (process.platform === 'darwin') {
          await runSystemCommand('osascript -e \'tell app "System Events" to shut down\'')
        } else {
          await runSystemCommand('shutdown -h +1')
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
          await runSystemCommand('shutdown /h')
        } else if (process.platform === 'darwin') {
          await runSystemCommand('osascript -e \'tell app "System Events" to sleep\'')
        } else {
          await runSystemCommand('systemctl suspend')
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
        await runSystemCommand('shutdown /a')
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
    registerSecureHandler('show-save-dialog', async (event, options) => {
      const window = this.windowController.getMainWindow()
      if (window) {
        return await dialog.showSaveDialog(window, options)
      }
      return { canceled: true }
    }, { getMainWindow: this.windowRef, failureValue: { canceled: true } })

    registerSecureHandler('show-open-dialog', async (event, options) => {
      const window = this.windowController.getMainWindow()
      if (window) {
        return await dialog.showOpenDialog(window, options)
      }
      return { canceled: true }
    }, { getMainWindow: this.windowRef, failureValue: { canceled: true } })
  }

  private registerFileHandlers() {
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

    registerSecureHandler('delete-files', async (event, filePaths: string[], taskDir?: string) => {
      // 允许删除文件的根目录集合：基础下载目录 + 调用方传入的任务实际目录
      // （任务可下载到非默认目录，按任务目录放宽白名单）
      // 走**直读**：此值参与安全判定，用户刚改完下载目录就点删除时不能用到旧值。
      // 基础目录口径与渲染层/扩展接口统一走 resolveBaseDownloadDir
      const settings = getSettingsFresh()
      const allowedRoots: string[] = []
      const settingDir = resolveBaseDownloadDir(settings ?? undefined)
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
      // 判定路径是否落在任一允许根目录下
      const isAllowed = (norm: string): boolean =>
        normalizedRoots.some(root =>
          norm === root || norm.startsWith(root + path.sep)
        )

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
            const stats = await fs.promises.stat(target)
            if (stats.isDirectory()) {
              await fs.promises.rm(target, { recursive: true, force: true })
            } else {
              await fs.promises.unlink(target)
            }
            results.push({ path: p, success: true })
          } catch (statErr) {
            if ((statErr as NodeJS.ErrnoException).code === 'ENOENT') {
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

  /** yt-dlp 流媒体支持（可选外部引擎） */
  private registerYtdlpHandlers() {
    registerSecureHandler('ytdlp-check', async () => await checkYtdlpAvailable(), {
      getMainWindow: this.windowRef,
      failureValue: { available: false, error: 'Unauthorized' }
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
  }
}
