import { ipcMain, dialog, shell } from 'electron'
import { WindowController } from './WindowController'
import { TrayController } from './TrayController'
import { Aria2Controller } from './Aria2Controller'
import Store from 'electron-store'
import * as path from 'path'
import * as fs from 'fs'

export class IpcController {
    private windowController: WindowController
    private trayController: TrayController
    private aria2Controller: Aria2Controller
    private store: Store

    constructor(
        windowController: WindowController,
        trayController: TrayController,
        aria2Controller: Aria2Controller,
        store: Store
    ) {
        this.windowController = windowController
        this.trayController = trayController
        this.aria2Controller = aria2Controller
        this.store = store
    }

    public registerHandlers() {
        this.registerAppHandlers()
        this.registerFileHandlers()
        this.aria2Controller.registerIpcHandlers()
    }

    private registerAppHandlers() {
        ipcMain.handle('get-app-version', () => process.env.npm_package_version || '1.0.0')

        ipcMain.handle('set-tray-enabled', (_, enabled: boolean) => {
            if (enabled) {
                this.trayController.createTray()
            } else {
                this.trayController.destroy()
            }
        })

        ipcMain.handle('set-window-theme', (_, isDark: boolean) => {
            this.windowController.setWindowTheme(isDark)
        })

        ipcMain.handle('get-store-value', (_, key: string) => this.store.get(key))

        ipcMain.handle('set-store-value', (_, key: string, value: any) => {
            this.store.set(key, value)
        })

        ipcMain.handle('show-save-dialog', async (_, options) => {
            const window = this.windowController.getMainWindow()
            if (window) {
                return await dialog.showSaveDialog(window, options)
            }
            return { canceled: true }
        })

        ipcMain.handle('show-open-dialog', async (_, options) => {
            const window = this.windowController.getMainWindow()
            if (window) {
                return await dialog.showOpenDialog(window, options)
            }
            return { canceled: true }
        })
    }

    private registerFileHandlers() {
        ipcMain.handle('show-item-in-folder', async (_, filePath: string) => {
            try {
                const normalizedPath = path.normalize(filePath)
                if (!fs.existsSync(normalizedPath)) return { success: false, error: 'Path not found' }
                shell.showItemInFolder(normalizedPath)
                return { success: true }
            } catch (e) {
                return { success: false, error: String(e) }
            }
        })

        ipcMain.handle('open-path', async (_, filePath: string) => {
            try {
                const normalizedPath = path.normalize(filePath)
                if (!fs.existsSync(normalizedPath)) return { success: false, error: 'Path not found' }
                await shell.openPath(normalizedPath)
                return { success: true }
            } catch (e) {
                return { success: false, error: String(e) }
            }
        })

        ipcMain.handle('delete-files', async (_, filePaths: string[]) => {
            const results: any[] = []
            for (const p of filePaths) {
                try {
                    const normalized = path.normalize(p)
                    if (fs.existsSync(normalized)) {
                        const stats = fs.statSync(normalized)
                        if (stats.isDirectory()) {
                            fs.rmSync(normalized, { recursive: true, force: true })
                        } else {
                            fs.unlinkSync(normalized)
                        }
                        results.push({ path: p, success: true })
                    } else {
                        results.push({ path: p, success: false, error: 'Not found' })
                    }
                } catch (e) {
                    results.push({ path: p, success: false, error: String(e) })
                }
            }
            return { success: true, results }
        })
    }
}
