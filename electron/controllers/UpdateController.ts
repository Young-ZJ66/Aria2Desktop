import { app, BrowserWindow, net, shell } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

// GitHub Releases API（公开仓库可直接访问，无需 token）
const GITHUB_REPO = 'Young-ZJ66/Aria2Desktop'
const GITHUB_API_LATEST = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`

interface GitHubAsset {
  name: string
  browser_download_url: string
}

interface GitHubRelease {
  tag_name: string
  assets: GitHubAsset[]
}

/**
 * UpdateController - 通过 GitHub Releases API 检查更新：
 * 1. 拉取最新 Release 的版本号并比对本地版本
 * 2. 发现新版本后下载对应架构的安装包（带进度推送）
 * 3. 启动安装程序，交由用户完成安装
 *
 * 不依赖 latest.yml / blockmap，不使用 electron-updater
 * 状态通过 webContents.send('update:status', ...) 推送给渲染进程
 */
export class UpdateController {
  private getWindow: () => BrowserWindow | null
  private downloadedPath: string = ''

  constructor(getWindow: () => BrowserWindow | null) {
    this.getWindow = getWindow
  }

  /** 向主窗口推送更新状态 */
  private sendToRenderer(payload: unknown): void {
    const win = this.getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('update:status', payload)
    }
  }

  /** 检查更新；发现新版本时自动下载并启动安装程序 */
  async checkForUpdates(): Promise<{ success: boolean; error?: string }> {
    if (!app.isPackaged) {
      return { success: false, error: 'Development mode does not support auto update' }
    }
    try {
      const release = await this.fetchLatestRelease()
      const latestVersion = release.tag_name.replace(/^v/i, '')
      const currentVersion = app.getVersion()

      // 当前已是最新版本
      if (this.compareVersions(latestVersion, currentVersion) <= 0) {
        this.sendToRenderer({ state: 'not-available' })
        return { success: true }
      }

      // 查找与当前架构匹配的安装包
      const asset = this.findInstallerAsset(release.assets, process.arch)
      if (!asset) {
        this.sendToRenderer({ state: 'error', error: 'No matching installer asset found' })
        return { success: true }
      }

      this.sendToRenderer({ state: 'available', version: latestVersion })
      await this.downloadInstaller(asset.browser_download_url, latestVersion)
      this.sendToRenderer({ state: 'downloaded', version: latestVersion })

      // 打开安装程序，交由用户完成安装
      await shell.openPath(this.downloadedPath)
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** 重新打开已下载的安装程序（用户可再次执行安装） */
  async openInstaller(): Promise<{ success: boolean; error?: string }> {
    if (!this.downloadedPath || !fs.existsSync(this.downloadedPath)) {
      return { success: false, error: 'Installer not downloaded' }
    }
    try {
      await shell.openPath(this.downloadedPath)
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** 请求 GitHub Releases API 获取最新版本信息 */
  private async fetchLatestRelease(): Promise<GitHubRelease> {
    const response = await net.fetch(GITHUB_API_LATEST, {
      headers: { 'User-Agent': 'Aria2Desktop-Update' }
    })
    if (!response.ok) {
      throw new Error(`GitHub API request failed: ${response.status}`)
    }
    return (await response.json()) as GitHubRelease
  }

  /** 按当前架构匹配安装包资产 */
  private findInstallerAsset(assets: GitHubAsset[], arch: string): GitHubAsset | undefined {
    const suffixMap: Record<string, string> = {
      x64: '-x64-Setup.exe',
      ia32: '-x86-Setup.exe',
      arm64: '-arm64-Setup.exe'
    }
    const suffix = suffixMap[arch] || '-x64-Setup.exe'
    return assets.find((a) => a.name.endsWith(suffix)) || assets.find((a) => /-Setup\.exe$/i.test(a.name))
  }

  /** 流式下载安装包到临时目录，并推送下载进度 */
  private async downloadInstaller(url: string, version: string): Promise<void> {
    const response = await net.fetch(url, {
      headers: { 'User-Agent': 'Aria2Desktop-Update' }
    })
    if (!response.ok || !response.body) {
      throw new Error(`Download failed: ${response.status}`)
    }

    const total = Number(response.headers.get('content-length') || 0)
    const filePath = path.join(app.getPath('temp'), `Aria2Desktop-${version}-Setup.exe`)
    const fileStream = fs.createWriteStream(filePath)
    const reader = response.body.getReader()
    let received = 0

    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        received += value.byteLength
        if (!fileStream.write(Buffer.from(value))) {
          await new Promise<void>((resolve) => fileStream.once('drain', () => resolve()))
        }
        if (total > 0) {
          this.sendToRenderer({
            state: 'downloading',
            percent: Math.min(100, Math.round((received / total) * 100)),
            transferred: received,
            total
          })
        }
      }
      await new Promise<void>((resolve, reject) => {
        fileStream.end((err?: Error | null) => (err ? reject(err) : resolve()))
      })
    } finally {
      reader.releaseLock()
    }

    this.downloadedPath = filePath
  }

  /** 简单的语义化版本比较：a > b 返回 1，a < b 返回 -1，相等返回 0 */
  private compareVersions(a: string, b: string): number {
    const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
    const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
    const len = Math.max(pa.length, pb.length)
    for (let i = 0; i < len; i++) {
      const na = pa[i] || 0
      const nb = pb[i] || 0
      if (na > nb) return 1
      if (na < nb) return -1
    }
    return 0
  }
}
