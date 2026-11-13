import { randomUUID } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import Store from 'electron-store'
import { WindowController } from '../controllers/WindowController'
import { registerSecureHandler } from '../utils/ipcSecurity'
import { callAria2Rpc } from '../utils/aria2Rpc'
import { activeRpcOptions } from '../utils/activeRpcConfig'
import { createLogger } from '../utils/logger'
import { computeFileSha256 } from '../utils/fileHash'
// 注意：主进程产物是 CJS，运行时无法解析 @/ 别名，必须用相对路径引入 src/shared
import type { AutoImportLogEntry, WatchFolderConfig } from '../../src/shared/autoImport'
import type { StoreData } from '../types/store'

// 本文件日志文案自带 [WatchFolder] 前缀（历史风格），故 scope 传空避免前缀重复
const logger = createLogger('')

/** 扫描步长：固定 15 秒（文件夹监听要的是"放进去很快被吃掉"的体验） */
const SCAN_INTERVAL_MS = 15_000

/** 稳定性门槛：文件 mtime 距今至少 3 秒才视为"写完了" */
const STABLE_MTIME_MS = 3_000

/** 未配置 extensions 时默认处理的扩展名 */
const DEFAULT_EXTENSIONS = ['.torrent', '.metalink', '.txt']

/** 已导入内容哈希上限（FIFO）：内容去重的记忆窗口 */
const MAX_SEEN_HASHES = 1_000

/** 导入日志上限（条）：与 RSS 隧道共用一份，超出裁最旧 */
const MAX_LOG_ENTRIES = 200

/** 'watch-folders-scan-now' 的返回载荷 */
export interface WatchScanResult {
  success: boolean
  imported: number
  error?: string
}

/** 'watch-folders-save' 的返回载荷 */
export interface WatchSaveResult {
  success: boolean
  folder?: WatchFolderConfig
  error?: string
}

/**
 * 监听文件夹自动导入服务。
 *
 * 15 秒一跳扫描所有 enabled 文件夹（非递归，只看顶层）。每个文件必须先过
 * 稳定性门槛（mtime 距今 ≥3 秒且 size 与上一轮一致——两轮不变才算写完，
 * 半截的 torrent 文件喂给 aria2 只会得到坏任务），再按内容哈希去重，
 * 然后按扩展名导入：.torrent/.metalink 转 base64 走 RPC，.txt 逐行找磁力。
 * 单文件失败不记哈希、留在原地，下一轮自然重试。
 */
export class WatchFolderService {
  private store: Store<StoreData>
  private windowController: WindowController
  private timer: NodeJS.Timeout | null = null
  /** 进行中的扫描（按文件夹 id）：ticker 与 scan-now 并发时共享同一次扫描 */
  private pendingScans = new Map<string, Promise<WatchScanResult>>()
  /** 上一轮扫描看到的文件大小（path→size）：稳定性判定基准，纯内存，重启后重新学习 */
  private lastSizes = new Map<string, number>()
  /** 供 ipcSecurity 工厂使用的窗口取值器（与 trackerSubscriptionService 口径一致） */
  private windowRef = () => this.windowController.getMainWindow()

  constructor(store: Store<StoreData>, windowController: WindowController) {
    this.store = store
    this.windowController = windowController
  }

  /**
   * 启动：立即扫一跳只用于"记住"当前文件大小（首轮观察永远不会被判定稳定，
   * 必须有上一轮 size 作对照），随后固定 15 秒一跳。
   */
  initialize(): void {
    if (this.timer) return
    this.tick()
    this.timer = setInterval(() => this.tick(), SCAN_INTERVAL_MS)
  }

  /** 清理定时器（应用退出时调用） */
  shutdown(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** 读取全部监听配置（旧 store 文件没有该键 → 空列表） */
  getFolders(): WatchFolderConfig[] {
    return (this.store.get('watchFolders') as WatchFolderConfig[] | undefined) ?? []
  }

  /** 读指定配置 */
  private findFolder(id: string): WatchFolderConfig | undefined {
    return this.getFolders().find(folder => folder.id === id)
  }

  /** 覆写配置列表 */
  private saveFolders(list: WatchFolderConfig[]): void {
    this.store.set('watchFolders', list)
  }

  /** 只更新单个文件夹的运行时字段（扫描状态写回） */
  private patchFolder(id: string, patch: Partial<WatchFolderConfig>): void {
    const list = this.getFolders()
    const index = list.findIndex(folder => folder.id === id)
    if (index < 0) return
    list[index] = { ...list[index], ...patch }
    this.saveFolders(list)
  }

  /**
   * 手动/定时扫描统一入口：同一文件夹的并发调用共享同一个 Promise。
   */
  scanNow(id: string): Promise<WatchScanResult> {
    const pending = this.pendingScans.get(id)
    if (pending) return pending
    const promise = this.performScan(id).finally(() => {
      this.pendingScans.delete(id)
    })
    this.pendingScans.set(id, promise)
    return promise
  }

  private tick(): void {
    for (const folder of this.getFolders()) {
      if (!folder.enabled) continue
      // 不 await：大文件夹的哈希计算不该拖住其它文件夹；异常在 performScan 内已兜住
      void this.scanNow(folder.id).catch(error => {
        logger.warn('[WatchFolder] 自动扫描异常:', folder.path, error)
      })
    }
  }

  /**
   * 扫描管线。文件夹级失败（不存在/读不了）只写 lastError 并返回失败；
   * 文件级失败逐条写日志，不影响其它文件。
   */
  private async performScan(id: string): Promise<WatchScanResult> {
    const folder = this.findFolder(id)
    if (!folder) return { success: false, imported: 0, error: '监听文件夹不存在' }

    let names: string[]
    try {
      // 非递归：只扫顶层。递归会顺带吃掉用户手工整理的子目录，与"投递箱"心智不符
      names = fs.readdirSync(folder.path)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.patchFolder(id, { lastScanAt: new Date().toISOString(), lastError: message })
      return { success: false, imported: 0, error: message }
    }

    const extensionSet = this.resolveExtensions(folder)
    const seenHashes = new Set(this.getSeenHashes())
    const logEntries: AutoImportLogEntry[] = []
    let imported = 0
    // 本轮扫描观察到的大小：结束后整体替换 lastSizes（消失的文件自然失忆）
    const currentSizes = new Map<string, number>()

    for (const name of names) {
      const filePath = path.join(folder.path, name)
      let stat: fs.Stats
      try {
        stat = fs.statSync(filePath)
      } catch {
        // stat 失败多半是扫描瞬间被移走/删除：静默跳过即可
        continue
      }
      if (!stat.isFile()) continue
      currentSizes.set(filePath, stat.size)

      // 扩展名过滤：不在处理名单里的文件完全不碰（不记哈希、不写日志）
      if (!extensionSet.has(path.extname(name).toLowerCase())) continue

      // 稳定性门槛：正在写入的文件（mtime 太新 / 大小较上轮有变化）本轮先观察
      const previousSize = this.lastSizes.get(filePath)
      const mtimeAge = Date.now() - stat.mtimeMs
      if (mtimeAge < STABLE_MTIME_MS || previousSize === undefined || previousSize !== stat.size) continue

      let hash: string
      try {
        // 用内容哈希去重而不是文件名：同名重新投递、改名投递都能识别为已导入
        hash = await computeFileSha256(filePath)
      } catch (error) {
        logger.warn('[WatchFolder] 哈希计算失败:', filePath, error)
        continue
      }
      if (seenHashes.has(hash)) {
        logEntries.push(this.buildLogEntry(folder, name, 'skipped', '内容已导入过，跳过'))
        continue
      }

      try {
        const fileImported = await this.importFile(folder, filePath, name, logEntries)
        imported += fileImported
        // 只有导入完成（或明确"无需导入"）才记哈希：失败必须能重试
        seenHashes.add(hash)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logEntries.push(this.buildLogEntry(folder, name, 'error', message))
        logger.warn('[WatchFolder] 导入失败（下轮重试）:', filePath, message)
      }
    }

    this.lastSizes = currentSizes
    if (seenHashes.size > 0) this.setSeenHashes(Array.from(seenHashes))
    this.appendLog(logEntries)
    this.patchFolder(id, { lastScanAt: new Date().toISOString(), lastError: null })
    return { success: true, imported }
  }

  /** 解析生效的扩展名集合：未配置 → 默认三种；显式空数组 → 什么都不处理 */
  private resolveExtensions(folder: WatchFolderConfig): Set<string> {
    if (folder.extensions === undefined) return new Set(DEFAULT_EXTENSIONS)
    return new Set(folder.extensions)
  }

  /**
   * 按扩展名导入一个（已判定稳定的）文件。
   * 成功返回导入条数并写 added 日志；失败抛异常由调用方写 error 日志。
   * 导入完成后负责删除/移动源文件。
   */
  private async importFile(
    folder: WatchFolderConfig,
    filePath: string,
    fileName: string,
    logEntries: AutoImportLogEntry[]
  ): Promise<number> {
    // 目标地址参数：配置了 dir 才下发（aria2 端缺省目录由全局配置决定）
    const options = folder.dir && folder.dir.trim() !== '' ? { dir: folder.dir } : {}
    const ext = path.extname(fileName).toLowerCase()

    if (ext === '.torrent') {
      const base64 = (await fs.promises.readFile(filePath)).toString('base64')
      const gid = await this.rpc('aria2.addTorrent', [base64, [], options])
      logEntries.push(this.buildLogEntry(folder, fileName, 'added', undefined, gid))
      await this.cleanupSource(folder, filePath, logEntries)
      return 1
    }

    if (ext === '.metalink') {
      const base64 = (await fs.promises.readFile(filePath)).toString('base64')
      // addMetalink 对多文件 metalink 返回 gid 数组，拼成可读字符串进日志
      const gid = await this.rpc('aria2.addMetalink', [base64, options])
      logEntries.push(this.buildLogEntry(folder, fileName, 'added', undefined, gid))
      await this.cleanupSource(folder, filePath, logEntries)
      return 1
    }

    if (ext === '.txt') {
      const text = await fs.promises.readFile(filePath, 'utf-8')
      const magnets = text
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => /^magnet:/i.test(line))
      // 一个磁力行算一条：空文件/纯文本文件不该让扫描报错，静默视为"无需导入"
      if (magnets.length === 0) return 0
      for (const magnet of magnets) {
        const gid = await this.rpc('aria2.addUri', [[magnet], options])
        logEntries.push(this.buildLogEntry(folder, fileName, 'added', undefined, gid))
      }
      await this.cleanupSource(folder, filePath, logEntries)
      return magnets.length
    }

    // 扩展名在生效名单里但没有对应处理器：静默跳过（不记哈希的跳过在 resolveExtensions 一层
    // 已排除默认名单，这里只剩用户自定义的陌生扩展名）
    return 0
  }

  /** 导入成功后的源文件清理：按配置删除，否则移入 imported/ 子目录（重名覆盖） */
  private async cleanupSource(folder: WatchFolderConfig, filePath: string, logEntries: AutoImportLogEntry[]): Promise<void> {
    try {
      if (folder.deleteAfterImport === true) {
        await fs.promises.rm(filePath, { force: true })
        return
      }
      // copyFile + unlink 而不是 rename：Windows 上 rename 到已存在的目标会失败，
      // 而投递箱里同名文件重复投递是常态；copyFile 默认覆盖目标
      const importedDir = path.join(folder.path, 'imported')
      await fs.promises.mkdir(importedDir, { recursive: true })
      const dest = path.join(importedDir, path.basename(filePath))
      await fs.promises.copyFile(filePath, dest)
      await fs.promises.unlink(filePath)
    } catch (error) {
      // 清理失败不影响"已添加"的事实（哈希已记录，不会重复导入），但要留痕给用户排查
      const message = error instanceof Error ? error.message : String(error)
      const fileName = path.basename(filePath)
      logEntries.push(this.buildLogEntry(folder, fileName, 'error', '已添加到 aria2，但清理/归档源文件失败: ' + message))
      logger.warn('[WatchFolder] 清理源文件失败:', filePath, message)
    }
  }

  /** 经活动连接端点执行 RPC；返回 gid 或 gid 列表的字符串形态 */
  private async rpc(method: string, params: unknown[], timeoutMs = 10_000): Promise<string> {
    // 端点必须每次现解析：用户随时可能切到远程 aria2，写死 127.0.0.1 会操作错引擎
    const result = await callAria2Rpc({ ...activeRpcOptions(), method, params, timeoutMs })
    if (typeof result === 'string') return result
    if (Array.isArray(result)) return result.map(String).join(',')
    return String(result)
  }

  /** 读取已导入内容哈希 */
  private getSeenHashes(): string[] {
    return (this.store.get('watchSeenHashes') as string[] | undefined) ?? []
  }

  /** 写回哈希表，FIFO 上限 1000：最旧的先被挤掉 */
  private setSeenHashes(hashes: string[]): void {
    this.store.set('watchSeenHashes', hashes.slice(-MAX_SEEN_HASHES))
  }

  /** 构造一条导入日志 */
  private buildLogEntry(
    folder: WatchFolderConfig,
    fileName: string,
    status: AutoImportLogEntry['status'],
    message?: string,
    gid?: string
  ): AutoImportLogEntry {
    return {
      id: randomUUID(),
      kind: 'watch-folder',
      sourceId: folder.id,
      sourceName: folder.path,
      title: fileName,
      ...(gid !== undefined ? { gid } : {}),
      status,
      ...(message !== undefined ? { message } : {}),
      importedAt: new Date().toISOString()
    }
  }

  /** 追加日志（新→旧排序，超过 200 条裁最旧）；按批一次写盘，避免扫描中途反复触发持久化 */
  private appendLog(entries: AutoImportLogEntry[]): void {
    if (entries.length === 0) return
    const existing = (this.store.get('autoImportLog') as AutoImportLogEntry[] | undefined) ?? []
    // entries 是时间正序（旧→新），存储是新→旧：整批反转后头插
    const merged = [...entries.slice().reverse(), ...existing].slice(0, MAX_LOG_ENTRIES)
    this.store.set('autoImportLog', merged)
  }

  /**
   * 校验并归一化配置（upsert 前调用）。
   * extensions 归一为小写带点（'TORRENT'/'torrent' → '.torrent'）。
   */
  private validateFolder(folder: WatchFolderConfig): { ok: true; folder: WatchFolderConfig } | { ok: false; error: string } {
    if (!folder || typeof folder !== 'object') return { ok: false, error: '配置数据无效' }
    const watchPath = typeof folder.path === 'string' ? folder.path.trim() : ''
    if (watchPath === '') return { ok: false, error: '监听路径不能为空' }
    if (!path.isAbsolute(watchPath)) return { ok: false, error: '监听路径必须是绝对路径' }
    try {
      const stat = fs.statSync(watchPath)
      if (!stat.isDirectory()) return { ok: false, error: '监听路径不是文件夹' }
    } catch {
      return { ok: false, error: '监听路径不存在或不可访问' }
    }
    const dir = typeof folder.dir === 'string' ? folder.dir.trim() : ''
    // dir 与 RSS 订阅同口径：相对目录会被 aria2 按它自己的工作目录解释，必然落错位置
    if (dir !== '' && !path.isAbsolute(dir)) return { ok: false, error: '下载目录必须是绝对路径' }

    const extensions = folder.extensions === undefined
      ? undefined
      : (Array.isArray(folder.extensions) ? folder.extensions : [])
        .filter((ext): ext is string => typeof ext === 'string')
        .map(ext => {
          let normalized = ext.trim().toLowerCase()
          if (normalized === '') return ''
          if (!normalized.startsWith('.')) normalized = '.' + normalized
          return normalized
        })
        .filter(ext => ext !== '')
        // 去重：'TORRENT'/'torrent' 归一后是同一个扩展名，重复项只会让 UI 白显示一行
        .filter((ext, index, all) => all.indexOf(ext) === index)

    return {
      ok: true,
      folder: {
        ...folder,
        path: watchPath,
        enabled: folder.enabled === true,
        deleteAfterImport: folder.deleteAfterImport === true,
        dir: dir === '' ? undefined : dir,
        ...(extensions !== undefined ? { extensions } : {})
      }
    }
  }

  /**
   * 按 id upsert：新配置（无 id）生成 UUID。
   * 运行时字段（lastScanAt/lastError）以已存值为准——改路径不该伪造扫描历史。
   * 注意：path 变更后旧的文件大小记忆（内存）与新路径天然不匹配，首轮观察
   * 会重新学习，无需特殊处理。
   */
  private upsertFolder(folder: WatchFolderConfig): WatchSaveResult {
    const validated = this.validateFolder(folder)
    if (!validated.ok) return { success: false, error: validated.error }

    const incoming = validated.folder
    const id = incoming.id && incoming.id !== '' ? incoming.id : randomUUID()
    const list = this.getFolders()
    const index = list.findIndex(existing => existing.id === id)
    const previous = index >= 0 ? list[index] : undefined
    const merged: WatchFolderConfig = {
      ...incoming,
      id,
      lastScanAt: incoming.lastScanAt ?? previous?.lastScanAt ?? null,
      lastError: incoming.lastError ?? previous?.lastError ?? null
    }
    if (index >= 0) list[index] = merged
    else list.push(merged)
    this.saveFolders(list)
    return { success: true, folder: merged }
  }

  /** 删除配置（内容哈希表是全局的，无法区分来源，保持不动） */
  private deleteFolder(id: string): { success: boolean } {
    this.saveFolders(this.getFolders().filter(folder => folder.id !== id))
    return { success: true }
  }

  registerIpcHandlers(): void {
    registerSecureHandler('watch-folders-list', () => ({ folders: this.getFolders() }), {
      getMainWindow: this.windowRef
    })

    registerSecureHandler('watch-folders-save', (event, folder: WatchFolderConfig) => this.upsertFolder(folder), {
      getMainWindow: this.windowRef
    })

    registerSecureHandler('watch-folders-delete', (event, id: string) => this.deleteFolder(id), {
      getMainWindow: this.windowRef
    })

    registerSecureHandler('watch-folders-scan-now', async (event, id: string) => await this.scanNow(id), {
      getMainWindow: this.windowRef
    })
  }
}
