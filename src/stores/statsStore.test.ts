import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

/**
 * 全局统计 store 的回归测试（限速开关与数值归一化）。
 *
 * aria2 的 globalStat 全是字符串，未归一化时 `downloadSpeed` 会是 '0' 这类真值，
 * `|| 0` 与 `parseInt` 的差异会直接体现为「明明没速度却显示有速度」。
 * 限速开关的坑在记忆值：从没设过限速时不能凭空给出 1MB/s。
 */
const service = {
  getGlobalStat: vi.fn(),
  getVersion: vi.fn(),
  getGlobalOption: vi.fn(),
  changeGlobalOption: vi.fn()
}

vi.mock('./connectionStore', () => ({
  useConnectionStore: () => ({ service })
}))

vi.mock('@/utils/speedLimit', () => ({
  formatSpeedLimit: (bytes: number) => `${Math.round(bytes / 1024)} KB/s`
}))

const { useStatsStore } = await import('./statsStore')

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  service.getGlobalStat.mockResolvedValue({
    downloadSpeed: '1024',
    uploadSpeed: '0',
    numActive: '2',
    numWaiting: '0',
    numStopped: '3',
    numStoppedTotal: '7'
  })
  service.getVersion.mockResolvedValue({ version: '1.37.0', enabledFeatures: [] })
  service.getGlobalOption.mockResolvedValue({ 'max-overall-download-limit': '0' })
  service.changeGlobalOption.mockResolvedValue('OK')
})

describe('loadGlobalStat：字符串统计转数值', () => {
  it('全部字段转成 number', async () => {
    const store = useStatsStore()
    await store.loadGlobalStat()
    expect(store.globalStat).toEqual({
      downloadSpeed: 1024,
      uploadSpeed: 0,
      numActive: 2,
      numWaiting: 0,
      numStopped: 3,
      numStoppedTotal: 7
    })
  })

  it('缺失或非法字段回退 0（不能漏出 NaN）', async () => {
    service.getGlobalStat.mockResolvedValue({ downloadSpeed: 'abc' } as never)
    const store = useStatsStore()
    await store.loadGlobalStat()
    expect(store.globalStat.downloadSpeed).toBe(0)
    expect(store.globalStat.numActive).toBe(0)
  })

  it('RPC 失败时保留旧值且不抛错', async () => {
    service.getGlobalStat.mockRejectedValue(new Error('boom'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const store = useStatsStore()
    store.globalStat.downloadSpeed = 42
    await store.loadGlobalStat()
    expect(store.globalStat.downloadSpeed).toBe(42)
  })
})

describe('限速状态', () => {
  it('限速值为 0 或空串时不算限速', async () => {
    const store = useStatsStore()
    store.globalOptions = { 'max-overall-download-limit': '0' }
    expect(store.isSpeedLimited).toBe(false)
    store.globalOptions = { 'max-overall-download-limit': '' }
    expect(store.isSpeedLimited).toBe(false)
    store.globalOptions = {}
    expect(store.isSpeedLimited).toBe(false)
  })

  it('限速值非零时给出格式化显示', () => {
    const store = useStatsStore()
    store.globalOptions = { 'max-overall-download-limit': '1048576' }
    expect(store.isSpeedLimited).toBe(true)
    expect(store.speedLimitDisplay).toBe('1024 KB/s')
  })

  it('setSpeedLimit 下发字节数并记住恢复值', async () => {
    const store = useStatsStore()
    await store.setSpeedLimit(2097152)
    expect(service.changeGlobalOption).toHaveBeenCalledWith({ 'max-overall-download-limit': '2097152' })
  })

  it('setSpeedLimit(0) 下发 0（0 表示不限制）', async () => {
    const store = useStatsStore()
    await store.setSpeedLimit(0)
    expect(service.changeGlobalOption).toHaveBeenCalledWith({ 'max-overall-download-limit': '0' })
  })

  it('从没设过限速时打开开关返回 false（不凭空造 1MB/s）', async () => {
    const store = useStatsStore()
    store.globalOptions = { 'max-overall-download-limit': '0' }
    await expect(store.toggleSpeedLimit()).resolves.toBe(false)
    expect(service.changeGlobalOption).not.toHaveBeenCalled()
  })

  it('设过限速后关掉再打开能恢复上次的值', async () => {
    const store = useStatsStore()
    await store.setSpeedLimit(524288)
    store.globalOptions = { 'max-overall-download-limit': '524288' }
    service.changeGlobalOption.mockClear()

    await expect(store.toggleSpeedLimit()).resolves.toBe(true)
    expect(service.changeGlobalOption).toHaveBeenLastCalledWith({ 'max-overall-download-limit': '0' })

    store.globalOptions = { 'max-overall-download-limit': '0' }
    await expect(store.toggleSpeedLimit()).resolves.toBe(true)
    expect(service.changeGlobalOption).toHaveBeenLastCalledWith({ 'max-overall-download-limit': '524288' })
  })
})

describe('缓存清理', () => {
  it('clearCache 同时清掉版本与全局选项', () => {
    const store = useStatsStore()
    store.version = { version: '1.37.0', enabledFeatures: [] } as never
    store.globalOptions = { dir: '/tmp' }
    store.clearCache()
    expect(store.version).toBeNull()
    expect(store.globalOptions).toEqual({})
  })

  it('getGlobalOptions 默认走缓存，force 时重新请求', async () => {
    const store = useStatsStore()
    store.globalOptions = { dir: '/cached' }
    await expect(store.getGlobalOptions()).resolves.toEqual({ dir: '/cached' })
    expect(service.getGlobalOption).not.toHaveBeenCalled()

    await store.getGlobalOptions(true)
    expect(service.getGlobalOption).toHaveBeenCalledTimes(1)
  })
})

describe('加载失败时不清掉已有数据', () => {
  it('getVersion 抛错只记日志，版本保持原值', async () => {
    const store = useStatsStore()
    store.version = { version: '1.36.0', enabledFeatures: [] } as never
    service.getVersion.mockRejectedValueOnce(new Error('rpc down'))
    await expect(store.loadVersion()).resolves.toBeUndefined()
    expect(store.version).toEqual({ version: '1.36.0', enabledFeatures: [] })
  })

  it('getGlobalStat 抛错时统计保持上一次的数值', async () => {
    const store = useStatsStore()
    await store.loadGlobalStat()
    const before = { ...store.globalStat }
    service.getGlobalStat.mockRejectedValueOnce(new Error('rpc down'))
    await expect(store.loadGlobalStat()).resolves.toBeUndefined()
    expect(store.globalStat).toEqual(before)
  })

  it('getGlobalOption 抛错时全局选项保持原值', async () => {
    const store = useStatsStore()
    store.globalOptions = { dir: '/keep' }
    service.getGlobalOption.mockRejectedValueOnce(new Error('rpc down'))
    await expect(store.loadGlobalOptions()).resolves.toBeUndefined()
    expect(store.globalOptions).toEqual({ dir: '/keep' })
  })

  it('getGlobalOptions 失败会把错误抛给调用方（界面要提示）', async () => {
    const store = useStatsStore()
    store.globalOptions = {}
    service.getGlobalOption.mockRejectedValueOnce(new Error('rpc down'))
    await expect(store.getGlobalOptions()).rejects.toThrow('rpc down')
  })

  it('changeGlobalOptions 成功后重新读一次全局选项', async () => {
    const store = useStatsStore()
    service.getGlobalOption.mockResolvedValue({ 'max-overall-download-limit': '2048' })
    await expect(store.changeGlobalOptions({ 'max-overall-download-limit': '2048' })).resolves.toBe('OK')
    expect(service.changeGlobalOption).toHaveBeenCalledWith({ 'max-overall-download-limit': '2048' })
    expect(store.globalOptions).toEqual({ 'max-overall-download-limit': '2048' })
  })

  it('changeGlobalOptions 失败把错误抛给调用方', async () => {
    const store = useStatsStore()
    service.changeGlobalOption.mockRejectedValueOnce(new Error('denied'))
    await expect(store.changeGlobalOptions({ 'max-overall-download-limit': '1' })).rejects.toThrow('denied')
  })
})

describe('未连接时的行为', () => {
  afterEach(() => {
    vi.doUnmock('./connectionStore')
  })

  it('没有 service 时加载类方法静默返回，取/改类方法抛 Not connected', async () => {
    vi.resetModules()
    vi.doMock('./connectionStore', () => ({ useConnectionStore: () => ({ service: null }) }))
    const mod = await import('./statsStore')
    setActivePinia(createPinia())
    const store = mod.useStatsStore()

    await expect(store.loadVersion()).resolves.toBeUndefined()
    await expect(store.loadGlobalStat()).resolves.toBeUndefined()
    await expect(store.loadGlobalOptions()).resolves.toBeUndefined()
    await expect(store.getGlobalOptions()).rejects.toThrow('Not connected')
    await expect(store.changeGlobalOptions({})).rejects.toThrow('Not connected')
    await expect(store.toggleSpeedLimit()).resolves.toBe(false)
  })
})

describe('限速显示', () => {
  it('没有限速时显示空串，限速时给出友好单位', () => {
    const store = useStatsStore()
    store.globalOptions = { 'max-overall-download-limit': '0' }
    expect(store.isSpeedLimited).toBe(false)
    expect(store.speedLimitDisplay).toBe('')

    store.globalOptions = { 'max-overall-download-limit': '1048576' }
    expect(store.isSpeedLimited).toBe(true)
    expect(store.speedLimitDisplay).toBe('1024 KB/s')
  })

  it('限速值不是数字时按 0 处理（不显示 NaN）', () => {
    const store = useStatsStore()
    store.globalOptions = { 'max-overall-download-limit': 'unlimited' }
    expect(store.isSpeedLimited).toBe(true)
    expect(store.speedLimitDisplay).toBe('0 KB/s')
  })

  it('clearGlobalOptions 只清选项，不动版本与统计', async () => {
    const store = useStatsStore()
    await store.loadGlobalStat()
    store.version = { version: '1.37.0', enabledFeatures: [] } as never
    store.globalOptions = { dir: '/x' }
    store.clearGlobalOptions()
    expect(store.globalOptions).toEqual({})
    expect(store.version).not.toBeNull()
    expect(store.globalStat.downloadSpeed).toBe(1024)
  })
})
