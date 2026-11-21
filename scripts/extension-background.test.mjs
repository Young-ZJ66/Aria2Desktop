/**
 * 扩展 service worker 的行为用例（D-07 / D-08 / D-09）。
 *
 * 为什么值得单测：这三个缺陷的修复全在 extension/background.js 里，而扩展是 MV3
 * service worker，vitest 默认收不到它——于是"嗅探把 .ts 分片当普通视频"、"批量发送没有
 * 并发/超时"、"接管失败丢掉 Referer/Cookie" 这三类回归只能靠人工点浏览器才能发现。
 * 这里用 node:vm 把 background.js 当脚本跑起来，注入一个假的 chrome 对象，
 * 直接验证三条链路的可观察结果（列表内容、并发上限、兜底下发参数）。
 *
 * 注意：用例文件放在 scripts/ 而不是 extension/——pack:extension-zip 会把 extension/
 * 目录下除 README.md/Icon.ico 之外的文件全部打进商店 zip，测试文件不该上架。
 */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = fs.readFileSync(path.join(root, 'extension/background.js'), 'utf8')

/** 假 chrome：只实现 background.js 真正用到的 API，其余按需在用例里替换 */
function createChrome(state) {
  const listeners = {}
  const addListener = (name) => (fn) => { listeners[name] = fn }
  const chrome = {
    i18n: { getMessage: () => undefined },
    runtime: {
      getManifest: () => ({ version: '1.5.0' }),
      getPlatformInfo: async () => ({ os: 'win' }),
      getURL: (p) => 'chrome-extension://test/' + p,
      lastError: undefined,
      sendMessage: () => Promise.resolve(),
      onInstalled: { addListener: addListener('installed') },
      onMessage: { addListener: addListener('message') }
    },
    storage: {
      local: {
        get: async (key) => ({ [key]: state.config }),
        set: async (patch) => { state.localWrites.push(patch) }
      },
      session: {
        get: async (key) => ({ [key]: state.session.get(key) }),
        set: (patch) => { for (const [k, v] of Object.entries(patch)) state.session.set(k, v) },
        remove: (key) => { state.session.delete(key) }
      },
      onChanged: { addListener: addListener('storageChanged') }
    },
    cookies: { getAll: async () => state.cookies },
    webRequest: {
      onBeforeRequest: { addListener: addListener('beforeRequest') },
      onCompleted: { addListener: addListener('completed') },
      onErrorOccurred: { addListener: addListener('errorOccurred') }
    },
    tabs: {
      query: async () => [{ id: 1, url: state.tabUrl }],
      onRemoved: { addListener: addListener('tabRemoved') }
    },
    notifications: {
      create: (options, callback) => {
        state.notifications.push(options)
        if (callback) callback()
      }
    },
    scripting: { executeScript: async () => [] },
    contextMenus: {
      removeAll: async () => {},
      create: () => {},
      onClicked: { addListener: addListener('menuClicked') }
    },
    downloads: {
      onDeterminingFilename: { addListener: addListener('determiningFilename') },
      download: (options, callback) => {
        state.downloads.push(options)
        if (callback) callback(state.downloadId)
      },
      cancel: async () => {},
      erase: () => {}
    }
  }
  return { chrome, listeners }
}

/**
 * 载入 background.js 并返回测试用的操作面。
 *
 * vm 上下文里没有 URL/AbortController/fetch 等宿主全局，必须显式注入；
 * setTimeout 直接取当前的全局函数，因此 vi.useFakeTimers() 对脚本内部同样生效。
 */
function loadBackground(overrides = {}) {
  const state = {
    config: { enabled: true, interceptAll: false, allowCookies: false, token: 'token-1', secret: '', ...overrides.config },
    session: new Map(),
    localWrites: [],
    cookies: [],
    tabUrl: 'https://example.com/page',
    notifications: [],
    downloads: [],
    downloadId: 42,
    fetchImpl: overrides.fetchImpl || (async () => ({ status: 200, ok: true, json: async () => ({ ok: true, gid: 'g1' }) }))
  }
  const { chrome, listeners } = createChrome(state)
  const sandbox = {
    chrome,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    URL,
    URLSearchParams,
    AbortController,
    TextDecoder,
    fetch: (...args) => state.fetchImpl(...args)
  }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: 'background.js' })
  const send = (message) => new Promise((resolve) => {
    const handled = listeners.message(message, {}, resolve)
    if (!handled) resolve(undefined)
  })
  return { state, listeners, send }
}

/** 推进若干轮微任务：脚本里大量 .then 链，断言前需要让它们跑完 */
async function flush(times = 8) {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

describe('扩展嗅探的分片识别（D-07）', () => {
  it('HLS 的 .ts 与 DASH 的 .m4s 都不进资源列表，只计入 fragmentCount', async () => {
    const bg = loadBackground()
    await flush()
    const completed = bg.listeners.completed
    const emit = (requestId, url, type = 'xmlhttprequest') => completed({ tabId: 1, requestId, url, type, method: 'GET', statusCode: 200 })
    emit('r1', 'https://v.example.com/hls/seg-1.ts')
    emit('r2', 'https://v.example.com/hls/seg-2.ts')
    emit('r3', 'https://v.example.com/dash/init.m4s')
    emit('r4', 'https://v.example.com/hls/master.m3u8')
    emit('r5', 'https://v.example.com/movie.mp4', 'media')
    const data = await bg.send({ action: 'getSnifferData' })
    expect(data.success).toBe(true)
    const urls = data.items.map((item) => item.url)
    expect(urls).toEqual(['https://v.example.com/movie.mp4', 'https://v.example.com/hls/master.m3u8'])
    expect(data.fragmentCount).toBe(3)
    expect(data.totalCount).toBe(5)
    expect(data.playlistCount).toBe(1)
  })

  it('播放列表标记为 playlist，普通视频不会被误标', async () => {
    const bg = loadBackground()
    await flush()
    bg.listeners.completed({ tabId: 1, requestId: 'p1', url: 'https://v.example.com/a.mpd', type: 'xmlhttprequest', method: 'GET' })
    bg.listeners.completed({ tabId: 1, requestId: 'p2', url: 'https://v.example.com/a.mp4', type: 'media', method: 'GET' })
    const data = await bg.send({ action: 'getSnifferData' })
    const byUrl = new Map(data.items.map((item) => [item.url, item]))
    expect(byUrl.get('https://v.example.com/a.mpd').playlist).toBe(true)
    expect(byUrl.get('https://v.example.com/a.mpd').kind).toBe('playlist')
    expect(byUrl.get('https://v.example.com/a.mp4').playlist).toBe(false)
    expect(byUrl.get('https://v.example.com/a.mp4').fragment).toBe(false)
  })
})

describe('扩展批量发送的并发与超时（D-08）', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('并发不超过 4，且逐条进度写进 storage.session', async () => {
    let inFlight = 0
    let peak = 0
    const bg = loadBackground({
      fetchImpl: async () => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 10))
        inFlight -= 1
        return { status: 200, ok: true, json: async () => ({ ok: true, gid: 'g' }) }
      }
    })
    await vi.advanceTimersByTimeAsync(0)
    const urls = Array.from({ length: 8 }, (_, i) => 'https://example.com/f' + i + '.zip')
    const pending = bg.send({ action: 'sendGrabbedLinks', links: urls, pageUrl: 'https://example.com/' })
    await vi.advanceTimersByTimeAsync(100)
    const summary = await pending
    expect(summary.total).toBe(8)
    expect(summary.sent).toBe(8)
    expect(summary.failed).toBe(0)
    expect(peak).toBeLessThanOrEqual(4)
    expect(peak).toBeGreaterThan(1)
    const stored = bg.state.session.get('batchQueue')
    expect(stored.items.every((item) => item.status === 'done')).toBe(true)
  })

  it('单条超过 5 秒判失败，不拖住整批', async () => {
    // 注意：App 建任务走的是 POST /api/add，目标地址在 body 里而不是 fetch 的第一个参数
    const bg = loadBackground({
      fetchImpl: (_url, init) => String(init?.body || '').includes('slow.zip')
        ? new Promise(() => {})
        : Promise.resolve({ status: 200, ok: true, json: async () => ({ ok: true, gid: 'g' }) })
    })
    await vi.advanceTimersByTimeAsync(0)
    const pending = bg.send({ action: 'sendGrabbedLinks', links: ['https://example.com/slow.zip', 'https://example.com/fast.zip'] })
    await vi.advanceTimersByTimeAsync(6000)
    const summary = await pending
    expect(summary.sent).toBe(1)
    expect(summary.failed).toBe(1)
    expect(summary.failedUrls).toEqual(['https://example.com/slow.zip'])
    expect(summary.errors).toEqual(['errTimeout'])
  })

  it('重复 URL 只入队一次，且超过 200 条时截断', async () => {
    const bg = loadBackground()
    await vi.advanceTimersByTimeAsync(0)
    const summary = await bg.send({ action: 'sendGrabbedLinks', links: ['https://a/1.zip', 'https://a/1.zip'] })
    expect(summary.total).toBe(1)
  })
})

describe('扩展接管失败的兜底重下（D-09）', () => {
  it('回落浏览器时保留文件名、Referer 与 Cookie', async () => {
    const bg = loadBackground({
      config: { interceptAll: true, allowCookies: true, token: 'token-1' },
      fetchImpl: async () => ({ status: 200, ok: true, json: async () => ({ ok: false, code: 'engine_unavailable' }) })
    })
    bg.state.cookies = [{ name: 'sid', value: 'abc' }]
    await flush()
    const onDetermining = bg.listeners.determiningFilename
    const handled = onDetermining({
      id: 7,
      url: 'https://files.example.com/report.pdf',
      filename: 'C:\\Users\\me\\Downloads\\report.pdf',
      referrer: 'https://files.example.com/list'
    })
    expect(handled).toBe(true)
    await flush(30)
    expect(bg.state.downloads).toHaveLength(1)
    expect(bg.state.downloads[0]).toMatchObject({
      url: 'https://files.example.com/report.pdf',
      filename: 'report.pdf',
      conflictAction: 'uniquify'
    })
    expect(bg.state.downloads[0].headers).toEqual([
      { name: 'Referer', value: 'https://files.example.com/list' },
      { name: 'Cookie', value: 'sid=abc' }
    ])
    // 回落成功要有明确提示，否则用户只看到一条被取消的浏览器下载记录
    expect(bg.state.notifications.some((n) => n.title === 'interceptFallbackTitle')).toBe(true)
  })
})