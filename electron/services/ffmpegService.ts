/**
 * ffmpeg 按需安装服务（流媒体合并音视频时使用）。
 *
 * 交付方式与 yt-dlp 一致：不随安装包分发（单平台 65–157 MB），
 * 首次需要合并音轨时由用户点一次按钮，下载官方 FFmpeg-Builds 构建产物，
 * 校验官方 `checksums.sha256` 后解压到 userData。系统 PATH 中已有 ffmpeg 时直接复用。
 *
 * macOS 没有官方自动构建，保留 PATH / Homebrew 安装方式（界面给出指引）。
 */

import { spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { resolveFfmpegAsset } from '../utils/ffmpegAssets'
import { findSha256ForFile } from '../utils/sha256Sums'
import { downloadToFile, fetchText, type DownloadProgress } from '../utils/downloader'
import { ffmpegBuildDate, formatDateStamp, isoToDateStamp } from '../utils/componentUpdate'
import { computeFileSha256 } from '../utils/fileHash'
import { extractArchiveTo } from './archiveService'
import { createLogger } from '../utils/logger'

const logger = createLogger('FfmpegService')

/** FFmpeg-Builds 官方 Release（`latest` 指向当前滚动构建） */
const RELEASE_BASE = 'https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest'

export interface FfmpegCheckResult {
  available: boolean
  version?: string
  error?: string
  source?: 'downloaded' | 'path'
  /** 当前平台是否支持自动安装 */
  installable: boolean
  approxSizeMB?: number
}

export interface FfmpegInstallResult {
  success: boolean
  version?: string
  error?: string
}

/** 检查更新结果（与 yt-dlp 同一形状，便于界面复用） */
export interface FfmpegUpdateResult {
  success: boolean
  updateAvailable: boolean
  checkable: boolean
  currentVersion?: string
  latestVersion?: string
  error?: string
}

/** Release 元信息（GitHub API `latest` 返回滚动构建的资产更新时间） */
const RELEASE_API_LATEST = 'https://api.github.com/repos/yt-dlp/FFmpeg-Builds/releases/latest'

export type FfmpegInstallProgress = DownloadProgress

interface ResolvedFfmpeg {
  command: string
  source: 'downloaded' | 'path'
}

let installInFlight: Promise<FfmpegInstallResult> | null = null

/** 应用内下载的存放目录（与 yt-dlp 同级） */
function ffmpegDir(): string {
  return path.join(app.getPath('userData'), 'ffmpeg')
}

function executableName(): string {
  return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
}

function resolveFfmpeg(): ResolvedFfmpeg {
  const local = path.join(ffmpegDir(), executableName())
  if (fs.existsSync(local)) return { command: local, source: 'downloaded' }
  return { command: 'ffmpeg', source: 'path' }
}

/**
 * 传给 yt-dlp 的 `--ffmpeg-location`：应用内下载时指向所在目录
 * （共享库构建的 DLL 必须与 exe 同目录，因此返回目录而不是单文件路径）；
 * PATH 版无需传参，返回空串。
 */
export function getFfmpegLocation(): string {
  return fs.existsSync(path.join(ffmpegDir(), executableName())) ? ffmpegDir() : ''
}

/** 检查 ffmpeg 是否可用（含来源与自动安装能力） */
export async function checkFfmpegAvailable(): Promise<FfmpegCheckResult> {
  const asset = resolveFfmpegAsset(process.platform, process.arch)
  const resolved = resolveFfmpeg()
  try {
    const version = await runFfmpegVersion(resolved.command)
    return {
      available: true,
      version,
      source: resolved.source,
      installable: Boolean(asset),
      approxSizeMB: asset?.approxSizeMB
    }
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error),
      source: resolved.source,
      installable: Boolean(asset),
      approxSizeMB: asset?.approxSizeMB
    }
  }
}

/**
 * 检查 ffmpeg 是否有更新。
 * FFmpeg-Builds 是每日滚动构建、没有语义化版本：用本地版本号里的构建日期
 * 与 Release 资产的更新时间做比较。
 */
export async function checkFfmpegUpdate(): Promise<FfmpegUpdateResult> {
  const status = await checkFfmpegAvailable()
  if (!status.available) {
    return {
      success: false,
      updateAvailable: false,
      checkable: false,
      error: status.error || 'ffmpeg 未安装'
    }
  }
  const current = String(status.version || '').trim()
  const localDate = ffmpegBuildDate(current)
  if (!localDate) {
    return {
      success: false,
      updateAvailable: false,
      checkable: false,
      currentVersion: current,
      error: '当前版本不含构建日期，无法自动比较（请自行更新）'
    }
  }
  const asset = resolveFfmpegAsset(process.platform, process.arch)
  if (!asset) {
    return {
      success: false,
      updateAvailable: false,
      checkable: false,
      currentVersion: current,
      error: '当前平台不支持自动更新 ffmpeg'
    }
  }
  try {
    const raw = await fetchText(RELEASE_API_LATEST, 4 * 1024 * 1024)
    const data = JSON.parse(raw) as { assets?: Array<{ name?: string; updated_at?: string }> }
    const matched = data.assets?.find((item) => item.name === asset.fileName)
    const remoteDate = isoToDateStamp(String(matched?.updated_at || ''))
    if (!remoteDate) {
      return {
        success: false,
        updateAvailable: false,
        checkable: true,
        currentVersion: current,
        error: '未能获取最新构建信息'
      }
    }
    return {
      success: true,
      checkable: true,
      updateAvailable: remoteDate > localDate,
      currentVersion: current,
      latestVersion: formatDateStamp(remoteDate)
    }
  } catch (error) {
    return {
      success: false,
      updateAvailable: false,
      checkable: true,
      currentVersion: current,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

/** 下载并安装当前平台的 ffmpeg（校验官方 SHA-256 后解压到 userData） */
export function installFfmpeg(onProgress?: (progress: FfmpegInstallProgress) => void): Promise<FfmpegInstallResult> {
  if (installInFlight) return installInFlight
  installInFlight = performInstall(onProgress).finally(() => {
    installInFlight = null
  })
  return installInFlight
}

async function performInstall(
  onProgress?: (progress: FfmpegInstallProgress) => void
): Promise<FfmpegInstallResult> {
  const asset = resolveFfmpegAsset(process.platform, process.arch)
  if (!asset) {
    return {
      success: false,
      error: '当前平台暂不支持自动下载 ffmpeg，请手动安装并加入系统 PATH（macOS 可执行 brew install ffmpeg）'
    }
  }

  const tempRoot = path.join(app.getPath('temp'), `aria2-ffmpeg-${Date.now()}`)
  const archivePath = path.join(tempRoot, asset.fileName)
  const extractDir = path.join(tempRoot, 'extract')
  let installed = false

  try {
    fs.mkdirSync(extractDir, { recursive: true })

    // 先取官方校验和：拿不到就停止，绝不安装未校验的可执行文件
    const sums = await fetchText(`${RELEASE_BASE}/checksums.sha256`)
    const expected = findSha256ForFile(sums, asset.fileName)
    if (!expected) {
      return { success: false, error: '官方校验文件中缺少该平台的 SHA-256，已停止安装' }
    }

    await downloadToFile(`${RELEASE_BASE}/${asset.fileName}`, archivePath, onProgress)

    const actual = await computeFileSha256(archivePath)
    if (actual !== expected) {
      logger.warn(`ffmpeg 校验失败：期望 ${expected.slice(0, 12)}…，实际 ${actual.slice(0, 12)}…`)
      return {
        success: false,
        error: `SHA-256 校验失败（期望 ${expected.slice(0, 12)}…，实际 ${actual.slice(0, 12)}…）`
      }
    }

    await extractFfmpegArchive(archivePath, extractDir)

    // 归档内是 `<build>/bin/ffmpeg(.exe)`（共享库构建还带 DLL），整个 bin 目录一起搬
    const ffmpegPath = findFfmpegBinary(extractDir)
    if (!ffmpegPath) {
      return { success: false, error: '解压后未找到 ffmpeg 可执行文件，归档结构可能已变化' }
    }
    const binDir = path.dirname(ffmpegPath)
    const staging = path.join(tempRoot, 'bin')
    fs.cpSync(binDir, staging, { recursive: true })

    // 先把当前可用的旧安装挪到备份位（而非直接删除）：rename 到新位置失败
    // （%TEMP% 与 userData 跨盘的 EXDEV、文件被占用等）或新装自检失败时，
    // 把备份挪回来——旧版继续可用，不会出现"旧的删了、新的没装上"的两头空。
    const target = ffmpegDir()
    const backup = target + '.backup'
    let hadBackup = false
    if (fs.existsSync(target)) {
      fs.rmSync(backup, { recursive: true, force: true })
      fs.renameSync(target, backup)
      hadBackup = true
    }
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.renameSync(staging, target)
      installed = true
      if (process.platform !== 'win32') {
        fs.chmodSync(path.join(target, executableName()), 0o755)
        // ffprobe 也常被 yt-dlp 调用，缺失时一并修正权限
        const probe = path.join(target, 'ffprobe')
        if (fs.existsSync(probe)) fs.chmodSync(probe, 0o755)
      }

      // 真正执行一次，确认不是"解压成功但跑不起来"
      const version = await runFfmpegVersion(path.join(target, executableName()))
      logger.info(`ffmpeg 安装完成: ${version}`)
      // 安装成功后备份才允许删除
      if (hadBackup) fs.rmSync(backup, { recursive: true, force: true })
      return { success: true, version }
    } catch (installError) {
      // 回滚：新装有问题时恢复旧版（若此前没有旧版则清理半成品）
      try {
        if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true })
        if (hadBackup) fs.renameSync(backup, target)
      } catch (rollbackError) {
        logger.warn('ffmpeg 回滚失败:', rollbackError)
      }
      throw installError
    }
  } catch (error) {
    if (installed) fs.rmSync(ffmpegDir(), { recursive: true, force: true })
    logger.warn('ffmpeg 安装失败:', error)
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
}

/** 执行一次 `ffmpeg -version` 并返回首行（同时兼作可执行性自检） */
function runFfmpegVersion(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, ['-version'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      reject(new Error('ffmpeg 执行超时'))
    }, 10000)
    let stdout = ''
    let stderr = ''
    proc.stdout?.on('data', (chunk) => { stdout += chunk.toString() })
    proc.stderr?.on('data', (chunk) => { stderr += chunk.toString() })
    proc.on('error', (error) => {
      clearTimeout(timer)
      if (error.message.includes('ENOENT')) {
        reject(new Error('未检测到 ffmpeg。可在此处一键下载，或自行安装并加入系统 PATH。'))
      } else {
        reject(error)
      }
    })
    proc.on('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) {
        const firstLine = stdout.split(/\r?\n/)[0]?.trim() || 'ffmpeg'
        // 首行形如 "ffmpeg version N-128251-g6d1bfd7609-20261031 Copyright (c) ..."：
        // 只取版本号本身，避免版权声明这类长文本进入界面
        const match = /^ffmpeg version\s+([^\s]+)/i.exec(firstLine)
        resolve(match?.[1] ?? firstLine)
      } else {
        reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`))
      }
    })
  })
}

/**
 * 用系统 tar 解压到指定目录。
 *
 * 实现放在 archiveService：那条链路上已经踩过"PATH 里的 GNU tar 把带盘符路径当成
 * 远程主机"的坑（Git for Windows / MSYS2 会提供 tar.exe），两处必须共用同一份取舍，
 * 否则自动解压修好了、组件安装照样挂。
 */
async function extractFfmpegArchive(archivePath: string, destDir: string): Promise<void> {
  const result = await extractArchiveTo(archivePath, destDir)
  if (result.success) return
  if (result.reason === 'tar_not_available') throw new Error('系统未提供 tar，无法解压 ffmpeg 归档')
  if (result.reason === 'extract_timeout') throw new Error('ffmpeg 解压超时')
  throw new Error(`解压 ffmpeg 归档失败：${result.reason ?? '未知原因'}`)
}

/** 深度优先查找 ffmpeg 可执行文件（归档内的目录层级来自官方构建，保持宽松） */
function findFfmpegBinary(dir: string): string | null {
  const names = ['ffmpeg.exe', 'ffmpeg']
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const entry of entries) {
    if (entry.isFile() && names.includes(entry.name)) return path.join(dir, entry.name)
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const found = findFfmpegBinary(path.join(dir, entry.name))
      if (found) return found
    }
  }
  return null
}
