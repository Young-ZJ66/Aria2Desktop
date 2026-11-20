import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

/**
 * 自动导入（RSS / 监听文件夹）状态。
 *
 * 主进程不主动推送，页面全靠这 9 个 invoke；因此两条不变量必须锁住：
 * 1) invoke 抛错（IPC 断链）要归一成 { success:false }，UI 只有一条展示路径，不会出现未捕获异常；
 * 2) 轮询失败只记 lastError，绝不能把异常抛到定时器里（否则每次轮询都在控制台炸一次）。
 */
import { useAutoImportStore } from './autoImportStore'

type Api = Record<string, ReturnType<typeof vi.fn>>
let api: Api

function installApi(): void {
  ;(globalThis as unknown as { window: unknown }).window = { electronAPI: api }
}

beforeEach(() => {
  setActivePinia(createPinia())
  api = {
    rssSubsList: vi.fn(async () => ({ subscriptions: [{ id: 'r1', name: '订阅' }] })),
    watchFoldersList: vi.fn(async () => ({ folders: [{ id: 'w1', path: '/watch' }] })),
    autoImportLogList: vi.fn(async () => ({ entries: [{ id: 'l1' }] })),
    rssSubsSave: vi.fn(async () => ({ success: true, subscription: { id: 'r2' } })),
    rssSubsDelete: vi.fn(async () => ({ success: true })),
    rssSubsFetchNow: vi.fn(async () => ({ success: true, added: 3, items: [{ title: 't', link: 'l' }] })),
    watchFoldersSave: vi.fn(async () => ({ success: true, folder: { id: 'w2' } })),
    watchFoldersDelete: vi.fn(async () => ({ success: true })),
    watchFoldersScanNow: vi.fn(async () => ({ success: true, imported: 2 }))
  }
  installApi()
})

describe('loadAll / pollRefresh', () => {
  it('loadAll 同时拉三组列表并复位 lastError', async () => {
    const store = useAutoImportStore()
    store.lastError = '旧错误'
    await store.loadAll()
    expect(store.subscriptions).toEqual([{ id: 'r1', name: '订阅' }])
    expect(store.watchFolders).toEqual([{ id: 'w1', path: '/watch' }])
    expect(store.logEntries).toEqual([{ id: 'l1' }])
    expect(store.lastError).toBeNull()
    expect(store.loading).toBe(false)
  })

  it('loadAll 失败记 lastError 且不抛出', async () => {
    api.rssSubsList.mockRejectedValue(new Error('ipc broken'))
    const store = useAutoImportStore()
    await expect(store.loadAll()).resolves.toBeUndefined()
    expect(store.lastError).toBe('ipc broken')
    expect(store.loading).toBe(false)
  })

  it('pollRefresh 失败只记错误（轮询不能抛到定时器里）', async () => {
    api.autoImportLogList.mockRejectedValue(new Error('log failed'))
    const store = useAutoImportStore()
    await expect(store.pollRefresh()).resolves.toBeUndefined()
    expect(store.lastError).toBe('log failed')
  })

  it('pollRefresh 成功会清掉上一次的错误', async () => {
    const store = useAutoImportStore()
    store.lastError = '上次失败'
    await store.pollRefresh()
    expect(store.lastError).toBeNull()
  })

  it('缺少 electronAPI 时 loadAll 记可读错误而不是 TypeError', async () => {
    ;(globalThis as unknown as { window: unknown }).window = {}
    const store = useAutoImportStore()
    await store.loadAll()
    expect(store.lastError).toBe('window.electronAPI is not available')
  })
})

describe('订阅写操作', () => {
  it('保存成功返回结果并刷新列表', async () => {
    const store = useAutoImportStore()
    const result = await store.saveSubscription({ id: 'r2', name: '新订阅', url: 'https://example.com/feed.xml', enabled: true })
    expect(result).toEqual({ success: true, subscription: { id: 'r2' } })
    expect(api.rssSubsList).toHaveBeenCalledTimes(1)
  })

  it('保存失败把主进程的 error 记进 lastError 且不刷新列表', async () => {
    api.rssSubsSave.mockResolvedValue({ success: false, error: '订阅地址无效' })
    const store = useAutoImportStore()
    const result = await store.saveSubscription({ id: 'r2', name: 'x', url: 'https://example.com/feed.xml', enabled: true })
    expect(result.success).toBe(false)
    expect(store.lastError).toBe('订阅地址无效')
    expect(api.rssSubsList).not.toHaveBeenCalled()
  })

  it('保存抛错归一成 { success:false, error }', async () => {
    api.rssSubsSave.mockRejectedValue(new Error('boom'))
    const store = useAutoImportStore()
    await expect(store.saveSubscription({ id: 'r2', name: 'x', url: 'https://example.com/feed.xml', enabled: true })).resolves.toEqual({ success: false, error: 'boom' })
  })

  it('删除成功后刷新列表', async () => {
    const store = useAutoImportStore()
    const result = await store.deleteSubscription('r1')
    expect(result.success).toBe(true)
    expect(api.rssSubsList).toHaveBeenCalledTimes(1)
  })

  it('立即拉取返回 added 与预览条目，并刷新订阅与日志', async () => {
    const store = useAutoImportStore()
    const result = await store.fetchNow('r1')
    expect(result).toEqual({ success: true, added: 3, items: [{ title: 't', link: 'l' }] })
    expect(api.rssSubsList).toHaveBeenCalledTimes(1)
    expect(api.autoImportLogList).toHaveBeenCalledTimes(1)
  })

  it('立即拉取抛错时 added 归零', async () => {
    api.rssSubsFetchNow.mockRejectedValue(new Error('network'))
    const store = useAutoImportStore()
    await expect(store.fetchNow('r1')).resolves.toEqual({ success: false, added: 0, error: 'network' })
  })
})

describe('监听文件夹写操作', () => {
  it('保存成功刷新文件夹列表', async () => {
    const store = useAutoImportStore()
    const result = await store.saveFolder({ id: 'w2', path: '/x', enabled: true })
    expect(result.success).toBe(true)
    expect(api.watchFoldersList).toHaveBeenCalledTimes(1)
  })

  it('删除成功刷新文件夹列表', async () => {
    const store = useAutoImportStore()
    await store.deleteFolder('w1')
    expect(api.watchFoldersList).toHaveBeenCalledTimes(1)
  })

  it('立即扫描返回 imported 数并刷新文件夹与日志', async () => {
    const store = useAutoImportStore()
    const result = await store.scanNow('w1')
    expect(result).toEqual({ success: true, imported: 2 })
    expect(api.watchFoldersList).toHaveBeenCalledTimes(1)
    expect(api.autoImportLogList).toHaveBeenCalledTimes(1)
  })

  it('扫描抛错时 imported 归零', async () => {
    api.watchFoldersScanNow.mockRejectedValue(new Error('disk'))
    const store = useAutoImportStore()
    await expect(store.scanNow('w1')).resolves.toEqual({ success: false, imported: 0, error: 'disk' })
  })
})
