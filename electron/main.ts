import { app, BrowserWindow, Menu, Tray, shell, ipcMain, dialog } from 'electron'
import { join } from 'path'
import * as path from 'path'
import * as fs from 'fs'
// import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import Store from 'electron-store'
import { getAria2ProcessManager, Aria2ProcessManager } from '../src/services/aria2ProcessManager'

// 获取应用所在目录
const getAppDirectory = () => {
  if (app.isPackaged) {
    // 生产环境：使用可执行文件所在目录
    return path.dirname(process.execPath)
  } else {
    // 开发环境：使用项目根目录
    return process.cwd()
  }
}

// 获取配置文件目录 - 统一存放在安装目录的 data 文件夹中
const getConfigDirectory = () => {
  const appDir = getAppDirectory()
  const configDir = path.join(appDir, 'data', 'config')

  // 确保配置目录存在
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true })
  }

  return configDir
}

// 获取用户数据根目录
const getUserDataDirectory = () => {
  const appDir = getAppDirectory()
  const dataDir = path.join(appDir, 'data')

  // 确保数据目录存在
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }

  return dataDir
}

// 初始化配置存储，设置存储路径为应用所在目录的 config 文件夹
const appDir = getAppDirectory()
const configDir = getConfigDirectory()
const store = new Store({
  cwd: configDir,
  name: 'aria2-desktop-settings'  // 这将创建 aria2-desktop-settings.json 文件
})

console.log('App directory:', appDir)
console.log('Config directory:', configDir)
console.log('Config file path:', store.path)

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let hasShownTrayNotification = false
let aria2Manager: Aria2ProcessManager | null = null

function createWindow(): void {
  console.log('Creating main window...')
  // 创建主窗口
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: true,
    autoHideMenuBar: false,
    center: true,
    resizable: true,
    icon: join(__dirname, '../../build/Aria2.ico'),
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    console.log('Window ready to show')
    mainWindow?.show()
    mainWindow?.focus()
    mainWindow?.setAlwaysOnTop(true)
    setTimeout(() => {
      mainWindow?.setAlwaysOnTop(false)
    }, 1000)
    console.log('Window shown and focused')
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // 开发环境加载本地服务器，生产环境加载打包文件
  console.log('Loading URL...')
  if (process.env.NODE_ENV === 'development') {
    console.log('Loading development URL: http://localhost:5173')
    mainWindow.loadURL('http://localhost:5173')
  } else {
    console.log('Loading production file')
    mainWindow.loadFile(join(__dirname, '../vue/index.html'))
  }

  // 窗口关闭时的处理
  mainWindow.on('close', (event) => {
    if (!(app as any).isQuiting) {
      // 检查是否启用了最小化到托盘功能
      const settings = store.get('settings', {}) as any
      const minimizeToTray = settings.minimizeToTray !== false // 默认启用

      console.log('Window close event:', {
        settings,
        minimizeToTray,
        hasTray: !!tray,
        isQuiting: (app as any).isQuiting,
        nodeEnv: process.env.NODE_ENV
      })

      if (minimizeToTray) {
        // 最小化到托盘（即使托盘还未创建，也先隐藏窗口）
        event.preventDefault()
        mainWindow?.hide()

        // 如果托盘还未创建，现在创建它
        if (!tray) {
          createTray()
        }

        // 显示系统通知（首次最小化到托盘时）
        if (!hasShownTrayNotification && process.platform !== 'darwin') {
          const { Notification } = require('electron')
          if (Notification.isSupported()) {
            new Notification({
              title: 'Aria2 Desktop',
              body: '应用已最小化到系统托盘，双击托盘图标可重新打开',
              silent: true
            }).show()
            hasShownTrayNotification = true
          }
        }
      } else {
        // 直接退出
        app.quit()
      }
    }
  })
}

function createTray(): void {
  // 使用 ico 文件作为托盘图标
  const iconPath = join(__dirname, '../../build/Aria2.ico')
  tray = new Tray(iconPath)

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => {
        mainWindow?.show()
        mainWindow?.focus()
      }
    },
    {
      label: '隐藏窗口',
      click: () => {
        mainWindow?.hide()
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        (app as any).isQuiting = true
        app.quit()
      }
    }
  ])

  tray.setToolTip('Aria2 Desktop')
  tray.setContextMenu(contextMenu)

  // 双击托盘图标显示/隐藏窗口
  tray.on('double-click', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide()
    } else {
      mainWindow?.show()
      mainWindow?.focus()
    }
  })
}

// 初始化 Aria2 进程管理器
async function initializeAria2Manager() {
  try {
    // 使用默认配置，实际配置从 aria2.conf 文件读取
    const aria2Config = {
      autoStart: true // 默认启用自动启动
    }

    aria2Manager = getAria2ProcessManager(aria2Config)
    
    // 如果启用了自动启动，则启动 Aria2
    if (aria2Config.autoStart) {
      const success = await aria2Manager.start()
      if (success) {
        console.log('Aria2 自动启动成功')
      } else {
        console.error('Aria2 自动启动失败')
      }
    }
  } catch (error) {
    console.error('初始化 Aria2 进程管理器失败:', error)
  }
}

// 应用准备就绪
app.whenReady().then(async () => {
  console.log('App ready, creating window...')
  // 设置应用用户模型ID (Windows)
  // electronApp.setAppUserModelId('com.aria2desktop.app')

  // 开发环境下的默认打开或关闭DevTools快捷键
  // app.on('browser-window-created', (_, window) => {
  //   optimizer.watchWindowShortcuts(window)
  // })

  createWindow()

  // 根据设置决定是否创建托盘
  const settings = store.get('settings', {}) as any
  const minimizeToTray = settings.minimizeToTray !== false // 默认启用
  if (minimizeToTray) {
    createTray()
  }

  // 初始化 Aria2 进程管理器
  await initializeAria2Manager()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// 所有窗口关闭时的处理
app.on('window-all-closed', () => {
  // 检查是否启用了托盘功能
  const settings = store.get('settings', {}) as any
  const minimizeToTray = settings.minimizeToTray !== false // 默认启用

  console.log('All windows closed:', { minimizeToTray, hasTray: !!tray, platform: process.platform })

  // 如果启用了托盘功能，不退出应用（让应用在后台运行）
  // 如果是 macOS 或者启用了托盘，不退出应用
  if (process.platform === 'darwin' || minimizeToTray) {
    // 不退出应用，让它在后台运行
    return
  }

  // 其他情况下退出应用
  app.quit()
})

// 应用即将退出时清理 Aria2 进程
app.on('before-quit', async (event) => {
  console.log('应用即将退出，执行清理工作...')
  
  if (aria2Manager && aria2Manager.isRunning()) {
    console.log('应用退出，正在停止 Aria2 进程...')
    event.preventDefault()
    
    try {
      // 先强制保存会话，防止任务丢失
      console.log('正在强制保存Aria2会话...')
      try {
        const aria2Service = require('../src/services/aria2Service')
        if (aria2Service && aria2Service.Aria2Service) {
          const service = new aria2Service.Aria2Service()
          await service.saveSession()
          console.log('会话保存成功')
        }
      } catch (sessionError) {
        console.warn('保存会话失败，但继续退出流程:', sessionError)
      }
      
      await aria2Manager.stop()
      console.log('Aria2 进程已停止，应用即将退出')
      // 设置标志避免重复处理
      ;(app as any).isQuiting = true
      app.quit()
    } catch (error) {
      console.error('停止 Aria2 进程失败:', error)
      ;(app as any).isQuiting = true
      app.quit() // 强制退出
    }
  }
})

// 处理进程信号，确保优雅退出
process.on('SIGINT', () => {
  console.log('收到SIGINT信号，正在退出...')
  ;(app as any).isQuiting = true
  app.quit()
})

process.on('SIGTERM', () => {
  console.log('收到SIGTERM信号，正在退出...')
  ;(app as any).isQuiting = true
  app.quit()
})

// 处理未捕获的异常，避免进程僵死
process.on('uncaughtException', (error) => {
  console.error('未捕获的异常:', error)
  ;(app as any).isQuiting = true
  app.quit()
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('未处理的Promise拒绝:', reason, 'at:', promise)
})

// IPC通信处理
ipcMain.handle('get-app-version', () => {
  return app.getVersion()
})

// 托盘控制
ipcMain.handle('set-tray-enabled', (_, enabled: boolean) => {
  if (enabled && !tray) {
    createTray()
  } else if (!enabled && tray) {
    tray.destroy()
    tray = null
  }
})



ipcMain.handle('get-store-value', (_, key: string) => {
  return store.get(key)
})

ipcMain.handle('set-store-value', (_, key: string, value: any) => {
  store.set(key, value)
})

ipcMain.handle('show-save-dialog', async (_, options) => {
  const result = await dialog.showSaveDialog(mainWindow!, options)
  return result
})

ipcMain.handle('show-open-dialog', async (_, options) => {
  const result = await dialog.showOpenDialog(mainWindow!, options)
  return result
})

ipcMain.handle('show-item-in-folder', async (_, filePath: string) => {
  try {
    console.log('Attempting to show item in folder:', filePath)

    // 规范化路径
    const normalizedPath = path.normalize(filePath)
    console.log('Normalized path:', normalizedPath)

    // 检查路径是否存在
    if (!fs.existsSync(normalizedPath)) {
      console.error('Path does not exist:', normalizedPath)
      return { success: false, error: '路径不存在' }
    }

    // 使用 shell.showItemInFolder
    shell.showItemInFolder(normalizedPath)
    console.log('Successfully called shell.showItemInFolder')
    return { success: true }
  } catch (error) {
    console.error('Failed to show item in folder:', error)
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('open-path', async (_, filePath: string) => {
  try {
    console.log('Attempting to open path:', filePath)

    // 规范化路径
    const normalizedPath = path.normalize(filePath)
    console.log('Normalized path:', normalizedPath)

    // 检查路径是否存在
    if (!fs.existsSync(normalizedPath)) {
      console.error('Path does not exist:', normalizedPath)
      return { success: false, error: '路径不存在' }
    }

    // 检查是否为目录
    const stats = fs.statSync(normalizedPath)
    if (stats.isDirectory()) {
      // 对于目录，首先尝试 shell.openPath
      const result = await shell.openPath(normalizedPath)
      if (result) {
        console.log('shell.openPath failed, trying alternative method:', result)

        // 如果失败，尝试使用 Windows explorer 命令
        if (process.platform === 'win32') {
          const { spawn } = require('child_process')
          try {
            spawn('explorer', [normalizedPath], { detached: true })
            console.log('Successfully opened with explorer command')
            return { success: true, method: 'explorer' }
          } catch (explorerError) {
            console.error('Explorer command failed:', explorerError)
            // 最后尝试 showItemInFolder
            shell.showItemInFolder(normalizedPath)
            return { success: true, method: 'showItemInFolder' }
          }
        } else {
          shell.showItemInFolder(normalizedPath)
          return { success: true, method: 'showItemInFolder' }
        }
      }
      return { success: true, method: 'openPath' }
    } else {
      // 对于文件，使用 shell.showItemInFolder
      shell.showItemInFolder(normalizedPath)
      return { success: true, method: 'showItemInFolder' }
    }
  } catch (error) {
    console.error('Failed to open path:', error)
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

// 专门用于 Windows 的资源管理器打开方法
ipcMain.handle('open-in-explorer', async (_, filePath: string) => {
  try {
    console.log('Opening in Windows Explorer:', filePath)

    if (process.platform !== 'win32') {
      return { success: false, error: '此方法仅支持 Windows' }
    }

    const normalizedPath = path.normalize(filePath)
    console.log('Normalized path for explorer:', normalizedPath)

    if (!fs.existsSync(normalizedPath)) {
      return { success: false, error: '路径不存在' }
    }

    const { spawn } = require('child_process')
    const stats = fs.statSync(normalizedPath)

    if (stats.isDirectory()) {
      // 打开目录
      spawn('explorer', [normalizedPath], { detached: true, stdio: 'ignore' })
    } else {
      // 选中文件
      spawn('explorer', ['/select,', normalizedPath], { detached: true, stdio: 'ignore' })
    }

    console.log('Successfully launched Windows Explorer')
    return { success: true, method: 'windows-explorer' }
  } catch (error) {
    console.error('Failed to open in Windows Explorer:', error)
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

// 删除文件或目录
ipcMain.handle('delete-files', async (_, filePaths: string[]) => {
  try {
    console.log('Attempting to delete files:', filePaths)

    const results: Array<{ path: string; success: boolean; error?: string }> = []
    for (const filePath of filePaths) {
      try {
        const normalizedPath = path.normalize(filePath)
        console.log('Deleting:', normalizedPath)

        if (fs.existsSync(normalizedPath)) {
          const stats = fs.statSync(normalizedPath)
          if (stats.isDirectory()) {
            // 删除目录
            fs.rmSync(normalizedPath, { recursive: true, force: true })
          } else {
            // 删除文件
            fs.unlinkSync(normalizedPath)
          }
          results.push({ path: filePath, success: true })
          console.log('Successfully deleted:', normalizedPath)
        } else {
          results.push({ path: filePath, success: false, error: '文件不存在' })
          console.log('File does not exist:', normalizedPath)
        }
      } catch (error) {
        results.push({ path: filePath, success: false, error: error instanceof Error ? error.message : String(error) })
        console.error('Failed to delete file:', filePath, error)
      }
    }

    return { success: true, results }
  } catch (error) {
    console.error('Failed to delete files:', error)
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

// Aria2 进程管理 IPC 接口
ipcMain.handle('aria2-start', async () => {
  try {
    if (!aria2Manager) {
      await initializeAria2Manager()
    }
    const success = await aria2Manager!.start()
    return { success, error: success ? null : 'Failed to start Aria2' }
  } catch (error) {
    console.error('Failed to start Aria2:', error)
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

// 会话保存 IPC 接口
ipcMain.handle('aria2-save-session', async () => {
  try {
    if (!aria2Manager || !aria2Manager.isRunning()) {
      return { success: false, error: 'Aria2 not running' }
    }
    
    // 通过配置管理器获取会话文件路径并触发保存
    const aria2Service = require('../src/services/aria2Service')
    if (aria2Service && aria2Service.Aria2Service) {
      const service = new aria2Service.Aria2Service()
      await service.saveSession()
      console.log('Session saved via IPC')
      return { success: true }
    }
    
    return { success: false, error: 'Aria2 service not available' }
  } catch (error) {
    console.error('Failed to save session via IPC:', error)
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('aria2-stop', async () => {
  try {
    if (!aria2Manager) {
      return { success: true, message: 'Aria2 not running' }
    }
    const success = await aria2Manager.stop()
    return { success, error: success ? null : 'Failed to stop Aria2' }
  } catch (error) {
    console.error('Failed to stop Aria2:', error)
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('aria2-restart', async () => {
  try {
    if (!aria2Manager) {
      await initializeAria2Manager()
    }
    const success = await aria2Manager!.restart()
    return { success, error: success ? null : 'Failed to restart Aria2' }
  } catch (error) {
    console.error('Failed to restart Aria2:', error)
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})

ipcMain.handle('aria2-status', () => {
  try {
    if (!aria2Manager) {
      return { 
        isRunning: false, 
        pid: null, 
        retryCount: 0, 
        config: null,
        error: 'Aria2 manager not initialized'
      }
    }
    return aria2Manager.getProcessInfo()
  } catch (error) {
    console.error('Failed to get Aria2 status:', error)
    return { 
      isRunning: false, 
      pid: null, 
      retryCount: 0, 
      config: null,
      error: error instanceof Error ? error.message : String(error)
    }
  }
})

ipcMain.handle('aria2-update-config', async (_, config) => {
  try {
    if (!aria2Manager) {
      await initializeAria2Manager()
    }
    
    // 只提取可序列化的配置项
    const serializableConfig = {
      port: config.port,
      secret: config.secret,
      downloadDir: config.downloadDir,
      enableRpc: config.enableRpc,
      rpcAllowOriginAll: config.rpcAllowOriginAll,
      autoStart: config.autoStart
    }
    
    aria2Manager!.updateConfig(serializableConfig)
    
    // 配置已通过 Aria2ConfigManager 直接保存到 aria2.conf 文件
    // 不再需要保存到 electron-store
    
    return { success: true }
  } catch (error) {
    console.error('Failed to update Aria2 config:', error)
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})


