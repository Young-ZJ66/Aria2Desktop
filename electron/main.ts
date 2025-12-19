import { app } from 'electron'
import Store from 'electron-store'
import * as path from 'path'
import * as fs from 'fs'
import { WindowController } from './controllers/WindowController'
import { TrayController } from './controllers/TrayController'
import { Aria2Controller } from './controllers/Aria2Controller'
import { IpcController } from './controllers/IpcController'
import { AppLifecycle } from './controllers/AppLifecycle'

// ==========================================
// 配置和路径设置
// ==========================================

const getAppDirectory = () => {
  if (app.isPackaged) {
    return path.dirname(process.execPath)
  } else {
    return process.cwd()
  }
}

const getConfigDirectory = () => {
  const appDir = getAppDirectory()
  const configDir = path.join(appDir, 'data', 'config')
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true })
  }
  return configDir
}

const configDir = getConfigDirectory()
const store = new Store({
  cwd: configDir,
  name: 'aria2-desktop-settings'
})

console.log('Config directory:', configDir)
console.log('Config file path:', store.path)

// ==========================================
// 控制器初始化
// ==========================================

const windowController = new WindowController(store)
const trayController = new TrayController(windowController)
const aria2Controller = new Aria2Controller(store)
const ipcController = new IpcController(windowController, trayController, aria2Controller, store)

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

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    windowController.show()
  })

  app.whenReady().then(async () => {
    console.log('App ready, starting initialization...')

    try {
      // 通过 AppLifecycle 初始化所有子系统
      await appLifecycle.initialize()
      console.log('✓ Application initialized successfully')
    } catch (error) {
      console.error('✗ Application initialization failed:', error)
      // 如果初始化严重失败，退出应用
      app.quit()
    }
  })

  app.on('window-all-closed', () => {
    const settings = store.get('settings', {}) as any
    const minimizeToTray = settings.minimizeToTray !== false
    const platform = process.platform

    console.log('All windows closed', { minimizeToTray, platform })

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
    if ((app as any).isQuiting) return

    e.preventDefault();
    (app as any).isQuiting = true

    console.log('App quitting, starting graceful shutdown...')

    try {
      await appLifecycle.shutdown()
      console.log('✓ Graceful shutdown complete')
    } catch (error) {
      console.error('✗ Shutdown error:', error)
    } finally {
      app.quit()
    }
  })

  // 处理信号
  process.on('SIGINT', () => {
    (app as any).isQuiting = true
    app.quit()
  })
}

