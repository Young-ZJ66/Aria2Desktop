/**
 * 下载历史数据库（SQLite）
 *
 * 渲染层历史记录原先整体序列化成 persisted-tasks.json，IPC 有 10MB 上限，
 * 大历史会写盘失败并且每次写入都是全量重写。这里改用 Node 22 内置的
 * node:sqlite 按任务逐行存储：容量由 SQLite 管理，不再有 JSON 字符串上限。
 * 若运行环境没有 node:sqlite（旧 Electron/测试环境），自动回退到原 JSON 文件。
 */

import fs from 'node:fs'
import path from 'node:path'
import logger from 'electron-log'

interface HistoryRow {
  gid: string
  task_json: string
  completed_at: number
  persisted_at: number
}

interface SqliteStatement {
  run(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
}

/** 历史记录上限：SQLite 后端按行裁剪最旧记录（按 completed_at 排序），不再按天龄清理。 */
export const HISTORY_MAX_ROWS = 50_000

/** 单次增量删除的 gid 数量上限：与渲染层单次批量删除的规模一致，防止超大 IN 列表拖垮 SQLite。 */
const MAX_DELETE_BATCH = 1_000

interface SqliteDatabase {
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
  close(): void
}

function openSqlite(filePath: string): SqliteDatabase | null {
  try {

    const sqlite = require('node:sqlite') as { DatabaseSync: new (file: string) => SqliteDatabase }
    return new sqlite.DatabaseSync(filePath)
  } catch (error) {
    logger.warn('[HistoryDatabase] node:sqlite unavailable, falling back to JSON:', error)
    return null
  }
}

export class HistoryDatabase {
  private db: SqliteDatabase | null = null
  private readonly legacyPath: string

  constructor(private readonly dbPath: string, legacyPath?: string) {
    this.legacyPath = legacyPath ?? ''
    this.open()
  }

  private open() {
    try {
      const dir = path.dirname(this.dbPath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      this.db = openSqlite(this.dbPath)
      if (!this.db) return
      this.db.exec(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS download_history (
          gid TEXT PRIMARY KEY,
          task_json TEXT NOT NULL,
          completed_at INTEGER NOT NULL DEFAULT 0,
          persisted_at INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_history_completed ON download_history(completed_at DESC);
      `)
      this.migrateLegacy()
    } catch (error) {
      logger.error('[HistoryDatabase] Failed to open database:', error)
      this.db = null
    }
  }

  /** 首次启动时把旧 persisted-tasks.json 导入 SQLite，成功后保留 .migrated 备份 */
  private migrateLegacy() {
    if (!this.db || !this.legacyPath || !fs.existsSync(this.legacyPath)) return
    const count = this.db.prepare('SELECT COUNT(*) AS count FROM download_history').all() as { count: number }[]
    if ((count[0]?.count ?? 0) > 0) return
    try {
      const content = fs.readFileSync(this.legacyPath, 'utf-8')
      const data = JSON.parse(content || '{}') as Record<string, unknown>
      const entries = Object.entries(data)
      if (entries.length === 0) return
      this.saveAll(data)
      fs.renameSync(this.legacyPath, `${this.legacyPath}.migrated`)
      logger.info(`[HistoryDatabase] Migrated ${entries.length} history records from JSON to SQLite`)
    } catch (error) {
      logger.warn('[HistoryDatabase] Legacy migration failed:', error)
    }
  }

  get enabled(): boolean {
    return this.db !== null
  }

  loadAll(): Record<string, unknown> {
    if (!this.db) return this.loadJson()
    try {
      const rows = this.db.prepare('SELECT gid, task_json FROM download_history').all() as HistoryRow[]
      const result: Record<string, unknown> = {}
      for (const row of rows) {
        try {
          result[row.gid] = JSON.parse(row.task_json)
        } catch {
          // 单条损坏记录不影响其余历史
        }
      }
      return result
    } catch (error) {
      logger.error('[HistoryDatabase] Failed to load history:', error)
      return this.loadJson()
    }
  }

  saveAll(data: Record<string, unknown>): { success: boolean; error?: string } {
    if (!this.db) return this.saveJson(data)
    try {
      const keys = Object.keys(data)
      const insert = this.db.prepare(
        'INSERT OR REPLACE INTO download_history (gid, task_json, completed_at, persisted_at) VALUES (?, ?, ?, ?)'
      )
      this.db.exec('BEGIN')
      try {
        for (const gid of keys) {
          const task = data[gid] as { completedAt?: number; persistedAt?: number } | null
          insert.run(
            gid,
            JSON.stringify(task ?? {}),
            Number(task?.completedAt ?? 0),
            Number(task?.persistedAt ?? 0)
          )
        }
        if (keys.length === 0) {
          this.db.exec('DELETE FROM download_history')
        } else {
          // 删除已不在渲染层集合中的记录（清空/单条删除都走全量保存）
          const placeholders = keys.map(() => '?').join(',')
          this.db.prepare(`DELETE FROM download_history WHERE gid NOT IN (${placeholders})`).run(...keys)
        }
        this.db.exec('COMMIT')
      } catch (error) {
        this.db.exec('ROLLBACK')
        throw error
      }
      return { success: true }
    } catch (error) {
      logger.error('[HistoryDatabase] Failed to save history:', error)
      return { success: false, error: String(error) }
    }
  }

  /**
   * 增量写入单条记录（INSERT OR REPLACE）。
   *
   * 渲染层每完成一个任务就有一条记录，此前渲染层把整张 Map 全量序列化后整体落盘，
   * 历史越大每次完成事件的写放大越严重。SQLite 后端下单条写入是 O(1)；JSON 回退后端
   * 仍走全量（读改写整个文件），但只在 node:sqlite 不可用的环境出现。
   */
  saveOne(gid: string, task: unknown): { success: boolean; error?: string } {
    if (!gid || typeof gid !== 'string') return { success: false, error: 'Invalid gid' }
    if (!this.db) return this.saveAll({ [gid]: task })
    try {
      const record = task as { completedAt?: number; persistedAt?: number } | null
      this.db.prepare(
        'INSERT OR REPLACE INTO download_history (gid, task_json, completed_at, persisted_at) VALUES (?, ?, ?, ?)'
      ).run(
        gid,
        JSON.stringify(task ?? {}),
        Number(record?.completedAt ?? 0),
        Number(record?.persistedAt ?? 0)
      )
      this.trimToLimit()
      return { success: true }
    } catch (error) {
      logger.error('[HistoryDatabase] Failed to save one history row:', error)
      return { success: false, error: String(error) }
    }
  }

  /** 增量删除若干 gid（分批 IN，避免超大语句）；JSON 回退后端不支持增量，由渲染层改走全量保存 */
  deleteMany(gids: string[]): { success: boolean; error?: string } {
    if (!Array.isArray(gids) || gids.length === 0) return { success: true }
    if (!this.db) return { success: false, error: 'JSON backend does not support incremental delete' }
    try {
      this.db.exec('BEGIN')
      try {
        for (let start = 0; start < gids.length; start += MAX_DELETE_BATCH) {
          const batch = gids.slice(start, start + MAX_DELETE_BATCH).filter(g => typeof g === 'string' && g)
          if (batch.length === 0) continue
          const placeholders = batch.map(() => '?').join(',')
          this.db.prepare(`DELETE FROM download_history WHERE gid IN (${placeholders})`).run(...batch)
        }
        this.db.exec('COMMIT')
      } catch (error) {
        this.db.exec('ROLLBACK')
        throw error
      }
      return { success: true }
    } catch (error) {
      logger.error('[HistoryDatabase] Failed to delete history rows:', error)
      return { success: false, error: String(error) }
    }
  }

  /** 清空全部历史（保留数据库结构与迁移标记） */
  deleteAll(): { success: boolean; error?: string } {
    if (!this.db) {
      try {
        if (this.legacyPath && fs.existsSync(this.legacyPath)) {
          fs.writeFileSync(this.legacyPath, '{}', { encoding: 'utf-8', mode: 0o600 })
        }
        return { success: true }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    }
    try {
      this.db.exec('DELETE FROM download_history')
      return { success: true }
    } catch (error) {
      logger.error('[HistoryDatabase] Failed to clear history:', error)
      return { success: false, error: String(error) }
    }
  }

  /** 超过行数上限时裁掉完成时间最旧的记录（SQLite 后端的容量管理，替代按天龄清理） */
  private trimToLimit(): void {
    if (!this.db) return
    try {
      const rows = this.db.prepare(
        'SELECT COUNT(*) AS count FROM download_history'
      ).all() as { count: number }[]
      const count = rows[0]?.count ?? 0
      if (count <= HISTORY_MAX_ROWS) return
      this.db.prepare(
        `DELETE FROM download_history WHERE gid IN (SELECT gid FROM download_history ORDER BY completed_at ASC, persisted_at ASC LIMIT ?)`
      ).run(count - HISTORY_MAX_ROWS)
      logger.info(`[HistoryDatabase] Trimmed ${count - HISTORY_MAX_ROWS} history rows to fit limit`)
    } catch (error) {
      logger.warn('[HistoryDatabase] Failed to trim history rows:', error)
    }
  }

  getStats(): { count: number; backend: 'sqlite' | 'json' } {
    if (!this.db) return { count: Object.keys(this.loadJson()).length, backend: 'json' }
    try {
      const rows = this.db.prepare('SELECT COUNT(*) AS count FROM download_history').all() as { count: number }[]
      return { count: rows[0]?.count ?? 0, backend: 'sqlite' }
    } catch {
      return { count: 0, backend: 'sqlite' }
    }
  }

  close() {
    try {
      this.db?.close()
    } catch { /* 忽略关闭失败 */ }
    this.db = null
  }

  private loadJson(): Record<string, unknown> {
    try {
      if (!this.legacyPath || !fs.existsSync(this.legacyPath)) return {}
      return JSON.parse(fs.readFileSync(this.legacyPath, 'utf-8') || '{}') as Record<string, unknown>
    } catch {
      return {}
    }
  }

  private saveJson(data: Record<string, unknown>): { success: boolean; error?: string } {
    try {
      if (!this.legacyPath) return { success: false, error: 'History storage unavailable' }
      fs.writeFileSync(this.legacyPath, JSON.stringify(data), { encoding: 'utf-8', mode: 0o600 })
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }
}
