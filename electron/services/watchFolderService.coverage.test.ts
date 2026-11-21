import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const holder = vi.hoisted(() => ({
  warn: vi.fn(),
  statThrowsFor: new Set<string>()
}))

vi.mock('../utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: holder.warn, error: vi.fn(), debug: vi.fn() })
}))
vi.mock('../utils/ipcSecurity', () => ({ registerSecureHandler: vi.fn() }))
vi.mock('../utils/aria2Rpc', () => ({ callAria2Rpc: vi.fn() }))
vi.mock('../utils/settingsAccessor', () => ({ getSettingsFresh: vi.fn() }))
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  const statSync = ((filePath: fs.PathLike, ...rest: unknown[]) => {
    if (holder.statThrowsFor.has(path.basename(String(filePath)))) {
      throw new Error('stat boom')
    }
    return (actual.statSync as unknown as (...args: unknown[]) => unknown)(filePath, ...rest)
  }) as unknown as typeof actual.statSync
  return { ...actual, default: actual, statSync }
})

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

let tmpDir: string

/** 可控 store：getOverride 可在中途改变读取结果（模拟扫描期间配置被删） */
function makeStore(initial: Record<string, unknown> = {}, getOverride?: (key: string, data: Record<string, unknown>) => unknown) {
  const data: Record<string, unknown> = { ...initial }
  const store: StoreLike = {
    get: key => (getOverride ? getOverride(key, data) : data[key]),
    set: (key, value) => { data[key] = value },
    dump: () => data
  }
  return store
}

function makeService(
  initial: Record<string, unknown> = {},
  options: { getMainWindow?: () => unknown; getOverride?: (key: string, data: Record<string, unknown>) => unknown } = {}
) {
  const store = makeStore(initial, options.getOverride)
  const windowController = { getMainWindow: options.getMainWindow ?? (() => null) }
  const service = new WatchFolderService(store as never, windowController as never)
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

async function scan(service: WatchFolderService, folderId = 'folder-1', rounds = 2) {
  let result = { success: false, imported: 0 } as { success: boolean; imported: number }
  for (let i = 0; i < rounds; i += 1) {
    result = await service.scanNow(folderId)
  }
  return result
}

beforeEach(() => {
  vi.useFakeTimers()
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-cov-'))
  holder.warn.mockReset()
  holder.statThrowsFor.clear()
  mockedRpc.mockReset()
  mockedRpc.mockResolvedValue('gid-1')
  mockedSettings.mockReset()
  mockedSettings.mockReturnValue({
    aria2: { host: '127.0.0.1', port: 6801, secret: 'secret-1' }
  } as unknown as ReturnType<typeof getSettingsFresh>)
  mockedRegister.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('WatchFolderService 定时器与扫描兜底', () => {
  it('initialize 重复调用只装一个 ticker', async () => {
    const { service } = makeService({ watchFolders: [folderConfig()] })
    const scanSpy = vi.spyOn(service, 'scanNow')
    service.initialize()
    service.initialize()
    // 首轮 tick 与 15 秒后的一跳各一次；重复 initialize 若再装一个 interval 会变成 3 次
    await vi.advanceTimersByTimeAsync(15_000)
    expect(scanSpy).toHaveBeenCalledTimes(2)
    service.shutdown()
  })

  it('tick 里扫描抛错只记 warn 不中断定时器', async () => {
    const { service } = makeService({ watchFolders: [folderConfig()] })
    vi.spyOn(service, 'scanNow').mockRejectedValue(new Error('scan boom'))
    service.initialize()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(holder.warn).toHaveBeenCalledWith('[WatchFolder] 自动扫描异常:', tmpDir, expect.any(Error))
    service.shutdown()
  })

  it('扫描期间配置被删掉时写回状态不崩', async () => {
    let reads = 0
    const { service, store } = makeService({ watchFolders: [folderConfig()] }, {
      getOverride: (key, data) => {
        if (key !== 'watchFolders') return data[key]
        reads += 1
        // 第一次给 performScan 的 findFolder 用，之后（patchFolder 回写时）列表已空
        return reads === 1 ? data.watchFolders : []
      }
    })
    const result = await service.scanNow('folder-1')
    // 扫描本身成功（目录可读），只是回写状态时列表里已经找不到这条：patchFolder 静默跳过，
    // 不会把已删除的配置重新写回去
    expect(result.success).toBe(true)
    const folders = store.dump().watchFolders as WatchFolderConfig[]
    expect(folders).toHaveLength(1)
    expect(folders[0].lastScanAt).toBeUndefined()
  })

  it('stat 失败的条目静默跳过，其余文件照常导入', async () => {
    const { service } = makeService({ watchFolders: [folderConfig()] })
    writeStableFile(tmpDir, 'ghost.torrent', 'ghost')
    writeStableFile(tmpDir, 'real.torrent', 'real-data')
    holder.statThrowsFor.add('ghost.torrent')

    const result = await scan(service)

    expect(result.success).toBe(true)
    expect(result.imported).toBe(1)
    expect(mockedRpc).toHaveBeenCalledTimes(1)
  })

  it('自定义陌生扩展名命中名单但没有处理器时返回 0 条', async () => {
    const { service } = makeService({ watchFolders: [folderConfig({ extensions: ['.weird'] })] })
    writeStableFile(tmpDir, 'thing.weird', 'payload')

    const result = await scan(service)

    expect(result.success).toBe(true)
    expect(result.imported).toBe(0)
    expect(mockedRpc).not.toHaveBeenCalled()
  })

  it('RPC 返回非字符串非数组时转成字符串写进日志', async () => {
    const { service, store } = makeService({ watchFolders: [folderConfig()] })
    mockedRpc.mockResolvedValue(4242 as unknown as string)
    writeStableFile(tmpDir, 'file.torrent', 'torrent-data')

    const result = await scan(service)

    expect(result.imported).toBe(1)
    const log = store.get('autoImportLog') as AutoImportLogEntry[]
    expect(log[0].gid).toBe('4242')
  })
})

describe('WatchFolderService 配置校验与通道注册', () => {
  type Handler = (event: unknown, payload: unknown) => { success: boolean } & Record<string, unknown>

  function getHandler(channel: string): Handler {
    const call = mockedRegister.mock.calls.find(entry => entry[0] === channel)
    if (!call) throw new Error('handler not registered: ' + channel)
    return call[1] as Handler
  }

  it('非对象与空路径的配置都被拒绝', () => {
    const { service } = makeService()
    service.registerIpcHandlers()
    const save = getHandler('watch-folders-save')

    expect(save(undefined, null).success).toBe(false)
    expect(save(undefined, 'nope').success).toBe(false)
    expect(save(undefined, { path: '   ' }).success).toBe(false)
  })

  it('scan-now 通道直接返回扫描结果', async () => {
    const { service } = makeService({ watchFolders: [folderConfig()] })
    writeStableFile(tmpDir, 'file.torrent', 'torrent-data')
    service.registerIpcHandlers()
    const handler = getHandler('watch-folders-scan-now')

    await handler(undefined, 'folder-1')
    const result = await handler(undefined, 'folder-1')

    expect(result.success).toBe(true)
    expect(result.imported).toBe(1)
  })

  it('通道的窗口取值器走 WindowController，且未建窗时为 null', () => {
    const mainWindow = { id: 7 }
    const { service } = makeService({}, { getMainWindow: () => mainWindow })
    service.registerIpcHandlers()

    const channels = mockedRegister.mock.calls.map(entry => entry[0])
    expect(channels).toEqual([
      'watch-folders-list',
      'watch-folders-save',
      'watch-folders-delete',
      'watch-folders-scan-now'
    ])
    for (const call of mockedRegister.mock.calls) {
      const options = call[2] as { getMainWindow: () => unknown }
      expect(options.getMainWindow()).toBe(mainWindow)
    }
  })
})
