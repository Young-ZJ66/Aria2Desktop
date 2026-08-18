import { app, BrowserWindow, shell } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'
import { URL } from 'url'

// 仓库信息与版本查询入口
const GITHUB_REPO = 'Young-ZJ66/Aria2Desktop'
// releases.atom 订阅源：普通网页接口，不受 GitHub API 配额（403 限流）影响
const RELEASES_ATOM_URL = `https://github.com/${GITHUB_REPO}/releases.atom`
const MAX_REDIRECTS = 5

/**
 * UpdateController - 检查更新流程：
 * 1. 通过 releases.atom 订阅源获取最新版本号（普通网页接口，不受 API 限流影响）并比对本地版本
 * 2. 发现新版本后按命名规则构造安装包下载地址并下载（带进度推送）
 * 3. 点击"重启更新"后启动安装程序并退出应用，完成安装后自动重启新版
 *
 * 网络请求统一使用 Node 原生 https（手动跟随重定向），
 * 避免 Electron net.fetch（Chromium 网络栈）流式下载大文件时偶发的连接中断。
 * 不依赖 latest.yml / blockmap / GitHub API，不使用 electron-updater。
 * 状态通过 webContents.send('update:status', ...) 推送给渲染进程。
 */
export class UpdateController {
  private getWindow: () => BrowserWindow | null
  private downloadedPath: string = ''
  private downloadedVersion: string = ''
  private isDownloading = false

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

  /** 检查更新（只检查不下载），供启动检查与设置页手动检查共用 */
  async checkForUpdates(): Promise<{
    success: boolean
    hasUpdate: boolean
    version?: string
    notes?: string
    /** 本次会话中该版本安装包是否已下载完成 */
    alreadyDownloaded?: boolean
    error?: string
  }> {
    if (!app.isPackaged) {
      return { success: false, hasUpdate: false, error: 'Development mode does not support auto update' }
    }
    try {
      const { tag, notes } = await this.fetchLatestReleaseInfo()
      const latestVersion = tag.replace(/^v/i, '')
      if (this.compareVersions(latestVersion, app.getVersion()) <= 0) {
        this.sendToRenderer({ state: 'not-available' })
        return { success: true, hasUpdate: false }
      }
      this.sendToRenderer({ state: 'available', version: latestVersion })
      const alreadyDownloaded = this.downloadedVersion === latestVersion &&
        !!this.downloadedPath && fs.existsSync(this.downloadedPath)
      return { success: true, hasUpdate: true, version: latestVersion, notes, alreadyDownloaded }
    } catch (error) {
      return { success: false, hasUpdate: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** 启动时后台检查更新（只提醒，不下载），与 checkForUpdates 行为一致 */
  async checkForUpdatesOnStartup(): Promise<{
    success: boolean
    hasUpdate: boolean
    version?: string
    notes?: string
    alreadyDownloaded?: boolean
    error?: string
  }> {
    return this.checkForUpdates()
  }

  /** 下载最新版本安装包（带进度推送），由用户在更新弹窗中确认后调用 */
  async downloadUpdate(): Promise<{ success: boolean; error?: string }> {
    if (!app.isPackaged) {
      return { success: false, error: 'Development mode does not support auto update' }
    }
    if (this.isDownloading) {
      return { success: false, error: 'Download already in progress' }
    }
    try {
      const { tag } = await this.fetchLatestReleaseInfo()
      const latestVersion = tag.replace(/^v/i, '')
      if (this.compareVersions(latestVersion, app.getVersion()) <= 0) {
        return { success: false, error: 'No update available' }
      }
      // 同版本已下载完成时直接复用，不重复下载
      if (this.downloadedVersion === latestVersion && this.downloadedPath && fs.existsSync(this.downloadedPath)) {
        this.sendToRenderer({ state: 'downloaded', version: latestVersion })
        return { success: true }
      }

      this.isDownloading = true
      const downloadUrl = this.buildInstallerUrl(latestVersion)
      await this.downloadInstaller(downloadUrl, latestVersion)
      this.sendToRenderer({ state: 'downloaded', version: latestVersion })
      return { success: true }
    } catch (error) {
      // 失败原因通过返回值交给渲染层展示（附 GitHub 手动下载指引），不再推送 error 状态避免重复提示
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    } finally {
      this.isDownloading = false
    }
  }

  /** 重启更新：启动安装程序并退出应用，安装完成（runAfterFinish）后自动重启新版 */
  async restartAndInstall(): Promise<{ success: boolean; error?: string }> {
    if (!this.downloadedPath || !fs.existsSync(this.downloadedPath)) {
      return { success: false, error: 'Installer not downloaded' }
    }
    try {
      const errMsg = await shell.openPath(this.downloadedPath)
      if (errMsg) {
        return { success: false, error: errMsg }
      }
      // 稍作延迟确保安装程序已启动，再退出应用
      setTimeout(() => app.quit(), 1500)
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** 请求 releases.atom 订阅源，提取最新 Release 的 tag 与更新内容（如 v1.0.1） */
  private fetchLatestReleaseInfo(): Promise<{ tag: string; notes: string }> {
    return new Promise<{ tag: string; notes: string }>((resolve, reject) => {
      const req = https.request(this.buildRequestOptions(RELEASES_ATOM_URL), (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          if (!res.statusCode || res.statusCode >= 400) {
            reject(new Error(`Failed to fetch release feed: ${res.statusCode}`))
            return
          }
          const body = Buffer.concat(chunks).toString('utf-8')
          // 匹配第一个 release tag，如 https://github.com/.../releases/tag/v1.0.1
          const tagMatch = /releases\/tag\/([^/<"']+)/.exec(body)
          if (!tagMatch) {
            reject(new Error('No release tag found'))
            return
          }
          // 提取第一条 entry 的更新内容（content 节点，HTML 转义，需反转义）
          const contentMatch = /<content[^>]*>([\s\S]*?)<\/content>/.exec(body)
          const notes = contentMatch ? this.decodeHtmlEntities(contentMatch[1]).trim() : ''
          resolve({ tag: tagMatch[1], notes })
        })
        res.on('error', reject)
      })
      // 15 秒超时，避免网络异常时请求永久挂起（更新检查随之无法返回）
      req.setTimeout(15000, () => req.destroy(new Error('Update check timed out')))
      req.on('error', reject)
      req.end()
    })
  }

  /** 反转义 atom 内容中的 HTML 实体 */
  private decodeHtmlEntities(input: string): string {
    return input
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
  }

  /** 按版本与当前架构构造安装包下载地址（命名规则与打包产物保持一致） */
  private buildInstallerUrl(version: string): string {
    const archSuffix = process.arch === 'ia32' ? 'x86' : process.arch === 'arm64' ? 'arm64' : 'x64'
    const fileName = `Aria2Desktop-${version}-${archSuffix}-Setup.exe`
    return `https://github.com/${GITHUB_REPO}/releases/download/v${version}/${fileName}`
  }

  /** 流式下载安装包到临时目录，并推送下载进度 */
  private downloadInstaller(url: string, version: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // 每次下载使用唯一文件名，避免覆盖仍被占用（如安装器运行中/杀软扫描）的旧文件
      const filePath = path.join(app.getPath('temp'), `Aria2Desktop-${version}-${Date.now()}-Setup.exe`)
      this.downloadWithRedirects(url, filePath, version, 0, resolve, reject)
    })
  }

  /** 递归处理重定向并写盘（GitHub 资产下载会 302 到 CDN） */
  private downloadWithRedirects(
    url: string,
    filePath: string,
    version: string,
    redirectCount: number,
    resolve: () => void,
    reject: (reason?: unknown) => void
  ): void {
    if (redirectCount > MAX_REDIRECTS) {
      reject(new Error('Too many redirects'))
      return
    }

    const req = https.request(this.buildRequestOptions(url), (res) => {
      // 手动跟随重定向
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        const nextUrl = new URL(res.headers.location, url).toString()
        this.downloadWithRedirects(nextUrl, filePath, version, redirectCount + 1, resolve, reject)
        return
      }

      if (!res.statusCode || res.statusCode >= 400) {
        res.resume()
        reject(new Error(`Download failed: ${res.statusCode}`))
        return
      }

      const total = Number(res.headers['content-length'] || 0)
      const fileStream = fs.createWriteStream(filePath)
      let received = 0
      let failed = false

      // 磁盘满、权限不足等写盘失败也要终止下载并退出 Promise，避免永久挂起
      fileStream.on('error', (err) => {
        failed = true
        res.destroy()
        fileStream.destroy()
        reject(err)
      })

      res.on('data', (chunk: Buffer) => {
        if (failed) return
        received += chunk.length
        if (!fileStream.write(chunk)) {
          res.pause()
          fileStream.once('drain', () => res.resume())
        }
        if (total > 0) {
          this.sendToRenderer({
            state: 'downloading',
            percent: Math.min(100, Math.round((received / total) * 100)),
            transferred: received,
            total
          })
        }
      })

      res.on('end', () => {
        if (failed) return
        fileStream.end(() => {
          this.downloadedPath = filePath
          this.downloadedVersion = version
          resolve()
        })
      })

      res.on('error', (err) => {
        fileStream.destroy()
        reject(err)
      })
    })

    // 30 秒内无数据视为超时，避免长时间无响应
    req.setTimeout(30000, () => req.destroy(new Error('Download timed out')))
    req.on('error', reject)
    req.end()
  }

  /** 构造 https 请求选项 */
  private buildRequestOptions(url: string): https.RequestOptions {
    const parsed = new URL(url)
    return {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: { 'User-Agent': 'Aria2Desktop-Update' }
    }
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
