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
import { isSafeHttpUrl } from '../utils/ipcInputValidation'

const logger = createLogger('StreamDownload')

/** 进度模板前缀：解析 yt-dlp 输出时靠它做行筛选，避免混入其它日志 */
export const PROGRESS_MARKER = '__YTDLP_PROGRESS__'

/**
 * 进度模板字段：百分比｜已下载字节｜总字节｜估算总字节｜速度｜剩余时间｜速度（字节/秒）｜
 * 条目序号｜总条目数｜条目标题。
 *
 * 后三个字段为播放列表模式准备（单视频时为 NA）：进度事件据此带出"正在下载第几项/共几项"，
 * 让任务列表不用再显示一条聚合的百分比。标题放最后：标题本身可能含 "|"，
 * 解析时把剩余分段重新拼回即可，不影响前面的定长字段。
 */
const PROGRESS_TEMPLATE =
  `download:${PROGRESS_MARKER}%(progress._percent_str)s|%(progress.downloaded_bytes)s|` +
  '%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress._speed_str)s|%(progress._eta_str)s|' +
  '%(progress.speed)s|%(info.playlist_index)s|%(info.n_entries)s|%(info.title)s'

/** 进行中的下载（允许多条并发：App 流媒体页与扩展整页下载都可能发起） */
const activeDownloads = new Map<string, ActiveDownload>()

export interface StreamDownloadRequest {
  url: string
  /**
   * 选定的格式 id（App 流媒体页用）。
   * 省略时按“最佳视频+最佳音频”下载（扩展把整页链接交给 App 的场景）。
   */
  formatId?: string
  /** 是否把最佳音轨合并进来；省略时按 true 处理（分离流站点必须合并） */
  merge?: boolean
  /** 视频标题（列表展示用；来自扩展的标签页标题或 App 流媒体页） */
  title?: string
  /** 保存目录（绝对路径，通常是设置里的任务目录） */
  outputDir: string
  /**
   * 播放列表下载：选中的条目 id（yt-dlp 的 --playlist-items 语义）。
   * 省略时保持单视频行为（--no-playlist），向后兼容。
   */
  playlist?: { ids: string[] }
  /** 字幕：enabled 时写字幕文件并统一转 srt（转换依赖 ffmpeg） */
  subtitle?: { enabled: boolean; languages: string[]; includeAuto?: boolean }
  /** Cookie 文件（--cookies）：会员视频等需要登录态的站点用 */
  cookieFile?: string
  /** 提取音频并转 MP3（-x --audio-format mp3，依赖 ffmpeg） */
  extractAudio?: boolean
}

export type StreamDownloadEvent =
  | {
    type: 'started'
    id: string
    url: string
    title?: string
    formatId?: string
    merge: boolean
    outputDir: string
  }
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
    /** 播放列表模式：当前条目标题（单视频下载不携带，事件结构向后兼容） */
    entryTitle?: string
    /** 播放列表模式：当前条目序号（1 起）与总条目数 */
    entryIndex?: number
    entryCount?: number
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

/**
 * 允许的格式选择器表达式（yt-dlp 完整 -f 语法）。
 *
 * 为什么放宽：预设（bestvideo*[height<=1080]+bestaudio/best[height<=1080]）本身就不是
 * 单个格式 id，而是带过滤器的选择器语法，旧的 FORMAT_ID_PATTERN（仅 [A-Za-z0-9+._-]）会把
 * 全部预设挡掉。安全上没有注入面：spawn 以数组参数形式传给 yt-dlp，-f 后的值不会被
 * shell 或 yt-dlp 二次解析成别的选项，这里仍然显式排除引号/分号/反引号等危险字符。
 */
export const FORMAT_EXPR_PATTERN = /^[A-Za-z0-9+._*=[\]()<>|/,~ -]{1,256}$/
/** 单个格式 id（旧口径，仍用于纯 id 场景的快速校验） */
const FORMAT_ID_PATTERN = /^[A-Za-z0-9+._-]+$/

/** 播放列表条目 id：yt-dlp flat entry 的 id（YouTube 为 11 位字符，其他站点也用字母数字） */
export const PLAYLIST_ITEM_ID_PATTERN = /^[\w-]{1,64}$/
/** 播放列表条目 id 数量上限（与解析侧 PLAYLIST_ENTRIES_LIMIT 同口径） */
export const PLAYLIST_ITEMS_MAX = 500
/** --playlist-items 拼接后的总长度上限（防极端长参数撑爆命令行） */
export const PLAYLIST_ITEMS_VALUE_MAX = 2000
/** 字幕语言代码（en、zh-Hans、pt-BR 等可带地区/文字变体，含 yt-dlp 的 "en.*" 通配写法） */
export const SUBTITLE_LANG_PATTERN = /^[A-Za-z0-9.,*_-]{1,20}$/
/** 语言数量上限（yt-dlp 语义上够了；同时限制 --sub-langs 参数长度） */
export const SUBTITLE_LANGS_MAX = 10
/** Cookie 文件大小上限（yt-dlp 只需要 Netscape 格式文本；几 MB 已远超实际需要） */
export const COOKIE_FILE_MAX_BYTES = 5 * 1024 * 1024

/** startStreamDownload 的参数构造依赖（把 spawn/fs 等副作用隔离出去，便于单测 buildStreamArgs） */
export interface BuildStreamArgsOptions {
  /** ffmpeg 路径；空串表示不需要/未配置。传 undefined 表示按 merge 语义自动需要 */
  ffmpegLocation?: string
  /** --print-to-file 的目标文件（最终文件路径回传机制） */
  finalPathFile?: string
}

/**
 * 校验并归一化请求中的扩展字段（playlist/subtitle/cookieFile）。
 * 返回 null 表示非法；调用方据此拒绝整个请求（坏一个 id 拒整单，不做静默修剪，
 * 因为静默跳过会让"下载了 3/5 个视频"看起来像成功）。
 */
export function validateStreamExtras(request: StreamDownloadRequest): string | null {
  const playlist = request.playlist
  if (playlist !== undefined) {
    if (!playlist || !Array.isArray(playlist.ids)) return 'Invalid playlist request'
    if (playlist.ids.length < 1 || playlist.ids.length > PLAYLIST_ITEMS_MAX) {
      return `播放列表条目数须在 1-${PLAYLIST_ITEMS_MAX} 之间`
    }
    if (playlist.ids.some(id => !PLAYLIST_ITEM_ID_PATTERN.test(id))) {
      return 'Invalid playlist item id'
    }
    if (playlist.ids.join(',').length > PLAYLIST_ITEMS_VALUE_MAX) {
      return '播放列表条目过多（选择串超长）'
    }
  }
  const subtitle = request.subtitle
  if (subtitle !== undefined) {
    if (!subtitle || typeof subtitle.enabled !== 'boolean' || !Array.isArray(subtitle.languages)) {
      return 'Invalid subtitle request'
    }
    if (subtitle.languages.length < 1 || subtitle.languages.length > SUBTITLE_LANGS_MAX) {
      return `字幕语言数须在 1-${SUBTITLE_LANGS_MAX} 之间`
    }
    if (subtitle.languages.some(lang => !SUBTITLE_LANG_PATTERN.test(lang))) {
      return 'Invalid subtitle language'
    }
    if (subtitle.includeAuto !== undefined && typeof subtitle.includeAuto !== 'boolean') {
      return 'Invalid subtitle request'
    }
  }
  return null
}

/**
 * 校验 Cookie 文件：必须绝对路径、存在、<5MB。
 * 只做 stat，不读内容（格式由 yt-dlp 自己判错）；大小限制防把任意大文件当 cookie 传给子进程。
 */
export function validateCookieFile(cookieFile: string | undefined): string | null {
  if (cookieFile === undefined) return null
  if (typeof cookieFile !== 'string' || cookieFile.length === 0) return 'Invalid cookie file'
  if (!path.isAbsolute(cookieFile)) return 'Cookie 文件路径必须是绝对路径'
  let stat: fs.Stats
  try {
    stat = fs.statSync(cookieFile)
  } catch {
    return 'Cookie 文件不存在'
  }
  if (!stat.isFile()) return 'Cookie 文件不是普通文件'
  if (stat.size > COOKIE_FILE_MAX_BYTES) return 'Cookie 文件超过 5MB 上限'
  return null
}

/**
 * 构造 yt-dlp 完整参数（纯函数，不 spawn）。
 *
 * 基本面沿袭单视频下载；差异点：
 * - playlist 存在时用 --playlist-items "id1,id2" **替换** --no-playlist
 *   （后者语义就是"只当单视频"，与列表模式互斥）；
 * - subtitle/cookieFile/extractAudio 依次叠加；
 * - merge 语义：有 formatId 时 formatId 表达式已是完整选择器（预设可能自带 bestaudio 部分），
 *   由调用方决定是否再 +bestaudio，本函数只拼接。
 */
export function buildStreamArgs(
  request: Pick<StreamDownloadRequest, 'url' | 'formatId' | 'merge' | 'outputDir' | 'playlist' | 'subtitle' | 'cookieFile' | 'extractAudio'>,
  selector: string,
  opts: BuildStreamArgsOptions = {}
): string[] {
  const merge = request.merge !== false
  const playlistValue = request.playlist?.ids.join(',') ?? ''
  const args: string[] = [
    '--newline',
    '--progress',
    '--progress-delta', '0.2',
    '--progress-template', PROGRESS_TEMPLATE,
    '--no-warnings',
    // 列表模式按选中 id 下载；单视频模式显式排除列表（兼容把 watch?v=..&list=.. 链接当单视频的用法）
    ...(request.playlist ? ['--playlist-items', playlistValue] : ['--no-playlist']),
    '--no-simulate'
  ]
  if (opts.finalPathFile) {
    args.push('--print-to-file', 'after_move:filepath', opts.finalPathFile)
  }
  args.push('-f', selector)
  if (request.subtitle?.enabled) {
    args.push('--write-subs')
    if (request.subtitle.includeAuto) args.push('--write-auto-subs')
    args.push('--sub-langs', request.subtitle.languages.join(','))
    // 统一转 srt：vtt 在播放器兼容性上参差，且与 aria2 无关的用户流程只有"拿到能用的字幕"
    args.push('--convert-subs', 'srt')
  }
  if (request.extractAudio) {
    args.push('-x', '--audio-format', 'mp3')
  }
  if (request.cookieFile) {
    args.push('--cookies', request.cookieFile)
  }
  args.push('-o', path.join(request.outputDir, '%(title)s.%(ext)s'))
  if (merge && opts.ffmpegLocation) {
    args.push('--ffmpeg-location', opts.ffmpegLocation)
  }
  args.push(request.url)
  return args
}

export async function startStreamDownload(
  request: StreamDownloadRequest,
  onEvent: (event: StreamDownloadEvent) => void
): Promise<StreamDownloadStartResult> {
  if (!isSafeHttpUrl(request.url)) {
    return { success: false, code: 'invalid_request', error: 'Invalid URL' }
  }
  const parsedUrl = new URL(request.url)
  if (!/^https?:$/.test(parsedUrl.protocol)) {
    return { success: false, code: 'invalid_request', error: 'Unsupported URL scheme' }
  }
  const hasFormatId = typeof request.formatId === 'string' && request.formatId.length > 0
  // formatId 现在承载完整格式选择器表达式（预设），按放宽后的表达式口径校验
  if (hasFormatId && !FORMAT_EXPR_PATTERN.test(request.formatId!)) {
    return { success: false, code: 'invalid_request', error: 'Invalid format expression' }
  }
  if (!path.isAbsolute(request.outputDir)) {
    return { success: false, code: 'invalid_request', error: 'Invalid output directory' }
  }
  // 播放列表/字幕为结构化对象：逐项校验，坏一项拒整单（见 validateStreamExtras 的说明）
  const extrasError = validateStreamExtras(request)
  if (extrasError) {
    return { success: false, code: 'invalid_request', error: extrasError }
  }
  const cookieError = validateCookieFile(request.cookieFile)
  if (cookieError) {
    return { success: false, code: 'invalid_request', error: cookieError }
  }

  // 有指定格式：预设表达式可能自带音频分支（bestvideo*+bestaudio/best），再拼 +bestaudio 会
  // 产生冗余但合法的表达式；旧单格式 id（如 137）仍需要 +bestaudio/best 兜底音轨
  const merge = hasFormatId ? request.merge !== false : true
  const needsFfmpeg = merge || request.extractAudio === true || request.subtitle?.enabled === true
  if (needsFfmpeg) {
    const ffmpeg = await checkFfmpegAvailable()
    if (!ffmpeg.available) {
      return {
        success: false,
        code: 'ffmpeg_missing',
        error: '该下载需要 ffmpeg（合并音轨/转 MP3/字幕转换），请先下载或安装后在设置中配置'
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

  const id = `sd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const finalPathFile = path.join(app.getPath('temp'), `ytdlp-final-${id}.txt`)
  fs.rmSync(finalPathFile, { force: true })

  // ffmpeg 路径：merge/转码/字幕转换任一需要时就带上，让 yt-dlp 找得到同目录的 ffmpeg
  const ffmpegLocation = needsFfmpeg ? getFfmpegLocation() : ''
  const rawFormat = hasFormatId ? request.formatId! : ''
  // 旧式单格式 id 且要合并：拼最佳音轨兜底；表达式（含 / + * 等）原样使用，
  // 因为表达式自己已经声明了音轨分支（bestvideo*+bestaudio/best），再拼会变成冗余表达
  const selector = !hasFormatId
    ? 'bv*+ba/b'
    : (merge && FORMAT_ID_PATTERN.test(rawFormat) ? rawFormat + '+bestaudio/best' : rawFormat)
  const args = buildStreamArgs(
    { ...request, merge },
    selector,
    { ffmpegLocation, finalPathFile }
  )

  logger.info(
    '开始 yt-dlp 下载: ' + request.url
    + '（格式 ' + selector
    + (request.playlist ? '，列表 ' + request.playlist.ids.length + ' 项' : '')
    + (request.subtitle?.enabled ? '，字幕 ' + request.subtitle.languages.join(',') : '')
    + (request.cookieFile ? '，Cookie' : '')
    + (request.extractAudio ? '，提取音频' : '')
    + '）'
  )

  const proc = spawn(getYtdlpExecutablePath(), args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    // POSIX 下自成进程组，取消时能一并结束 ffmpeg 子进程
    detached: process.platform !== 'win32'
  })
  activeDownloads.set(id, { proc, cancelled: false })
  onEvent({
    type: 'started',
    id,
    url: request.url,
    title: request.title,
    formatId: request.formatId,
    merge,
    outputDir: request.outputDir
  })

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

/**
 * 解析进度模板行；字段缺失时按 0/未知处理（NA/Unknown 一律不携带，保持事件干净）。
 * 导出仅供单测（yt-dlp 输出行格式的回归测试），运行时只有本文件调用。
 */
export function parseProgressLine(line: string): {
  percent: number
  speed?: string
  eta?: string
  downloadedBytes?: number
  totalBytes?: number
  speedBytes?: number
  entryTitle?: string
  entryIndex?: number
  entryCount?: number
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
  // 播放列表字段：单视频下载时 yt-dlp 输出 NA，此时不携带（事件形状向后兼容）
  const entryIndexRaw = parts[7] && !/Unknown|N\/A/i.test(parts[7]) ? Number(parts[7]) : NaN
  const entryCountRaw = parts[8] && !/Unknown|N\/A/i.test(parts[8]) ? Number(parts[8]) : NaN
  // 标题是最后一段：标题本身可能含 "|"（如 "A | B"），split 后重新拼回
  const titleText = parts.length > 9 ? parts.slice(9).join('|').trim() : ''
  // 单视频场景 yt-dlp 对列表字段输出 "NA"（不带斜杠），与 "N/A" 一起过滤
  const entryTitle = titleText && !/Unknown|^NA$|N\/A/i.test(titleText) ? titleText : undefined
  if (!Number.isFinite(percent) && total <= 0) return null
  return {
    percent: Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0,
    speed,
    eta,
    downloadedBytes: downloaded || undefined,
    totalBytes: total || undefined,
    speedBytes,
    ...(entryTitle !== undefined ? { entryTitle } : {}),
    ...(Number.isFinite(entryIndexRaw) && entryIndexRaw > 0 ? { entryIndex: entryIndexRaw } : {}),
    ...(Number.isFinite(entryCountRaw) && entryCountRaw > 0 ? { entryCount: entryCountRaw } : {})
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
