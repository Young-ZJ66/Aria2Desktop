import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as http from 'http'
import * as https from 'https'
import * as os from 'os'
import * as path from 'path'
import type { AddressInfo } from 'net'

// userData 指到测试自己的临时目录（getDeltaCacheDir = userData/updates）
const state = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({
  app: { getPath: (name: string): string => (name === 'userData' ? state.userData : '') }
}))
vi.mock('../utils/logger', () => ({
  createLogger: (): Record<string, ReturnType<typeof vi.fn>> => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn()
  })
}))

// deltaUpdater 用 https.request 且不透出注入 CA 的口子：给 request 统一包一层
// rejectUnauthorized: false（证书是一次性的本地测试材料，只用于 127.0.0.1）。
// ESM 命名空间不可 spy，只能整模块 mock。
vi.mock('https', async (importOriginal) => {
  const actual = await importOriginal<typeof import('https')>()
  const realRequest = actual.request.bind(actual)
  const wrapped = (options: https.RequestOptions | string | URL, callback?: (res: http.IncomingMessage) => void): http.ClientRequest => {
    if (typeof options !== 'string' && !(options instanceof URL)) {
      return realRequest({ ...options, rejectUnauthorized: false }, callback)
    }
    return realRequest(options as https.RequestOptions, callback)
  }
  return { ...actual, request: wrapped as unknown as typeof actual.request }
})

import { discardDeltaCache, downloadDelta, getDeltaCacheDir, saveDeltaCache } from './deltaUpdater'
import type { DeltaBlockTable } from '../utils/deltaBlocks'

const BLOCK = 4096
const COUNT = 24
const NEW_NAME = 'Aria2Desktop-1.2.1-x64-Setup.exe'
const OLD_NAME = 'Aria2Desktop-1.2.0-x64-Setup.exe'

function sha256hex(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

function makeTable(version: string, buf: Buffer, blockSize: number): DeltaBlockTable {
  const blocks = []
  for (let offset = 0; offset < buf.length; offset += blockSize) {
    const end = Math.min(offset + blockSize, buf.length)
    blocks.push({ offset, size: end - offset, sha256: sha256hex(buf.subarray(offset, end)) })
  }
  return {
    version,
    size: buf.length,
    format: 2,
    chunking: 'cdc',
    avgBlockSize: blockSize,
    blocks
  }
}

describe('deltaUpdater（本地 HTTPS 服务端到端）', () => {
  const oldBuf = crypto.randomBytes(BLOCK * COUNT)
  // 新包 = 前一半与旧包逐字节相同，后一半全新 → 前一半本地复制、后一半远端下载
  const newBuf = Buffer.from(oldBuf)
  crypto.randomBytes(BLOCK * COUNT / 2).copy(newBuf, BLOCK * COUNT / 2)
  const oldTable = makeTable('1.2.0-x64', oldBuf, BLOCK)
  const newTable = makeTable('1.2.1-x64', newBuf, BLOCK)

  let server: https.Server | undefined
  let port = 0
  let blocksPayloadForNew: string = JSON.stringify(newTable)
  let rangeMode: 'honored' | 'ignored' = 'honored'
  const workDirs: string[] = []

  function currentWorkDir(): string {
    return path.join(state.userData, 'work')
  }

  beforeAll(async () => {
    // 证书生成命令（一次性测试材料，重签时执行即可）：
    // openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
    //   -keyout electron/services/__fixtures__/delta-test-key.pem \
    //   -out electron/services/__fixtures__/delta-test-cert.pem \
    //   -subj "//CN=127.0.0.1" -addext "subjectAltName=IP:127.0.0.1"
    const cert = fs.readFileSync(path.join(__dirname, '__fixtures__', 'delta-test-cert.pem'))
    const key = fs.readFileSync(path.join(__dirname, '__fixtures__', 'delta-test-key.pem'))
    server = https.createServer({ cert, key }, (req, res) => {
      const url = req.url ?? ''
      if (url === `/${NEW_NAME}.blocks.json`) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(blocksPayloadForNew)
        return
      }
      if (url === `/${OLD_NAME}.blocks.json`) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(oldTable))
        return
      }
      if (url === `/${NEW_NAME}`) {
        const range = req.headers.range
        if (!range || rangeMode === 'ignored') {
          res.writeHead(200, { 'content-length': newBuf.length })
          res.end(newBuf)
          return
        }
        const match = /bytes=(\d+)-(\d+)/.exec(range)
        if (!match) {
          res.writeHead(416)
          res.end()
          return
        }
        const start = Number(match[1])
        const end = Number(match[2])
        res.writeHead(206, {
          'content-type': 'application/octet-stream',
          'content-range': `bytes ${start}-${end}/${newBuf.length}`
        })
        res.end(newBuf.subarray(start, end + 1))
        return
      }
      res.writeHead(404)
      res.end()
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    port = (server?.address() as AddressInfo | undefined)?.port ?? 0
  })

  afterAll(async () => {
    vi.restoreAllMocks()
    if (!server) return
    await new Promise<void>((resolve) => server?.close(() => resolve()))
  })

  beforeEach(() => {
    blocksPayloadForNew = JSON.stringify(newTable)
    rangeMode = 'honored'
    state.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'delta-cache-'))
    fs.mkdirSync(currentWorkDir(), { recursive: true })
    workDirs.push(state.userData)
  })

  afterEach(async () => {
    for (const dir of workDirs.splice(0)) {
      await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  })

  function oldInstallerUrl(): string {
    return `https://127.0.0.1:${port}/${OLD_NAME}`
  }

  function newInstallerUrl(): string {
    return `https://127.0.0.1:${port}/${NEW_NAME}`
  }

  async function seedCacheViaSave(version: string): Promise<void> {
    const oldExe = path.join(currentWorkDir(), 'old-setup.exe')
    fs.writeFileSync(oldExe, oldBuf)
    await saveDeltaCache(oldExe, version, oldInstallerUrl())
  }

  it('完整差量流程：saveDeltaCache 缓存旧包 → downloadDelta 逐块组装出与新版逐字节一致的文件', async () => {
    await seedCacheViaSave('1.2.0-x64')
    const targetPath = path.join(currentWorkDir(), 'target.exe')
    const seen: Array<{ percent: number; remoteBytes: number; totalSize: number }> = []
    const result = await downloadDelta({
      installerUrl: newInstallerUrl(),
      newVersion: '1.2.1-x64',
      targetPath,
      onProgress: (percent, remoteBytes, totalSize) => seen.push({ percent, remoteBytes, totalSize })
    })
    expect(result.totalSize).toBe(newBuf.length)
    expect(result.remoteBytes).toBe(BLOCK * COUNT / 2)
    expect(result.savedBytes).toBe(BLOCK * COUNT / 2)
    expect(fs.readFileSync(targetPath).equals(newBuf)).toBe(true)
    expect(seen[seen.length - 1]?.percent).toBe(100)
  }, 30000)

  it('没有缓存时抛 no_cache（调用方回落全量）', async () => {
    await expect(
      downloadDelta({ installerUrl: newInstallerUrl(), newVersion: '1.2.1-x64', targetPath: path.join(currentWorkDir(), 't.exe') })
    ).rejects.toThrow(/no_cache/)
  })

  it('缓存版本比目标还新（版本回退）→ 报 cache_stale 并清空缓存', async () => {
    // 直接手写一份"声称比目标更新"的缓存（saveDeltaCache 会核对版本，造不出这种脏数据）
    const dir = getDeltaCacheDir()
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'cached-setup.exe'), oldBuf)
    fs.writeFileSync(path.join(dir, 'cached-blocks.json'), JSON.stringify(makeTable('1.2.2-x64', oldBuf, BLOCK)))
    await expect(
      downloadDelta({ installerUrl: newInstallerUrl(), newVersion: '1.2.1-x64', targetPath: path.join(currentWorkDir(), 't.exe') })
    ).rejects.toThrow(/cache_stale/)
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it('缓存 exe 与块表大小不一致（写缓存被中断）→ 自愈为 no_cache', async () => {
    await seedCacheViaSave('1.2.0-x64')
    fs.writeFileSync(path.join(getDeltaCacheDir(), 'cached-setup.exe'), Buffer.alloc(10))
    await expect(
      downloadDelta({ installerUrl: newInstallerUrl(), newVersion: '1.2.1-x64', targetPath: path.join(currentWorkDir(), 't.exe') })
    ).rejects.toThrow(/no_cache/)
    expect(fs.readdirSync(getDeltaCacheDir())).toEqual([])
  })

  it('缓存块表损坏（非 JSON）→ 自愈为 no_cache', async () => {
    await seedCacheViaSave('1.2.0-x64')
    fs.writeFileSync(path.join(getDeltaCacheDir(), 'cached-blocks.json'), '{broken')
    await expect(
      downloadDelta({ installerUrl: newInstallerUrl(), newVersion: '1.2.1-x64', targetPath: path.join(currentWorkDir(), 't.exe') })
    ).rejects.toThrow(/no_cache/)
    expect(fs.readdirSync(getDeltaCacheDir())).toEqual([])
  })

  it('远端 blocks.json 不是 JSON → 报 bad_blocks_json，且不动缓存', async () => {
    await seedCacheViaSave('1.2.0-x64')
    blocksPayloadForNew = 'not json {'
    await expect(
      downloadDelta({ installerUrl: newInstallerUrl(), newVersion: '1.2.1-x64', targetPath: path.join(currentWorkDir(), 't.exe') })
    ).rejects.toThrow(/bad_blocks_json/)
    expect(fs.existsSync(path.join(getDeltaCacheDir(), 'cached-setup.exe'))).toBe(true)
  })

  it('远端 blocks.json 结构非法 → 报 invalid_blocks_table', async () => {
    await seedCacheViaSave('1.2.0-x64')
    blocksPayloadForNew = JSON.stringify({ version: '1.2.1-x64' })
    await expect(
      downloadDelta({ installerUrl: newInstallerUrl(), newVersion: '1.2.1-x64', targetPath: path.join(currentWorkDir(), 't.exe') })
    ).rejects.toThrow(/invalid_blocks_table/)
  })

  it('块表版本与目标版本不一致 → 报 blocks_version_mismatch', async () => {
    await seedCacheViaSave('1.2.0-x64')
    blocksPayloadForNew = JSON.stringify(oldTable)
    await expect(
      downloadDelta({ installerUrl: newInstallerUrl(), newVersion: '1.2.1-x64', targetPath: path.join(currentWorkDir(), 't.exe') })
    ).rejects.toThrow(/blocks_version_mismatch/)
  })

  it('几乎没有共享块 → 报 delta_not_worth（差量不划算）', async () => {
    await seedCacheViaSave('1.2.0-x64')
    const freshBuf = crypto.randomBytes(BLOCK * COUNT)
    blocksPayloadForNew = JSON.stringify(makeTable('1.2.1-x64', freshBuf, BLOCK))
    await expect(
      downloadDelta({ installerUrl: newInstallerUrl(), newVersion: '1.2.1-x64', targetPath: path.join(currentWorkDir(), 't.exe') })
    ).rejects.toThrow(/delta_not_worth/)
  })

  it('服务器忽略 Range（返回 200 全量）→ 拒绝组装，缓存保留', async () => {
    await seedCacheViaSave('1.2.0-x64')
    rangeMode = 'ignored'
    await expect(
      downloadDelta({ installerUrl: newInstallerUrl(), newVersion: '1.2.1-x64', targetPath: path.join(currentWorkDir(), 't.exe') })
    ).rejects.toThrow(/Range request not honored: 200/)
    expect(fs.existsSync(path.join(getDeltaCacheDir(), 'cached-setup.exe'))).toBe(true)
  })

  it('discardDeltaCache 之后缓存目录为空', async () => {
    await seedCacheViaSave('1.2.0-x64')
    await discardDeltaCache()
    expect(fs.readdirSync(getDeltaCacheDir())).toEqual([])
  })
})
