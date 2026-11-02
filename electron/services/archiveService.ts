import { spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { createLogger } from '../utils/logger'

const logger = createLogger('Archive')

/**
 * 下载完成后自动解压（可选，默认关闭）。
 *
 * 为什么用系统自带的 tar 而不是内置 7-Zip：
 * - Windows 10 1803+ 自带 `tar.exe`（bsdtar/libarchive），可解 zip / tar / gz / bz2 / xz / 7z，
 *   macOS 同样自带 bsdtar；引入第三方二进制会让安装包变大、还要为每个架构单独准备；
 * - 代价是 RAR 无法处理（libarchive 的 RAR 支持在 Windows 版本上不可靠），
 *   因此 RAR 明确回报"不支持"，而不是丢一个解一半的目录给用户。
 *
 * 安全边界：
 * - 只解压**调用方已在允许目录内**的文件（路径校验在 IPC 层，与删除文件同一套根目录判定）；
 * - 解压目标固定为压缩包所在目录，不接受调用方指定；
 * - bsdtar 默认 Secure 模式：剥离绝对路径、拒绝 `..` 成分，压缩包无法写到目标目录之外。
 */

/** 支持自动解压的扩展名（小写，含复合后缀） */
const SUPPORTED_SUFFIXES = [
  '.zip', '.7z',
  '.tar', '.tar.gz', '.tgz', '.tar.bz2', '.tbz2', '.tar.xz', '.txz'
]

/** 单次解压超时：大压缩包在机械盘上可能很慢，但不能无限等 */
const EXTRACT_TIMEOUT_MS = 5 * 60 * 1000

export interface ExtractResult {
  success: boolean
  /** 是否真的执行了解压（false 表示按规则跳过，不算失败） */
  extracted: boolean
  /** 跳过或失败的原因（已本地化前的关键短语，调用方决定是否展示） */
  reason?: string
  /** 解压目标目录 */
  targetDir?: string
}

/** 判断文件名是否属于可自动解压的归档格式 */
export function isExtractableArchive(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  return SUPPORTED_SUFFIXES.some(suffix => lower.endsWith(suffix))
}

/**
 * 选择解压用的 tar 可执行文件。
 *
 * Windows 上**不能只靠 PATH**：Git for Windows / MSYS2 / Cygwin 同样会提供 `tar.exe`
 * （GNU tar），只要它排在 PATH 前面就会抢先命中，带来两处静默退化：
 * 1. GNU tar 把带盘符的绝对路径当成"远程主机:路径"语法，直接报
 *    `tar: Cannot connect to D: resolve failed`——自动解压在这种机器上全挂，
 *    而报错文案与解压本身毫无关系，用户根本看不懂；
 * 2. 格式支持面不同：bsdtar 覆盖 zip / 7z / tar 系列，GNU tar 只处理 tar 系列。
 * 因此优先用 `%SystemRoot%\System32\tar.exe`（Win10 1803+ 自带的 bsdtar），
 * 该文件不存在时才回退到 PATH 里的 `tar.exe`。
 *
 * 抽成"平台 + 是否存在"的纯函数是为了能直接单测两个分支。
 */
export function pickTarCommand(
  platform: string,
  systemRoot: string | undefined,
  fileExists: (candidate: string) => boolean
): string {
  if (platform !== 'win32') return 'tar'
  if (systemRoot) {
    const systemTar = path.join(systemRoot, 'System32', 'tar.exe')
    if (fileExists(systemTar)) return systemTar
  }
  return 'tar.exe'
}

/** 运行时解析 tar 命令（极少数精简系统可能没有 SystemRoot，此时回退 PATH） */
function resolveTarCommand(): string {
  const systemRoot = process.env.SystemRoot || process.env.windir
  return pickTarCommand(process.platform, systemRoot, candidate => fs.existsSync(candidate))
}

/**
 * 解压参数：`-x` 解压、`-f` 指定归档。
 *
 * 归档用**相对目标目录的路径**（配合 spawn 的 `cwd = 目标目录`），不传带盘符的绝对路径
 * ——这样既不依赖 tar 实现能否正确处理盘符，也不需要 `-C`。实测 bsdtar 与 GNU tar
 * 都接受这种写法，而带盘符的绝对路径只有 bsdtar 接受。
 */
export function buildExtractArgs(fileName: string): string[] {
  return ['-x', '-f', fileName]
}

/**
 * 计算 `-f` 用的归档路径。
 *
 * 目标是让 tar 拿到一个不带盘符的相对路径。跨盘符（Windows 上归档在 D:、目标在 C:）时
 * `path.relative` 会退回绝对路径，此时只能交给 bsdtar 处理——这也是 `pickTarCommand`
 * 优先钉住系统 bsdtar 的原因之一。
 */
export function resolveArchiveArg(filePath: string, targetDir: string): string {
  const relative = path.relative(targetDir, filePath)
  return relative && !path.isAbsolute(relative) ? relative : filePath
}

/**
 * 解压一个压缩包到它所在目录。
 *
 * 调用方（IPC）负责校验文件位于允许的下载目录内；本函数只再做最基本的
 * "存在且是文件"检查，避免把不存在的路径传给子进程。
 */
export async function extractArchive(filePath: string): Promise<ExtractResult> {
  return extractArchiveTo(filePath, path.dirname(filePath))
}

/**
 * 解压到指定目录（供组件安装等内部流程复用，解压实现只有这一份）。
 *
 * 与用户可见的自动解压共用同一套 tar 选择与参数构造：Windows 上 PATH 里的 GNU tar
 * 会把带盘符的绝对路径当成"远程主机:路径"，这条坑在两条链路上必须同时躲开。
 */
export async function extractArchiveTo(filePath: string, targetDir: string): Promise<ExtractResult> {
  if (!filePath || !path.isAbsolute(filePath)) {
    return { success: false, extracted: false, reason: 'invalid_path' }
  }
  if (!targetDir || !path.isAbsolute(targetDir)) {
    return { success: false, extracted: false, reason: 'invalid_target' }
  }

  const fileName = path.basename(filePath)
  if (!isExtractableArchive(fileName)) {
    return { success: true, extracted: false, reason: 'unsupported_format' }
  }

  let stats: fs.Stats
  try {
    stats = await fs.promises.stat(filePath)
  } catch {
    return { success: false, extracted: false, reason: 'not_found' }
  }
  if (!stats.isFile()) {
    return { success: false, extracted: false, reason: 'not_a_file' }
  }

  // 归档用相对路径 + spawn 的 cwd，参数直接给数组，不经 shell，避免路径被二次解释
  const args = buildExtractArgs(resolveArchiveArg(filePath, targetDir))

  try {
    await fs.promises.mkdir(targetDir, { recursive: true })
    await runTar(resolveTarCommand(), args, targetDir)
    logger.info(`已解压 ${fileName} 到 ${targetDir}`)
    return { success: true, extracted: true, targetDir }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn(`解压失败 ${fileName}: ${message}`)
    return { success: false, extracted: false, reason: message.slice(0, 300) }
  }
}

/** 执行 tar 并等待结束（含超时与 ENOENT 归类） */
function runTar(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe']
    })

    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      reject(new Error('extract_timeout'))
    }, EXTRACT_TIMEOUT_MS)

    let stderr = ''
    proc.stderr?.on('data', (chunk: Buffer) => {
      // 只保留尾部：失败时通常最后一行才是有用的原因
      stderr = (stderr + chunk.toString()).slice(-2000)
    })

    proc.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      // 系统没有 tar（过旧的 Windows / 精简系统）：如实告知不可用，而不是报"解压失败"
      reject(new Error(error.code === 'ENOENT' ? 'tar_not_available' : error.message))
    })

    proc.on('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(stderr.trim() || `tar exited with code ${code}`))
    })
  })
}
