/**
 * yt-dlp 下载模式（流媒体页专用）。
 *
 * 为什么需要它：B 站等站点只提供分离的视频/音频流，单条直链交给 aria2 无法合并音轨。
 * 该服务让 yt-dlp 自己下载（必要时 `+bestaudio`）并调用 ffmpeg 合并，保存到用户指定目录。
 *
 * 与 aria2 任务的边界：这类下载**不进入 aria2 队列**（aria2 只接受 HTTP 直链），
 * 进度/取消由本服务经 IPC 推送；aria2 仍是普通 HTTP/直链下载的主力。
 */

import { spawn, spawnSync, type ChildProcess } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { app, Notification } from 'electron'
import { getYtdlpExecutablePath } from './ytdlpService'
import { checkFfmpegAvailable, getFfmpegLocation } from './ffmpegService'
import { createLogger } from '../utils/logger'

const logger = createLogger('StreamDownload')

/** 进度模板前缀：解析 yt-dlp 输出时靠它做行筛选，避免混入其它日志 */
const PROGRESS_MARKER = '__YTDLP_PROGRESS__'

/** 进度模板字段：百分比｜已下载字节｜总字节｜估算总字节｜速度｜剩余时间｜速度（字节/秒） */
const PROGRESS_TEMPLATE =
  `download:${PROGRESS_MARKER}%(progress._percent_str)s|%(progress.downloaded_bytes)s|` +
  '%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress._speed_str)s|%(progress._eta_str)s|' +
  '%(progress.speed)s'

/** 同一时刻只允许一条流媒体下载（界面是单按钮，重复点击复用会互相干扰） */
const activeDownloads = new Map<string, ActiveDownload>()

export interface StreamDownloadRequest {
  url: string
  formatId: string
  /** 是否把最佳音轨合并进来（选到纯视频格式时为 true） */
  merge: boolean
  /** 保存目录（绝对路径，通常是设置里的任务目录） */
  outputDir: string
}

export type StreamDownloadEvent =
  | {
    type: 'progress'
    id: string
    percent: number
    speed?: string
    eta?: string
    downloadedBytes?: number
    totalBytes?: number
    /** 速度原始值（字节/秒），供任务列表排序/格式化使用 */
    speedBytes?: number
  }
  | { type: 'completed'; id: string; filePath: string }
  | { type: 'failed'; id: string; error: string }
  | { type: 'cancelled'; id: string }

export interface StreamDownloadStartResult {
  success: boolean
  id?: string
  /** ffmpeg_missing：需要先安装/配置 ffmpeg（界面据此显示安装入口） */
  code?: 'ffmpeg_missing' | 'invalid_request'
  error?: string
}

interface ActiveDownload {
  proc: ChildProcess
  cancelled: boolean
}

/** 允许的格式标识（与 yt-dlp 的 -f 参数口径一致，同时防参数注入） */
const FORMAT_ID_PATTERN = /^[A-Za-z0-9+._-]+$/

export async function startStreamDownload(
  request: StreamDownloadRequest,
  onEvent: (event: StreamDownloadEvent) => void
): Promise<StreamDownloadStartResult> {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(request.url)
  } catch {
    return { success: false, code: 'invalid_request', error: 'Invalid URL' }
  }
  if (!/^https?:$/.test(parsedUrl.protocol)) {
    return { success: false, code: 'invalid_request', error: 'Unsupported URL scheme' }
  }
  if (!FORMAT_ID_PATTERN.test(request.formatId)) {
    return { success: false, code: 'invalid_request', error: 'Invalid format id' }
  }
  if (!path.isAbsolute(request.outputDir)) {
    return { success: false, code: 'invalid_request', error: 'Invalid output directory' }
  }

  if (request.merge) {
    const ffmpeg = await checkFfmpegAvailable()
    if (!ffmpeg.available) {
      return {
        success: false,
        code: 'ffmpeg_missing',
        error: '合并音轨需要 ffmpeg，请先下载或安装后在设置中配置'
      }
    }
  }

  try {
    fs.mkdirSync(request.outputDir, { recursive: true })
  } catch (error) {
    return {
      success: false,
      code: 'invalid_request',
      error: `无法创建保存目录：${error instanceof Error ? error.message : String(error)}`
    }
  }

  if (activeDownloads.size > 0) {
    return { success: false, code: 'invalid_request', error: '已有流媒体下载正在进行，请先等待或取消' }
  }

  const id = `sd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const finalPathFile = path.join(app.getPath('temp'), `ytdlp-final-${id}.txt`)
  fs.rmSync(finalPathFile, { force: true })

  const ffmpegLocation = request.merge ? getFfmpegLocation() : ''
  const selector = request.merge ? `${request.formatId}+bestaudio/best` : request.formatId
  const args = [
    '--newline',
    '--progress',
    '--progress-delta', '0.2',
    '--progress-template', PROGRESS_TEMPLATE,
    '--no-warnings',
    '--no-playlist',
    '--no-simulate',
    '--print-to-file', 'after_move:filepath', finalPathFile,
    '-f', selector,
    '-o', path.join(request.outputDir, '%(title)s.%(ext)s'),
    ...(ffmpegLocation ? ['--ffmpeg-location', ffmpegLocation] : []),
    request.url
  ]

  logger.info(`开始 yt-dlp 下载: ${request.url}（格式 ${selector}${ffmpegLocation ? '，合并音轨' : ''}）`)

  const proc = spawn(getYtdlpExecutablePath(), args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    // POSIX 下自成进程组，取消时能一并结束 ffmpeg 子进程
    detached: process.platform !== 'win32'
  })
  activeDownloads.set(id, { proc, cancelled: false })

  let stderrTail = ''
  let fallbackPath = ''

  proc.stdout?.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (!line) continue
      const markerIndex = line.indexOf(PROGRESS_MARKER)
      if (markerIndex >= 0) {
        const progress = parseProgressLine(line.slice(markerIndex))
        if (progress) onEvent({ type: 'progress', id, ...progress })
      } else if (path.isAbsolute(line.trim()) && fs.existsSync(line.trim())) {
        // --print-to-file 之外的兜底：某些版本会把最终路径直接打印到 stdout
        fallbackPath = line.trim()
      }
    }
  })

  proc.stderr?.on('data', (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-4000)
  })

  proc.on('error', (error) => {
    activeDownloads.delete(id)
    fs.rmSync(finalPathFile, { force: true })
    onEvent({
      type: 'failed',
      id,
      error: error.message.includes('ENOENT')
        ? '未检测到 yt-dlp，请先在流媒体页下载 yt-dlp'
        : error.message
    })
  })

  proc.on('exit', (code) => {
    const record = activeDownloads.get(id)
    activeDownloads.delete(id)
    const cancelled = record?.cancelled === true

    const printedPath = readFinalPath(finalPathFile)
    fs.rmSync(finalPathFile, { force: true })
    const filePath = printedPath || fallbackPath

    if (cancelled) {
      onEvent({ type: 'cancelled', id })
      return
    }
    if (code !== 0) {
      onEvent({ type: 'failed', id, error: stderrTail.trim() || `yt-dlp exited with code ${code}` })
      return
    }
    if (!filePath || !fs.existsSync(filePath)) {
      onEvent({ type: 'failed', id, error: '下载完成但未找到输出文件' })
      return
    }

    logger.info(`yt-dlp 下载完成: ${filePath}`)
    onEvent({ type: 'completed', id, filePath })
    notifyCompleted(filePath)
  })

  return { success: true, id }
}

/** 取消一条进行中的下载（结束整个进程树，含 ffmpeg） */
export function cancelStreamDownload(id: string): boolean {
  const record = activeDownloads.get(id)
  if (!record) return false
  record.cancelled = true
  killProcessTree(record.proc)
  return true
}

/** 应用退出时兜底清理，避免留下孤儿进程（Windows 不会随父进程回收子进程） */
process.on('exit', () => {
  for (const record of activeDownloads.values()) {
    try {
      record.proc.kill('SIGKILL')
      if (process.platform === 'win32' && record.proc.pid) {
        spawnSync('taskkill', ['/PID', String(record.proc.pid), '/T', '/F'], { stdio: 'ignore' })
      }
    } catch {
      // 退出路径上忽略一切失败
    }
  }
})

function killProcessTree(proc: ChildProcess): void {
  if (!proc.pid) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' })
    return
  }
  try {
    process.kill(-proc.pid, 'SIGKILL')
  } catch {
    try { proc.kill('SIGKILL') } catch { /* 已退出 */ }
  }
}

/** 解析进度模板行；字段缺失时按 0/未知处理 */
function parseProgressLine(line: string): {
  percent: number
  speed?: string
  eta?: string
  downloadedBytes?: number
  totalBytes?: number
  speedBytes?: number
} | null {
  const parts = line.slice(PROGRESS_MARKER.length).split('|')
  if (parts.length < 6) return null
  const percentText = (parts[0] ?? '').replace(/\s/g, '')
  const percent = Number.parseFloat(percentText)
  const downloaded = Number(parts[1]) || 0
  const total = Number(parts[2]) || Number(parts[3]) || 0
  const speed = parts[4] && !/Unknown|N\/A/i.test(parts[4]) ? parts[4].trim() : undefined
  const eta = parts[5] && !/Unknown|N\/A/i.test(parts[5]) ? parts[5].trim() : undefined
  const speedBytes = Number(parts[6]) || undefined
  if (!Number.isFinite(percent) && total <= 0) return null
  return {
    percent: Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0,
    speed,
    eta,
    downloadedBytes: downloaded || undefined,
    totalBytes: total || undefined,
    speedBytes
  }
}

/** 读取 --print-to-file 写入的最终路径（取最后一行非空内容） */
function readFinalPath(filePath: string): string {
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    return lines[lines.length - 1] ?? ''
  } catch {
    return ''
  }
}

/** 完成通知：流媒体下载不在 aria2 任务列表里，用户关闭弹窗后需要可见的反馈 */
function notifyCompleted(filePath: string): void {
  try {
    if (!Notification.isSupported()) return
    new Notification({
      title: '下载完成',
      body: path.basename(filePath)
    }).show()
  } catch {
    // 通知失败不影响下载本身
  }
}
