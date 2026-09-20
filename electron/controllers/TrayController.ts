import { Tray, Menu, app, nativeImage } from 'electron'
import { WindowController } from './WindowController'
import { appState } from '../utils/appState'
import { resolveAppIconPath } from '../utils/resolvePaths'
import { createLogger } from '../utils/logger'

// 本文件日志文案自带 [TrayController] 前缀（历史风格），故 scope 传空避免前缀重复
const logger = createLogger('')

export class TrayController {
  private tray: Tray | null = null
  private windowController: WindowController

  constructor(windowController: WindowController) {
    this.windowController = windowController
  }

  public createTray(): void {
    if (this.tray) return

    const iconPath = this.getIconPath()
    logger.info('[TrayController] Creating tray with icon:', iconPath)

    try {
      // 图标路径不存在时回退到空图像，避免 Tray 构造抛错
      this.tray = new Tray(iconPath ?? nativeImage.createEmpty())
      this.setupContextMenu()
      this.setupEventHandlers()
      this.tray.setToolTip('Aria2 Desktop')
    } catch (error) {
      logger.error('Failed to create tray:', error)
    }
  }

  private getIconPath(): string | null {
    // 图标路径口径统一在 resolvePaths（此前这里维护了 5 个候选路径，绝大多数永不命中）
    return resolveAppIconPath()
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
          // 先 markQuitting 放行窗口 close 拦截（minimizeToTray 时窗口仍可能可见）；
          // 优雅关闭（Aria2 会话保存）由 main.ts 的 before-quit 统一执行
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
      logger.info('[TrayController] Tray destroyed')
    }
  }
}
