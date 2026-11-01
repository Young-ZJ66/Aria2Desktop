/**
 * yt-dlp 集成服务（可选外部引擎）
 * 提供流媒体 URL 解析、格式提取和下载能力。
 *
 * 交付方式：**按需下载**。应用不随包携带 yt-dlp（单平台 20–40 MB，且站点改版后需频繁更新），
 * 首次进入流媒体页时由用户点一次按钮，从官方 GitHub Release 下载当前平台的构建产物，
 * 校验官方 SHA-256 后落到 userData。也可继续使用用户自行安装并加入 PATH 的版本。
 * 未安装时所有操作优雅降级（返回错误提示而非崩溃）。
 */

import { spawn } from 'child_process'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { app, net } from 'electron'
import { isPackagedApp } from '../utils/appEnv'
import { findYtdlpChecksum, resolveYtdlpAsset } from '../utils/ytdlpAssets'
import { createLogger } from '../utils/logger'

const logger = createLogger('YtdlpService')

/** yt-dlp 官方 Release 的固定下载前缀（`latest` 会 302 到当前最新 tag） */
const RELEASE_BASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download'

/** 30 秒无数据视为断流（GitHub 直连被重置时能尽快给出可行动的提示） */
const IDLE_TIMEOUT_MS = 30_000
/** 校验文件很小，10 秒足够 */
const TEXT_IDLE_TIMEOUT_MS = 10_000
/** 校验文件防御性上限（正常约 1.6 KB） */
const MAX_TEXT_BYTES = 64 * 1024

/** yt-dlp 元信息（精简版） */
export interface YtdlpVideoInfo {
  title: string
  url: string           // 实际媒体下载 URL
  ext: string           // 容器格式（mp4, mkv, webm 等）
  filesize: number | null
  format: string        // 格式描述
  formats: YtdlpFormat[]
  /** 直链下载时服务器要求的请求头（Referer/User-Agent 等），需原样交给 aria2 */
  httpHeaders: Record<string, string>
}

export interface YtdlpFormat {
  formatId: string
  ext: string
  resolution: string
  fps: number | null
  filesize: number | null
  vcodec: string
  acodec: string
  note: string
}

/** yt-dlp 可用性 + 自动安装能力（供流媒体页决定显示表单还是下载按钮） */
export interface YtdlpCheckResult {
  available: boolean
  version?: string
  error?: string
  /** 可执行文件来源：应用内下载 / 随包内置 / 系统 PATH */
  source?: 'downloaded' | 'bundled' | 'path'
  /** 当前平台是否支持自动下载 */
  installable: boolean
  /** 下载体积（MB），仅用于界面提示 */
  approxSizeMB?: number
}

export interface YtdlpInstallResult {
  success: boolean
  version?: string
  error?: string
}

export interface YtdlpInstallProgress {
  percent: number
  transferred: number
  total: number
}

interface ResolvedExecutable {
  command: string
  source: 'downloaded' | 'bundled' | 'path'
}

/** 并发保护：同一时刻只允许一个安装任务（重复点击直接复用进行中的 Promise） */
let installInFlight: Promise<YtdlpInstallResult> | null = null

/** 应用内下载的存放目录（与 aria2 配置同根的 userData） */
function downloadDir(): string {
  return path.join(app.getPath('userData'), 'yt-dlp')
}

/** 当前平台的可执行文件名（下载/内置/PATH 三种来源共用同一名字） */
function executableName(): string {
  return resolveYtdlpAsset(process.platform, process.arch)?.executable
    ?? (process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')
}

/**
 * 解析实际要执行的路径。
 *
 * 优先级：应用内下载 > 随包内置（预留）> 系统 PATH。
 * 下载版优先是因为它是用户在应用里显式安装的；PATH 版作为未下载用户的回退。
 */
function resolveExecutable(): ResolvedExecutable {
  const name = executableName()
  const downloaded = path.join(downloadDir(), name)
  if (fs.existsSync(downloaded)) return { command: downloaded, source: 'downloaded' }

  if (isPackagedApp) {
    const bundled = path.join(process.resourcesPath, 'yt-dlp', name)
    if (fs.existsSync(bundled)) return { command: bundled, source: 'bundled' }
  }
  return { command: 'yt-dlp', source: 'path' }
}

/** 检查 yt-dlp 是否可用（含来源与自动安装能力） */
export async function checkYtdlpAvailable(): Promise<YtdlpCheckResult> {
  const asset = resolveYtdlpAsset(process.platform, process.arch)
  const installable = Boolean(asset)
  const approxSizeMB = asset?.approxSizeMB
  const resolved = resolveExecutable()
  try {
    const version = (await execYtdlp(['--version'], resolved.command)).trim()
    return { available: true, version, source: resolved.source, installable, approxSizeMB }
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error),
      source: resolved.source,
      installable,
      approxSizeMB
    }
  }
}

/**
 * 下载并安装当前平台的 yt-dlp。
 *
 * 安全约束：**校验和缺失/不匹配一律拒绝安装**——下载的是将被执行的二进制，
 * 不能像普通资源那样"校验不了就先用了"。校验文件与二进制都来自官方 Release。
 */
export function installYtdlp(onProgress?: (progress: YtdlpInstallProgress) => void): Promise<YtdlpInstallResult> {
  if (installInFlight) return installInFlight
  installInFlight = performInstall(onProgress).finally(() => {
    installInFlight = null
  })
  return installInFlight
}

async function performInstall(
  onProgress?: (progress: YtdlpInstallProgress) => void
): Promise<YtdlpInstallResult> {
  const asset = resolveYtdlpAsset(process.platform, process.arch)
  if (!asset) {
    return { success: false, error: '当前平台暂不支持自动下载 yt-dlp，请手动安装并加入系统 PATH' }
  }

  const targetPath = path.join(downloadDir(), asset.executable)
  const tempPath = `${targetPath}.download`
  let installed = false

  try {
    fs.mkdirSync(downloadDir(), { recursive: true })
    fs.rmSync(tempPath, { force: true })

    // 先取官方校验和：拿不到就停止，绝不安装未校验的可执行文件
    const sums = await fetchText(`${RELEASE_BASE}/SHA2-256SUMS`)
    const expected = findYtdlpChecksum(sums, asset.fileName)
    if (!expected) {
      return { success: false, error: '官方校验文件中缺少该平台的 SHA-256，已停止安装' }
    }

    await downloadFile(`${RELEASE_BASE}/${asset.fileName}`, tempPath, onProgress)

    const actual = await computeSha256(tempPath)
    if (actual !== expected) {
      fs.rmSync(tempPath, { force: true })
      logger.warn(`yt-dlp 校验失败：期望 ${expected.slice(0, 12)}…，实际 ${actual.slice(0, 12)}…`)
      return {
        success: false,
        error: `SHA-256 校验失败（期望 ${expected.slice(0, 12)}…，实际 ${actual.slice(0, 12)}…）`
      }
    }

    // 原子替换：Windows 的 rename 不能覆盖已存在文件，先移除旧版本
    fs.rmSync(targetPath, { force: true })
    fs.renameSync(tempPath, targetPath)
    installed = true
    if (process.platform !== 'win32') fs.chmodSync(targetPath, 0o755)

    // 真正执行一次，确认不是"下载成功但跑不起来"（如 glibc 不兼容/被拦截）
    const version = (await execYtdlp(['--version'], targetPath)).trim()
    logger.info(`yt-dlp 安装完成: ${version}`)
    return { success: true, version }
  } catch (error) {
    fs.rmSync(tempPath, { force: true })
    if (installed) {
      // 装了但验证失败：不要留下一个"存在却不可用"的文件，否则界面会一直判定异常
      fs.rmSync(targetPath, { force: true })
    }
    logger.warn('yt-dlp 安装失败:', error)
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** 获取视频信息（标题、格式列表等） */
export async function getVideoInfo(url: string): Promise<{ success: boolean; info?: YtdlpVideoInfo; error?: string }> {
  try {
    const args = [
      '--dump-json',
      '--no-download',
      '--no-warnings',
      '--no-playlist',
      url
    ]
    const output = await execYtdlp(args)
    const data = JSON.parse(output)

    const formats: YtdlpFormat[] = (data.formats || []).map((f: Record<string, unknown>) => ({
      formatId: String(f.format_id || ''),
      ext: String(f.ext || ''),
      resolution: String(f.resolution || 'audio only'),
      fps: f.fps as number | null || null,
      filesize: (f.filesize || f.filesize_approx) as number | null || null,
      vcodec: String(f.vcodec || 'none'),
      acodec: String(f.acodec || 'none'),
      note: String(f.format_note || '')
    }))

    // 选择最佳格式（优先有视频+音频的合并格式，其次最佳视频+音频）
    const bestUrl = data.url || ''
    const bestExt = data.ext || 'mp4'

    return {
      success: true,
      info: {
        title: data.title || data.fulltitle || 'Unknown',
        url: bestUrl,
        ext: bestExt,
        filesize: data.filesize || data.filesize_approx || null,
        format: data.format || `${bestExt} (best)`,
        formats,
        httpHeaders: normalizeHttpHeaders(data.http_headers)
      }
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** 获取指定格式的直接下载 URL（同时返回该直链要求的请求头） */
export async function getFormatUrl(url: string, formatId: string): Promise<{ success: boolean; downloadUrl?: string; title?: string; ext?: string; httpHeaders?: Record<string, string>; error?: string }> {
  // formatId 直接拼入 -f 参数：校验只允许 yt-dlp 合法格式标识字符，
  // 防止以 "--" 开头的值被 yt-dlp 误解析为命令行选项（参数注入）
  if (!/^[A-Za-z0-9+._-]+$/.test(formatId)) {
    return { success: false, error: 'Invalid format id' }
  }
  try {
    const args = [
      '--dump-json',
      '--no-download',
      '--no-warnings',
      '--no-playlist',
      '-f', formatId,
      url
    ]
    const output = await execYtdlp(args)
    const data = JSON.parse(output)

    return {
      success: true,
      downloadUrl: data.url || '',
      title: data.title || 'Unknown',
      ext: data.ext || 'mp4',
      // Bilibili 等站点会对直链校验 Referer/User-Agent，缺了它们 aria2 会直接 403
      httpHeaders: normalizeHttpHeaders(data.http_headers)
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * 收敛 yt-dlp 的 http_headers 为字符串字典。
 * 非字符串值一律丢弃（RPC/aria2 只接受 `Header: value` 形式的字符串）。
 */
function normalizeHttpHeaders(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {}
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string' && value) headers[key] = value
  }
  return headers
}

/**
 * 执行 yt-dlp 命令并返回 stdout
 * 默认使用解析出的可执行文件（下载版/内置版/PATH），安装后校验可显式指定路径。
 */
function execYtdlp(args: string[], command = resolveExecutable().command): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })

    // 30 秒超时看门狗（进程退出/报错时清理，避免正常完成后计时器残留）
    const watchdog = setTimeout(() => {
      proc.kill('SIGKILL')
      reject(new Error('yt-dlp 执行超时'))
    }, 30000)
    const clearWatchdog = () => clearTimeout(watchdog)

    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', (data) => { stdout += data.toString() })
    proc.stderr?.on('data', (data) => { stderr += data.toString() })

    proc.on('error', (err) => {
      clearWatchdog()
      if (err.message.includes('ENOENT')) {
        reject(new Error('未检测到 yt-dlp。可在流媒体页一键下载，或自行安装并加入系统 PATH。'))
      } else {
        reject(err)
      }
    })

    proc.on('exit', (code) => {
      clearWatchdog()
      if (code === 0) {
        resolve(stdout)
      } else {
        reject(new Error(stderr || `yt-dlp exited with code ${code}`))
      }
    })
  })
}

/** 空闲超时守卫：一段时间内没有任何数据回调就触发失败（避免请求永久挂起） */
function startIdleTimer(timeoutMs: number, onTimeout: () => void): { reset: () => void; clear: () => void } {
  let timer: NodeJS.Timeout | null = null
  const clear = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }
  const reset = () => {
    clear()
    timer = setTimeout(onTimeout, timeoutMs)
  }
  reset()
  return { reset, clear }
}

/**
 * 通过 Electron `net` 下载（走 Chromium 网络栈，自动使用系统代理——
 * 国内用户多数只配置系统代理，Node 原生 https 不会读取它）。
 * 重定向由 `redirect: 'follow'` 处理（GitHub 资产会 302 到 CDN）。
 */
function downloadFile(
  url: string,
  destPath: string,
  onProgress?: (progress: YtdlpInstallProgress) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = net.request({ url, redirect: 'follow', useSessionCookies: false })
    let settled = false
    let fileStream: fs.WriteStream | null = null
    let idle: ReturnType<typeof startIdleTimer> | null = null

    const fail = (error: Error) => {
      if (settled) return
      settled = true
      idle?.clear()
      try { request.abort() } catch { /* 已结束的请求忽略 */ }
      fileStream?.destroy()
      reject(error)
    }

    const succeed = () => {
      if (settled) return
      settled = true
      idle?.clear()
      resolve()
    }

    idle = startIdleTimer(IDLE_TIMEOUT_MS, () => {
      fail(new Error('下载超时（30 秒无数据），请检查网络或系统代理'))
    })

    request.on('error', (error) => fail(error instanceof Error ? error : new Error(String(error))))

    request.on('response', (response) => {
      const status = response.statusCode ?? 0
      if (status < 200 || status >= 300) {
        fail(new Error(`下载失败：HTTP ${status}`))
        return
      }

      const total = Number(String(response.headers['content-length'] ?? 0)) || 0
      let transferred = 0
      let lastReportAt = 0
      fileStream = fs.createWriteStream(destPath, { flags: 'w' })
      fileStream.on('error', fail)

      // Electron 的 IncomingMessage 不暴露 pause/resume，无法做背压控制；
      // 单文件 20–40 MB，让 WriteStream 内部缓冲即可（内存占用可控且实现更简单）。
      response.on('data', (chunk: Buffer) => {
        if (settled) return
        idle?.reset()
        transferred += chunk.length
        fileStream?.write(chunk)

        const now = Date.now()
        if (onProgress && total > 0 && (now - lastReportAt >= 100 || transferred >= total)) {
          lastReportAt = now
          onProgress({
            percent: Math.min(100, Math.round((transferred / total) * 100)),
            transferred,
            total
          })
        }
      })

      response.on('end', () => {
        if (settled) return
        fileStream!.end(() => {
          onProgress?.({ percent: 100, transferred, total: total || transferred })
          succeed()
        })
      })

      response.on('error', (error) => fail(error instanceof Error ? error : new Error(String(error))))
    })

    request.end()
  })
}

/** GET 文本（用于官方 SHA2-256SUMS）。同样走系统代理与自动重定向 */
function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = net.request({ url, redirect: 'follow', useSessionCookies: false })
    let settled = false
    let idle: ReturnType<typeof startIdleTimer> | null = null

    const fail = (error: Error) => {
      if (settled) return
      settled = true
      idle?.clear()
      try { request.abort() } catch { /* 已结束的请求忽略 */ }
      reject(error)
    }

    idle = startIdleTimer(TEXT_IDLE_TIMEOUT_MS, () => {
      fail(new Error('获取校验文件超时，请检查网络或系统代理'))
    })

    request.on('error', (error) => fail(error instanceof Error ? error : new Error(String(error))))

    request.on('response', (response) => {
      const status = response.statusCode ?? 0
      if (status < 200 || status >= 300) {
        fail(new Error(`获取校验文件失败：HTTP ${status}`))
        return
      }
      let body = ''
      let bytes = 0
      response.on('data', (chunk: Buffer) => {
        idle?.reset()
        bytes += chunk.length
        if (bytes > MAX_TEXT_BYTES) {
          fail(new Error('校验文件异常（响应体过大）'))
          return
        }
        body += chunk.toString()
      })
      response.on('end', () => {
        if (settled) return
        settled = true
        idle?.clear()
        resolve(body)
      })
      response.on('error', (error) => fail(error instanceof Error ? error : new Error(String(error))))
    })

    request.end()
  })
}

/**
 * 流式计算文件 SHA-256。
 * 二进制 20–40 MB，readFileSync 整包读入会阻塞主进程事件循环（UI 冻结、IPC 无响应）。
 */
function computeSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}
