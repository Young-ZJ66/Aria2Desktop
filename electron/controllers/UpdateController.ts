import { app, BrowserWindow, shell } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'
import * as crypto from 'crypto'
import { URL } from 'url'
// 版本比较已抽到 utils/version（纯函数，便于单测）
import { compareVersions } from '../utils/version'
// tag / 更新日志的解析是纯字符串判定，抽到 releaseFeed 后可按真实报文固化边界用例
import { extractReleaseNotes, parseStableTagFromLocation } from '../utils/releaseFeed'
import { downloadDelta, saveDeltaCache, discardDeltaCache } from '../services/deltaUpdater'
import { createLogger } from '../utils/logger'
import { isPackagedApp } from '../utils/appEnv'

// 本文件日志文案自带 [UpdateController] 前缀（历史风格），故 scope 传空避免前缀重复
const logger = createLogger('')

// 仓库信息与版本查询入口
const GITHUB_REPO = 'Young-ZJ66/Aria2Desktop'
// releases.atom 订阅源：普通网页接口，不受 GitHub API 配额（403 限流）影响
const RELEASES_ATOM_URL = `https://github.com/${GITHUB_REPO}/releases.atom`
// releases/latest 跳转地址：GitHub 保证它永远 302 到**最新非 pre-release** 的 tag 页
const RELEASES_LATEST_URL = `https://github.com/${GITHUB_REPO}/releases/latest`
const MAX_REDIRECTS = 5

/**
 * UpdateController - 检查更新流程：
 * 1. 通过 `releases/latest` 的 302 重定向获取最新稳定版 tag（服务端保证非 pre-release），
 *    再从 releases.atom 中按该 tag 匹配出更新日志（atom 按时间排序，最新条目可能是
 *    pre-release，不能按位置取第一条）；比对本地版本
 * 2. 发现新版本后按命名规则构造安装包下载地址并下载（优先差量、失败回落全量 + 断点续传，
 *    带进度推送）
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
    /** 该平台不支持应用内安装（macOS/Linux）：UI 改为引导去 Release 页 */
    manualDownload?: boolean
    error?: string
  }> {
    if (!isPackagedApp) {
      return { success: false, hasUpdate: false, error: 'Development mode does not support auto update' }
    }
    try {
      const { tag, notes } = await this.fetchLatestReleaseInfo()
      const latestVersion = tag.replace(/^v/i, '')
      if (compareVersions(latestVersion, app.getVersion()) <= 0) {
        this.sendToRenderer({ state: 'not-available' })
        return { success: true, hasUpdate: false }
      }
      this.sendToRenderer({
        state: 'available',
        version: latestVersion,
        notes,
        // 定时复查（见 startScheduledCheck）只走推送不开弹窗返回值，渲染层需要这两项打开弹窗
        manualDownload: !UpdateController.AUTO_INSTALL_SUPPORTED
      })
      const alreadyDownloaded = this.downloadedVersion === latestVersion &&
        !!this.downloadedPath && fs.existsSync(this.downloadedPath)
      return {
        success: true,
        hasUpdate: true,
        version: latestVersion,
        notes,
        alreadyDownloaded,
        manualDownload: !UpdateController.AUTO_INSTALL_SUPPORTED
      }
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
    manualDownload?: boolean
    error?: string
  }> {
    return this.checkForUpdates()
  }

  /** 下载最新版本安装包（带进度推送），由用户在更新弹窗中确认后调用。
    checksumUnavailable：安装包已下载但无校验文件可验证完整性（存量 Release 兼容） */
  async downloadUpdate(): Promise<{ success: boolean; error?: string; checksumUnavailable?: boolean }> {
    if (!isPackagedApp) {
      return { success: false, error: 'Development mode does not support auto update' }
    }
    // 非 Windows 平台不提供应用内安装：返回明确标记，渲染层据此引导用户去 Release 页
    if (!UpdateController.AUTO_INSTALL_SUPPORTED) {
      return { success: false, error: 'manual_download_required' }
    }
    if (this.isDownloading) {
      return { success: false, error: 'Download already in progress' }
    }
    try {
      const { tag } = await this.fetchLatestReleaseInfo()
      const latestVersion = tag.replace(/^v/i, '')
      if (compareVersions(latestVersion, app.getVersion()) <= 0) {
        return { success: false, error: 'No update available' }
      }
      // 同版本已下载完成时直接复用，不重复下载
      if (this.downloadedVersion === latestVersion && this.downloadedPath && fs.existsSync(this.downloadedPath)) {
        this.sendToRenderer({ state: 'downloaded', version: latestVersion })
        return { success: true }
      }

      this.isDownloading = true
      const downloadUrl = this.buildInstallerUrl(latestVersion)
      const { checksumUnavailable } = await this.downloadInstaller(downloadUrl, latestVersion)
      this.sendToRenderer({ state: 'downloaded', version: latestVersion })
      return { success: true, checksumUnavailable }
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
      // 使用 app.exit() 而非 app.quit()：跳过 before-quit 中的 Aria2 优雅关闭（RPC shutdown + 等待退出），
      // 让进程立即退出。NSIS 安装程序会等待旧进程退出后才继续安装，
      // app.quit() 会触发耗时的优雅关闭导致安装程序与旧进程死锁。
      // 注意：这里既不保存会话也不停引擎 —— 都由调用方（restart-and-install handler）在安装前补齐：
      // 先 aria2.saveSession 落盘，再 fire-and-forget 地请求 aria2 关闭（否则它会成为孤儿进程占住 RPC 端口）。
      setTimeout(() => app.exit(0), 500)
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  // ---------- 周期复查（P1） ----------
  // 本应用是托盘常驻型下载器，用户可能数天不重启；只在启动时检查一次，
  // 长驻用户会一直错过新版本。定时器放主进程而非渲染层：渲染层 reload/销毁会重置计时。
  private dailyCheckTimer: NodeJS.Timeout | null = null
  private static readonly DAILY_CHECK_MS = 24 * 60 * 60 * 1000

  /** 启动每日更新复查（重复调用无副作用）。由 IpcController.registerHandlers 挂载 */
  startScheduledCheck(): void {
    if (this.dailyCheckTimer) return
    this.dailyCheckTimer = setInterval(() => {
      // checkForUpdates 自带 isPackaged 守卫与错误消化；hasUpdate 时内部会推送 available
      this.checkForUpdates().catch((e) => {
        logger.warn('[UpdateController] Scheduled update check failed:', e)
      })
    }, UpdateController.DAILY_CHECK_MS)
    // 不阻止进程退出：检查器不在应用的关键路径上
    this.dailyCheckTimer.unref()
    logger.info('[UpdateController] 每日更新复查已启动')
  }

  /** 停止每日复查（应用退出时调用），避免定时器延迟进程退出 */
  stopScheduledCheck(): void {
    if (!this.dailyCheckTimer) return
    clearInterval(this.dailyCheckTimer)
    this.dailyCheckTimer = null
  }

  /**
   * 探测最新稳定版 tag。
   *
   * 为什么用 `releases/latest` 的 302 而不是继续解析 atom 的第一条：atom 按时间排序，
   * 只要发过 pre-release，第一条就是它——而 `compareVersions` 明确不处理预发布后缀
   * （"1.0.0-beta" 等价于 "1.0.0"），会把 beta 当正式版推给所有用户，且按 beta tag
   * 拼出的安装包地址不存在，全体用户的更新检查会变成"发现新版本 → 下载失败"。
   * GitHub 对 `releases/latest` 的定义就是"最新非 pre-release"，服务端过滤最可靠。
   *
   * 实测行为：HEAD 请求 → 302 → `Location: https://github.com/<repo>/releases/tag/v1.0.9`，
   * 一个请求头就拿到版本号，无需解析任何 HTML。
   */
  private fetchLatestStableTag(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const req = https.request(this.buildRequestOptions(RELEASES_LATEST_URL, 'HEAD'), (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          const tag = parseStableTagFromLocation(res.headers.location)
          if (tag) {
            resolve(tag)
            return
          }
          reject(new Error('No release tag found in redirect Location'))
          return
        }
        res.resume()
        reject(new Error(`Unexpected status from releases/latest: ${res.statusCode}`))
      })
      req.setTimeout(15000, () => req.destroy(new Error('Update check timed out')))
      req.on('error', reject)
      req.end()
    })
  }

  /**
   * 获取最新稳定版的 tag 与更新日志。
   *
   * 版本号由 302 给出（见 fetchLatestStableTag）；日志从 atom 中**按 tag 匹配**提取——
   * 不能取第一条 entry（它可能是 pre-release）。atom 拿不到时日志为空串：
   * 日志只是展示信息，缺失不影响更新判断，这里降级而不是失败。
   */
  private async fetchLatestReleaseInfo(): Promise<{ tag: string; notes: string }> {
    const tag = await this.fetchLatestStableTag()

    let notes = ''
    try {
      const body = await this.fetchText(RELEASES_ATOM_URL)
      // 按 tag 精确匹配（不能取第一条 entry：它可能是 pre-release；也不能用 includes：
      // v1.1.0 是 v1.1.0-beta.1 的前缀）
      notes = extractReleaseNotes(body, tag)
      if (!notes) {
        logger.warn(`[UpdateController] atom 中未找到 tag ${tag} 的日志条目（可能已翻页），日志留空`)
      }
    } catch (error) {
      logger.warn('[UpdateController] Failed to fetch release notes (non-fatal):',
        error instanceof Error ? error.message : error)
    }

    return { tag, notes }
  }

  /** 按版本与当前架构构造安装包下载地址（命名规则与打包产物保持一致） */
  private buildInstallerUrl(version: string): string {
    const archSuffix = process.arch === 'ia32' ? 'x86' : process.arch === 'arm64' ? 'arm64' : 'x64'
    const fileName = `Aria2Desktop-${version}-${archSuffix}-Setup.exe`
    return `https://github.com/${GITHUB_REPO}/releases/download/v${version}/${fileName}`
  }

  /**
   * 是否支持"应用内下载并安装"。
   *
   * 只有 Windows 能做闭环：NSIS 安装包可以静默替换正在运行的旧版本。
   * macOS（dmg 需要用户拖入 /Applications，且未公证的应用需手动放行）与 Linux
   * （AppImage 需要用户自己替换文件）都无法可靠地自动完成，硬做只会造成
   * "下载完了却装不上"的困惑。因此这两个平台改为**检测到新版本后引导去 Release 页下载**。
   */
  private static readonly AUTO_INSTALL_SUPPORTED = process.platform === 'win32'

  /**
   * 下载安装包到临时目录（差量优先，失败回落全量），校验通过后转正。
   * 校验文件缺失时 resolve 携带 checksumUnavailable 标记（安装包保留，交由 UI 决定）。
   */
  private async downloadInstaller(url: string, version: string): Promise<{ checksumUnavailable?: boolean }> {
    const fileName = `Aria2Desktop-${version}-Setup.exe`
    // 临时文件名**固定**（不再带 Date.now()）：断点续传要求跨次重试能命中同一个文件
    const filePath = path.join(app.getPath('temp'), `${fileName}.download`)
    await this.cleanStaleDownloads(fileName)

    try {
      let checksumResult: { checksumUnavailable?: boolean } | undefined
      if (this.isDeltaCapable()) {
        try {
          // 差量：本地缓存着上次安装包时，只下载变化分块（通常每次更新省 70-80% 流量）。
          // 组装产物落在同一个 .download 路径，校验/转正/安装流程与全量完全一致；
          // 组装完仍走 verifyChecksum 全量校验——块表不是信任边界（见 deltaUpdater 的说明）
          const delta = await downloadDelta({
            installerUrl: url,
            newVersion: version,
            targetPath: filePath,
            onProgress: (percent, remoteBytes, totalSize) => {
              this.sendToRenderer({
                state: 'downloading',
                percent,
                // transferred 反映真实网络流量（差量的价值所在），total 用安装包体积，
                // 保证 UI 进度条语义连续
                transferred: remoteBytes,
                total: totalSize
              })
            }
          })
          logger.info(`[UpdateController] 差量下载完成：下载 ${(delta.remoteBytes / 1048576).toFixed(1)}MB，本地复用 ${(delta.savedBytes / 1048576).toFixed(1)}MB`)
          checksumResult = await this.verifyChecksum(filePath, url)
        } catch (error) {
          // 差量不可用（首次更新/无缓存/远端无块表/不值得）属常态而非错误：
          // 静默回落全量。半截产物必须清掉——否则全量的续传探测会把垃圾当有效前缀
          this.cleanupTempFile(filePath)
          logger.info('[UpdateController] 差量更新不可用，回落全量下载:',
            error instanceof Error ? error.message : error)
        }
      }

      if (!checksumResult) {
        checksumResult = await this.downloadWithRedirects(url, filePath, version, url, 0)
      }

      // 校验通过 → 转正（去 .download 后缀；restartAndInstall 启动的是这个正式名）
      const finalPath = path.join(app.getPath('temp'), fileName)
      await fs.promises.rename(filePath, finalPath)
      this.downloadedPath = finalPath
      this.downloadedVersion = version

      // 把本次安装包写入差量缓存，供**下次**更新做增量（约 100MB 常驻 userData/updates）。
      // 失败只记日志：缓存是纯优化，缺了下一次就走全量
      void saveDeltaCache(finalPath, version, url).catch((e) =>
        logger.warn('[UpdateController] 写入差量缓存失败（不影响本次更新）:', e))

      return checksumResult
    } catch (error) {
      // 任何失败清掉半截文件：损坏的前缀续传只会产出损坏的安装包，从头再来最稳
      this.cleanupTempFile(filePath)
      throw error
    }
  }

  /** 差量仅 Windows 全量安装链路可用：其余平台 downloadUpdate 已提前拦截，这里做双保险 */
  private isDeltaCapable(): boolean {
    return UpdateController.AUTO_INSTALL_SUPPORTED
  }

  /** 删除 temp 目录里**其它版本**的半截下载文件（本版本的正是续传要用的，不能删） */
  private async cleanStaleDownloads(keepFileName: string): Promise<void> {
    try {
      const dir = app.getPath('temp')
      const entries = await fs.promises.readdir(dir)
      const stale = entries.filter(name =>
        name.startsWith('Aria2Desktop-') &&
        name.endsWith('-Setup.exe.download') &&
        name !== `${keepFileName}.download`)
      for (const name of stale) {
        await fs.promises.unlink(path.join(dir, name)).catch(() => { /* 清理失败不阻断下载 */ })
      }
    } catch {
      // 目录不可读等场景只影响清理，不影响下载本身
    }
  }

  /** 删除未完成的临时安装包（存在时才删，忽略权限等清理失败） */
  private cleanupTempFile(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    } catch (error) {
      logger.warn('[UpdateController] Failed to clean temp installer:', error)
    }
  }

  /**
   * 全量下载（手动跟随重定向 + 断点续传），完成后就地做 SHA-256 校验。
   *
   * 续传机制：临时文件名固定（见 downloadInstaller），重试时若 .download 已有半截内容，
   * 发 `Range: bytes=N-` 从末尾继续。响应二态处理：
   * - 206 且 content-range 起点与本地一致 → 追加模式续传；
   * - 200（服务器不支持 Range，或远端文件已变）→ 截断重下，从头开始。
   * 校验失败的半截文件由调用方删除——绝不把损坏的前缀续成损坏的安装包。
   */
  private downloadWithRedirects(
    url: string,
    filePath: string,
    version: string,
    originalUrl: string,
    redirectCount: number
  ): Promise<{ checksumUnavailable?: boolean }> {
    return new Promise((resolve, reject) => {
      if (redirectCount > MAX_REDIRECTS) {
        reject(new Error('Too many redirects'))
        return
      }

      // 断点续传起点：本地已有半截内容时从末尾继续（同步 stat，与创建写流的间隙不存在竞态——
      // 本应用同时只允许一个下载任务，isDownloading 在入口把守）
      let startOffset = 0
      try {
        startOffset = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0
      } catch {
        startOffset = 0
      }
      const rangeHeaders: Record<string, string> = {}
      if (startOffset > 0) rangeHeaders.Range = `bytes=${startOffset}-`

      const req = https.request(this.buildRequestOptions(url, 'GET', rangeHeaders), (res) => {
        // 手动跟随重定向（GitHub 资产下载会 302 到 CDN），Range 头在下一跳继续携带
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          const nextUrl = new URL(res.headers.location, url).toString()
          this.downloadWithRedirects(nextUrl, filePath, version, originalUrl, redirectCount + 1)
            .then(resolve)
            .catch(reject)
          return
        }

        if (!res.statusCode || res.statusCode >= 400) {
          res.resume()
          reject(new Error(`Download failed: ${res.statusCode}`))
          return
        }

        // 206 = 服务器接受了续传；其余（200）一律按全量处理
        let resumed = false
        if (res.statusCode === 206) {
          const rangeMatch = /bytes (\d+)-/.exec(String(res.headers['content-range'] ?? ''))
          // 起点与本地不一致（远端文件已变/CDN 缓存层异常）时不能续：当全量重下
          resumed = !!rangeMatch && Number(rangeMatch[1]) === startOffset
          if (!resumed) startOffset = 0
        } else {
          startOffset = 0
        }

        // 总大小：206 的 content-length 是"剩余字节"，真实总量在 content-range 的 /total 里
        let total = 0
        if (resumed) {
          const totalMatch = /\/(\d+)$/.exec(String(res.headers['content-range'] ?? ''))
          total = totalMatch ? Number(totalMatch[1]) : 0
        } else {
          total = Number(res.headers['content-length'] || 0)
        }

        // 追加（'a'）或截断（'w'）由续传是否成立决定；收到响应头才开流，避免先创建后推翻
        const baseOffset = resumed ? startOffset : 0
        const fileStream = fs.createWriteStream(filePath, { flags: resumed ? 'a' : 'w' })
        let received = baseOffset
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
            // 写盘完成后校验 SHA-256（release 附带 .sha256 时强制校验；
            // 缺失时 resolve 携带 checksumUnavailable，由 UI 提示并让用户显式决定）
            this.verifyChecksum(filePath, originalUrl)
              .then(resolve)
              .catch(reject)
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
    })
  }

  /**
 * 校验安装包 SHA-256：
 * - release 附带 `${url}.sha256` 时强制比对，不匹配/格式异常则拒绝安装（安全红线，不放开）；
 * - 校验文件缺失或获取失败（404/网络错误）时返回 { checksumUnavailable: true }，
 *   不自动安装也不删除已下载的安装包，交由渲染层提示用户后由其显式决定是否安装
 *   （用于兼容尚未附带校验文件的存量 Release）。
 */
  private async verifyChecksum(installerPath: string, originalUrl: string): Promise<{ checksumUnavailable?: boolean }> {
    let sha256Text: string | null = null
    try {
      sha256Text = await this.fetchText(`${originalUrl}.sha256`)
    } catch (error) {
      logger.warn('[UpdateController] Checksum file unavailable, installer left unverified:',
        error instanceof Error ? error.message : error)
      return { checksumUnavailable: true }
    }
    if (!sha256Text) {
      return { checksumUnavailable: true }
    }
    // 兼容 "hash  filename" 与纯 hash 两种格式
    const expected = sha256Text.trim().split(/\s+/)[0].toLowerCase()
    // 格式异常（非 64 位 hex）时拒绝校验，防止攻击者构造格式异常的 sha256 文件绕过完整性校验
    if (!/^[0-9a-f]{64}$/.test(expected)) {
      throw new Error('SHA-256 校验文件格式异常，已拒绝自动安装，请从 GitHub Release 手动下载')
    }
    const actual = await this.computeSha256(installerPath)
    if (actual !== expected) {
      // 校验失败时顺手清掉差量缓存：本地底版损坏/被篡改是常见成因，
      // 不清的话下次差量会再次拼出同一个坏包（自愈优先于保留缓存）
      await discardDeltaCache()
      throw new Error(`SHA-256 校验失败：期望 ${expected.slice(0, 12)}…，实际 ${actual.slice(0, 12)}…`)
    }
    logger.info('[UpdateController] Installer checksum verified')
    return {}
  }

  /**
   * 流式计算文件 SHA-256。
   * 安装包 100MB 级，readFileSync 整包读入会占用大内存并同步阻塞主进程事件循环
   * （校验期间 UI 冻结、IPC 无响应），故必须流式分块计算。
   */
  private computeSha256(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256')
      const stream = fs.createReadStream(filePath)
      stream.on('data', (chunk) => hash.update(chunk))
      stream.on('error', reject)
      stream.on('end', () => resolve(hash.digest('hex')))
    })
  }

  /** GET 文本（用于拉取 .sha256）。GitHub 资产会 302 到 CDN，需手动跟随重定向，
    否则 302 空响应体会被误判为"无校验文件" */
  private fetchText(url: string, redirectCount = 0): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const fail = (err: unknown) => {
        reject(err instanceof Error ? err : new Error(String(err)))
      }
      const req = https.request(this.buildRequestOptions(url), (res) => {
        // 手动跟随重定向（releases/download 资产会 302 到 release-assets CDN）
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          if (redirectCount >= MAX_REDIRECTS) {
            fail(new Error('Too many redirects'))
            return
          }
          const nextUrl = new URL(res.headers.location, url).toString()
          this.fetchText(nextUrl, redirectCount + 1).then(resolve).catch(fail)
          return
        }

        if (!res.statusCode || res.statusCode >= 400) {
          res.resume()
          fail(new Error(`Fetch failed: ${res.statusCode}`))
          return
        }
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
        res.on('error', (err) => fail(err))
      })
      req.setTimeout(15000, () => req.destroy(new Error('Fetch checksum timed out')))
      req.on('error', (err) => fail(err))
      req.end()
    })
  }

  /** 构造 https 请求选项（method 默认 GET；差量下载等场景需要自定义 headers 见各调用处） */
  private buildRequestOptions(url: string, method: 'GET' | 'HEAD' = 'GET', extraHeaders: Record<string, string> = {}): https.RequestOptions {
    const parsed = new URL(url)
    return {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method,
      headers: { 'User-Agent': 'Aria2Desktop-Update', ...extraHeaders }
    }
  }
}
