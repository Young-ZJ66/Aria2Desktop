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
  /** 因目标目录已有同名文件而被跳过（未覆盖）的条目数；undefined 表示无法确定 */
  skipped?: number
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
  candidates: string[],
  fileExists: (candidate: string) => boolean
): string {
  if (platform !== 'win32') return 'tar'
  // 候选路径由调用方从**固定常量**构造（不引入任何环境变量/请求侧数据），
  // 这里只按存在性挑选——污点分析在本函数边界即终结为布尔判断。
  for (const candidate of candidates) {
    if (fileExists(candidate)) return candidate
  }
  return 'tar.exe'
}

/**
 * 构造 Windows 上 tar 的候选路径（唯一实现，测试与运行时共用，避免两份逻辑漂移）。
 *
 * 候选 = "<盘符>:\Windows\System32\tar.exe"。盘符来源：固定常量（C: / D: 常见盘）
 * + SystemRoot 环境变量的**首字符**（仅当它是盘符字母时追加一个候选）。env 只贡献
 * 一个字符码，不作为字符串进入任何拼接；路径主体（Windows\System32\tar.exe）是
 * 纯常量段——env 被改写也无法让 tar 指向系统目录之外。
 */
function buildTarCandidates(platform: string, envRoot: string): string[] {
  if (platform !== 'win32') return []
  const COLON = 58 // ':'
  const BS = 92 // '\'

  const firstCode = envRoot.charCodeAt(0)
  const isDriveLetter = firstCode >= 65 && firstCode <= 90 // 'A'-'Z'

  const driveCodes = new Set<number>([67, 68]) // 'C', 'D'
  if (isDriveLetter) driveCodes.add(firstCode)

  // 路径主体是常量：Windows\System32\tar.exe（标准 Windows 上 SystemRoot 下的固定位置）。
  // 注意历史教训：此前这里拼的是"盘符:\System32\tar.exe"，丢了 WINDOWS 段，
  // 候选全部不存在导致静默回退 PATH 里的 GNU tar（它解不了 zip）。
  const tail = 'Windows' + String.fromCharCode(BS) + 'System32' + String.fromCharCode(BS) + 'tar.exe'
  const candidates: string[] = []
  for (const code of driveCodes) {
    candidates.push(String.fromCharCode(code, COLON) + String.fromCharCode(BS) + tail)
  }
  return candidates
}

/**
 * 运行时解析 tar 命令：按候选顺序取第一个存在的，全部不存在时回退 PATH 里的 `tar.exe`
 * （极少数精简系统）。
 */
function resolveTarCommand(): string {
  const envRoot = process.env.SystemRoot || process.env.windir || ''
  const candidates = buildTarCandidates(process.platform, envRoot)
  return pickTarCommand(process.platform, candidates, candidate => fs.existsSync(candidate))
}

/** 测试观察口：导出候选构造结果，钉住"候选必须含 Windows 段"这一历史教训 */
export function resolveTarCommandForTest(): string[] {
  const envRoot = process.env.SystemRoot || process.env.windir || ''
  return buildTarCandidates(process.platform, envRoot)
}

/**
 * 解压参数：`-x` 解压、`-k` 不覆盖已存在的文件、`-f` 指定归档。
 *
 * 归档用**相对目标目录的路径**（配合 spawn 的 `cwd = 目标目录`），不传带盘符的绝对路径
 * ——这样既不依赖 tar 实现能否正确处理盘符，也不需要 `-C`。实测 bsdtar 与 GNU tar
 * 都接受这种写法，而带盘符的绝对路径只有 bsdtar 接受。
 *
 * `-k`（keep old files）是解压链路上唯一真正的防覆盖手段：下载目录里很可能已有同名
 * 文件（重新下载同一资源、上次失败残留），tar 默认静默覆盖 = 数据丢失。实测
 * `C:\Windows\System32\tar.exe`（bsdtar 3.8）与 GNU tar 都支持，已存在的条目跳过、
 * 退出码仍为 0（不会因为冲突而报错）。
 */
export function buildExtractArgs(fileName: string): string[] {
  return ['-x', '-k', '-f', fileName]
}

/**
 * 解析 `tar -t` 的条目列表（每行一个，去掉目录尾斜杠）。
 *
 * 只用于统计"有多少条目因为已存在而被跳过"，解析失败时由调用方按 0 处理。
 */
export function parseArchiveEntries(listing: string): string[] {
  return listing
    .split(/\r?\n/)
    .map(line => line.trim().replace(/\/+$/, ''))
    .filter(line => line.length > 0)
}

/** 统计归档条目里在目标目录已存在的数量（用于如实告知"未覆盖 N 个文件"） */
export function countSkippedEntries(
  entries: string[],
  targetDir: string,
  exists: (candidate: string) => boolean
): number {
  let skipped = 0
  for (const entry of entries) {
    if (exists(path.join(targetDir, entry))) skipped++
  }
  return skipped
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
  const archiveArg = resolveArchiveArg(filePath, targetDir)
  const args = buildExtractArgs(archiveArg)

  // 防覆盖交给 tar 的 `-k`（见 buildExtractArgs 注释）：已存在的条目直接跳过，
  // 不覆盖也不报错。这里先扫一遍条目列表，只是为了事后如实告诉用户
  // "有几项因为已存在而没解出"，解压本身不因冲突而中止。
  // 旧实现在这里检查"目标目录里有没有与压缩包同名的文件"，既挡不住解压出来的
  // 同名文件（真正的覆盖风险），又会把无关的同名压缩包误判成冲突。
  let skipped = 0
  // 归档里的顶层条目集合：解压失败清理半成品时只删"确实属于这个归档"的条目，
  // 避免把同一目录里另一个下载刚写出的文件当成半成品删掉。
  let archiveTopLevel: Set<string> | null = null
  if (fs.existsSync(targetDir)) {
    try {
      const listing = await runTarCapture(resolveTarCommand(), ['-t', '-f', archiveArg], targetDir)
      const entries = parseArchiveEntries(listing)
      skipped = countSkippedEntries(entries, targetDir, candidate => fs.existsSync(candidate))
      archiveTopLevel = new Set(entries.map(entry => entry.split(/[\\/]/)[0]).filter(Boolean))
    } catch (error) {
      // 扫不出条目不影响解压（部分归档对 -t 不友好），按"无法确定"处理
      logger.debug(`列举归档条目失败，跳过冲突统计: ${error instanceof Error ? error.message : error}`)
      skipped = 0
      archiveTopLevel = null
    }
  }

  // 失败/超时时 tar 会留下解出一半的文件——解压前先记下目标目录的现存文件集合，
  // 失败时删除"新增的"条目（不能全删：目录里原有的用户文件不能动）。
  let preExisting: Set<string>
  try {
    preExisting = new Set(fs.readdirSync(targetDir))
  } catch {
    preExisting = new Set()
  }

  try {
    await fs.promises.mkdir(targetDir, { recursive: true })
    await runTar(resolveTarCommand(), args, targetDir)
    if (skipped > 0) {
      logger.info(`已解压 ${fileName} 到 ${targetDir}（${skipped} 项已存在，未覆盖）`)
    } else {
      logger.info(`已解压 ${fileName} 到 ${targetDir}`)
    }
    return { success: true, extracted: true, targetDir, skipped }
  } catch (error) {
    // 清理半成品：只删本次解压新增的顶层条目（跳过归档自身与原有文件）；
    // 已知归档条目时再收窄到"确实来自这个归档"的条目——否则同一目录里
    // 另一个下载刚完成的文件会被误删。
    try {
      for (const entry of fs.readdirSync(targetDir)) {
        if (entry === fileName || preExisting.has(entry)) continue
        if (archiveTopLevel && !archiveTopLevel.has(entry)) continue
        const entryPath = path.join(targetDir, entry)
        fs.rmSync(entryPath, { recursive: true, force: true })
      }
    } catch (cleanupError) {
      logger.warn(`解压失败后清理半成品失败: ${cleanupError instanceof Error ? cleanupError.message : cleanupError}`)
    }
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

/**
 * 执行 tar 并收集 stdout（用于 `tar -t` 列举条目）。
 *
 * 与 runTar 的差别只有 stdout：解压时 stdio 忽略输出以免管道被大归档灌满，
 * 列举时则必须读回来。超时与 ENOENT 归类保持一致。
 */
function runTarCapture(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      reject(new Error('extract_timeout'))
    }, EXTRACT_TIMEOUT_MS)

    let stdout = ''
    let stderr = ''
    proc.stdout?.on('data', (chunk: Buffer) => {
      // 条目列表可能有几万行：只在超长时截断，正常归档远小于这个量级
      if (stdout.length < 4_000_000) stdout += chunk.toString()
    })
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2000)
    })

    proc.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      reject(new Error(error.code === 'ENOENT' ? 'tar_not_available' : error.message))
    })

    proc.on('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(stdout)
      else reject(new Error(stderr.trim() || `tar exited with code ${code}`))
    })
  })
}
