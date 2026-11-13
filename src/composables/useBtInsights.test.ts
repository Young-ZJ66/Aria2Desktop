/**
 * BT 洞察 composable 单测。
 *
 * 覆盖三类逻辑：BT 任务识别（磁力元数据未挂上时的边界）、tracker 行提取（tier 分组与去重）、
 * 轮询生命周期（启停、错误降级保留上一帧、gid 切换重置）。这些是页面手点验不出来的。
 *
 * service 实例由调用方注入（页面传 connectionStore.service getter），测试传纯 mock，不触网。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref } from 'vue'

import {
  BT_INSIGHTS_POLL_MS,
  isBtTask,
  trackerRowsFromTask,
  useBtInsights
} from '@/composables/useBtInsights'
import type { Aria2Task } from '@/types/aria2'
import type { Aria2Service } from '@/services/aria2Service'

// service 实例由页面从 connectionStore 注入；测试里构造一个纯 mock
function makeService(): { service: Aria2Service; tellStatus: ReturnType<typeof vi.fn>; getPeers: ReturnType<typeof vi.fn> } {
  const tellStatus = vi.fn()
  const getPeers = vi.fn()
  const service = { tellStatus, getPeers } as unknown as Aria2Service
  return { service, tellStatus, getPeers }
}

function makeTask(overrides: Partial<Aria2Task> = {}): Aria2Task {
  return {
    gid: 'gid1',
    status: 'active',
    ...overrides
  } as Aria2Task
}

describe('isBtTask', () => {
  it('bittorrent 元数据存在即 BT', () => {
    expect(isBtTask(makeTask({ bittorrent: { mode: 'single' } as Aria2Task['bittorrent'] }))).toBe(true)
  })

  it('磁力 URI 识别为 BT（元数据未挂上时）', () => {
    const magnet = makeTask({
      files: [{ index: '1', length: '0', completedLength: '0', path: '[METADATA]', selected: 'true', uris: [{ uri: 'magnet:?xt=urn:btih:abc', status: 'used' }] }]
    } as Partial<Aria2Task>)
    expect(isBtTask(magnet)).toBe(true)
  })

  it('普通 HTTP 下载不是 BT', () => {
    const http = makeTask({
      files: [{ index: '1', length: '1', completedLength: '0', path: '/tmp/a', selected: 'true', uris: [{ uri: 'https://example.com/a', status: 'used' }] }]
    } as Partial<Aria2Task>)
    expect(isBtTask(http)).toBe(false)
    expect(isBtTask(makeTask())).toBe(false)
  })
})

describe('trackerRowsFromTask', () => {
  it('按 tier 展平并去重', () => {
    const task = makeTask({
      bittorrent: {
        announceList: [
          ['http://t1/announce', 'http://t2/announce'],
          ['http://t1/announce', 'udp://t3/announce']
        ]
      } as Aria2Task['bittorrent']
    })
    expect(trackerRowsFromTask(task)).toEqual([
      { tier: 1, url: 'http://t1/announce' },
      { tier: 1, url: 'http://t2/announce' },
      { tier: 2, url: 'udp://t3/announce' }
    ])
  })

  it('缺失 announceList 返回空数组', () => {
    expect(trackerRowsFromTask(makeTask())).toEqual([])
    expect(trackerRowsFromTask(makeTask({ bittorrent: {} as Aria2Task['bittorrent'] }))).toEqual([])
  })
})

describe('useBtInsights', () => {
  let svc: ReturnType<typeof makeService>

  beforeEach(() => {
    vi.useFakeTimers()
    svc = makeService()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function setup(gidValue: string | null, enabledValue: boolean) {
    const gid = ref<string | null>(gidValue)
    const enabled = ref(enabledValue)
    return { gid, enabled, ...useBtInsights(gid, enabled, () => svc.service) }
  }

  it('未选任务时不发 RPC，不建轮询', async () => {
    setup(null, false)
    await vi.advanceTimersByTimeAsync(BT_INSIGHTS_POLL_MS * 3)
    expect(svc.tellStatus).not.toHaveBeenCalled()
  })

  it('选中任务立即拉取一次', async () => {
    svc.tellStatus.mockResolvedValue(makeTask({ gid: 'g2', bittorrent: { infoHash: 'hash', mode: 'single', announceList: [['http://t/announce']] } as Aria2Task['bittorrent'] }))
    svc.getPeers.mockResolvedValue([])
    const { gid, snapshot } = setup(null, true)
    gid.value = 'g2'
    await vi.advanceTimersByTimeAsync(0)
    expect(svc.tellStatus).toHaveBeenCalledWith('g2')
    expect(snapshot.value?.gid).toBe('g2')
    expect(snapshot.value?.announceList).toEqual([{ tier: 1, url: 'http://t/announce' }])
  })

  it('RPC 失败时保留上一帧数据并记录错误', async () => {
    svc.tellStatus.mockResolvedValueOnce(makeTask({ gid: 'g1', bittorrent: { infoHash: 'hash', announceList: [['http://t/announce']] } as Aria2Task['bittorrent'] }))
    svc.getPeers.mockResolvedValueOnce([{ peerId: 'p', ip: '1.2.3.4', port: '6881', bitfield: '', amChoking: 'false', peerChoking: 'false', downloadSpeed: '10', uploadSpeed: '0', seeder: 'false' }])
    svc.tellStatus.mockRejectedValueOnce(new Error('connection lost'))
    svc.getPeers.mockRejectedValueOnce(new Error('connection lost'))
    const { gid, snapshot } = setup(null, true)
    gid.value = 'g1'
    await vi.advanceTimersByTimeAsync(0)
    expect(snapshot.value?.error).toBeNull()
    expect(snapshot.value?.peers).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(BT_INSIGHTS_POLL_MS)
    expect(snapshot.value?.error).toBe('connection lost')
    // 上一帧数据保留
    expect(snapshot.value?.peers).toHaveLength(1)
    expect(snapshot.value?.announceList).toEqual([{ tier: 1, url: 'http://t/announce' }])
  })

  it('enabled 关闭停止轮询', async () => {
    svc.tellStatus.mockResolvedValue(makeTask({ gid: 'g1' }))
    svc.getPeers.mockResolvedValue([])
    const { gid, enabled } = setup(null, true)
    gid.value = 'g1'
    await vi.advanceTimersByTimeAsync(0)
    enabled.value = false
    const calls = svc.tellStatus.mock.calls.length
    await vi.advanceTimersByTimeAsync(BT_INSIGHTS_POLL_MS * 3)
    expect(svc.tellStatus.mock.calls.length).toBe(calls)
  })

  it('gid 清空时清空 snapshot', async () => {
    svc.tellStatus.mockResolvedValue(makeTask({ gid: 'g1', bittorrent: { announceList: [['http://t/announce']] } as Aria2Task['bittorrent'] }))
    svc.getPeers.mockResolvedValue([])
    const { gid, snapshot } = setup(null, true)
    gid.value = 'g1'
    await vi.advanceTimersByTimeAsync(0)
    expect(snapshot.value).not.toBeNull()
    gid.value = null
    // watch 回调默认 pre-flush，等一个微任务帧
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(snapshot.value).toBeNull()
  })

  it('service 为 null（未连接）时不抛错', async () => {
    const gid = ref<string | null>('g1')
    const enabled = ref(true)
    const { snapshot } = useBtInsights(gid, enabled, () => null)
    gid.value = 'g1'
    await vi.advanceTimersByTimeAsync(0)
    expect(snapshot.value).toBeNull()
  })
})
