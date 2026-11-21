/**
 * BT 洞察 composable 单测。
 *
 * 覆盖三类逻辑：BT 任务识别（磁力元数据未挂上时的边界）、tracker 行提取（tier 分组与去重）、
 * 轮询生命周期（启停、错误降级保留上一帧、gid 切换重置）。这些是页面手点验不出来的。
 *
 * service 实例由调用方注入（页面传 connectionStore.service getter），测试传纯 mock，不触网。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRenderer, defineComponent, ref } from 'vue'

import {
  BT_INSIGHTS_POLL_MS,
  isBtTask,
  trackerRowsFromTask,
  useBtInsights
} from '@/composables/useBtInsights'
import type { Aria2Task } from '@/types/aria2'
import type { Aria2Service } from '@/services/aria2Service'

// service 实例由页面从 connectionStore 注入；测试里构造一个纯 mock
interface HostNode {
  kind: string
  text?: string
  children?: HostNode[]
}

/** 最小自定义渲染器：只为让 onUnmounted 有真实组件实例可挂（项目未装 @vue/test-utils） */
function createHostRenderer() {
  return createRenderer<HostNode, HostNode>({
    createElement: (type: string) => ({ kind: type, children: [] }),
    createText: (text: string) => ({ kind: '#text', text }),
    createComment: (text: string) => ({ kind: '#comment', text }),
    setText: (node, text) => {
      node.text = text
    },
    setElementText: (node, text) => {
      node.text = text
    },
    insert: () => {
      // 测试渲染器不维护真实树
    },
    remove: () => {
      // 测试渲染器不维护真实树
    },
    parentNode: () => null,
    nextSibling: () => null,
    patchProp: () => {
      // 组件不渲染任何真实属性
    }
  })
}

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

describe('useBtInsights 轮询与卸载的边界', () => {
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

  function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (reason: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }

  it('refreshOnce 在未选任务或未连接时直接返回', async () => {
    const idleGid = ref<string | null>(null)
    const enabled = ref(true)
    const idle = useBtInsights(idleGid, enabled, () => svc.service)
    await idle.refreshOnce()
    expect(svc.tellStatus).not.toHaveBeenCalled()

    const offlineGid = ref<string | null>('g1')
    const offline = useBtInsights(offlineGid, enabled, () => null)
    await offline.refreshOnce()
    expect(svc.tellStatus).not.toHaveBeenCalled()
  })

  it('在途请求返回前切换任务时丢弃旧任务的结果', async () => {
    const gate = deferred<Aria2Task>()
    svc.tellStatus.mockImplementation((id: string) =>
      id === 'g1' ? gate.promise : Promise.resolve(makeTask({ gid: id }))
    )
    svc.getPeers.mockResolvedValue([])
    const { gid, snapshot } = setup(null, true)

    gid.value = 'g1'
    await vi.advanceTimersByTimeAsync(0)
    gid.value = 'g2'
    await vi.advanceTimersByTimeAsync(0)
    const current = snapshot.value
    expect(current?.gid).toBe('g2')

    gate.resolve(makeTask({ gid: 'g1', bittorrent: { infoHash: 'stale' } as Aria2Task['bittorrent'] }))
    await vi.advanceTimersByTimeAsync(0)
    expect(snapshot.value).toBe(current)
  })

  it('在途请求失败前切换任务时不覆盖新任务的数据', async () => {
    const gate = deferred<Aria2Task>()
    svc.tellStatus.mockImplementation((id: string) =>
      id === 'g1' ? gate.promise : Promise.resolve(makeTask({ gid: id }))
    )
    svc.getPeers.mockResolvedValue([])
    const { gid, snapshot } = setup(null, true)

    gid.value = 'g1'
    await vi.advanceTimersByTimeAsync(0)
    gid.value = 'g2'
    await vi.advanceTimersByTimeAsync(0)
    const current = snapshot.value

    gate.reject(new Error('旧任务已被删除'))
    await vi.advanceTimersByTimeAsync(0)
    expect(snapshot.value).toBe(current)
    expect(snapshot.value?.error).toBeNull()
  })

  it('上一轮响应未返回时不会叠加新的 RPC 轮询', async () => {
    const pendingCalls: Array<ReturnType<typeof deferred<Aria2Task>>> = []
    svc.tellStatus.mockImplementation(() => {
      const call = deferred<Aria2Task>()
      pendingCalls.push(call)
      return call.promise
    })
    svc.getPeers.mockResolvedValue([])
    const { gid } = setup(null, true)

    gid.value = 'g1'
    await vi.advanceTimersByTimeAsync(0)
    expect(pendingCalls).toHaveLength(1)

    // 第一轮定时器到点，但请求一直不返回（polling 保持 true）
    await vi.advanceTimersByTimeAsync(BT_INSIGHTS_POLL_MS)
    expect(pendingCalls).toHaveLength(2)

    gid.value = 'g2'
    await vi.advanceTimersByTimeAsync(0)
    expect(pendingCalls).toHaveLength(3)

    // 上一轮仍在等响应：新定时器只把自己重排，不再发 RPC
    await vi.advanceTimersByTimeAsync(BT_INSIGHTS_POLL_MS)
    expect(pendingCalls).toHaveLength(3)
  })

  it('重新启用轮询后立即恢复拉取', async () => {
    svc.tellStatus.mockResolvedValue(makeTask({ gid: 'g1' }))
    svc.getPeers.mockResolvedValue([])
    const { gid, enabled } = setup(null, true)

    gid.value = 'g1'
    await vi.advanceTimersByTimeAsync(0)
    enabled.value = false
    await vi.advanceTimersByTimeAsync(0)
    const paused = svc.tellStatus.mock.calls.length

    enabled.value = true
    await vi.advanceTimersByTimeAsync(0)
    expect(svc.tellStatus.mock.calls.length).toBeGreaterThan(paused)
  })

  it('在途请求返回时轮询已被关闭则不再排下一轮', async () => {
    const gate = deferred<Aria2Task>()
    svc.tellStatus.mockReturnValueOnce(gate.promise)
    svc.getPeers.mockResolvedValue([])
    const { gid, enabled } = setup(null, true)

    gid.value = 'g1'
    await vi.advanceTimersByTimeAsync(0)
    enabled.value = false
    gate.resolve(makeTask({ gid: 'g1' }))
    await vi.advanceTimersByTimeAsync(0)

    await vi.advanceTimersByTimeAsync(BT_INSIGHTS_POLL_MS * 2)
    expect(svc.tellStatus).toHaveBeenCalledTimes(1)
  })

  it('组件卸载后停止轮询且不再拉取', async () => {
    svc.tellStatus.mockResolvedValue(makeTask({ gid: 'g1' }))
    svc.getPeers.mockResolvedValue([])
    const gid = ref<string | null>(null)
    const enabled = ref(true)
    const renderer = createHostRenderer()
    const app = renderer.createApp(defineComponent({
      setup() {
        useBtInsights(gid, enabled, () => svc.service)
        return () => null
      }
    }))
    app.mount({ kind: 'root', children: [] })

    gid.value = 'g1'
    await vi.advanceTimersByTimeAsync(0)
    expect(svc.tellStatus).toHaveBeenCalledTimes(1)

    app.unmount()
    await vi.advanceTimersByTimeAsync(BT_INSIGHTS_POLL_MS * 3)
    expect(svc.tellStatus).toHaveBeenCalledTimes(1)
  })

  it('遗留的旧轮询定时器到期后自行放弃', async () => {
    const gate = deferred<Aria2Task>()
    svc.tellStatus.mockReturnValueOnce(gate.promise)
    svc.getPeers.mockResolvedValue([])
    const { gid, enabled } = setup(null, true)

    // 首轮请求挂在 gate 上：轮询定时器到点后只把自己重排（polling 分支），产生第二个定时器
    gid.value = 'g1'
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(BT_INSIGHTS_POLL_MS)

    // 首轮返回后 finally 又排了一个定时器，此时同时存在两个待触发的定时器
    gate.resolve(makeTask({ gid: 'g1' }))
    await vi.advanceTimersByTimeAsync(0)
    const callsAfterFirstRound = svc.tellStatus.mock.calls.length

    // stop 只清掉最新的那个句柄，更早的那个仍会到期
    enabled.value = false
    await vi.advanceTimersByTimeAsync(0)

    svc.tellStatus.mockResolvedValue(makeTask({ gid: 'g1' }))
    await vi.advanceTimersByTimeAsync(BT_INSIGHTS_POLL_MS)
    expect(svc.tellStatus.mock.calls.length).toBe(callsAfterFirstRound)
  })
})
