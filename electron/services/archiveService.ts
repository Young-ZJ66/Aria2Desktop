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

/** 解析系统 tar 可执行文件名（POSIX 上就是 tar，Windows 为 System32\tar.exe） */
function getTarCommand(): string {
  return process.platform === 'win32' ? 'tar.exe' : 'tar'
}

/**
 * 解压一个压缩包到它所在目录。
 *
 * 调用方（IPC）负责校验文件位于允许的下载目录内；本函数只再做最基本的
 * "存在且是文件"检查，避免把不存在的路径传给子进程。
 */
export async function extractArchive(filePath: string): Promise<ExtractResult> {
  if (!filePath || !path.isAbsolute(filePath)) {
    return { success: false, extracted: false, reason: 'invalid_path' }
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

  const targetDir = path.dirname(filePath)
  // -x 解压、-f 指定文件、-C 指定目标目录；参数直接给数组，不经 shell，避免路径被二次解释
  const args = ['-x', '-f', filePath, '-C', targetDir]

  try {
    await runTar(getTarCommand(), args)
    logger.info(`已解压 ${fileName} 到 ${targetDir}`)
    return { success: true, extracted: true, targetDir }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn(`解压失败 ${fileName}: ${message}`)
    return { success: false, extracted: false, reason: message.slice(0, 300) }
  }
}

/** 执行 tar 并等待结束（含超时与 ENOENT 归类） */
function runTar(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })

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
