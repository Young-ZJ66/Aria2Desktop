import { app, BrowserWindow, Menu, Tray, shell, ipcMain, dialog } from 'electron'
import { join } from 'path'
import * as path from 'path'
import * as fs from 'fs'
// import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import Store from 'electron-store'

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

// 获取配置文件目录
const getConfigDirectory = () => {
  const appDir = getAppDirectory()
  const configDir = path.join(appDir, 'config')

  // 确保配置目录存在
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true })
  }

  return configDir
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
    if (process.env.NODE_ENV === 'development') {
      // 开发模式下直接退出
      app.quit()
    } else if (!(app as any).isQuiting) {
      // 生产模式下最小化到托盘
      event.preventDefault()
      mainWindow?.hide()
    }
  })
}

function createTray(): void {
  tray = new Tray(join(__dirname, '../../build/icon.png'))
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => {
        mainWindow?.show()
      }
    },
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
  
  tray.on('double-click', () => {
    mainWindow?.show()
  })
}

// 应用准备就绪
app.whenReady().then(() => {
  console.log('App ready, creating window...')
  // 设置应用用户模型ID (Windows)
  // electronApp.setAppUserModelId('com.aria2desktop.app')

  // 开发环境下的默认打开或关闭DevTools快捷键
  // app.on('browser-window-created', (_, window) => {
  //   optimizer.watchWindowShortcuts(window)
  // })

  createWindow()
  // createTray() // 暂时禁用托盘功能

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// 所有窗口关闭时退出应用 (macOS除外)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// IPC通信处理
ipcMain.handle('get-app-version', () => {
  return app.getVersion()
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

    const results = []
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


