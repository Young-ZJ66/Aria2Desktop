import { app } from 'electron'
import Store from 'electron-store'
import * as path from 'path'
import * as fs from 'fs'
import { WindowController } from './controllers/WindowController'
import { TrayController } from './controllers/TrayController'
import { Aria2Controller } from './controllers/Aria2Controller'
import { IpcController } from './controllers/IpcController'
import { AppLifecycle } from './controllers/AppLifecycle'
import { appState } from './utils/appState'
import { decryptSettingsSecrets } from './utils/secretCipher'
import type { StoreData, AppSettings } from './types/store'

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
 */
function migrateLegacyData(): void {
  const legacyDataDir = path.join(getAppDirectory(), 'data')
  if (!fs.existsSync(legacyDataDir)) return

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
      console.log(`[Migration] Migrated legacy data: ${from} -> ${to}`)
    } catch (error) {
      console.warn(`[Migration] Failed to migrate ${from}:`, error)
    }
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

console.log('Config directory:', configDir)
console.log('Config file path:', store.path)

// ==========================================
// 控制器初始化
// ==========================================

const windowController = new WindowController(store)
const trayController = new TrayController(windowController)
const aria2Controller = new Aria2Controller(store, windowController)
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
      console.log('Application initialized successfully')
    } catch (error) {
      console.error('Application initialization failed:', error)
      // 如果初始化严重失败，退出应用
      app.quit()
    }
  })

  app.on('window-all-closed', () => {
    const settings = decryptSettingsSecrets(store.get('settings', {}) as AppSettings)
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
    if (appState.isQuitting()) return

    e.preventDefault()
    appState.markQuitting()

    console.log('App quitting, starting graceful shutdown...')

    try {
      await appLifecycle.shutdown()
      console.log('Graceful shutdown complete')
    } catch (error) {
      console.error('Shutdown error:', error)
    } finally {
      app.quit()
    }
  })

  // 处理信号：直接触发 quit，由 before-quit 执行优雅关闭
  process.on('SIGINT', () => {
    app.quit()
  })
}

