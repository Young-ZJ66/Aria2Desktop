import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

// 这组用例专盯"网络与磁盘出问题时"的分支：重定向、超时、Range 不认账、
// 段数据不足、写盘失败、缓存底版被截断、缓存过期/非法、清理失败。
// 正常路径已由 deltaUpdater.test.ts 用真实本地 HTTPS 服务覆盖。
const state = vi.hoisted(() => ({
  userData: '',
  plan: [] as Array<Record<string, unknown>>,
  requests: [] as Array<Record<string, unknown>>,
  failWrite: false,
  failWriteAt: 0,
  writeCalls: 0,
  failRead: false,
  logs: { info: [] as string[], warn: [] as string[], error: [] as string[] }
}))

vi.mock('electron', () => ({
  app: { getPath: (name: string): string => (name === 'userData' ? state.userData : '') }
}))

vi.mock('../utils/logger', () => ({
  createLogger: () => ({
    info: (...args: unknown[]): void => { state.logs.info.push(args.map(String).join(' ')) },
    warn: (...args: unknown[]): void => { state.logs.warn.push(args.map(String).join(' ')) },
    error: (...args: unknown[]): void => { state.logs.error.push(args.map(String).join(' ')) },
    debug: (): void => undefined
  })
}))

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  const open = async (target: fs.PathLike, flags?: string | number): Promise<fs.promises.FileHandle> => {
    const handle = await actual.promises.open(target, flags as string)
    if ((state.failWrite || state.failWriteAt > 0) && flags === 'w') {
      const fake = {
        write: async (): Promise<{ bytesWritten: number }> => {
          state.writeCalls += 1
          if (state.failWrite || state.writeCalls >= state.failWriteAt) {
            throw new Error('ENOSPC: no space left on device')
          }
          return { bytesWritten: 0 }
        },
        close: (): Promise<void> => handle.close()
      }
      return fake as unknown as fs.promises.FileHandle
    }
    if (state.failRead && flags === 'r') {
      const fake = {
        read: async (): Promise<{ bytesRead: number; buffer: Buffer }> => ({ bytesRead: 0, buffer: Buffer.alloc(0) }),
        close: (): Promise<void> => handle.close()
      }
      return fake as unknown as fs.promises.FileHandle
    }
    return handle
  }
  return { ...actual, promises: { ...actual.promises, open } }
})

vi.mock('https', async (importOriginal) => {
  const actual = await importOriginal<typeof import('https')>()
  const { EventEmitter } = await import('events')

  class FakeRes extends EventEmitter {
    statusCode = 200
    headers: Record<string, string> = {}
    resume(): void { /* 丢弃响应体 */ }
    destroy(): void { /* 无真实套接字 */ }
  }

  class FakeReq extends EventEmitter {
    onTimeout: (() => void) | null = null
    callback: ((res: FakeRes) => void) | null = null
    setTimeout(_ms: number, cb: () => void): void { this.onTimeout = cb }
    destroy(err?: Error): void { if (err) this.emit('error', err) }
    end(): void { queueMicrotask(() => dispatch(this)) }
  }

  const dispatch = (req: FakeReq): void => {
    const entry = state.plan.shift()
    if (!entry) {
      req.emit('error', new Error('no scripted response'))
      return
    }
    if (entry.kind === 'timeout') {
      req.onTimeout?.()
      return
    }
    const res = new FakeRes()
    // 状态码与响应头必须在回调之前就位：fetchRange 在回调里同步读 statusCode / content-range
    if (entry.kind === 'redirect') {
      res.statusCode = 302
      res.headers = { location: String(entry.location) }
      req.callback?.(res)
      return
    }
    if (entry.kind === 'status') {
      res.statusCode = Number(entry.status)
      req.callback?.(res)
      return
    }
    res.statusCode = Number(entry.status ?? 200)
    res.headers = (entry.headers as Record<string, string> | undefined) ?? {}
    req.callback?.(res)
    queueMicrotask(() => {
      if (entry.body !== undefined) res.emit('data', Buffer.from(String(entry.body)))
      if (entry.data !== undefined) res.emit('data', Buffer.from(entry.data as Buffer))
      if (entry.data2 !== undefined) res.emit('data', Buffer.from(entry.data2 as Buffer))
      res.emit('end')
    })
  }

  const request = (options: unknown, callback?: (res: FakeRes) => void): FakeReq => {
    state.requests.push(options as Record<string, unknown>)
    const req = new FakeReq()
    req.callback = callback ?? null
    return req
  }

  return { ...actual, request: request as unknown as typeof actual.request }
})

import { discardDeltaCache, downloadDelta, getDeltaCacheDir, saveDeltaCache } from './deltaUpdater'
import { planDelta, type DeltaBlockTable } from '../utils/deltaBlocks'

const BLOCK = 1024
const COUNT = 8

function sha256hex(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

function makeTable(version: string, buf: Buffer, blockSize: number): DeltaBlockTable {
  const blocks = []
  for (let offset = 0; offset < buf.length; offset += blockSize) {
    const end = Math.min(offset + blockSize, buf.length)
    blocks.push({ offset, size: end - offset, sha256: sha256hex(buf.subarray(offset, end)) })
  }
  return { version, size: buf.length, blockSize, blocks }
}

const oldBuf = crypto.randomBytes(BLOCK * COUNT)
// 新版 = 前半与旧包逐字节相同（本地复制），后半全新（远端 Range 下载）
const newBuf = Buffer.from(oldBuf)
crypto.randomBytes(BLOCK * COUNT / 2).copy(newBuf, BLOCK * COUNT / 2)
const oldTable = makeTable('1.2.0-x64', oldBuf, BLOCK)
const newTable = makeTable('1.2.1-x64', newBuf, BLOCK)

const NEW_URL = 'https://example.test/Aria2Desktop-1.2.1-x64-Setup.exe'

function workDir(): string {
  return path.join(state.userData, 'work')
}

function seedCache(buf: Buffer, table: DeltaBlockTable): void {
  const dir = getDeltaCacheDir()
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'cached-setup.exe'), buf)
  fs.writeFileSync(path.join(dir, 'cached-blocks.json'), JSON.stringify(table))
}

function tableBody(): Record<string, unknown> {
  return { kind: 'body', body: JSON.stringify(newTable) }
}

function rangeEntries(): Array<Record<string, unknown>> {
  const plan = planDelta(oldTable, newTable)
  const out: Array<Record<string, unknown>> = []
  for (const op of plan.ops) {
    if (op.source.type !== 'remote') continue
    const start = op.source.offset
    out.push({
      kind: 'range',
      status: 206,
      headers: { 'content-range': 'bytes ' + start + '-' + (start + op.size - 1) + '/' + newBuf.length },
      data: newBuf.subarray(start, start + op.size)
    })
  }
  return out
}

function targetPath(): string {
  return path.join(workDir(), 'target.exe')
}

describe('deltaUpdater 失败路径（脚本化的 https 响应）', () => {
  beforeEach(() => {
    state.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'delta-cov-'))
    fs.mkdirSync(workDir(), { recursive: true })
    state.plan = []
    state.requests = []
    state.failWrite = false
    state.failWriteAt = 0
    state.writeCalls = 0
    state.failRead = false
    state.logs = { info: [], warn: [], error: [] }
  })

  afterEach(() => {
    fs.rmSync(state.userData, { recursive: true, force: true })
  })

  it('块表 302 到 CDN 时会跟随重定向并继续组装', async () => {
    seedCache(oldBuf, oldTable)
    state.plan = [
      { kind: 'redirect', location: '/cdn/blocks.json' },
      tableBody(),
      ...rangeEntries()
    ]
    const result = await downloadDelta({ installerUrl: NEW_URL, newVersion: '1.2.1-x64', targetPath: targetPath() })
    expect(result.totalSize).toBe(newBuf.length)
    expect(fs.readFileSync(targetPath()).equals(newBuf)).toBe(true)
    expect(state.requests).toHaveLength(2 + rangeEntries().length)
    expect(String(state.requests[0].path)).toBe('/Aria2Desktop-1.2.1-x64-Setup.exe.blocks.json')
    expect(String(state.requests[1].path)).toBe('/cdn/blocks.json')
  })

  it('重定向超过上限就放弃，不再继续请求', async () => {
    seedCache(oldBuf, oldTable)
    state.plan = [1, 2, 3, 4, 5, 6].map((i) => ({ kind: 'redirect', location: '/hop' + i }))
    await expect(downloadDelta({ installerUrl: NEW_URL, newVersion: '1.2.1-x64', targetPath: targetPath() }))
      .rejects.toThrow(/Too many redirects/)
    expect(state.requests).toHaveLength(6)
  })

  it('块表请求返回 500 时报 Fetch failed 而不是继续组装', async () => {
    seedCache(oldBuf, oldTable)
    state.plan = [{ kind: 'status', status: 500 }]
    await expect(downloadDelta({ installerUrl: NEW_URL, newVersion: '1.2.1-x64', targetPath: targetPath() }))
      .rejects.toThrow(/Fetch failed: 500/)
    expect(fs.existsSync(targetPath())).toBe(false)
  })

  it('块表请求超时会中止而不是挂住', async () => {
    seedCache(oldBuf, oldTable)
    state.plan = [{ kind: 'timeout' }]
    await expect(downloadDelta({ installerUrl: NEW_URL, newVersion: '1.2.1-x64', targetPath: targetPath() }))
      .rejects.toThrow(/Fetch timed out/)
  })

  it('Range 请求超时会中止整次差量下载', async () => {
    seedCache(oldBuf, oldTable)
    const ranges = rangeEntries()
    state.plan = [tableBody(), { kind: 'timeout' }, ...ranges.slice(1)]
    await expect(downloadDelta({ installerUrl: NEW_URL, newVersion: '1.2.1-x64', targetPath: targetPath() }))
      .rejects.toThrow(/Range fetch timed out/)
  })

  it('Range 请求跟随 302 时仍然携带 Range 头', async () => {
    seedCache(oldBuf, oldTable)
    const ranges = rangeEntries()
    state.plan = [tableBody(), { kind: 'redirect', location: '/cdn/setup.exe' }, ...ranges]
    await downloadDelta({ installerUrl: NEW_URL, newVersion: '1.2.1-x64', targetPath: targetPath() })
    const redirected = state.requests[2]
    expect(String(redirected.path)).toBe('/cdn/setup.exe')
    expect(String((redirected.headers as Record<string, string>).Range)).toMatch(/^bytes=\d+-\d+$/)
    expect(fs.readFileSync(targetPath()).equals(newBuf)).toBe(true)
  })

  it('content-range 起点与请求不一致时拒绝使用这段数据', async () => {
    seedCache(oldBuf, oldTable)
    state.plan = [
      tableBody(),
      { kind: 'range', status: 206, headers: { 'content-range': 'bytes 999-1999/' + newBuf.length }, data: newBuf.subarray(0, 100) }
    ]
    await expect(downloadDelta({ installerUrl: NEW_URL, newVersion: '1.2.1-x64', targetPath: targetPath() }))
      .rejects.toThrow(/Range response start mismatch/)
  })

  it('段数据不足时报 Range segment incomplete，不把半截包当成功', async () => {
    seedCache(oldBuf, oldTable)
    const ranges = rangeEntries()
    const first = ranges[0]
    const short = (first.data as Buffer).subarray(0, 10)
    state.plan = [tableBody(), { ...first, data: short }, ...ranges.slice(1)]
    await expect(downloadDelta({ installerUrl: NEW_URL, newVersion: '1.2.1-x64', targetPath: targetPath() }))
      .rejects.toThrow(/Range segment incomplete/)
  })

  it('写盘失败时整次组装失败（调用方回落全量）', async () => {
    seedCache(oldBuf, oldTable)
    state.failWrite = true
    state.plan = [tableBody(), ...rangeEntries()]
    await expect(downloadDelta({ installerUrl: NEW_URL, newVersion: '1.2.1-x64', targetPath: targetPath() }))
      .rejects.toThrow(/ENOSPC/)
  })

  it('缓存底版被截断时报 Cached installer truncated', async () => {
    seedCache(oldBuf, oldTable)
    state.failRead = true
    state.plan = [tableBody(), ...rangeEntries()]
    await expect(downloadDelta({ installerUrl: NEW_URL, newVersion: '1.2.1-x64', targetPath: targetPath() }))
      .rejects.toThrow(/Cached installer truncated/)
  })

  it('缓存块表是合法 JSON 但不是块表 → 自愈清理后按 no_cache 处理', async () => {
    const dir = getDeltaCacheDir()
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'cached-setup.exe'), oldBuf)
    fs.writeFileSync(path.join(dir, 'cached-blocks.json'), JSON.stringify({ version: '1.2.0-x64' }))
    await expect(downloadDelta({ installerUrl: NEW_URL, newVersion: '1.2.1-x64', targetPath: targetPath() }))
      .rejects.toThrow(/no_cache/)
    expect(fs.readdirSync(dir)).toEqual([])
    expect(state.logs.info.join(' ')).toContain('缓存块表非法')
  })

  it('缓存超过 90 天 → 自愈清理', async () => {
    seedCache(oldBuf, oldTable)
    const stale = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000)
    fs.utimesSync(path.join(getDeltaCacheDir(), 'cached-setup.exe'), stale, stale)
    await expect(downloadDelta({ installerUrl: NEW_URL, newVersion: '1.2.1-x64', targetPath: targetPath() }))
      .rejects.toThrow(/no_cache/)
    expect(fs.readdirSync(getDeltaCacheDir())).toEqual([])
    expect(state.logs.info.join(' ')).toContain('差量缓存已过期')
  })

  it('清理缓存失败只记日志，不把错误抛给调用方', async () => {
    const dir = getDeltaCacheDir()
    fs.mkdirSync(path.join(dir, 'cached-setup.exe'), { recursive: true })
    await expect(discardDeltaCache()).resolves.toBeUndefined()
    expect(state.logs.warn.join(' ')).toContain('清理差量缓存失败')
  })

  it('saveDeltaCache 在远端块表不是 JSON 时报 bad_blocks_json', async () => {
    const installer = path.join(workDir(), 'setup.exe')
    fs.writeFileSync(installer, newBuf)
    state.plan = [{ kind: 'body', body: 'not json {' }]
    await expect(saveDeltaCache(installer, '1.2.1-x64', NEW_URL)).rejects.toThrow(/bad_blocks_json/)
    expect(fs.existsSync(path.join(getDeltaCacheDir(), 'cached-setup.exe'))).toBe(false)
  })

  it('saveDeltaCache 在块表结构非法时报 invalid_blocks_table', async () => {
    const installer = path.join(workDir(), 'setup.exe')
    fs.writeFileSync(installer, newBuf)
    state.plan = [{ kind: 'body', body: JSON.stringify({ version: '1.2.1-x64' }) }]
    await expect(saveDeltaCache(installer, '1.2.1-x64', NEW_URL)).rejects.toThrow(/invalid_blocks_table/)
  })

  it('saveDeltaCache 在块表版本不符时报 blocks_version_mismatch', async () => {
    const installer = path.join(workDir(), 'setup.exe')
    fs.writeFileSync(installer, newBuf)
    state.plan = [tableBody()]
    await expect(saveDeltaCache(installer, '1.2.9-x64', NEW_URL)).rejects.toThrow(/blocks_version_mismatch/)
  })

  it('saveDeltaCache 成功时把安装包与块表一起落到缓存目录', async () => {
    const installer = path.join(workDir(), 'setup.exe')
    fs.writeFileSync(installer, newBuf)
    state.plan = [tableBody()]
    await saveDeltaCache(installer, '1.2.1-x64', NEW_URL)
    expect(fs.readdirSync(getDeltaCacheDir()).sort()).toEqual(['cached-blocks.json', 'cached-setup.exe'])
    expect(fs.readFileSync(path.join(getDeltaCacheDir(), 'cached-setup.exe')).equals(newBuf)).toBe(true)
  })

  it('Range 请求连续重定向超过上限就放弃（块表已取到）', async () => {
    seedCache(oldBuf, oldTable)
    state.plan = [tableBody(), ...[1, 2, 3, 4, 5, 6].map((i) => ({ kind: 'redirect', location: '/hop' + i }))]
    await expect(downloadDelta({ installerUrl: NEW_URL, newVersion: '1.2.1-x64', targetPath: targetPath() }))
      .rejects.toThrow(/Too many redirects/)
    // 1 次块表 + 6 次 Range 请求，第 7 次在发起前就被拦下
    expect(state.requests).toHaveLength(7)
  })

  it('同一段里第二个分片写盘失败时整段作废并停止后续写入', async () => {
    seedCache(oldBuf, oldTable)
    const ranges = rangeEntries()
    const first = ranges[0]
    const payload = first.data as Buffer
    const half = Math.floor(payload.length / 2)
    state.failWriteAt = 2
    state.plan = [
      tableBody(),
      { ...first, data: payload.subarray(0, half), data2: payload.subarray(half) },
      ...ranges.slice(1)
    ]
    await expect(downloadDelta({ installerUrl: NEW_URL, newVersion: '1.2.1-x64', targetPath: targetPath() }))
      .rejects.toThrow(/ENOSPC/)
    expect(state.writeCalls).toBe(2)
  })
})
