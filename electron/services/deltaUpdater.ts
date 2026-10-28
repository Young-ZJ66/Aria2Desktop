import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'
import { app } from 'electron'
import { createLogger } from '../utils/logger'
import { isDeltaBlockTable, planDelta, type DeltaBlockTable } from '../utils/deltaBlocks'
import { compareVersions } from '../utils/version'

const logger = createLogger('DeltaUpdater')

/**
 * 差量更新执行器：把"新版安装包"组装出来，而不是下载下来。
 *
 * 原理：本地缓存着上一次更新用的安装包（exe + 块表），新版只下载 hash 不同的分块
 * （HTTP Range 请求），其余从旧包就地复制。组装完成后照走 UpdateController 的
 * **全量 SHA-256 强制校验**——块表不是信任边界，任何被篡改/错位的数据都会在
 * 全量校验处被拦下并回落全量下载。
 *
 * 所有失败都向上抛，由调用方决定回落；本模块绝不吞错谎报成功。
 */

/** 本地缓存的目录与文件名（userData/updates，始终只保留最近一版） */
const CACHE_DIRNAME = 'updates'
const CACHE_EXE = 'cached-setup.exe'
const CACHE_TABLE = 'cached-blocks.json'

/** remote 字节占新版总体积的比例超过该阈值就不值得差量：串行小请求未必快过全量+续传 */
const DELTA_WORTH_RATIO = 0.8

/** 单次 HTTP Range 请求的无数据超时（与全量下载的看门狗口径一致） */
const REQUEST_TIMEOUT_MS = 30000
const MAX_REDIRECTS = 5

export interface DeltaDownloadOptions {
  /** 新版安装包的 GitHub 下载地址（块表 = 该地址 + `.blocks.json`） */
  installerUrl: string
  /** 目标版本号（与块表内 version 严格比对，防 CDN/缓存错位） */
  newVersion: string
  /** 组装产物输出路径（与全量下载共用同一个 .download 路径） */
  targetPath: string
  /** 进度回调：(百分比, 已下载远程字节, 新版总字节) */
  onProgress?: (percent: number, remoteBytes: number, totalSize: number) => void
}

export interface DeltaDownloadResult {
  remoteBytes: number
  totalSize: number
  savedBytes: number
}

/** 差量缓存目录（userData/updates） */
export function getDeltaCacheDir(): string {
  return path.join(app.getPath('userData'), CACHE_DIRNAME)
}

/** GET 文本并跟随重定向（GitHub 资产 302 到 CDN），用于取块表 JSON */
function fetchText(url: string, redirectCount = 0): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (redirectCount > MAX_REDIRECTS) {
      reject(new Error('Too many redirects'))
      return
    }
    const parsed = new URL(url)
    const req = https.request({
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: { 'User-Agent': 'Aria2Desktop-Update' }
    }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        fetchText(new URL(res.headers.location, url).toString(), redirectCount + 1).then(resolve, reject)
        return
      }
      if (!res.statusCode || res.statusCode >= 400) {
        res.resume()
        reject(new Error(`Fetch failed: ${res.statusCode}`))
        return
      }
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
      res.on('error', reject)
    })
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('Fetch timed out')))
    req.on('error', reject)
    req.end()
  })
}

/**
 * 下载一个 Range 段并写到目标 fd 的指定位置。
 * 206 且 content-range 起点一致才接受数据；其余一律抛错（调用方回落全量）。
 */
function fetchRange(
  url: string,
  start: number,
  length: number,
  targetFd: fs.promises.FileHandle,
  writeAt: number,
  onBytes: (n: number) => void,
  redirectCount = 0
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (redirectCount > MAX_REDIRECTS) {
      reject(new Error('Too many redirects'))
      return
    }
    const parsed = new URL(url)
    const req = https.request({
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      // Range 头在 302 到 CDN 后必须继续携带，否则拿到的是全量内容、写入位置却按段算
      headers: { 'User-Agent': 'Aria2Desktop-Update', Range: `bytes=${start}-${start + length - 1}` }
    }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        fetchRange(new URL(res.headers.location, url).toString(), start, length, targetFd, writeAt, onBytes, redirectCount + 1)
          .then(resolve, reject)
        return
      }
      if (res.statusCode !== 206) {
        res.resume()
        // 200 意味着服务器忽略了 Range——段数据不能用了（起点不明），不能静默降级
        reject(new Error(`Range request not honored: ${res.statusCode}`))
        return
      }
      const rangeMatch = /bytes (\d+)-/.exec(String(res.headers['content-range'] ?? ''))
      if (!rangeMatch || Number(rangeMatch[1]) !== start) {
        res.resume()
        reject(new Error('Range response start mismatch'))
        return
      }
      let written = 0
      res.on('data', async (chunk: Buffer) => {
        // 位置写：每一段都明确写 writeAt + 已写字节处，乱序到达也不串位。
        // write 返回值忽略（长度小于 chunk 时会自旋重试，这里不背压——CDN 单段体积有限）
        res.pause()
        try {
          await targetFd.write(chunk, 0, chunk.length, writeAt + written)
          written += chunk.length
          onBytes(chunk.length)
          res.resume()
        } catch (err) {
          res.destroy()
          reject(err)
        }
      })
      res.on('end', () => {
        if (written !== length) {
          reject(new Error(`Range segment incomplete: ${written}/${length}`))
          return
        }
        resolve()
      })
      res.on('error', reject)
    })
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('Range fetch timed out')))
    req.on('error', reject)
    req.end()
  })
}

/** 从旧包 fd 复制一段到目标 fd（按 4MB 切片，避免大段一次性占内存） */
async function copySpan(
  srcFd: fs.promises.FileHandle,
  targetFd: fs.promises.FileHandle,
  srcOffset: number,
  targetOffset: number,
  length: number,
  onBytes: (n: number) => void
): Promise<void> {
  const CHUNK = 4 * 1024 * 1024
  const buffer = Buffer.allocUnsafe(CHUNK)
  let done = 0
  while (done < length) {
    const want = Math.min(CHUNK, length - done)
    const { bytesRead } = await srcFd.read(buffer, 0, want, srcOffset + done)
    if (bytesRead <= 0) throw new Error(`Cached installer truncated at ${srcOffset + done}`)
    await targetFd.write(buffer, 0, bytesRead, targetOffset + done)
    done += bytesRead
    onBytes(bytesRead)
  }
}

/** 缓存有效期：超过后视为过期（100MB 长期占盘且块表可能对应已下架的旧版本） */
const CACHE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000

/** 删除差量缓存（自愈入口：缓存损坏、版本回退、校验失败后都会被调用） */
export async function discardDeltaCache(): Promise<void> {
  const dir = getDeltaCacheDir()
  await Promise.all([
    fs.promises.rm(path.join(dir, CACHE_EXE), { force: true }),
    fs.promises.rm(path.join(dir, CACHE_TABLE), { force: true })
  ]).catch((error) => {
    logger.warn('[DeltaUpdater] 清理差量缓存失败:', error)
  })
}

/** 读本地缓存（exe + 块表）；缺失、损坏、过期、不一致都返回 null 并顺手自愈 */
async function loadCachedTable(): Promise<{ table: DeltaBlockTable; exePath: string } | null> {
  const exePath = path.join(getDeltaCacheDir(), CACHE_EXE)
  if (!fs.existsSync(exePath)) return null
  try {
    const raw = await fs.promises.readFile(path.join(getDeltaCacheDir(), CACHE_TABLE), 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    if (!isDeltaBlockTable(parsed)) {
      logger.info('[DeltaUpdater] 缓存块表非法，已清理')
      await discardDeltaCache()
      return null
    }
    // 缓存表与 exe 必须自洽：size 不一致说明 copyFile/写表被中断过，这样的底版会组装出错位文件
    const stat = await fs.promises.stat(exePath)
    if (stat.size !== parsed.size) {
      logger.info(`[DeltaUpdater] 缓存 exe 与块表不一致（${stat.size} ≠ ${parsed.size}），已清理`)
      await discardDeltaCache()
      return null
    }
    if (Date.now() - stat.mtimeMs > CACHE_MAX_AGE_MS) {
      logger.info('[DeltaUpdater] 差量缓存已过期，已清理')
      await discardDeltaCache()
      return null
    }
    return { table: parsed, exePath }
  } catch {
    // 读失败（文件被占用/半写）同样自愈：留着只会让下次继续失败
    await discardDeltaCache()
    return null
  }
}

/**
 * 差量组装新版安装包。任何一步失败都抛错（调用方回落全量），不产生"半成功"。
 */
export async function downloadDelta(opts: DeltaDownloadOptions): Promise<DeltaDownloadResult> {
  const cached = await loadCachedTable()
  if (!cached) throw new Error('no_cache')

  // 取新版块表：旧 Release 没上传过 blocks.json 时这里 404，属过渡期常态
  const tableRaw = await fetchText(`${opts.installerUrl}.blocks.json`)
  let parsedTable: unknown
  try {
    parsedTable = JSON.parse(tableRaw)
  } catch {
    throw new Error('bad_blocks_json')
  }
  if (!isDeltaBlockTable(parsedTable)) throw new Error('invalid_blocks_table')
  const newTable = parsedTable as DeltaBlockTable
  if (newTable.version !== opts.newVersion) throw new Error('blocks_version_mismatch')

  // 版本回退/同版本：缓存比目标还新，做差量没有意义（也会让"降级安装"拿到错误底版）
  if (compareVersions(cached.table.version, newTable.version) >= 0) {
    await discardDeltaCache()
    throw new Error(`cache_stale (${cached.table.version} >= ${newTable.version})`)
  }

  const plan = planDelta(cached.table, newTable)
  if (plan.remoteBytes > newTable.size * DELTA_WORTH_RATIO) {
    throw new Error(`delta_not_worth (${(plan.remoteBytes / newTable.size).toFixed(2)})`)
  }

  const targetFd = await fs.promises.open(opts.targetPath, 'w')
  try {
    const srcFd = await fs.promises.open(cached.exePath, 'r')
    try {
      let localDone = 0
      let remoteDone = 0
      const total = newTable.size
      const report = (): void => {
        opts.onProgress?.(
          Math.min(99, Math.round(((localDone + remoteDone) / total) * 100)),
          remoteDone,
          total
        )
      }
      for (const op of plan.ops) {
        if (op.source.type === 'local') {
          await copySpan(srcFd, targetFd, op.source.offset, op.targetOffset, op.size, (n) => {
            localDone += n
            report()
          })
        } else {
          await fetchRange(opts.installerUrl, op.source.offset, op.size, targetFd, op.targetOffset, (n) => {
            remoteDone += n
            report()
          })
        }
      }
      opts.onProgress?.(100, remoteDone, total)
      const savedBytes = total - plan.remoteBytes
      logger.info(`[DeltaUpdater] 组装完成：本地复制 ${(savedBytes / 1048576).toFixed(1)}MB，下载 ${(plan.remoteBytes / 1048576).toFixed(1)}MB / 共 ${(total / 1048576).toFixed(1)}MB`)
      return { remoteBytes: plan.remoteBytes, totalSize: total, savedBytes }
    } finally {
      await srcFd.close()
    }
  } finally {
    await targetFd.close()
  }
}

/**
 * 把刚下载并通过校验的安装包写入缓存，供**下一次**更新做差量。
 *
 * 原子性说明：先复制 exe、后写表。任一步被中断都会留下"exe 与表 size 不一致"的缓存，
 * loadCachedTable 的自洽校验会把它判为无效——不会拿坏底版组装。
 * 远端没有新版块表（404）时抛错：新 exe 若配上旧表反而危险，干脆不动缓存，
 * 保留旧缓存（它对再下一次更新仍是一份自洽的底版）。
 */
export async function saveDeltaCache(installerPath: string, version: string, installerUrl: string): Promise<void> {
  const tableRaw = await fetchText(`${installerUrl}.blocks.json`)
  let parsedTable: unknown
  try {
    parsedTable = JSON.parse(tableRaw)
  } catch {
    throw new Error('bad_blocks_json')
  }
  if (!isDeltaBlockTable(parsedTable)) throw new Error('invalid_blocks_table')
  if ((parsedTable as DeltaBlockTable).version !== version) throw new Error('blocks_version_mismatch')

  const dir = getDeltaCacheDir()
  await fs.promises.mkdir(dir, { recursive: true })
  // 同盘 copyFile（~100MB）秒级完成；已存在时 copyFile 默认覆盖
  await fs.promises.copyFile(installerPath, path.join(dir, CACHE_EXE))
  await fs.promises.writeFile(path.join(dir, CACHE_TABLE), tableRaw, 'utf-8')
  logger.info(`[DeltaUpdater] 已缓存 v${version} 安装包，供下次更新差量使用`)
}
