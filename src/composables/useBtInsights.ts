/**
 * BT 洞察数据源：按 gid 轮询 tellStatus(bittorrent) + getPeers，聚合成视图需要的形状。
 *
 * 独立成 composable 的原因：页面只负责渲染与交互；“哪些任务算 BT”“轮询生命周期”
 * "错误静默降级"这些可以在 node 环境单测的逻辑都收敛在这里。
 */
import { onUnmounted, ref, shallowRef, watch, type Ref } from 'vue'
import type { Aria2Peer, Aria2Task } from '@/types/aria2'
import type { Aria2Service } from '@/services/aria2Service'

/** 轮询间隔：与 Status 页同量级。太短会把空闲任务的 RPC 打满。 */
export const BT_INSIGHTS_POLL_MS = 5_000

/** 判断一个任务是否是 BT/磁力任务（用于选择器过滤与图标标识） */
export function isBtTask(task: Aria2Task): boolean {
  // 1) 引擎已识别出 bittorrent 元数据（下载中/做种中的 torrent 都会有）
  if (task.bittorrent) return true
  // 2) 磁力任务在元数据下载完成前 bittorrent 尚未挂上：磁力的 files[0].uris 指向磁力本体
  const firstUris = task.files?.[0]?.uris
  if (firstUris && firstUris.length > 0) {
    return firstUris.some(uri => uri.uri?.startsWith('magnet:'))
  }
  return false
}

export interface BtTrackerRow {
  /** tier（announce 组）从 1 开始 */
  tier: number
  url: string
}

export interface BtInsightsSnapshot {
  gid: string
  infoHash?: string
  mode?: string
  announceList: BtTrackerRow[]
  peers: Aria2Peer[]
  /** 轮询中最近一次错误（连接断开等）；恢复后自动清空 */
  error: string | null
}

/** 从任务对象提取去重后的 tracker 行（announceList: string[][]） */
export function trackerRowsFromTask(task: Pick<Aria2Task, 'bittorrent'>): BtTrackerRow[] {
  const tiers = task.bittorrent?.announceList
  if (!Array.isArray(tiers)) return []
  const seen = new Set<string>()
  const rows: BtTrackerRow[] = []
  for (let tierIndex = 0; tierIndex < tiers.length; tierIndex++) {
    const tier = tiers[tierIndex] ?? []
    for (const url of tier) {
      if (typeof url !== 'string' || seen.has(url)) continue
      seen.add(url)
      rows.push({ tier: tierIndex + 1, url })
    }
  }
  return rows
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * BT 洞察轮询。
 *
 * service 通过 getter 注入而不是直接 import：实例由 connectionStore 持有（连接切换时重建），
 * 页面传入 `() => connectionStore.service`；测试传 () => mock 实例。
 *
 * @param gid 当前选中的任务 gid；null/空表示未选中（停轮询）
 * @param enabled 是否轮询（页面失焦/路由切走时传 false，暂停 RPC）
 * @param getService 当前连接的 Aria2Service 实例 getter（可能为 null，表示未连接）
 */
export function useBtInsights(
  gid: Ref<string | null>,
  enabled: Ref<boolean>,
  getService: () => Aria2Service | null
) {
  const snapshot = shallowRef<BtInsightsSnapshot | null>(null)
  const loading = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null
  let polling = false
  let disposed = false

  async function refreshOnce(): Promise<void> {
    const id = gid.value
    if (!id) return
    const service = getService()
    if (!service) return
    try {
      // 两路并行：任务元数据（含 bittorrent）+ peers
      const [status, peers] = await Promise.all([
        service.tellStatus(id),
        service.getPeers(id)
      ])
      if (disposed || gid.value !== id) return
      snapshot.value = {
        gid: id,
        infoHash: status.bittorrent?.infoHash,
        mode: status.bittorrent?.mode,
        announceList: trackerRowsFromTask(status),
        peers: peers ?? [],
        error: null
      }
    } catch (error) {
      // 连接断开/任务被删：保留上一帧数据（表格不闪空），只更新错误字段
      if (disposed || gid.value !== id) return
      const previous = snapshot.value
      snapshot.value = {
        gid: id,
        infoHash: previous?.gid === id ? previous.infoHash : undefined,
        mode: previous?.gid === id ? previous.mode : undefined,
        announceList: previous?.gid === id ? previous.announceList : [],
        peers: previous?.gid === id ? previous.peers : [],
        error: describeError(error)
      }
    }
  }

  function scheduleNext(): void {
    if (disposed || !enabled.value || !gid.value) return
    timer = setTimeout(async () => {
      if (polling) return scheduleNext()
      polling = true
      try {
        await refreshOnce()
      } finally {
        polling = false
        if (!disposed) scheduleNext()
      }
    }, BT_INSIGHTS_POLL_MS)
  }

  function start(): void {
    stop()
    if (!gid.value || !enabled.value) return
    loading.value = true
    refreshOnce().finally(() => {
      loading.value = false
    })
    scheduleNext()
  }

  function stop(): void {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  // gid/enabled 变化时重置轮询；组件卸载时清理（组合式调用点在 setup 内，onUnmounted 合法）
  watch(gid, () => {
    if (gid.value && enabled.value) start()
    else {
      stop()
      snapshot.value = null
    }
  })
  watch(enabled, now => {
    if (now && gid.value) start()
    else stop()
  })
  onUnmounted(() => {
    disposed = true
    stop()
  })

  return { snapshot, loading, refreshOnce }
}
