import { Tray, Menu, app, nativeImage } from 'electron'
import { join } from 'path'
import * as fs from 'fs'
import { WindowController } from './WindowController'

export class TrayController {
    private tray: Tray | null = null
    private windowController: WindowController

    constructor(windowController: WindowController) {
        this.windowController = windowController
    }

    public createTray(): void {
        if (this.tray) return

        const iconPath = this.getIconPath()
        console.log('Creating tray with icon:', iconPath)

        try {
            this.tray = new Tray(iconPath)
            this.setupContextMenu()
            this.setupEventHandlers()
            this.tray.setToolTip('Aria2 Desktop')
        } catch (error) {
            console.error('Failed to create tray:', error)
            // 回退到空图像
            try {
                this.tray = new Tray(nativeImage.createEmpty())
                this.setupContextMenu()
                this.setupEventHandlers()
            } catch (e) {
                console.error('Failed to create fallback tray:', e)
            }
        }
    }

    private getIconPath(): string {
        if (process.env.NODE_ENV === 'development') {
            return join(process.cwd(), 'build/Aria2.ico')
        }

        const possiblePaths = [
            join(process.resourcesPath, 'build', 'Aria2.ico'),
            join(process.resourcesPath, 'app.asar.unpacked', 'build', 'Aria2.ico'),
            join(process.resourcesPath, 'Aria2.ico'),
            join(__dirname, '../../build/Aria2.ico'),
            join(__dirname, '../../../build/Aria2.ico')
        ]

        return possiblePaths.find(path => fs.existsSync(path)) || possiblePaths[0]
    }

    private setupContextMenu() {
        if (!this.tray) return

        const contextMenu = Menu.buildFromTemplate([
            {
                label: '显示主窗口',
                click: () => this.windowController.show()
            },
            {
                label: '隐藏窗口',
                click: () => this.windowController.hide()
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

    public destroyTray() {
        if (this.tray) {
            this.tray.destroy()
            this.tray = null
            console.log('[TrayController] Tray destroyed')
        }
    }

    public destroy() {
        this.destroyTray()
    }
}
