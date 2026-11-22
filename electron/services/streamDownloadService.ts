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
import { StringDecoder } from 'string_decoder'
import * as fs from 'fs'
import * as path from 'path'
import { app, Notification, shell } from 'electron'
import { getYtdlpExecutablePath } from './ytdlpService'
import { checkFfmpegAvailable, getFfmpegLocation } from './ffmpegService'
import { createLogger } from '../utils/logger'
import { isSafeHttpUrl } from '../utils/ipcInputValidation'
import { runtimeMainLocale } from '../utils/mainLocaleRuntime'
import { downloadNotificationTitle, streamDownloadError } from '../utils/mainProcessCopy'
import { readGlobalSpeedLimitBytes } from './globalSpeedLimit'
import type { MainLocale } from '../utils/mainLocale'

/** 流媒体下载的失败文案语言（与主进程其它对话框口径一致） */
function streamLocale(): MainLocale {
  return runtimeMainLocale()
}
import { applyCompletionRulesForTask } from './completionRuleService'

const logger = createLogger('StreamDownload')

/** 进度模板前缀：解析 yt-dlp 输出时靠它做行筛选，避免混入其它日志 */
export const PROGRESS_MARKER = '__YTDLP_PROGRESS__'

/**
 * 进度模板字段：百分比｜已下载字节｜总字节｜估算总字节｜速度｜剩余时间｜速度（字节/秒）｜
 * 条目序号｜总条目数。
 *
 * 后两个字段为播放列表模式准备（单视频时为 NA）：进度事件据此带出"正在下载第几项/共几项"，
 * 让任务列表不用再显示一条聚合的百分比。
 *
 * 这里**刻意不带标题**：进度行走的是 yt-dlp 的控制台输出，Windows 中文系统按 GBK 编码，
 * --encoding utf-8 也改不掉（实测无效），中文标题到 Node 侧就是乱码。标题改由
 * --print-to-file 写到文件里再按 UTF-8 读回（见 readLastLine），见 BuildStreamArgsOptions.titleFile。
 */
const PROGRESS_TEMPLATE =
  `download:${PROGRESS_MARKER}%(progress._percent_str)s|%(progress.downloaded_bytes)s|` +
  '%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress._speed_str)s|%(progress._eta_str)s|' +
  '%(progress.speed)s|%(info.playlist_index)s|%(info.n_entries)s'

/** 进行中的下载（允许多条并发：App 流媒体页与扩展整页下载都可能发起） */
const activeDownloads = new Map<string, ActiveDownload>()

/**
 * 同时运行的 yt-dlp 进程上限。
 *
 * 每条任务都是一个独立子进程 + ffmpeg 合并，没有上限时"全选批量下载"会把
 * CPU/磁盘打满（Gopeed 用户反馈里的 CPU 跑满即此类）。aria2 侧靠
 * max-concurrent-downloads 自限，这里没有队列机制，所以直接拒绝超限请求，
 * 由界面提示用户等待当前任务结束。
 */
export const MAX_CONCURRENT_STREAM_DOWNLOADS = 3

/** 进行中流媒体任务的合计速度（字节/秒）：托盘/页脚需要与 aria2 速度相加（D-10） */
export function activeStreamDownloadSpeedBytes(): number {
  let total = 0
  for (const task of streamTaskRegistry.values()) {
    if (task.status === 'active') total += task.speedBytes || 0
  }
  return total
}

/** 当前正在运行的下载数（不含已暂停） */
export function activeStreamDownloadCount(): number {
  let count = 0
  for (const record of activeDownloads.values()) {
    if (!record.paused) count += 1
  }
  return count
}

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
  | {
    type: 'completed'
    id: string
    /** 首个输出文件（兼容字段，等同 filePaths[0]） */
    filePath: string
    /** 全部输出文件：播放列表/多字幕一次会产出多个文件，渲染层据此支持逐个删除 */
    filePaths?: string[]
  }
  | { type: 'paused'; id: string }
  | { type: 'failed'; id: string; error: string }
  | { type: 'cancelled'; id: string }

export interface StreamDownloadStartResult {
  success: boolean
  id?: string
  /**
   * ffmpeg_missing：需要先安装/配置 ffmpeg（界面据此显示安装入口）
   * too_many_downloads：并发流媒体任务已达上限，等当前任务结束再试
   */
  code?: 'ffmpeg_missing' | 'invalid_request' | 'too_many_downloads'
  error?: string
}

interface ActiveDownload {
  proc: ChildProcess | null
  cancelled: boolean
  paused: boolean
  request: StreamDownloadRequest
  selector: string
  ffmpegLocation: string
  finalPathFile: string
  /** yt-dlp 的临时目录（--paths temp:），取消/失败/完成后清理 */
  tempDir: string
  /** 标题回传文件（--print-to-file video:%(title)s） */
  titleFile: string
  onEvent: (event: StreamDownloadEvent) => void
}

/** 本进程创建过的流媒体输出目录；删除文件只允许落在这些目录内 */
const streamOutputRoots = new Set<string>()

/** 清理一条下载的路径标记与临时目录；不碰 outputDir 里的最终文件 */
function cleanupStreamFiles(record: ActiveDownload): void {
  fs.rmSync(record.finalPathFile, { force: true })
  fs.rmSync(record.titleFile, { force: true })
  if (record.tempDir) {
    fs.rmSync(record.tempDir, { recursive: true, force: true })
  }
}

/**
 * 对外可查的流媒体任务快照（扩展下载列表用）。
 *
 * 为什么要单独登记：activeDownloads 里的记录在完成/失败/取消时会被删掉（进程已经结束，
 * 没什么可操作的），但扩展的下载列表还要显示"已下载完成"的条目；而 yt-dlp 任务**不进
 * aria2 队列**，扩展拿 aria2 RPC 快照永远看不到它们——只能由本服务提供这份状态。
 *
 * 只存在内存里：应用重启后 yt-dlp 子进程本来也全部中断，落盘没有意义。
 */
export interface StreamTaskSnapshot {
  id: string
  url: string
  title: string
  status: 'active' | 'paused' | 'complete' | 'error' | 'cancelled'
  percent: number
  /** 字节/秒；暂停与结束时归零，避免扩展列表显示幽灵速度 */
  speedBytes: number
  downloadedBytes: number
  totalBytes: number
  outputDir: string
  /** 主输出文件（单文件任务即唯一产物；多文件时取第一个，兼容旧字段） */
  filePath?: string
  /** 全部输出文件（播放列表/多字幕一次产出多个）；单文件任务与 [filePath] 一致 */
  filePaths?: string[]
  error?: string
  createdAt: number
  updatedAt: number
}

const streamTaskRegistry = new Map<string, StreamTaskSnapshot>()
/** 进行中任务最多保留的条数（同时下载远到不了这个量级，只是防泄漏） */
const STREAM_TASK_ACTIVE_KEEP = 50
/** 已结束任务保留条数：扩展列表的"已完成"一档据此显示 */
const STREAM_TASK_FINISHED_KEEP = 20

/** 导出仅供单测：登记一条任务快照（运行时由 startStreamDownload 调用） */
export function registerStreamTask(id: string, record: ActiveDownload): void {
  const now = Date.now()
  streamTaskRegistry.set(id, {
    id,
    url: record.request.url,
    title: record.request.title || record.request.url,
    status: 'active',
    percent: 0,
    speedBytes: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    outputDir: record.request.outputDir,
    createdAt: now,
    updatedAt: now
  })
  pruneStreamTaskRegistry()
}

/** 导出仅供单测：增量更新快照字段（运行时由进度/状态回调调用） */
export function updateStreamTask(id: string, patch: Partial<StreamTaskSnapshot>): void {
  const task = streamTaskRegistry.get(id)
  if (!task) return
  Object.assign(task, patch, { updatedAt: Date.now() })
  pruneStreamTaskRegistry()
}

/** 只留最近的若干条：Map 按插入顺序（老→新）迭代，倒着数才能先淘汰最老的 */
function pruneStreamTaskRegistry(): void {
  let active = 0
  let finished = 0
  for (const task of [...streamTaskRegistry.values()].reverse()) {
    const isFinished = task.status !== 'active' && task.status !== 'paused'
    if (isFinished) {
      finished += 1
      if (finished > STREAM_TASK_FINISHED_KEEP) streamTaskRegistry.delete(task.id)
    } else {
      active += 1
      if (active > STREAM_TASK_ACTIVE_KEEP) streamTaskRegistry.delete(task.id)
    }
  }
}

/**
 * 列出流媒体任务（新→旧）。扩展下载列表把它与 aria2 任务合并展示。
 * 已取消（cancelled）的条目与渲染层一致地不返回：取消是用户的显式动作，不留"已取消"一行。
 */
export function listStreamTasks(): StreamTaskSnapshot[] {
  return [...streamTaskRegistry.values()]
    .filter(task => task.status !== 'cancelled')
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(task => ({ ...task }))
}

/**
 * 从快照表移除一条任务（扩展列表里的「移除」）。
 * 只影响列表可见性，不删除 outputDir 里的文件——与 aria2 的 remove 语义一致。
 */
export function forgetStreamTask(id: string): boolean {
  return streamTaskRegistry.delete(id)
}

/** 取单条流媒体任务快照（不存在返回 undefined） */
export function getStreamTask(id: string): StreamTaskSnapshot | undefined {
  const task = streamTaskRegistry.get(id)
  return task ? { ...task } : undefined
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
  /**
   * --print-to-file "video:%(title)s" 的目标文件。
   * 进度行的 %(info.title)s 在 Windows 上是 GBK 字节（--encoding 无效），中文必然乱码；
   * 文件是 yt-dlp 直接按 UTF-8 写的，读回来才是正确标题。
   */
  titleFile?: string
  /** --paths temp: 的临时目录；未提供时使用 yt-dlp 默认（输出目录） */
  tempDir?: string
  /**
   * 全局限速（字节/秒）；> 0 时追加 --limit-rate。
   *
   * yt-dlp 任务不进 aria2 队列，拿不到 aria2 的 max-overall-download-limit，
   * 必须自己下发，否则"限速 1MB/s"对流媒体任务完全无效（D-10）。
   */
  limitRateBytes?: number
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
    // 请求 UTF-8 输出。注意：对 Windows 上 yt-dlp 的进度行（stdout）实测无效，仍是 GBK，
    // 所以标题不再从进度行取（见 PROGRESS_TEMPLATE 注释）；这里保留是为了 stderr 报错信息更可读。
    '--encoding', 'utf-8',
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
  if (opts.titleFile) {
    // video: 阶段就有标题（before_dl 在网页/缩略阶段会写 NA），列表模式每个条目追加一行
    args.push('--print-to-file', 'video:%(title)s', opts.titleFile)
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
  // 输出根目录用 --paths home: 声明，-o 只留相对模板。
  // 绝对 -o 会让 --paths temp: 直接失效（.part 仍然写进下载目录，删任务时清不干净），实测确认。
  args.push('--paths', 'home:' + request.outputDir)
  if (opts.tempDir) {
    // 分片/.part 等中间文件放到独立临时目录，删除进行中的任务时不会在下载目录留下残片
    args.push('--paths', 'temp:' + opts.tempDir)
  }
  args.push('-o', '%(title)s.%(ext)s')
  if (merge && opts.ffmpegLocation) {
    args.push('--ffmpeg-location', opts.ffmpegLocation)
  }
  // 全局限速：yt-dlp 只认自己的 --limit-rate（纯数字按字节/秒解释）
  if (opts.limitRateBytes && opts.limitRateBytes > 0) {
    args.push('--limit-rate', String(Math.round(opts.limitRateBytes)))
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
  if (activeStreamDownloadCount() >= MAX_CONCURRENT_STREAM_DOWNLOADS) {
    return {
      success: false,
      code: 'too_many_downloads',
      error: streamDownloadError(streamLocale(), 'too-many', '', MAX_CONCURRENT_STREAM_DOWNLOADS)
    }
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
        error: streamDownloadError(streamLocale(), 'ffmpeg-missing')
      }
    }
  }

  try {
    fs.mkdirSync(request.outputDir, { recursive: true })
  } catch (error) {
    return {
      success: false,
      code: 'invalid_request',
      error: streamDownloadError(streamLocale(), 'create-output-dir', error instanceof Error ? error.message : String(error))
    }
  }

  const id = `sd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const finalPathFile = path.join(app.getPath('temp'), `ytdlp-final-${id}.txt`)
  fs.rmSync(finalPathFile, { force: true })
  const titleFile = path.join(app.getPath('temp'), `ytdlp-title-${id}.txt`)
  fs.rmSync(titleFile, { force: true })
  let tempDir: string
  try {
    tempDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'aria2desktop-stream-'))
  } catch (error) {
    return {
      success: false,
      code: 'invalid_request',
      error: streamDownloadError(streamLocale(), 'create-temp-dir', error instanceof Error ? error.message : String(error))
    }
  }

  // ffmpeg 路径：merge/转码/字幕转换任一需要时就带上，让 yt-dlp 找得到同目录的 ffmpeg
  const ffmpegLocation = needsFfmpeg ? getFfmpegLocation() : ''
  const rawFormat = hasFormatId ? request.formatId! : ''
  // 旧式单格式 id 且要合并：拼最佳音轨兜底；表达式（含 / + * 等）原样使用，
  // 因为表达式自己已经声明了音轨分支（bestvideo*+bestaudio/best），再拼会变成冗余表达
  const selector = !hasFormatId
    ? 'bv*+ba/b'
    : (merge && FORMAT_ID_PATTERN.test(rawFormat) ? rawFormat + '+bestaudio/best' : rawFormat)
  const requestWithMerge: StreamDownloadRequest = { ...request, merge }

  logger.info(
    '开始 yt-dlp 下载: ' + request.url
    + '（格式 ' + selector
    + (request.playlist ? '，列表 ' + request.playlist.ids.length + ' 项' : '')
    + (request.subtitle?.enabled ? '，字幕 ' + request.subtitle.languages.join(',') : '')
    + (request.cookieFile ? '，Cookie' : '')
    + (request.extractAudio ? '，提取音频' : '')
    + '）'
  )

  const record: ActiveDownload = {
    proc: null,
    cancelled: false,
    paused: false,
    request: requestWithMerge,
    selector,
    ffmpegLocation,
    finalPathFile,
    tempDir,
    titleFile,
    onEvent
  }
  activeDownloads.set(id, record)
  // 记录本进程使用过的输出目录：删除文件时只允许操作这些目录内的文件
  streamOutputRoots.add(path.resolve(request.outputDir))
  // 登记到对外快照表：扩展的下载列表靠它看到 yt-dlp 任务（这类任务不进 aria2）
  registerStreamTask(id, record)
  onEvent({
    type: 'started',
    id,
    url: request.url,
    title: request.title,
    formatId: request.formatId,
    merge,
    outputDir: request.outputDir
  })

  await launchStreamProcess(id, record)
  // 读限速期间任务可能已被取消：此时不能报告"已开始"，否则界面留一条永远不动的任务
  if (activeDownloads.get(id) !== record || record.cancelled) {
    return { success: false, code: 'invalid_request', error: 'Cancelled' }
  }
  return { success: true, id }
}

/**
 * 启动（或恢复）一条 yt-dlp 子进程。
 * 恢复时复用同一个任务 id、输出目录和最终路径标记，用户看到的是同一条任务。
 *
 * 异步的原因只有一个：启动前要读 aria2 的全局限速并转成 --limit-rate。
 * 每次都重读（而不是在 start 时读一次存进 record），因为用户可能在暂停期间改了限速，
 * 恢复后应当按新值继续，而不是沿用旧值。
 */
async function launchStreamProcess(id: string, record: ActiveDownload): Promise<void> {
  const limitRateBytes = await readGlobalSpeedLimitBytes()
  // 读限速期间任务可能已被取消或再次暂停：此时不能再拉起进程
  if (activeDownloads.get(id) !== record || record.cancelled || record.paused) return
  const args = buildStreamArgs(record.request, record.selector, {
    ffmpegLocation: record.ffmpegLocation,
    finalPathFile: record.finalPathFile,
    titleFile: record.titleFile,
    tempDir: record.tempDir,
    limitRateBytes
  })

  const proc = spawn(getYtdlpExecutablePath(), args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    // POSIX 下自成进程组，暂停/取消时能一并结束 ffmpeg 子进程
    detached: process.platform !== 'win32'
  })
  record.proc = proc

  let stderrTail = ''
  let fallbackPath = ''
  // 上一次通过进度事件带出去的标题：标题文件只在条目切换/首次出现时变化，不必每条都带
  let lastEmittedTitle = ''
  const stdoutDecoder = new StringDecoder('utf8')
  const stderrDecoder = new StringDecoder('utf8')
  let stdoutBuffer = ''

  const handleStdoutLine = (rawLine: string): void => {
    const line = rawLine.trimEnd()
    if (!line) return
    const markerIndex = line.indexOf(PROGRESS_MARKER)
    if (markerIndex >= 0) {
      const progress = parseProgressLine(line.slice(markerIndex))
      if (progress) {
        // 标题取自 --print-to-file 写的文件（UTF-8），不用进度行里的 %(info.title)s（GBK 乱码）
        const title = readLastLine(record.titleFile)
        if (title && title !== lastEmittedTitle) {
          lastEmittedTitle = title
          progress.entryTitle = title
        }
        updateStreamTask(id, {
          percent: progress.percent,
          speedBytes: progress.speedBytes ?? 0,
          downloadedBytes: progress.downloadedBytes ?? 0,
          totalBytes: progress.totalBytes ?? 0,
          ...(title ? { title } : {})
        })
        record.onEvent({ type: 'progress', id, ...progress })
      }
    } else if (path.isAbsolute(line.trim()) && fs.existsSync(line.trim())) {
      // --print-to-file 之外的兜底：某些版本会把最终路径直接打印到 stdout
      fallbackPath = line.trim()
    }
  }

  proc.stdout?.on('data', (chunk: Buffer) => {
    // 按 UTF-8 流式解码而不是逐块 chunk.toString()：中文标题可能跨 chunk 边界，
    // 按块解码会把多字节字符拆坏，界面表现为下载中的文件名乱码。
    stdoutBuffer += stdoutDecoder.write(chunk)
    const lines = stdoutBuffer.split(/\r?\n/)
    stdoutBuffer = lines.pop() ?? ''
    for (const line of lines) handleStdoutLine(line)
  })
  proc.stdout?.on('end', () => {
    stdoutBuffer += stdoutDecoder.end()
    if (stdoutBuffer) handleStdoutLine(stdoutBuffer)
  })

  proc.stderr?.on('data', (chunk: Buffer) => {
    stderrTail = (stderrTail + stderrDecoder.write(chunk)).slice(-4000)
  })

  proc.on('error', (error) => {
    if (activeDownloads.get(id) !== record) return
    if (record.paused) {
      record.proc = null
      return
    }
    activeDownloads.delete(id)
    record.proc = null
    cleanupStreamFiles(record)
    updateStreamTask(id, {
      status: 'error',
      speedBytes: 0,
      error: error.message.includes('ENOENT')
        ? '未检测到 yt-dlp，请先在流媒体页下载 yt-dlp'
        : error.message
    })
    record.onEvent({
      type: 'failed',
      id,
      error: error.message.includes('ENOENT')
        ? '未检测到 yt-dlp，请先在流媒体页下载 yt-dlp'
        : error.message
    })
  })

  proc.on('exit', (code) => {
    if (activeDownloads.get(id) !== record) return
    // 暂停：进程由我们主动结束，保留任务记录，等 resume 重新拉起
    if (record.paused) {
      record.proc = null
      updateStreamTask(id, { status: 'paused', speedBytes: 0 })
      fs.rmSync(record.finalPathFile, { force: true })
      record.onEvent({ type: 'paused', id })
      return
    }

    activeDownloads.delete(id)
    record.proc = null
    const cancelled = record.cancelled
    // 必须在 cleanupStreamFiles 之前读：它会把 --print-to-file 的临时文件一并删掉。
    // 播放列表/多字幕一次会产出多个文件，这里把全部有效行都收进来（D-38）。
    const printedPaths = readFinalPaths(record.finalPathFile)
    const printedPath = readFinalPath(record.finalPathFile)
    // 结束后临时目录不再需要：完成/失败/取消都清掉，避免留下几百 MB 的分片
    cleanupStreamFiles(record)
    const filePath = printedPath || fallbackPath

    if (cancelled) {
      updateStreamTask(id, { status: 'cancelled', speedBytes: 0 })
      record.onEvent({ type: 'cancelled', id })
      return
    }
    if (code !== 0) {
      const failure = stderrTail.trim() || `yt-dlp exited with code ${code}`
      updateStreamTask(id, { status: 'error', speedBytes: 0, error: failure })
      record.onEvent({ type: 'failed', id, error: failure })
      // 失败也要走规则：用户可能配置了"失败时发 Webhook/通知"这类动作
      void applyCompletionRulesForTask({
        status: 'error',
        dir: record.request.outputDir,
        files: [],
        name: record.request.title || record.request.url,
        errorMessage: failure
      }).catch(error => logger.warn('流媒体失败规则执行失败', error))
      return
    }
    if (!filePath || !fs.existsSync(filePath)) {
      const noOutput = streamDownloadError(streamLocale(), 'no-output-file')
      updateStreamTask(id, { status: 'error', speedBytes: 0, error: noOutput })
      record.onEvent({ type: 'failed', id, error: noOutput })
      return
    }

    // 多文件场景：以 --print-to-file 的全部有效行为准；单文件时就是 [filePath]
    const filePaths = printedPaths.length > 0 ? printedPaths : [filePath]
    logger.info(`yt-dlp 下载完成: ${filePaths.join(', ')}`)
    updateStreamTask(id, { status: 'complete', percent: 100, speedBytes: 0, filePath, filePaths })
    record.onEvent({ type: 'completed', id, filePath, filePaths })
    notifyCompleted(filePath)
    // 完成规则（移动/重命名/打开/通知/Webhook/解压）此前只对 aria2 任务生效，
    // 流媒体任务不在 aria2 队列里就永远不触发（D-10）。这里补上同一套规则。
    void applyCompletionRulesForTask({
      status: 'complete',
      dir: path.dirname(filePath),
      files: filePaths,
      name: record.request.title || path.basename(filePath)
    }).catch(error => logger.warn('流媒体完成规则执行失败', error))
  })
}

/** 暂停一条进行中的下载（结束进程但保留任务记录，可继续） */
export function pauseStreamDownload(id: string): boolean {
  const record = activeDownloads.get(id)
  if (!record || record.cancelled) return false
  // 事件/双击竞态下重复暂停应视为成功，而不是弹「暂停失败」
  if (record.paused) return true
  if (!record.proc) {
    logger.warn(`暂停流媒体下载失败：进程尚未启动或已退出 (${id})`)
    return false
  }
  record.paused = true
  updateStreamTask(id, { status: 'paused', speedBytes: 0 })
  killProcessTree(record.proc)
  return true
}

/**
 * 继续一条已暂停的下载（重新拉起 yt-dlp，沿用原参数与输出目录）。
 *
 * 异步是因为重新拉起前要读一次全局限速（用户可能在暂停期间改了限速）；
 * 返回 true 表示"已接受继续"，进程真正起不来仍走既有的 failed 事件路径。
 */
export async function resumeStreamDownload(id: string): Promise<boolean> {
  const record = activeDownloads.get(id)
  if (!record || !record.paused || record.cancelled) return false
  record.paused = false
  updateStreamTask(id, { status: 'active' })
  fs.rmSync(record.finalPathFile, { force: true })
  await launchStreamProcess(id, record)
  return true
}

/** 取消一条进行中/已暂停的下载（结束整个进程树，含 ffmpeg） */
export function cancelStreamDownload(id: string): boolean {
  const record = activeDownloads.get(id)
  if (!record || record.cancelled) return false
  record.cancelled = true
  if (record.proc) {
    killProcessTree(record.proc)
  } else {
    // 已暂停的任务没有子进程，直接结束并让上层移除任务
    activeDownloads.delete(id)
    cleanupStreamFiles(record)
    updateStreamTask(id, { status: 'cancelled', speedBytes: 0 })
    record.onEvent({ type: 'cancelled', id })
  }
  return true
}

/**
 * 丢弃一条流媒体任务：结束进程并清理临时目录（不删除 outputDir 里的最终文件）。
 * 与 cancel 的区别是它会等待退出后再返回，供「删除任务并同时清理文件」的 UI 使用。
 */
export async function discardStreamDownload(id: string): Promise<boolean> {
  const record = activeDownloads.get(id)
  if (!record) return true
  record.cancelled = true
  record.paused = false
  const proc = record.proc
  if (proc) {
    killProcessTree(proc)
    await new Promise<void>((resolve) => {
      if (proc.exitCode !== null) {
        resolve()
        return
      }
      const timer = setTimeout(resolve, 2000)
      proc.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
  }
  // exit 处理器通常已经清理并移除了记录；若进程从未启动或迟到，这里兜底
  if (activeDownloads.get(id) === record) {
    activeDownloads.delete(id)
    cleanupStreamFiles(record)
    updateStreamTask(id, { status: 'cancelled', speedBytes: 0 })
  }
  return true
}

/** 删除流媒体任务的输出文件（只允许本进程创建过的输出目录，移入回收站） */
export async function deleteStreamDownloadFile(
  filePath: string,
  outputDir: string
): Promise<{ success: boolean; error?: string }> {
  if (!path.isAbsolute(filePath) || !path.isAbsolute(outputDir)) {
    return { success: false, error: 'Invalid path' }
  }
  const root = path.resolve(outputDir)
  if (!streamOutputRoots.has(root)) {
    return { success: false, error: 'Unknown stream download directory' }
  }
  const target = path.resolve(filePath)
  const relative = path.relative(root, target)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return { success: false, error: 'File is outside output directory' }
  }
  try {
    const stat = await fs.promises.stat(target)
    if (!stat.isFile()) return { success: false, error: 'Not a file' }
    await shell.trashItem(target)
    return { success: true }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { success: true }
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

/** 应用退出时兜底清理，避免留下孤儿进程（Windows 不会随父进程回收子进程） */
process.on('exit', () => {
  for (const record of activeDownloads.values()) {
    const proc = record.proc
    if (!proc) continue
    try {
      proc.kill('SIGKILL')
      if (process.platform === 'win32' && proc.pid) {
        spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' })
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
  /** 标题不在进度行里（GBK 乱码），由调用方从 --print-to-file 写出的 UTF-8 文件补上 */
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
  if (!Number.isFinite(percent) && total <= 0) return null
  return {
    percent: Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0,
    speed,
    eta,
    downloadedBytes: downloaded || undefined,
    totalBytes: total || undefined,
    speedBytes,
    ...(Number.isFinite(entryIndexRaw) && entryIndexRaw > 0 ? { entryIndex: entryIndexRaw } : {}),
    ...(Number.isFinite(entryCountRaw) && entryCountRaw > 0 ? { entryCount: entryCountRaw } : {})
  }
}

/** 读取 --print-to-file 写入文件的最后一行非空内容（文件不存在/读失败返回空串） */
function readLastLine(filePath: string): string {
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    return lines[lines.length - 1] ?? ''
  } catch {
    return ''
  }
}

/** 读取 --print-to-file 写入的最终路径（取最后一行非空内容） */
function readFinalPath(filePath: string): string {
  return readLastLine(filePath)
}

/**
 * 读取 --print-to-file 写入的全部输出路径（播放列表/多字幕会写出多行）。
 *
 * 只保留磁盘上真实存在的文件：yt-dlp 在部分条目失败时仍会打印路径，把不存在的
 * 路径交给渲染层会让"删除文件"对着一堆幽灵路径报错。
 */
export function readFinalPaths(filePath: string): string[] {
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    const seen = new Set<string>()
    const result: string[] = []
    for (const line of lines) {
      if (seen.has(line)) continue
      seen.add(line)
      if (fs.existsSync(line)) result.push(line)
    }
    return result
  } catch {
    return []
  }
}

/** 完成通知：流媒体下载不在 aria2 任务列表里，用户关闭弹窗后需要可见的反馈 */
function notifyCompleted(filePath: string): void {
  try {
    if (!Notification.isSupported()) return
    new Notification({
      title: downloadNotificationTitle(runtimeMainLocale(), true),
      body: path.basename(filePath)
    }).show()
  } catch {
    // 通知失败不影响下载本身
  }
}
