import { app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'

/**
 * ResourceManager - 管理 Aria2 相关资源路径
 */
export class ResourceManager {
    private static instance: ResourceManager | null = null
    private executablePath: string = ''
    private configPath: string = ''
    private sessionFilePath: string = ''

    private constructor() {
        this.initializeResources()
    }

    public static getInstance(): ResourceManager {
        if (!ResourceManager.instance) {
            ResourceManager.instance = new ResourceManager()
        }
        return ResourceManager.instance
    }

    public initializeResources() {
        const appDir = app.isPackaged
            ? path.dirname(process.execPath)
            : process.cwd()

        // Aria2 可执行文件路径
        this.executablePath = path.join(appDir, 'resources', 'aria2c.exe')
        console.log('Looking for aria2c.exe at:', this.executablePath)

        // 配置文件路径 - 使用 data/aria2 目录
        const configDir = path.join(appDir, 'data', 'aria2')
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true })
        }
        this.configPath = path.join(configDir, 'aria2.conf')

        // 会话文件路径 - 同样在 data/aria2 目录
        this.sessionFilePath = path.join(configDir, 'aria2.session')

        // 确保会话文件存在
        if (!fs.existsSync(this.sessionFilePath)) {
            fs.writeFileSync(this.sessionFilePath, '', 'utf-8')
            console.log('[ResourceManager] Created session file:', this.sessionFilePath)
        }

        console.log('[ResourceManager] Config path:', this.configPath)
        console.log('[ResourceManager] Session path:', this.sessionFilePath)

        return {
            executablePath: this.executablePath,
            configPath: this.configPath,
            sessionFilePath: this.sessionFilePath
        }
    }

    public isAria2Available(): boolean {
        return fs.existsSync(this.executablePath)
    }

    public getResourceInfo() {
        return {
            executablePath: this.executablePath,
            configPath: this.configPath,
            sessionFilePath: this.sessionFilePath,
            exists: this.isAria2Available()
        }
    }

    public getSessionFilePath(): string {
        return this.sessionFilePath
    }
}
