import * as fs from 'fs'
import * as path from 'path'

/**
 * Aria2ConfigManager - 管理 Aria2 配置文件
 */
export class Aria2ConfigManager {
    private configPath: string
    private configContent: Map<string, string> = new Map()

    constructor(configPath: string) {
        this.configPath = configPath
        this.loadConfig()
    }

    private loadConfig() {
        try {
            if (fs.existsSync(this.configPath)) {
                const content = fs.readFileSync(this.configPath, 'utf-8')
                const lines = content.split('\n')

                for (const line of lines) {
                    const trimmed = line.trim()
                    if (trimmed && !trimmed.startsWith('#')) {
                        const [key, ...valueParts] = trimmed.split('=')
                        if (key && valueParts.length > 0) {
                            this.configContent.set(key.trim(), valueParts.join('=').trim())
                        }
                    }
                }
            } else {
                // 创建默认配置文件
                this.createDefaultConfig()
            }
        } catch (error) {
            console.error('Failed to load Aria2 config:', error)
            this.createDefaultConfig()
        }
    }

    private createDefaultConfig() {
        const defaultConfig = `# Aria2 Configuration File
dir=D:/Downloads/Aria2Downloads
rpc-listen-port=6800
rpc-allow-origin-all=true
enable-rpc=true
max-concurrent-downloads=5
max-connection-per-server=16
min-split-size=10M
split=16
continue=true
save-session-interval=60
`
        try {
            const dir = path.dirname(this.configPath)
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true })
            }
            fs.writeFileSync(this.configPath, defaultConfig, 'utf-8')
            this.loadConfig()
        } catch (error) {
            console.error('Failed to create default config:', error)
        }
    }

    public getConfigValue(key: string): string | undefined {
        return this.configContent.get(key)
    }

    public setConfigValue(key: string, value: string | number) {
        this.configContent.set(key, String(value))
        this.saveConfig()
    }

    public setMultipleConfigs(configs: Record<string, string | number>) {
        for (const [key, value] of Object.entries(configs)) {
            this.configContent.set(key, String(value))
        }
        this.saveConfig()
    }

    private saveConfig() {
        try {
            const lines: string[] = ['# Aria2 Configuration File']

            for (const [key, value] of this.configContent.entries()) {
                if (key.startsWith('#')) {
                    lines.push(`#${key.substring(1)}=${value}`)
                } else {
                    lines.push(`${key}=${value}`)
                }
            }

            fs.writeFileSync(this.configPath, lines.join('\n'), 'utf-8')
        } catch (error) {
            console.error('Failed to save Aria2 config:', error)
        }
    }

    public getRelevantConfigs() {
        return {
            dir: this.getConfigValue('dir'),
            port: this.getConfigValue('rpc-listen-port'),
            secret: this.getConfigValue('rpc-secret')
        }
    }
}
