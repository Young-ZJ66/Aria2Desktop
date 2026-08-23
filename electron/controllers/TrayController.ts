import { Tray, Menu, app, nativeImage } from 'electron'
import { join } from 'path'
import * as fs from 'fs'
import { WindowController } from './WindowController'
import { appState } from '../utils/appState'

export class TrayController {
  private tray: Tray | null = null
  private windowController: WindowController

  constructor(windowController: WindowController) {
    this.windowController = windowController
  }

  public createTray(): void {
    if (this.tray) return

    const iconPath = this.getIconPath()
    console.log('[TrayController] Creating tray with icon:', iconPath)

    try {
      // 图标路径不存在时回退到空图像，避免 Tray 构造抛错
      this.tray = new Tray(iconPath ?? nativeImage.createEmpty())
      this.setupContextMenu()
      this.setupEventHandlers()
      this.tray.setToolTip('Aria2 Desktop')
    } catch (error) {
      console.error('Failed to create tray:', error)
    }
  }

  private getIconPath(): string | null {
    if (process.env.NODE_ENV === 'development') {
      return join(process.cwd(), 'build/Icon.ico')
    }

    const possiblePaths = [
      join(process.resourcesPath, 'build', 'Icon.ico'),
      join(process.resourcesPath, 'app.asar.unpacked', 'build', 'Icon.ico'),
      join(process.resourcesPath, 'Icon.ico'),
      join(__dirname, '../../build/Icon.ico'),
      join(__dirname, '../../../build/Icon.ico')
    ]

    return possiblePaths.find(p => fs.existsSync(p)) || null
  }

  private setupContextMenu() {
    if (!this.tray) return

    // 按系统语言切换托盘菜单文案（主进程无 i18n 实例，简单分流中英文）
    const isZh = app.getLocale().startsWith('zh')
    const labels = {
      show: isZh ? '显示主窗口' : 'Show Main Window',
      hide: isZh ? '隐藏窗口' : 'Hide Window',
      quit: isZh ? '退出' : 'Quit'
    }

    const contextMenu = Menu.buildFromTemplate([
      {
        label: labels.show,
        click: () => this.windowController.show()
      },
      {
        label: labels.hide,
        click: () => this.windowController.hide()
      },
      { type: 'separator' },
      {
        label: labels.quit,
        click: () => {
          appState.markQuitting()
          app.quit()
        }
      }
    ])

    this.tray.setContextMenu(contextMenu)
  }

  private setupEventHandlers() {
    if (!this.tray) return

    this.tray.on('double-click', () => {
      if (this.windowController.isVisible()) {
        this.windowController.hide()
      } else {
        this.windowController.show()
      }
    })
  }

  public getTray(): Tray | null {
    return this.tray
  }

  public destroy() {
    if (this.tray) {
      this.tray.destroy()
      this.tray = null
      console.log('[TrayController] Tray destroyed')
    }
  }
}
