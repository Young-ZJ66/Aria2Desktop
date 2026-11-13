import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
}))
vi.mock('../utils/ipcSecurity', () => ({ registerSecureHandler: vi.fn() }))
vi.mock('../utils/aria2Rpc', () => ({ callAria2Rpc: vi.fn() }))
vi.mock('../utils/settingsAccessor', () => ({ getSettingsFresh: vi.fn() }))

import { WatchFolderService } from './watchFolderService'
import { callAria2Rpc } from '../utils/aria2Rpc'
import { registerSecureHandler } from '../utils/ipcSecurity'
import { getSettingsFresh } from '../utils/settingsAccessor'
import type { AutoImportLogEntry, WatchFolderConfig } from '../../src/shared/autoImport'

const mockedRpc = vi.mocked(callAria2Rpc)
const mockedRegister = vi.mocked(registerSecureHandler)
const mockedSettings = vi.mocked(getSettingsFresh)

type StoreLike = {
  get: (key: string) => unknown
  set: (key: string, value: unknown) => void
  dump: () => Record<string, unknown>
}

function makeStore(initial: Record<string, unknown> = {}): StoreLike {
  const data: Record<string, unknown> = { ...initial }
  return {
    get: key => data[key],
    set: (key, value) => { data[key] = value },
    dump: () => data
  }
}

let tmpDir: string

function makeService(initial: Record<string, unknown> = {}) {
  const store = makeStore(initial)
  const service = new WatchFolderService(store as never, { getMainWindow: () => null } as never)
  return { service, store }
}

function folderConfig(overrides: Partial<WatchFolderConfig> = {}): WatchFolderConfig {
  return { id: 'folder-1', path: tmpDir, enabled: true, ...overrides }
}

/** 写文件并把 mtime 拨到 10 秒前（越过 3 秒稳定性门槛） */
function writeStableFile(dir: string, name: string, content: string | Buffer): string {
  const filePath = path.join(dir, name)
  fs.writeFileSync(filePath, content)
  const time = new Date(Date.now() - 10_000)
  fs.utimesSync(filePath, time, time)
  return filePath
}

/** 连续扫描两轮：第一轮只登记 size（无上轮记录不稳定），第二轮才真正处理 */
async function scan(service: WatchFolderService, folderId = 'folder-1', rounds = 2): Promise<number> {
  let imported = 0
  for (let i = 0; i < rounds; i++) {
    const result = await service.scanNow(folderId)
    imported = result.imported ?? 0
  }
  return imported
}

async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve()
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-test-'))
  mockedRpc.mockReset()
  mockedRpc.mockResolvedValue('gid-1')
  mockedSettings.mockReset()
  mockedSettings.mockReturnValue({
    aria2: { host: '127.0.0.1', port: 6801, secret: 'test-secret' }
  } as unknown as ReturnType<typeof getSettingsFresh>)
})

afterEach(() => {
  vi.useRealTimers()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('WatchFolderService 导入', () => {
  it('.torrent → base64 → aria2.addTorrent，源文件移入 imported/', async () => {
    const { service, store } = makeService({ watchFolders: [folderConfig()] })
    const filePath = writeStableFile(tmpDir, 'file.torrent', 'torrent-data')

    const imported = await scan(service)

    expect(imported).toBe(1)
    expect(mockedRpc).toHaveBeenCalledWith(expect.objectContaining({
      host: '127.0.0.1',
      port: 6801,
      secret: 'test-secret',
      method: 'aria2.addTorrent',
      params: [Buffer.from('torrent-data').toString('base64'), [], {}]
    }))
    // 源文件已归档
    expect(fs.existsSync(filePath)).toBe(false)
    expect(fs.existsSync(path.join(tmpDir, 'imported', 'file.torrent'))).toBe(true)

    const log = store.get('autoImportLog') as AutoImportLogEntry[]
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({
      kind: 'watch-folder', sourceId: 'folder-1', sourceName: tmpDir, title: 'file.torrent',
      status: 'added', gid: 'gid-1'
    })
    const folder = (store.get('watchFolders') as WatchFolderConfig[])[0]
    expect(folder.lastScanAt).toBeTruthy()
    expect(folder.lastError).toBeNull()
    // 哈希已记录（防重复导入）
    expect(store.get('watchSeenHashes')).toHaveLength(1)
  })

  it('folder.dir 非空 → opts 带 dir', async () => {
    const { service } = makeService({ watchFolders: [folderConfig({ dir: 'D:\\Downloads' })] })
    writeStableFile(tmpDir, 'file.torrent', 'torrent-data')

    await scan(service)

    expect(mockedRpc).toHaveBeenCalledWith(expect.objectContaining({
      method: 'aria2.addTorrent',
      params: [Buffer.from('torrent-data').toString('base64'), [], { dir: 'D:\\Downloads' }]
    }))
  })

  it('deleteAfterImport → 删除源文件', async () => {
    const { service } = makeService({ watchFolders: [folderConfig({ deleteAfterImport: true })] })
    const filePath = writeStableFile(tmpDir, 'file.torrent', 'torrent-data')

    await scan(service)

    expect(fs.existsSync(filePath)).toBe(false)
    expect(fs.existsSync(path.join(tmpDir, 'imported'))).toBe(false)
  })

  it('.metalink → aria2.addMetalink [base64, opts]，数组结果拼接为 gid', async () => {
    mockedRpc.mockResolvedValueOnce(['gid-a', 'gid-b'])
    const { service, store } = makeService({ watchFolders: [folderConfig()] })
    writeStableFile(tmpDir, 'file.metalink', 'metalink-data')

    const imported = await scan(service)

    expect(imported).toBe(1)
    expect(mockedRpc).toHaveBeenCalledWith(expect.objectContaining({
      method: 'aria2.addMetalink',
      params: [Buffer.from('metalink-data').toString('base64'), {}]
    }))
    const log = store.get('autoImportLog') as AutoImportLogEntry[]
    expect(log[0].gid).toBe('gid-a,gid-b')
  })

  it('.txt：逐行导入多个磁力（CRLF/LF 混合），一个磁力一条日志', async () => {
    const { service, store } = makeService({ watchFolders: [folderConfig()] })
    const lines = ['magnet:?xt=urn:btih:1', '# 注释行', '', 'magnet:?xt=urn:btih:2', 'magnet:?xt=urn:btih:3']
    const content = lines.join('\r\n') + '\nmagnet:?xt=urn:btih:4'
    writeStableFile(tmpDir, 'list.txt', content)

    const imported = await scan(service)

    expect(imported).toBe(4)
    expect(mockedRpc).toHaveBeenCalledTimes(4)
    for (const magnet of ['magnet:?xt=urn:btih:1', 'magnet:?xt=urn:btih:2', 'magnet:?xt=urn:btih:3', 'magnet:?xt=urn:btih:4']) {
      expect(mockedRpc).toHaveBeenCalledWith(expect.objectContaining({
        method: 'aria2.addUri',
        params: [[magnet], {}]
      }))
    }
    const log = store.get('autoImportLog') as AutoImportLogEntry[]
    expect(log).toHaveLength(4)
    expect(log.every(entry => entry.status === 'added')).toBe(true)
  })

  it('.txt 没有磁力行 → 静默跳过：不导入、不报错、文件留原处、哈希已记', async () => {
    const { service, store } = makeService({ watchFolders: [folderConfig()] })
    const filePath = writeStableFile(tmpDir, 'notes.txt', '普通文本内容')

    const imported = await scan(service)

    expect(imported).toBe(0)
    expect(mockedRpc).not.toHaveBeenCalled()
    expect(store.get('autoImportLog')).toBeUndefined()
    // 哈希已记录 → 第三轮扫描直接记 skipped
    const third = await service.scanNow('folder-1')
    expect(third.imported).toBe(0)
    const log = store.get('autoImportLog') as AutoImportLogEntry[]
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ status: 'skipped', title: 'notes.txt' })
    // 文件仍然留在原处
    expect(fs.existsSync(filePath)).toBe(true)
  })

  it('稳定性门槛：mtime 距今 <3 秒的文件不导入；变旧后导入', async () => {
    const { service } = makeService({ watchFolders: [folderConfig()] })
    const filePath = path.join(tmpDir, 'fresh.torrent')
    fs.writeFileSync(filePath, 'fresh-data')

    // 两轮扫描都因 mtime 太新而跳过
    const imported = await scan(service, 'folder-1', 3)
    expect(imported).toBe(0)
    expect(mockedRpc).not.toHaveBeenCalled()

    // 拨旧 mtime 后可导入
    const time = new Date(Date.now() - 10_000)
    fs.utimesSync(filePath, time, time)
    const next = await service.scanNow('folder-1')
    expect(next.imported).toBe(1)
  })

  it('稳定性门槛：size 与上轮不一致时不导入，一致后导入', async () => {
    const { service } = makeService({ watchFolders: [folderConfig()] })
    const filePath = writeStableFile(tmpDir, 'grow.torrent', 'v1')

    // 第一轮登记 size=2
    await service.scanNow('folder-1')
    // 内容变长（mtime 重置为新），再拨旧
    fs.writeFileSync(filePath, 'v1-plus-more')
    const time = new Date(Date.now() - 10_000)
    fs.utimesSync(filePath, time, time)

    // 第二轮：size 与上轮不同 → 跳过
    const second = await service.scanNow('folder-1')
    expect(second.imported).toBe(0)
    expect(mockedRpc).not.toHaveBeenCalled()

    // 第三轮：size 已一致 → 导入
    const third = await service.scanNow('folder-1')
    expect(third.imported).toBe(1)
  })

  it('扩展名过滤：未配置扩展名的文件被忽略', async () => {
    const { service, store } = makeService({ watchFolders: [folderConfig()] })
    writeStableFile(tmpDir, 'setup.exe', 'binary')
    writeStableFile(tmpDir, 'movie.mkv', 'video')
    writeStableFile(tmpDir, 'file.torrent', 'torrent-data')

    const imported = await scan(service)

    expect(imported).toBe(1)
    expect(mockedRpc).toHaveBeenCalledTimes(1)
    // exe/mkv 留在原处，不进日志、不记哈希
    expect(fs.existsSync(path.join(tmpDir, 'setup.exe'))).toBe(true)
    expect(fs.existsSync(path.join(tmpDir, 'movie.mkv'))).toBe(true)
    expect(store.get('autoImportLog') as AutoImportLogEntry[]).toHaveLength(1)
  })

  it('自定义 extensions 只认 .torrent，忽略 .txt', async () => {
    const { service } = makeService({ watchFolders: [folderConfig({ extensions: ['.torrent'] })] })
    writeStableFile(tmpDir, 'a.torrent', 'torrent-data')
    writeStableFile(tmpDir, 'b.txt', 'magnet:?xt=urn:btih:1')

    const imported = await scan(service)

    expect(imported).toBe(1)
    expect(mockedRpc).toHaveBeenCalledTimes(1)
    expect(fs.existsSync(path.join(tmpDir, 'b.txt'))).toBe(true)
  })

  it('哈希去重：相同内容再次出现 → skipped 且不重复导入', async () => {
    const { service, store } = makeService({ watchFolders: [folderConfig()] })
    writeStableFile(tmpDir, 'a.torrent', 'same-content')
    expect(await scan(service)).toBe(1)

    // 归档后再放入同内容文件（同名同内容）；size 记忆仍在，一轮扫描即可判定
    writeStableFile(tmpDir, 'a.torrent', 'same-content')
    const imported = await service.scanNow('folder-1')

    expect(imported.imported).toBe(0)
    expect(mockedRpc).toHaveBeenCalledTimes(1)
    const log = store.get('autoImportLog') as AutoImportLogEntry[]
    expect(log).toHaveLength(2)
    expect(log[0]).toMatchObject({ status: 'skipped', title: 'a.torrent' })
    // skipped 的文件留在原处
    expect(fs.existsSync(path.join(tmpDir, 'a.torrent'))).toBe(true)
  })

  it('RPC 失败：文件留在原处、不记哈希，下一轮重试成功', async () => {
    mockedRpc.mockRejectedValueOnce(new Error('Aria2 RPC Error: dead'))
    const { service, store } = makeService({ watchFolders: [folderConfig()] })
    const filePath = writeStableFile(tmpDir, 'file.torrent', 'torrent-data')

    await service.scanNow('folder-1') // 登记 size
    const failed = await service.scanNow('folder-1')

    expect(failed.imported).toBe(0)
    expect(failed.success).toBe(true)
    const log1 = store.get('autoImportLog') as AutoImportLogEntry[]
    expect(log1).toHaveLength(1)
    expect(log1[0]).toMatchObject({ status: 'error', title: 'file.torrent' })
    expect(log1[0].message).toContain('dead')
    // 文件还在原处（未记哈希）
    expect(fs.existsSync(filePath)).toBe(true)

    // 下一轮重试成功
    const retried = await service.scanNow('folder-1')
    expect(retried.imported).toBe(1)
    expect(fs.existsSync(filePath)).toBe(false)
  })

  it('非递归：子目录里的文件不导入', async () => {
    const { service } = makeService({ watchFolders: [folderConfig()] })
    fs.mkdirSync(path.join(tmpDir, 'sub'))
    writeStableFile(path.join(tmpDir, 'sub'), 'deep.torrent', 'torrent-data')

    const imported = await scan(service, 'folder-1', 3)

    expect(imported).toBe(0)
    expect(mockedRpc).not.toHaveBeenCalled()
    expect(fs.existsSync(path.join(tmpDir, 'sub', 'deep.torrent'))).toBe(true)
  })

  it('并发 scan-now 共享同一个 Promise', async () => {
    const { service } = makeService({ watchFolders: [folderConfig()] })
    writeStableFile(tmpDir, 'file.torrent', 'torrent-data')
    await service.scanNow('folder-1') // 登记 size

    // 第二轮进入后会挂在 rpc 上
    mockedRpc.mockImplementationOnce(() => new Promise(() => {}))
    const first = service.scanNow('folder-1')
    const second = service.scanNow('folder-1')
    expect(second).toBe(first)
    first.catch(() => {})
  })

  it('监听路径不存在 → scanNow 失败并写 lastError', async () => {
    const { service, store } = makeService({
      watchFolders: [folderConfig({ path: path.join(tmpDir, 'nope') })]
    })

    const result = await service.scanNow('folder-1')

    expect(result.success).toBe(false)
    expect(result.imported).toBe(0)
    expect(result.error).toBeTruthy()
    const folder = (store.get('watchFolders') as WatchFolderConfig[])[0]
    expect(folder.lastError).toBeTruthy()
    expect(folder.lastScanAt).toBeTruthy()
  })

  it('文件夹不存在 → {success:false, error}', async () => {
    const { service } = makeService({ watchFolders: [] })
    const result = await service.scanNow('nope')
    expect(result).toEqual({ success: false, imported: 0, error: '监听文件夹不存在' })
  })
})

describe('WatchFolderService 定时器', () => {
  it('initialize 首跳登记 + 15 秒后第二跳导入', async () => {
    const { service } = makeService({ watchFolders: [folderConfig()] })
    writeStableFile(tmpDir, 'file.torrent', 'torrent-data')

    service.initialize()
    await flush()
    // 首跳只登记 size，不导入
    expect(mockedRpc).not.toHaveBeenCalled()

    // 触发第二跳后，哈希/读文件是真实 fs I/O：假时钟的异步推进只清微任务，
    // 需要再挂几个真实 fs await 给事件循环转的机会，扫描链路才能走到 RPC
    vi.advanceTimersByTime(15_000)
    for (let i = 0; i < 12; i++) {
      await fs.promises.stat(tmpDir)
    }
    await flush()
    expect(mockedRpc).toHaveBeenCalledTimes(1)
    service.shutdown()
  })

  it('disabled 文件夹不被 ticker 扫描（手动 scan-now 可用）', async () => {
    const { service } = makeService({ watchFolders: [folderConfig({ enabled: false })] })
    writeStableFile(tmpDir, 'file.torrent', 'torrent-data')

    service.initialize()
    await flush()
    vi.advanceTimersByTime(60_000)
    await flush()
    expect(mockedRpc).not.toHaveBeenCalled()

    // 手动扫描不受 enabled 限制
    const imported = await scan(service)
    expect(imported).toBe(1)
  })

  it('shutdown 后 ticker 停止', async () => {
    const { service } = makeService({ watchFolders: [folderConfig()] })
    writeStableFile(tmpDir, 'file.torrent', 'torrent-data')
    service.initialize()
    await flush()
    service.shutdown()
    vi.advanceTimersByTime(120_000)
    await flush()
    expect(mockedRpc).not.toHaveBeenCalled()
  })
})

describe('WatchFolderService IPC', () => {
  // IPC 处理器在测试里都当同步/可 await 的宽松函数用：返回对象必含 success，其余字段自行断言
  type Handler = (event: unknown, payload: unknown) => { success: boolean } & Record<string, unknown>

  function getHandler(channel: string): Handler {
    const call = mockedRegister.mock.calls.find(entry => entry[0] === channel)
    if (!call) throw new Error('handler not registered: ' + channel)
    return call[1] as Handler
  }

  beforeEach(() => {
    mockedRegister.mockClear()
  })

  it('watch-folders-list 返回文件夹列表', () => {
    const folder = folderConfig()
    const { service } = makeService({ watchFolders: [folder] })
    service.registerIpcHandlers()
    const result = getHandler('watch-folders-list')(undefined, undefined)
    expect(result).toEqual({ folders: [folder] })
  })

  it('watch-folders-save：无 id 生成 UUID，extensions 归一为小写带点', () => {
    const { service, store } = makeService()
    service.registerIpcHandlers()
    const save = getHandler('watch-folders-save')

    const created = save(undefined, folderConfig({ id: '', extensions: ['TORRENT', 'torrent', '.TXT', ''] as unknown as string[] })) as { success: boolean; folder: WatchFolderConfig }
    expect(created.success).toBe(true)
    expect(created.folder.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(created.folder.extensions).toEqual(['.torrent', '.txt'])
    expect(store.get('watchFolders')).toHaveLength(1)
  })

  it('watch-folders-save：upsert 保留 lastScanAt/lastError 历史', () => {
    const { service, store } = makeService({
      watchFolders: [folderConfig({ lastScanAt: '2026-01-01T00:00:00.000Z', lastError: 'x' })]
    })
    service.registerIpcHandlers()
    const save = getHandler('watch-folders-save')

    const updated = save(undefined, folderConfig({ path: tmpDir })) as { success: boolean; folder: WatchFolderConfig }
    expect(updated.success).toBe(true)
    expect(updated.folder.lastScanAt).toBe('2026-01-01T00:00:00.000Z')
    // lastError 也保留：没做过新扫描就不该伪造"已恢复正常"，下次扫描成功才清空
    expect(updated.folder.lastError).toBe('x')
    expect(store.get('watchFolders')).toHaveLength(1)
  })

  it('watch-folders-save：非法输入被拒绝', () => {
    const { service } = makeService()
    service.registerIpcHandlers()
    const save = getHandler('watch-folders-save')

    // 相对路径
    expect(save(undefined, folderConfig({ path: 'relative/path' })).success).toBe(false)
    // 不存在的目录
    expect(save(undefined, folderConfig({ path: path.join(tmpDir, 'missing') })).success).toBe(false)
    // 路径是文件不是目录
    const fileAsPath = path.join(tmpDir, 'plain.txt')
    fs.writeFileSync(fileAsPath, 'x')
    expect(save(undefined, folderConfig({ path: fileAsPath })).success).toBe(false)
    // dir 相对路径
    expect(save(undefined, folderConfig({ dir: 'relative' })).success).toBe(false)
  })

  it('watch-folders-delete：删除配置', () => {
    const { service, store } = makeService({ watchFolders: [folderConfig()] })
    service.registerIpcHandlers()

    const result = getHandler('watch-folders-delete')(undefined, 'folder-1')
    expect(result).toEqual({ success: true })
    expect(store.get('watchFolders')).toEqual([])
  })
})
