/**
 * HistoryDatabase 的 JSON 回退后端单测。
 *
 * 主测试文件（historyDatabase.test.ts）在 node:sqlite 可用的环境下跑真 SQLite，
 * 因此 loadJson / saveJson / getStats(backend: 'json') 这些回退分支永远走不到，
 * 覆盖率上表现为整段未命中。这里让数据库路径不可用（父目录是个普通文件），
 * 构造函数里的 open() 会抛错并把 db 置空，于是整条链路走 JSON 回退——
 * 这正是旧 Electron / 老 Node 上 node:sqlite 缺失时的真实路径。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

vi.mock('electron-log', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

const { HistoryDatabase } = await import('./historyDatabase')

let tmpDir: string
let legacyPath: string
let blockedDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'history-db-json-'))
  legacyPath = path.join(tmpDir, 'persisted-tasks.json')
  // 用一个普通文件占住数据库的父目录：existsSync 为真所以不会 mkdir，
  // 随后 openSqlite 打开 "<文件>/x.db" 必然失败 → db 为 null → JSON 回退。
  blockedDir = path.join(tmpDir, 'blocked')
  fs.writeFileSync(blockedDir, 'not a directory')
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

function makeTask(gid: string, completedAt: number): Record<string, unknown> {
  return { gid, status: 'complete', completedAt, persistedAt: completedAt + 1 }
}

function readJson(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(legacyPath, 'utf-8') || '{}') as Record<string, unknown>
}

/** 构造一个只能走 JSON 回退的实例（数据库路径落在被占用的目录下） */
function openFallbackDb(legacy?: string) {
  return new HistoryDatabase(path.join(blockedDir, 'download-history.db'), legacy)
}

describe('JSON 回退后端', () => {
  it('数据库不可用时 enabled 为 false，且 getStats 报告 json 后端', () => {
    const db = openFallbackDb(legacyPath)

    expect(db.enabled).toBe(false)
    expect(db.getStats()).toEqual({ count: 0, backend: 'json' })

    db.close()
  })

  it('saveOne 退化为全量写 JSON，loadAll 能读回', () => {
    const db = openFallbackDb(legacyPath)

    expect(db.saveOne('a', makeTask('a', 1))).toEqual({ success: true })
    expect(db.saveOne('b', makeTask('b', 2))).toEqual({ success: true })

    expect(Object.keys(db.loadAll()).sort()).toEqual(['a', 'b'])
    expect(Object.keys(readJson()).sort()).toEqual(['a', 'b'])
    expect(db.getStats()).toEqual({ count: 2, backend: 'json' })

    db.close()
  })

  it('saveAll 整表覆盖：不在新集合里的旧记录被删除', () => {
    const db = openFallbackDb(legacyPath)
    db.saveOne('old', makeTask('old', 1))
    db.saveOne('keep', makeTask('keep', 2))

    expect(db.saveAll({ keep: makeTask('keep', 2) })).toEqual({ success: true })
    expect(Object.keys(db.loadAll())).toEqual(['keep'])

    db.close()
  })

  it('deleteMany 明确报 unsupported（渲染层据此改走全量保存）', () => {
    const db = openFallbackDb(legacyPath)
    db.saveOne('a', makeTask('a', 1))

    expect(db.deleteMany(['a'])).toEqual({
      success: false,
      error: 'JSON backend does not support incremental delete'
    })
    // 明确失败后记录必须原样保留，不能半删
    expect(Object.keys(db.loadAll())).toEqual(['a'])

    db.close()
  })

  it('deleteAll 把 JSON 文件写成空对象，库仍可继续使用', () => {
    const db = openFallbackDb(legacyPath)
    db.saveOne('a', makeTask('a', 1))

    expect(db.deleteAll()).toEqual({ success: true })
    expect(readJson()).toEqual({})
    expect(db.getStats().count).toBe(0)

    db.saveOne('b', makeTask('b', 2))
    expect(Object.keys(db.loadAll())).toEqual(['b'])

    db.close()
  })

  it('JSON 文件内容损坏时按空历史处理，不抛错', () => {
    fs.writeFileSync(legacyPath, '{ this is not json', 'utf-8')
    const db = openFallbackDb(legacyPath)

    expect(db.loadAll()).toEqual({})
    expect(db.getStats()).toEqual({ count: 0, backend: 'json' })

    db.close()
  })

  it('JSON 文件为空串时同样按空历史处理', () => {
    fs.writeFileSync(legacyPath, '', 'utf-8')
    const db = openFallbackDb(legacyPath)

    expect(db.loadAll()).toEqual({})
    db.close()
  })

  it('没有回退文件路径时保存失败并带出原因，不抛异常', () => {
    const db = openFallbackDb()

    const saved = db.saveOne('a', makeTask('a', 1))
    expect(saved.success).toBe(false)
    expect(saved.error).toBe('History storage unavailable')
    expect(db.loadAll()).toEqual({})

    db.close()
  })

  it('没有回退文件路径时 deleteAll 也返回成功（无需清理）', () => {
    const db = openFallbackDb()

    expect(db.deleteAll()).toEqual({ success: true })
    db.close()
  })
})
