/**
 * 打包产物冒烟里"窗口不是白屏"那一段的判定逻辑。
 *
 * 为什么要测：这一段是冒烟唯一能发现"asar 漏带 dist/vue、preload 路径写错"的地方，
 * 日志全绿但窗口白屏时，只有它会亮红。它内部又要连调试端口、又要兜超时，
 * 逻辑分支多且都在真实运行时才会走到，所以把 cdp 依赖整体替换掉单独跑。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  targets: [],
  listThrows: null,
  snapshot: null,
  evalThrows: null,
  evalHangs: false,
  connectThrows: null,
  closed: 0
}))

vi.mock('./e2e/lib/cdp.mjs', () => ({
  httpJson: async () => {
    if (h.listThrows) throw h.listThrows
    return h.targets
  },
  connect: async () => {
    if (h.connectThrows) throw h.connectThrows
    return {
      send: async () => ({}),
      close: () => { h.closed += 1 }
    }
  },
  evalIn: async () => {
    if (h.evalThrows) throw h.evalThrows
    // 连接没断但求值永远不返回：session.send 在真实环境里就是这样挂住的
    if (h.evalHangs) return new Promise(() => {})
    return h.snapshot
  }
}))

const { checkRendererRendered } = await import('./smoke-packaged.mjs')

function reset() {
  h.targets = []
  h.listThrows = null
  h.snapshot = null
  h.evalThrows = null
  h.evalHangs = false
  h.connectThrows = null
  h.closed = 0
}

afterEach(reset)

describe('checkRendererRendered', () => {
  it('页面正常渲染时判通过，并把标题与正文摘进 detail', async () => {
    h.targets = [{ type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/1' }]
    h.snapshot = { title: 'Aria2 Desktop', text: '正在下载 3 个任务，总速度 1.2 MB/s', url: 'file:///app/index.html' }
    const result = await checkRendererRendered(9222, 2000)
    expect(result.ok).toBe(true)
    expect(result.name).toBe('窗口渲染出了界面（不是白屏）')
    expect(result.detail).toContain('Aria2 Desktop')
    expect(result.detail).toContain('正在下载')
    expect(h.closed).toBe(1)
  })

  it('调试端口没有暴露页面目标时判失败并给出端口', async () => {
    h.targets = [{ type: 'service_worker', webSocketDebuggerUrl: 'ws://sw' }]
    const result = await checkRendererRendered(9333, 300)
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('没有暴露调试目标')
    expect(result.detail).toContain('9333')
  })

  it('调试端口一直连不上时也判失败（不抛错）', async () => {
    h.listThrows = new Error('ECONNREFUSED')
    const result = await checkRendererRendered(9444, 200)
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('没有暴露调试目标')
  })

  it('页面是白屏时判失败', async () => {
    h.targets = [{ type: 'page', webSocketDebuggerUrl: 'ws://page' }]
    h.snapshot = { title: '', text: '', url: 'about:blank' }
    const result = await checkRendererRendered(9222, 1000)
    expect(result.ok).toBe(false)
  })

  it('读取页面内容超时时判失败并说明超时', async () => {
    h.targets = [{ type: 'page', webSocketDebuggerUrl: 'ws://page' }]
    h.snapshot = null
    const result = await checkRendererRendered(9222, 1000)
    expect(result.ok).toBe(false)
    expect(result.detail).toBe('读取页面内容超时')
  })

  it('求值一直不返回时由自带的 8 秒兜底判超时', async () => {
    h.targets = [{ type: 'page', webSocketDebuggerUrl: 'ws://page' }]
    h.evalHangs = true
    vi.useFakeTimers()
    try {
      const pending = checkRendererRendered(9222, 1000)
      await vi.advanceTimersByTimeAsync(8000)
      const result = await pending
      expect(result.ok).toBe(false)
      expect(result.detail).toBe('读取页面内容超时')
    } finally {
      vi.useRealTimers()
    }
  })

  it('连接调试目标失败时把错误带进 detail', async () => {
    h.targets = [{ type: 'page', webSocketDebuggerUrl: 'ws://page' }]
    h.connectThrows = new Error('CDP 连接失败：ws://page')
    const result = await checkRendererRendered(9222, 1000)
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('读取页面失败')
    expect(result.detail).toContain('CDP 连接失败')
  })

  it('求值抛错时同样判失败（异常不许冒到调用方）', async () => {
    h.targets = [{ type: 'page', webSocketDebuggerUrl: 'ws://page' }]
    h.evalThrows = new Error('求值异常：Uncaught ReferenceError')
    const result = await checkRendererRendered(9222, 1000)
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('求值异常')
  })
})
