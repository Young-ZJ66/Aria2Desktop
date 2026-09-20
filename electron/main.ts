import { app } from 'electron'
import Store from 'electron-store'
import * as path from 'path'
import * as fs from 'fs'
import { WindowController } from './controllers/WindowController'
import { TrayController } from './controllers/TrayController'
import { Aria2Controller } from './controllers/Aria2Controller'
import { IpcController } from './controllers/IpcController'
import { AppLifecycle } from './controllers/AppLifecycle'
import { TrackerSubscriptionService } from './services/trackerSubscriptionService'
import { SpeedScheduler } from './services/speedScheduler'
import { appState } from './utils/appState'
import { bindSettingsStore, getSettings } from './utils/settingsAccessor'
import { setupLogging, createLogger } from './utils/logger'
import type { StoreData } from './types/store'

// 日志初始化尽早执行：后续所有模块的日志都走统一出口（级别/落盘策略见 utils/logger.ts）
setupLogging()
const logger = createLogger('Main')

// Windows：显式声明 AppUserModelID，让系统通知与任务栏分组归属到本应用。
// 生产环境取值必须与 electron-builder 写入快捷方式的 AUMID 一致——已核实 NSIS 模板
// (app-builder-lib/templates/nsis/include/installer.nsh) 用 WinShell::SetLnkAUMI "${APP_ID}"
// 把开始菜单/桌面快捷方式设为 build.appId，故此处取 'com.aria2desktop.app'。
// 硬编码属有意为之：运行期拿不到 build 配置，而值不一致只会静默失效；
// 因此改动 package.json 的 build.appId 时必须同步这里。
// 开发环境没有已注册的快捷方式，按 Electron 官方文档用 execPath。
// 注意：这不会让开发模式的任务栏图标变成自定义图标（任务栏取的是 exe 内嵌图标 /
// AUMID 关联快捷方式的图标），它解决的是通知归属与任务栏分组。
if (process.platform === 'win32') {
  app.setAppUserModelId(app.isPackaged ? 'com.aria2desktop.app' : process.execPath)
}

// ==========================================
// 配置和路径设置
// ==========================================

/** 应用可执行文件所在目录（仅用于定位旧版数据） */
const getAppDirectory = () => {
  if (app.isPackaged) {
    return path.dirname(process.execPath)
  } else {
    return process.cwd()
  }
}

/**
 * 数据根目录：统一使用 userData（Electron 惯例）。
 * 避免把设置 / aria2 配置 / 会话写入安装目录——
 * 提权安装到 Program Files 或便携版解压到只读位置时会写入失败。
 */
const getDataRoot = () => app.getPath('userData')

/**
 * 一次性迁移旧版数据（exe 旁的 data/ 目录）到 userData。
 * 仅当旧数据存在且新位置尚无对应文件时复制，不删除旧文件。
 * 完成一次后写入标记文件，避免每次启动重复扫描/复制。
 */
function migrateLegacyData(): void {
  const legacyDataDir = path.join(getAppDirectory(), 'data')
  if (!fs.existsSync(legacyDataDir)) return

  const flagFile = path.join(getDataRoot(), '.legacy-data-migrated')
  if (fs.existsSync(flagFile)) return

  const migrations: Array<{ from: string; to: string }> = [
    // electron-store 设置文件
    {
      from: path.join(legacyDataDir, 'config', 'aria2-desktop-settings.json'),
      to: path.join(getDataRoot(), 'config', 'aria2-desktop-settings.json')
    },
    // aria2 配置与会话文件
    {
      from: path.join(legacyDataDir, 'aria2', 'aria2.conf'),
      to: path.join(getDataRoot(), 'aria2', 'aria2.conf')
    },
    {
      from: path.join(legacyDataDir, 'aria2', 'aria2.session'),
      to: path.join(getDataRoot(), 'aria2', 'aria2.session')
    }
  ]

  for (const { from, to } of migrations) {
    try {
      if (!fs.existsSync(from) || fs.existsSync(to)) continue
      fs.mkdirSync(path.dirname(to), { recursive: true })
      fs.copyFileSync(from, to)
      logger.info(`已迁移旧版数据: ${from} -> ${to}`)
    } catch (error) {
      logger.warn(`迁移旧版数据失败 ${from}:`, error)
    }
  }

  // 无论单项迁移是否全部成功（单项失败已被吞掉），标记已完成，避免启动时重复扫描
  try {
    fs.writeFileSync(flagFile, Date.now().toString(), 'utf-8')
  } catch (error) {
    logger.warn('写入迁移标记失败:', error)
  }
}

const getConfigDirectory = () => {
  const configDir = path.join(getDataRoot(), 'config')
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true })
  }
  return configDir
}

migrateLegacyData()
const configDir = getConfigDirectory()
const store = new Store<StoreData>({
  cwd: configDir,
  name: 'aria2-desktop-settings',
  // 与 aria2.conf 保持一致：设置 JSON 可能包含 rpc-secret，限制为仅当前用户可读写
  configFileMode: 0o600
})
// 安全说明：settings.aria2.secret 与 connectionProfiles[].config.secret 已通过 safeStorage
// 加密存储（见 utils/secretCipher.ts），磁盘上不保存明文，并对旧明文数据透明兼容。

// 绑定 settings 访问器：此后主进程统一经 utils/settingsAccessor 读/写 settings
//（缓存与失效语义见该模块注释）。必须早于控制器实例化——未绑定即调用会直接抛错。
bindSettingsStore(store)

// ==========================================
// 控制器初始化
// ==========================================

const windowController = new WindowController(store)
const trayController = new TrayController(windowController)
const aria2Controller = new Aria2Controller(windowController)
const ipcController = new IpcController(windowController, trayController, aria2Controller, store)
const trackerSubscriptionService = new TrackerSubscriptionService(store, aria2Controller, windowController)
const speedScheduler = new SpeedScheduler()

// 创建 AppLifecycle 协调器
const appLifecycle = new AppLifecycle(
  store,
  windowController,
  trayController,
  aria2Controller,
  ipcController
)

// ==========================================
// 应用生命周期
// ==========================================

const gotTheLock = app.requestSingleInstanceLock()

/** 从命令行参数或协议 URL 中提取待处理的下载链接 */
function extractPendingUrl(argv: string[]): string | null {
  // Windows: 协议链接作为命令行参数传入（如 magnet:?xt=urn:btih:...）
  for (const arg of argv) {
    if (arg.startsWith('magnet:')) return arg
  }
  return null
}

/** 将待处理的下载链接推送给渲染进程（窗口就绪后由渲染层打开新建下载弹窗） */
function sendPendingUrl(url: string): void {
  const win = windowController.getMainWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send('pending-download-url', url)
  }
}

if (!gotTheLock) {
  app.quit()
} else {
  // 注册 magnet: 协议处理器（生产环境才注册，避免干扰开发环境）
  if (app.isPackaged) {
    app.setAsDefaultProtocolClient('magnet')
  }

  // macOS/Linux: 通过 open-url 事件接收协议链接
  app.on('open-url', (event, url) => {
    event.preventDefault()
    if (url && url.startsWith('magnet:')) {
      windowController.show()
      // 窗口可能尚未就绪，延迟发送
      setTimeout(() => sendPendingUrl(url), 500)
    }
  })

  app.on('second-instance', (_event, argv) => {
    windowController.show()
    // Windows: 从 second-instance 的 argv 中提取协议链接
    const pendingUrl = extractPendingUrl(argv)
    if (pendingUrl) {
      sendPendingUrl(pendingUrl)
    }
  })

  app.whenReady().then(async () => {
    logger.info('应用就绪，开始初始化...')

    try {
      // 注册 Tracker 订阅相关的 IPC（独立于 settings 页面的连接状态，随时可用）
      trackerSubscriptionService.registerIpcHandlers()
      // 通过 AppLifecycle 初始化所有子系统
      await appLifecycle.initialize()
      // App 就绪后启动 Tracker 每日订阅（含开机补拉 + 定时更新）
      trackerSubscriptionService.initialize()
      // 启动速度调度器（每分钟检查是否需要切换限速）
      speedScheduler.start()

      // 处理启动时的协议链接（Windows 首次启动通过 argv 传入）
      const startupUrl = extractPendingUrl(process.argv)
      if (startupUrl) {
        setTimeout(() => sendPendingUrl(startupUrl), 1000)
      }

      logger.info('应用初始化完成')
    } catch (error) {
      logger.error('应用初始化失败:', error)
      // 如果初始化严重失败，退出应用
      app.quit()
    }
  })

  app.on('window-all-closed', () => {
    const settings = getSettings()
    const minimizeToTray = settings.minimizeToTray !== false
    const platform = process.platform

    logger.info('所有窗口已关闭', { minimizeToTray, platform })

    if (platform === 'darwin' || minimizeToTray) {
      return
    }
    app.quit()
  })

  app.on('activate', () => {
    if (!windowController.getMainWindow()) {
      windowController.createWindow()
    } else {
      windowController.show()
    }
  })

  app.on('before-quit', async (e) => {
    // 优雅关闭只执行一次：首次 quit 达到时 preventDefault 并执行 shutdown，
    // shutdown 完成后 finally 中的 app.quit() 再次触发本事件，此时直接放行。
    // 托盘"退出"也走同一路径（TrayController 仅 markQuitting 放行窗口 close 拦截，不做关闭）。
    if (appState.hasShutdownStarted()) return

    e.preventDefault()
    appState.markQuitting()
    appState.markShutdownStarted()

    logger.info('应用退出中，开始优雅关闭...')

    try {
      await appLifecycle.shutdown()
      // 关闭 Tracker 订阅定时器，避免退出阻塞
      trackerSubscriptionService.shutdown()
      speedScheduler.stop()
      logger.info('优雅关闭完成')
    } catch (error) {
      logger.error('优雅关闭出错:', error)
    } finally {
      app.quit()
    }
  })

  // 处理信号：直接触发 quit，由 before-quit 执行优雅关闭
  // SIGINT: Ctrl+C（开发/终端启动）；SIGTERM: 容器/服务管理器停止；SIGHUP: 终端断开（POSIX）
  const handleTerminationSignal = () => {
    app.quit()
  }
  process.on('SIGINT', handleTerminationSignal)
  process.on('SIGTERM', handleTerminationSignal)
  if (process.platform !== 'win32') {
    process.on('SIGHUP', handleTerminationSignal)
  }
}

