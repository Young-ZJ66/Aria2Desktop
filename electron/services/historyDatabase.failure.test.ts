/**
 * HistoryDatabase 的 SQLite 失败路径单测。
 *
 * 主测试文件跑真 SQLite，只覆盖"一切正常"的语义；但这份代码真正的风险在
 * 出错之后：写库失败会不会留下半截事务、裁剪失败会不会连累整次保存、
 * 查询失败会不会把用户历史清空。这些分支真实环境很难触发（要磁盘满 / 库损坏），
 * 这里用一个可控的假 db 句柄把它们逐条钉住。
 *
 * 构造时让数据库路径落在被普通文件占住的目录下（同 historyDatabase.fallback.test.ts），
 * 于是 open() 失败、db 为 null，再把假句柄塞进实例——全程不碰真 SQLite 文件。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import logger from 'electron-log'

vi.mock('electron-log', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

const { HistoryDatabase, HISTORY_MAX_ROWS } = await import('./historyDatabase')

interface FakeCalls {
  exec: string[]
  prepare: string[]
  run: { sql: string; params: unknown[] }[]
}

interface FakeOptions {
  /** 查询结果（COUNT(*) 之类） */
  rows?: unknown[]
  /** all() 抛错，模拟库损坏 */
  allThrows?: boolean
  /** exec 命中时抛错 */
  execThrows?: (sql: string) => boolean
  /** prepare 命中时抛错 */
  prepareThrows?: (sql: string) => boolean
  /** run 命中时抛错 */
  runThrows?: (sql: string) => boolean
}

function makeFakeDb(options: FakeOptions = {}) {
  const calls: FakeCalls = { exec: [], prepare: [], run: [] }
  const db = {
    exec: (sql: string) => {
      calls.exec.push(sql)
      if (options.execThrows?.(sql)) throw new Error('exec boom')
    },
    prepare: (sql: string) => {
      calls.prepare.push(sql)
      if (options.prepareThrows?.(sql)) throw new Error('prepare boom')
      return {
        run: (...params: unknown[]) => {
          calls.run.push({ sql, params })
          if (options.runThrows?.(sql)) throw new Error('run boom')
          return {}
        },
        all: () => {
          if (options.allThrows) throw new Error('all boom')
          return options.rows ?? []
        }
      }
    },
    close: () => {}
  }
  return { db, calls }
}

let tmpDir: string
let blockedDir: string
let legacyPath: string

beforeEach(() => {
  vi.clearAllMocks()
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'history-db-failure-'))
  legacyPath = path.join(tmpDir, 'persisted-tasks.json')
  // 普通文件占住父目录：open() 必然失败 → db 为 null，随后由用例注入假句柄
  blockedDir = path.join(tmpDir, 'blocked')
  fs.writeFileSync(blockedDir, 'not a directory')
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

/** 打开一个 db 为 null 的实例（不触碰真 SQLite），再把假句柄塞进去 */
function openWithFakeDb(options: FakeOptions = {}, legacy?: string) {
  const instance = new HistoryDatabase(path.join(blockedDir, 'download-history.db'), legacy)
  const fake = makeFakeDb(options)
  ;(instance as unknown as { db: unknown }).db = fake.db
  return { instance, calls: fake.calls }
}

/** 打开一个真正的 JSON 回退实例（db 保持 null） */
function openFallbackDb(legacy?: string) {
  return new HistoryDatabase(path.join(blockedDir, 'download-history.db'), legacy)
}

describe('saveAll 的事务与错误处理', () => {
  it('写入中途失败时回滚，并把错误传给调用方', () => {
    const { instance, calls } = openWithFakeDb({ runThrows: sql => sql.includes('INSERT OR REPLACE') })

    const result = instance.saveAll({ g1: { gid: 'g1', completedAt: 1 } })

    expect(result.success).toBe(false)
    expect(result.error).toContain('run boom')
    // BEGIN 之后必须 ROLLBACK：否则一次失败会在库里留下半批行
    expect(calls.exec).toContain('BEGIN')
    expect(calls.exec).toContain('ROLLBACK')
    expect(calls.exec).not.toContain('COMMIT')
    expect(logger.error).toHaveBeenCalledWith('[HistoryDatabase] Failed to save history:', expect.any(Error))
  })

  it('写入空集合时整表清空（清空历史走的就是这条）', () => {
    const { instance, calls } = openWithFakeDb()

    expect(instance.saveAll({})).toEqual({ success: true })
    expect(calls.exec).toContain('DELETE FROM download_history')
    expect(calls.exec).toContain('COMMIT')
  })

  it('裁剪失败只记警告，不影响本次保存的成功结果', () => {
    // 容量管理是尽力而为：裁不掉旧行时宁可留着，也不能让用户这次保存失败
    const { instance } = openWithFakeDb({ allThrows: true })

    expect(instance.saveAll({ g1: { gid: 'g1' } })).toEqual({ success: true })
    expect(logger.warn).toHaveBeenCalledWith('[HistoryDatabase] Failed to trim history rows:', expect.any(Error))
  })
})

describe('trimToLimit 的容量管理', () => {
  it('超过上限时按完成时间删掉最旧的若干行', () => {
    const over = HISTORY_MAX_ROWS + 3
    const { instance, calls } = openWithFakeDb({ rows: [{ count: over }] })

    instance.saveAll({})

    const trim = calls.run.find(call => call.sql.includes('ORDER BY completed_at ASC'))
    expect(trim?.params).toEqual([3])
    expect(logger.info).toHaveBeenCalledWith(
      `[HistoryDatabase] Trimmed 3 history rows to fit limit`
    )
  })

  it('未超过上限时不做任何删除', () => {
    const { instance, calls } = openWithFakeDb({ rows: [{ count: 10 }] })

    instance.saveAll({})

    expect(calls.run.some(call => call.sql.includes('ORDER BY completed_at ASC'))).toBe(false)
  })

  it('saveOne 每写 128 条才裁一次，避免单条写入都跑全表聚合', () => {
    const { instance, calls } = openWithFakeDb({ rows: [{ count: 0 }] })

    for (let index = 0; index < 128; index++) {
      expect(instance.saveOne('g' + index, { gid: 'g' + index }).success).toBe(true)
    }

    const countQueries = calls.prepare.filter(sql => sql.includes('SELECT COUNT(*)'))
    expect(countQueries).toHaveLength(1)
  })

  it('saveOne 写库失败时返回错误而不抛', () => {
    const { instance } = openWithFakeDb({ runThrows: sql => sql.includes('INSERT OR REPLACE') })

    const result = instance.saveOne('g1', { gid: 'g1' })

    expect(result.success).toBe(false)
    expect(result.error).toContain('run boom')
    expect(logger.error).toHaveBeenCalledWith('[HistoryDatabase] Failed to save one history row:', expect.any(Error))
  })
})

describe('deleteMany 与 deleteAll 的失败路径', () => {
  it('非字符串 gid 过滤后为空则整批跳过', () => {
    const { instance, calls } = openWithFakeDb()

    expect(instance.deleteMany(['', 5 as unknown as string]).success).toBe(true)
    expect(calls.run.some(call => call.sql.includes('DELETE FROM download_history WHERE gid IN'))).toBe(false)
  })

  it('删除中途失败时回滚并返回错误', () => {
    const { instance, calls } = openWithFakeDb({ runThrows: sql => sql.includes('DELETE FROM download_history WHERE gid IN') })

    const result = instance.deleteMany(['a', 'b'])

    expect(result.success).toBe(false)
    expect(calls.exec).toContain('ROLLBACK')
    expect(logger.error).toHaveBeenCalledWith('[HistoryDatabase] Failed to delete history rows:', expect.any(Error))
  })

  it('清空失败时返回错误', () => {
    const { instance } = openWithFakeDb({ execThrows: sql => sql.includes('DELETE FROM download_history') })

    const result = instance.deleteAll()

    expect(result.success).toBe(false)
    expect(result.error).toContain('exec boom')
    expect(logger.error).toHaveBeenCalledWith('[HistoryDatabase] Failed to clear history:', expect.any(Error))
  })

  it('getStats 查询失败时回落 0 行，而不是把异常抛给状态页', () => {
    const { instance } = openWithFakeDb({ allThrows: true })

    expect(instance.getStats()).toEqual({ count: 0, backend: 'sqlite' })
  })
})

describe('loadAll 的容错', () => {
  it('单条记录 JSON 损坏时跳过该条，其余照常返回', () => {
    const { instance } = openWithFakeDb({
      rows: [
        { gid: 'ok', task_json: '{"gid":"ok"}' },
        { gid: 'bad', task_json: '{oops' }
      ]
    })

    expect(instance.loadAll()).toEqual({ ok: { gid: 'ok' } })
  })

  it('查询失败时退回 JSON 文件，不清空历史', () => {
    fs.writeFileSync(legacyPath, JSON.stringify({ legacy: { gid: 'legacy' } }))
    const { instance } = openWithFakeDb({ prepareThrows: sql => sql.includes('SELECT gid, task_json') }, legacyPath)

    expect(instance.loadAll()).toEqual({ legacy: { gid: 'legacy' } })
    expect(logger.error).toHaveBeenCalledWith('[HistoryDatabase] Failed to load history:', expect.any(Error))
  })
})

describe('JSON 回退后端的写盘失败', () => {
  it('清空时写盘失败返回错误', () => {
    // legacyPath 指向目录：existsSync 为真，writeFileSync 必然失败
    const dir = path.join(tmpDir, 'legacy-dir')
    fs.mkdirSync(dir)
    const instance = openFallbackDb(dir)

    const result = instance.deleteAll()

    expect(result.success).toBe(false)
    expect(result.error).toContain('EISDIR')
  })

  it('全量保存写盘失败返回错误', () => {
    const dir = path.join(tmpDir, 'legacy-dir-2')
    fs.mkdirSync(dir)
    const instance = openFallbackDb(dir)

    const result = instance.saveAll({ a: { gid: 'a' } })

    expect(result.success).toBe(false)
    expect(result.error).toContain('EISDIR')
  })

  it('没有 SQLite 句柄时容量裁剪直接跳过', () => {
    // JSON 回退后端由 saveJson 自己控制大小，trimToLimit 必须在入口就退出
    const instance = openFallbackDb(path.join(tmpDir, 'legacy-none.json'))

    expect(instance.enabled).toBe(false)
    expect(() => (instance as unknown as { trimToLimit: () => void }).trimToLimit()).not.toThrow()
  })
})

describe('旧数据迁移的边界', () => {
  it('旧文件是空对象时不导入、也不改名', () => {
    fs.writeFileSync(legacyPath, '{}')
    const { instance } = openWithFakeDb({ rows: [{ count: 0 }] }, legacyPath)

    ;(instance as unknown as { migrateLegacy: () => void }).migrateLegacy()

    expect(fs.existsSync(legacyPath)).toBe(true)
    expect(fs.existsSync(legacyPath + '.migrated')).toBe(false)
  })

  it('旧文件损坏时只记警告，文件保留待人工处理', () => {
    fs.writeFileSync(legacyPath, '{oops')
    const { instance } = openWithFakeDb({ rows: [{ count: 0 }] }, legacyPath)

    ;(instance as unknown as { migrateLegacy: () => void }).migrateLegacy()

    expect(logger.warn).toHaveBeenCalledWith('[HistoryDatabase] Legacy migration failed:', expect.any(Error))
    expect(fs.existsSync(legacyPath)).toBe(true)
  })
})
