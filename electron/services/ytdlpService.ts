/**
 * yt-dlp 集成服务（可选外部引擎）
 * 提供流媒体 URL 解析、格式提取和下载能力。
 * yt-dlp 未安装时所有操作优雅降级（返回错误提示而非崩溃）。
 */

import { spawn } from 'child_process'
import { app } from 'electron'
import * as path from 'path'

/** yt-dlp 元信息（精简版） */
export interface YtdlpVideoInfo {
  title: string
  url: string           // 实际媒体下载 URL
  ext: string           // 容器格式（mp4, mkv, webm 等）
  filesize: number | null
  format: string        // 格式描述
  formats: YtdlpFormat[]
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

/** 检查 yt-dlp 是否可用 */
export async function checkYtdlpAvailable(): Promise<{ available: boolean; version?: string; error?: string }> {
  try {
    const version = await execYtdlp(['--version'])
    return { available: true, version: version.trim() }
  } catch (error) {
    return { available: false, error: error instanceof Error ? error.message : String(error) }
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
        formats
      }
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** 获取指定格式的直接下载 URL */
export async function getFormatUrl(url: string, formatId: string): Promise<{ success: boolean; downloadUrl?: string; title?: string; ext?: string; error?: string }> {
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
      ext: data.ext || 'mp4'
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * 执行 yt-dlp 命令并返回 stdout
 * 优先使用用户配置的路径，否则尝试 PATH 中的 yt-dlp
 */
function execYtdlp(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const cmd = getYtdlpPath()
    const proc = spawn(cmd, args, {
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
        reject(new Error('yt-dlp 未安装。请安装 yt-dlp 并确保在系统 PATH 中。'))
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

function getYtdlpPath(): string {
  // 优先使用打包目录下的 yt-dlp
  if (app.isPackaged) {
    const exe = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
    return path.join(process.resourcesPath, 'yt-dlp', exe)
  }
  return 'yt-dlp'
}
