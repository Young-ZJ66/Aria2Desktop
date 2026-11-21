import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExtensionTokenStore, MAX_TOKEN_RECORDS, TOKEN_FILE_NAME } from './extensionTokenStore'
import type { ExtensionTokenRecord } from './extensionApiCore'

/**
 * 扩展配对凭据的落盘与撤销。
 *
 * 这些用例钉住的是「撤销真的生效」与「读盘异常不会让用户被永久挡在门外」：
 * 前者是安全承诺（设置页点撤销后，旧 token 必须立刻失效），
 * 后者是可用性承诺（文件损坏时宁可要求重新配对，也不要服务起不来）。
 */
let dir: string
let filePath: string
let warn: (message: string, error?: unknown) => void

function record(overrides: Partial<ExtensionTokenRecord> = {}): ExtensionTokenRecord {
  return {
    token: 'ext_' + 'a'.repeat(43),
    scopes: ['tasks:read'],
    extensionId: 'ndikflbmajhflfndbjblihkifnfbmdon',
    extensionName: 'Aria2 Desktop Helper',
    origin: 'chrome-extension://ndikflbmajhflfndbjblihkifnfbmdon',
    createdAt: 1_700_000_000_000,
    ...overrides
  }
}

function store(): ExtensionTokenStore {
  return new ExtensionTokenStore(filePath, { warn })
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aria2-ext-token-'))
  filePath = path.join(dir, TOKEN_FILE_NAME)
  warn = vi.fn() as unknown as (message: string, error?: unknown) => void
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('ExtensionTokenStore 读取', () => {
  it('文件不存在时按「没有已配对扩展」处理，且不刷警告', () => {
    expect(store().list()).toEqual([])
    expect(warn).not.toHaveBeenCalled()
  })

  it('文件损坏时返回空列表并记警告（不让服务起不来）', () => {
    fs.writeFileSync(filePath, '{ not json', 'utf8')
    expect(store().list()).toEqual([])
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('丢弃形态不合法的记录，只保留 token 是字符串且 scopes 是数组的', () => {
    const good = record()
    fs.writeFileSync(filePath, JSON.stringify([good, { token: 1 }, { token: 'x' }, null, { scopes: [] }]), 'utf8')
    expect(store().list()).toEqual([good])
  })

  it('文件被外部改写后重新读取（端到端脚本、设置导入会直接改这个文件）', () => {
    const s = store()
    expect(s.list()).toEqual([])
    const added = record()
    fs.writeFileSync(filePath, JSON.stringify([added]), 'utf8')
    expect(s.list()).toEqual([added])
  })
})

describe('ExtensionTokenStore 新增与淘汰', () => {
  it('新增记录后落盘，权限为仅属主可读写', () => {
    const s = store()
    s.add(record())
    const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    expect(onDisk).toHaveLength(1)
    if (process.platform !== 'win32') {
      expect(fs.statSync(filePath).mode & 0o777).toBe(0o600)
    }
  })

  it('同一扩展重复配对时替换旧记录（旧 token 立即失效）', () => {
    const s = store()
    s.add(record({ token: 'ext_' + 'a'.repeat(43) }))
    s.add(record({ token: 'ext_' + 'b'.repeat(43) }))
    const rows = s.list()
    expect(rows).toHaveLength(1)
    expect(rows[0].token).toBe('ext_' + 'b'.repeat(43))
  })

  it(`最多保留 ${MAX_TOKEN_RECORDS} 条，新配对的排在最前`, () => {
    const s = store()
    for (let i = 0; i < MAX_TOKEN_RECORDS + 5; i++) {
      s.add(record({ token: 'ext_' + String(i).padStart(43, '0'), extensionId: `ext-${i}` }))
    }
    const rows = s.list()
    expect(rows).toHaveLength(MAX_TOKEN_RECORDS)
    expect(rows[0].extensionId).toBe(`ext-${MAX_TOKEN_RECORDS + 4}`)
  })
})

describe('ExtensionTokenStore 撤销', () => {
  it('按值撤销命中时返回 true 并落盘', () => {
    const s = store()
    const target = record()
    s.add(target)
    expect(s.revoke(target.token)).toBe(true)
    expect(store().list()).toEqual([])
  })

  it('撤销不存在的 token 返回 false 且不改文件', () => {
    const s = store()
    s.add(record())
    const before = fs.readFileSync(filePath, 'utf8')
    expect(s.revoke('ext_' + 'z'.repeat(43))).toBe(false)
    expect(fs.readFileSync(filePath, 'utf8')).toBe(before)
  })

  it('按扩展撤销全部凭据，返回撤销条数', () => {
    const s = store()
    s.add(record({ extensionId: 'ext-a', token: 'ext_' + 'a'.repeat(43) }))
    s.add(record({ extensionId: 'ext-b', token: 'ext_' + 'b'.repeat(43) }))
    expect(s.revokeExtension('ext-a')).toBe(1)
    expect(s.list().map((row) => row.extensionId)).toEqual(['ext-b'])
  })

  it('按扩展撤销无命中时返回 0', () => {
    const s = store()
    s.add(record({ extensionId: 'ext-a' }))
    expect(s.revokeExtension('ext-zzz')).toBe(0)
  })
})

describe('ExtensionTokenStore lastSeenAt', () => {
  it('首次调用写入 lastSeenAt', () => {
    const s = store()
    const target = record()
    s.add(target)
    s.touch(target.token)
    const rows = store().list()
    expect(typeof rows[0].lastSeenAt).toBe('number')
    expect(rows[0].lastSeenAt as number).toBeGreaterThan(0)
  })

  it('一分钟内重复调用不重写文件（避免每次扩展请求都落盘）', () => {
    const s = store()
    const target = record()
    s.add(target)
    s.touch(target.token)
    const first = fs.readFileSync(filePath, 'utf8')
    const stamp = fs.statSync(filePath).mtimeMs
    s.touch(target.token)
    expect(fs.readFileSync(filePath, 'utf8')).toBe(first)
    expect(fs.statSync(filePath).mtimeMs).toBe(stamp)
  })

  it('超过一分钟再次调用会刷新 lastSeenAt', () => {
    const s = store()
    const target = record({ lastSeenAt: 1 })
    s.add(target)
    s.touch(target.token)
    expect(store().list()[0].lastSeenAt as number).toBeGreaterThan(1)
  })

  it('token 不存在时什么都不做', () => {
    const s = store()
    s.add(record())
    const before = fs.readFileSync(filePath, 'utf8')
    s.touch('ext_' + 'z'.repeat(43))
    expect(fs.readFileSync(filePath, 'utf8')).toBe(before)
  })
})

describe('落盘失败的兜底', () => {
  it('写临时文件失败时只记警告，不抛出', () => {
    // 让 .tmp 路径先成为目录：writeFileSync 会以 EISDIR 失败，走到 flush 的 catch
    fs.mkdirSync(`${filePath}.tmp`)
    const s = store()

    expect(() => s.add(record())).not.toThrow()

    expect(warn).toHaveBeenCalledWith('写入扩展配对记录失败:', expect.any(Error))
  })
})
