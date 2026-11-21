import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const state = {
    exposed: [] as { key: string; api: Record<string, unknown> }[],
    invokes: [] as { channel: string; args: unknown[] }[],
    sends: [] as { channel: string; args: unknown[] }[],
    onCalls: [] as { channel: string; listener: (event: unknown, payload?: unknown) => void }[],
    removed: [] as { channel: string; listener: unknown }[]
  }
  return { state }
})

const { state } = h

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, api: Record<string, unknown>) => {
      state.exposed.push({ key, api })
    }
  },
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => {
      state.invokes.push({ channel, args })
      return Promise.resolve({ channel, args })
    },
    send: (channel: string, ...args: unknown[]) => {
      state.sends.push({ channel, args })
    },
    on: (channel: string, listener: (event: unknown, payload?: unknown) => void) => {
      state.onCalls.push({ channel, listener })
    },
    removeListener: (channel: string, listener: unknown) => {
      state.removed.push({ channel, listener })
    }
  }
}))

await import('./preload')

type Api = Record<string, any>

const api: Api = state.exposed[0].api

function lastInvoke() {
  return state.invokes[state.invokes.length - 1]
}

function lastOn() {
  return state.onCalls[state.onCalls.length - 1]
}

beforeEach(() => {
  state.invokes = []
  state.sends = []
  state.onCalls = []
  state.removed = []
})

describe('暴露接口面', () => {
  it('只通过 contextBridge 暴露一次 electronAPI', () => {
    expect(state.exposed).toHaveLength(1)
    expect(state.exposed[0].key).toBe('electronAPI')
  })

  it('平台信息是值而不是函数', () => {
    expect(api.platform).toBe(process.platform)
  })

  it('所有订阅方法都返回退订函数', () => {
    const subscriptions = Object.keys(api).filter(key => key.startsWith('on'))
    expect(subscriptions.length).toBeGreaterThanOrEqual(10)
    for (const key of subscriptions) {
      const unsubscribe = api[key](() => {})
      expect(typeof unsubscribe).toBe('function')
    }
  })
})

describe('invoke 通道透传', () => {
  it('无参方法只传通道名', async () => {
    await api.getAppVersion()
    expect(lastInvoke()).toEqual({ channel: 'get-app-version', args: [] })
  })

  it('带参方法按顺序透传参数', async () => {
    await api.setStoreValue('settings', { theme: 'dark' })
    expect(lastInvoke()).toEqual({ channel: 'set-store-value', args: ['settings', { theme: 'dark' }] })
  })

  it('可选参数未传时以 undefined 占位，主进程按缺省处理', async () => {
    await api.showItemInFolder('E:/a/b.zip')
    expect(lastInvoke().args).toEqual(['E:/a/b.zip', undefined])
  })

  it('settingsExport 未传选项时下发 undefined（导出默认脱敏）', async () => {
    await api.settingsExport()
    expect(lastInvoke()).toEqual({ channel: 'settings-export', args: [undefined] })
  })

  it('pluginsMarketList 把 force 归一成布尔值', async () => {
    await api.pluginsMarketList()
    expect(lastInvoke().args).toEqual([false])
    await api.pluginsMarketList(true)
    expect(lastInvoke().args).toEqual([true])
  })

  it('aria2 子命名空间的每个方法都映射到独立通道', async () => {
    const channels: string[] = []
    const aria2 = api.aria2 as Record<string, (config?: unknown) => Promise<unknown>>
    for (const key of Object.keys(aria2)) {
      await aria2[key]()
      channels.push(lastInvoke().channel)
    }
    expect(channels).toEqual([
      'aria2-start',
      'aria2-stop',
      'aria2-restart',
      'aria2-status',
      'aria2-update-config',
      'aria2-save-global-options'
    ])
  })

  it('tracker 子命名空间透传三个参数', async () => {
    await api.tracker.setAutoUpdate(true, ['https://a'], 6)
    expect(lastInvoke()).toEqual({
      channel: 'tracker-set-auto-update',
      args: [true, ['https://a'], 6]
    })
  })
})

describe('send 通道（不等待返回）', () => {
  it('下载事件带 kind/gid/name', () => {
    api.notifyDownloadEvent('downloadComplete', 'gid-1', 'a.zip')
    expect(state.sends).toEqual([
      { channel: 'download-event', args: ['downloadComplete', 'gid-1', 'a.zip'] }
    ])
  })

  it('就绪通知与关闭窗口只发通道名', () => {
    api.notifyAppReady()
    api.close()
    expect(state.sends.map(entry => entry.channel)).toEqual(['app-ready', 'window-close'])
  })

  it('渲染层错误上报带原始载荷', () => {
    api.reportRendererError({ message: 'boom', stack: 's', kind: 'render' })
    expect(state.sends[0]).toEqual({
      channel: 'renderer-error',
      args: [{ message: 'boom', stack: 's', kind: 'render' }]
    })
  })
})

describe('事件订阅与退订', () => {
  it('onUpdateStatus 把状态载荷解出来交给回调', () => {
    const callback = vi.fn()
    api.onUpdateStatus(callback)
    expect(lastOn().channel).toBe('update:status')
    lastOn().listener({ sender: 'x' }, { state: 'available', version: '1.5.0' })
    expect(callback).toHaveBeenCalledWith({ state: 'available', version: '1.5.0' })
  })

  it('退订只摘掉自己注册的那个监听器', () => {
    const callback = vi.fn()
    const unsubscribe = api.onUpdateStatus(callback)
    const listener = lastOn().listener
    unsubscribe()
    expect(state.removed).toEqual([{ channel: 'update:status', listener }])
  })

  it('同一回调订阅两次得到两个独立监听器', () => {
    const callback = vi.fn()
    const first = api.onTrayAction(callback)
    const firstListener = lastOn().listener
    const second = api.onTrayAction(callback)
    const secondListener = lastOn().listener
    expect(firstListener).not.toBe(secondListener)
    first()
    expect(state.removed).toHaveLength(1)
    expect(state.removed[0].listener).toBe(firstListener)
    second()
    expect(state.removed[1].listener).toBe(secondListener)
  })

  it.each([
    ['onClipboardUrlDetected', 'clipboard-url-detected', 'magnet:?xt=urn:btih:abc'],
    ['onPendingDownloadUrl', 'pending-download-url', 'https://example.com/a.zip'],
    ['onTrayAction', 'tray-action', 'new-task']
  ])('%s 订阅 %s 并把载荷原样传出', (method, channel, payload) => {
    const callback = vi.fn()
    api[method](callback)
    expect(lastOn().channel).toBe(channel)
    lastOn().listener({}, payload)
    expect(callback).toHaveBeenCalledWith(payload)
  })

  it('onEngineStarted 的回调不需要载荷', () => {
    const callback = vi.fn()
    api.onEngineStarted(callback)
    expect(lastOn().channel).toBe('aria2-engine-started')
    lastOn().listener({})
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('onEngineCrashed 与 onEngineGaveUp 各自带计数', () => {
    const crashed = vi.fn()
    const gaveUp = vi.fn()
    api.onEngineCrashed(crashed)
    expect(lastOn().channel).toBe('aria2-engine-crashed')
    lastOn().listener({}, { retryCount: 2 })
    expect(crashed).toHaveBeenCalledWith({ retryCount: 2 })
    api.onEngineGaveUp(gaveUp)
    expect(lastOn().channel).toBe('aria2-engine-gave-up')
    lastOn().listener({}, { attempts: 3 })
    expect(gaveUp).toHaveBeenCalledWith({ attempts: 3 })
  })

  it('安装进度事件透传百分比对象', () => {
    const ytdlp = vi.fn()
    const ffmpeg = vi.fn()
    api.onYtdlpInstallProgress(ytdlp)
    expect(lastOn().channel).toBe('ytdlp-install-progress')
    lastOn().listener({}, { percent: 42, transferred: 4, total: 10 })
    expect(ytdlp).toHaveBeenCalledWith({ percent: 42, transferred: 4, total: 10 })
    api.onFfmpegInstallProgress(ffmpeg)
    expect(lastOn().channel).toBe('ffmpeg-install-progress')
    lastOn().listener({}, { percent: 7, transferred: 1, total: 14 })
    expect(ffmpeg).toHaveBeenCalledWith({ percent: 7, transferred: 1, total: 14 })
  })

  it('onPendingTaskFile 透传文件载荷', () => {
    const callback = vi.fn()
    api.onPendingTaskFile(callback)
    expect(lastOn().channel).toBe('pending-task-file')
    const file = { name: 'a.torrent', data: 'YmFzZTY0', kind: 'torrent' }
    lastOn().listener({}, file)
    expect(callback).toHaveBeenCalledWith(file)
  })

  it('onConfigChanged 与 onStreamDownloadEvent 透传载荷', () => {
    const config = vi.fn()
    const stream = vi.fn()
    api.onConfigChanged(config)
    expect(lastOn().channel).toBe('config:changed')
    lastOn().listener({}, { key: 'engine-restart-required', value: true })
    expect(config).toHaveBeenCalledWith({ key: 'engine-restart-required', value: true })
    api.onStreamDownloadEvent(stream)
    expect(lastOn().channel).toBe('stream-download-event')
    lastOn().listener({}, { id: 's1', kind: 'progress' })
    expect(stream).toHaveBeenCalledWith({ id: 's1', kind: 'progress' })
  })

  it('tracker.onUpdated 同样返回退订函数', () => {
    const callback = vi.fn()
    const unsubscribe = api.tracker.onUpdated(callback)
    expect(lastOn().channel).toBe('tracker:updated')
    lastOn().listener({}, { added: 1 })
    expect(callback).toHaveBeenCalledWith({ added: 1 })
    unsubscribe()
    expect(state.removed[0].channel).toBe('tracker:updated')
  })
})

/**
 * 全通道清点：把 electronAPI 上每个叶子函数都真调一次，记录它落到哪个 IPC 通道。
 *
 * 为什么需要：桥接层是渲染层与主进程之间唯一的契约面，漏接一个通道的表现是
 * 「点了按钮没反应」，而单测里逐个手写断言总会漏掉后加的接口。这里用遍历把
 * 覆盖面锁成"接口面变化必须被看见"：新增方法会自动纳入，通道重名会立刻失败。
 */
describe('全通道清点', () => {
  type Leaf = { path: string; fn: () => unknown }

  function collectLeaves(source: Record<string, unknown>, prefix = ''): Leaf[] {
    const leaves: Leaf[] = []
    for (const [key, value] of Object.entries(source)) {
      const path = prefix ? `${prefix}.${key}` : key
      if (typeof value === 'function') {
        leaves.push({ path, fn: value as () => unknown })
      } else if (typeof value === 'object' && value !== null) {
        leaves.push(...collectLeaves(value as Record<string, unknown>, path))
      }
    }
    return leaves
  }

  it('每个叶子方法都对应一个 IPC 通道，且通道不重名', async () => {
    const leaves = collectLeaves(api)
    // 平台信息是值而不是函数，不属于叶子方法
    expect(leaves.length).toBeGreaterThanOrEqual(100)

    const channels: string[] = []
    for (const leaf of leaves) {
      state.invokes = []
      state.sends = []
      state.onCalls = []
      await leaf.fn()
      const touched = state.invokes.length + state.sends.length + state.onCalls.length
      expect(touched, `${leaf.path} 没有落到任何 IPC 通道`).toBe(1)
      const channel = state.invokes[0]?.channel ?? state.sends[0]?.channel ?? state.onCalls[0]?.channel
      expect(typeof channel, `${leaf.path} 的通道名不是字符串`).toBe('string')
      channels.push(channel as string)
    }

    const duplicates = channels.filter((channel, index) => channels.indexOf(channel) !== index)
    expect(duplicates, `通道被多个方法共用：${duplicates.join(', ')}`).toEqual([])
  })

  it('订阅类方法全部登记了监听器而不是发请求', async () => {
    const leaves = collectLeaves(api).filter(leaf => /(^|\.)on[A-Z]/.test(leaf.path))
    expect(leaves.length).toBeGreaterThanOrEqual(12)
    for (const leaf of leaves) {
      state.invokes = []
      state.sends = []
      state.onCalls = []
      state.removed = []
      const unsubscribe = await leaf.fn()
      expect(state.onCalls, `${leaf.path} 应该登记监听器`).toHaveLength(1)
      expect(state.invokes).toHaveLength(0)
      expect(typeof unsubscribe, `${leaf.path} 应该返回退订函数`).toBe('function')
      ;(unsubscribe as () => void)()
      expect(state.removed).toHaveLength(1)
      expect(state.removed[0].channel).toBe(state.onCalls[0].channel)
    }
  })
})
