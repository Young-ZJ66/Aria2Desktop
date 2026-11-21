import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 插件宿主是安全边界：插件代码在独立进程的 vm 沙箱里跑，只能通过消息端口调用白名单 API。
// 这里直接驱动宿主入口（把 process.parentPort 换成假的），验证沙箱隔离、定时器清理与 API 桥接。

type Outgoing = { type: string; [key: string]: unknown }

interface FakePort {
  postMessage: (message: Outgoing) => void
  on: (event: 'message', listener: (event: { data: unknown }) => void) => void
}

let sent: Outgoing[] = []
let dispatch: (message: unknown) => void = () => {}

function installPort(): FakePort {
  return {
    postMessage: (message) => { sent.push(message) },
    on: (_event, listener) => {
      dispatch = (message) => listener({ data: message })
    }
  }
}
async function loadHost(): Promise<void> {
  vi.resetModules()
  sent = []
  Object.defineProperty(process, 'parentPort', { value: installPort(), configurable: true })
  await import('./pluginHost')
}

function messagesOf(type: string): Outgoing[] {
  return sent.filter(message => message.type === type)
}

/** 最后一条指定类型的消息（tsconfig 的 lib 不含 ES2022，不能用 Array.prototype.at） */
function last(type: string): Outgoing | undefined {
  const list = messagesOf(type)
  return list[list.length - 1]
}

/** 宿主把 onActivate 推迟到微任务里执行（同步抛错不能冒到加载流程），断言前先让出一轮 */
function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

const manifest = { id: 'com.test.plugin', name: 'Test', version: '1.0.0', main: 'index.js' }

function load(code: string): Outgoing | undefined {
  dispatch({ type: 'load', pluginId: 'com.test.plugin', manifest, code })
  return last('loaded')
}

describe('插件宿主：启动与沙箱隔离', () => {
  beforeEach(async () => {
    await loadHost()
  })

  afterEach(() => {
    delete (process as unknown as Record<string, unknown>).parentPort
    vi.restoreAllMocks()
  })

  it('启动后向主进程宣告 ready', () => {
    expect(messagesOf('ready')).toHaveLength(1)
  })

  it('沙箱里拿不到 process 与 require（逃逸防护）', async () => {
    const result = load(`
      module.exports = {
        onActivate() {
          notify.send('probe', [typeof process, typeof require, typeof globalThis.process].join(','))
        }
      }
    `)
    expect(result).toMatchObject({ ok: true })
    await flush()
    const notify = last('notify')
    expect(notify?.body).toBe('undefined,undefined,undefined')
  })

  it('插件导出非对象时按空实例处理（不炸）', () => {
    const result = load('module.exports = 42')
    expect(result).toMatchObject({ ok: true })
  })
})

describe('插件宿主：加载与激活', () => {
  beforeEach(async () => {
    await loadHost()
  })

  afterEach(() => {
    delete (process as unknown as Record<string, unknown>).parentPort
    vi.restoreAllMocks()
  })

  it('加载成功后回调 onActivate', async () => {
    const result = load(`
      module.exports = { onActivate() { notify.send('激活了', 'ok') } }
    `)
    expect(result).toMatchObject({ ok: true })
    await vi.waitFor(() => expect(messagesOf('notify')).toHaveLength(1))
    expect(messagesOf('notify')[0]).toMatchObject({ title: '激活了', body: 'ok' })
  })

  it('onActivate 抛错时报 activate-error 而不是让宿主崩溃', async () => {
    load(`module.exports = { onActivate() { throw new Error('激活失败') } }`)
    await vi.waitFor(() => expect(messagesOf('activate-error')).toHaveLength(1))
    expect(String(messagesOf('activate-error')[0].error)).toContain('激活失败')
  })

  it('语法错误时回 loaded ok:false 并带上错误信息', () => {
    const result = load('module.exports = {{{')
    expect(result?.ok).toBe(false)
    expect(String(result?.error).length).toBeGreaterThan(0)
  })

  it('插件里的 console.log 只传可序列化字符串（对象转 JSON）', async () => {
    load(`module.exports = { onActivate() { console.log('文本', { a: 1 }, [1, 2]) } }`)
    await flush()
    const log = messagesOf('log')[0]
    expect(log.level).toBe('log')
    expect(log.args).toEqual(['文本', '{"a":1}', '[1,2]'])
  })
})

describe('插件宿主：定时器受跟踪（D-16）', () => {
  beforeEach(async () => {
    await loadHost()
  })

  afterEach(() => {
    delete (process as unknown as Record<string, unknown>).parentPort
    vi.restoreAllMocks()
  })

  it('加载失败时清掉插件在初始化阶段注册的定时器', async () => {
    // 插件先注册一个会持续打 API 的定时器，再抛错：若宿主不清，加载失败后它还在跑
    load(`
      setInterval(function () { aria2.getGlobalStat() }, 10)
      throw new Error('初始化失败')
    `)
    await new Promise(resolve => setTimeout(resolve, 60))
    const before = messagesOf('api').length
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(messagesOf('api').length).toBe(before)
  })

  it('deactivate 后不再有定时器打 API', async () => {
    load(`
      module.exports = {
        onActivate() { setInterval(function () { aria2.getGlobalStat() }, 10) },
        onDeactivate() { notify.send('停用', 'ok') }
      }
    `)
    await new Promise(resolve => setTimeout(resolve, 60))
    dispatch({ type: 'deactivate' })
    await vi.waitFor(() => expect(messagesOf('deactivated')).toHaveLength(1))
    expect(last('notify')).toMatchObject({ title: '停用' })
    const before = messagesOf('api').length
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(messagesOf('api').length).toBe(before)
  })
})

describe('插件宿主：事件分派', () => {
  beforeEach(async () => {
    await loadHost()
  })

  afterEach(() => {
    delete (process as unknown as Record<string, unknown>).parentPort
    vi.restoreAllMocks()
  })

  it('下载事件分派到对应回调', () => {
    load(`
      module.exports = {
        onDownloadStart(d) { notify.send('start', d.name) },
        onDownloadComplete(d) { notify.send('complete', d.name) },
        onDownloadError(d) { notify.send('error', d.name) }
      }
    `)
    dispatch({ type: 'event', event: 'downloadStart', data: { gid: 'g1', name: 'a.zip' } })
    dispatch({ type: 'event', event: 'downloadComplete', data: { gid: 'g1', name: 'a.zip' } })
    dispatch({ type: 'event', event: 'downloadError', data: { gid: 'g1', name: 'a.zip' } })
    expect(messagesOf('notify').map(m => m.title)).toEqual(['start', 'complete', 'error'])
  })

  it('插件没实现回调时事件被静默忽略', () => {
    load('module.exports = {}')
    expect(() => dispatch({ type: 'event', event: 'downloadStart', data: { gid: 'g', name: 'n' } })).not.toThrow()
    expect(messagesOf('event-error')).toHaveLength(0)
  })

  it('事件回调同步抛错时报 event-error', () => {
    load(`module.exports = { onDownloadComplete() { throw new Error('回调炸了') } }`)
    dispatch({ type: 'event', event: 'downloadComplete', data: { gid: 'g', name: 'n' } })
    expect(String(messagesOf('event-error')[0].error)).toContain('回调炸了')
  })

  it('事件回调返回的 Promise 被 reject 时也报 event-error', async () => {
    load(`module.exports = { onDownloadError() { return Promise.reject(new Error('异步炸了')) } }`)
    dispatch({ type: 'event', event: 'downloadError', data: { gid: 'g', name: 'n' } })
    await vi.waitFor(() => expect(messagesOf('event-error')).toHaveLength(1))
    expect(String(messagesOf('event-error')[0].error)).toContain('异步炸了')
  })
})

describe('插件宿主：白名单 API 桥接', () => {
  beforeEach(async () => {
    await loadHost()
  })

  afterEach(() => {
    delete (process as unknown as Record<string, unknown>).parentPort
    vi.restoreAllMocks()
  })

  it('aria2 调用发 api 消息并带方法名与参数', async () => {
    load(`
      module.exports = { onActivate() { aria2.addUri(['http://a/b.zip'], { dir: '/d' }) } }
    `)
    await flush()
    const api = last('api')
    expect(api).toMatchObject({ method: 'aria2.addUri', args: [['http://a/b.zip'], { dir: '/d' }] })
    expect(typeof api?.id).toBe('number')
  })

  it('api-response ok 时把值交给插件', async () => {
    load(`
      module.exports = {
        onActivate() {
          aria2.getGlobalStat().then(function (stat) { notify.send('统计', String(stat.downloadSpeed)) })
        }
      }
    `)
    await flush()
    const api = last('api')
    dispatch({ type: 'api-response', id: api?.id, ok: true, value: { downloadSpeed: '1234' } })
    await vi.waitFor(() => expect(messagesOf('notify')).toHaveLength(1))
    expect(messagesOf('notify')[0].body).toBe('1234')
  })

  it('api-response 失败时插件收到带原因的 reject', async () => {
    load(`
      module.exports = {
        onActivate() {
          aria2.pause('g1').catch(function (error) { notify.send('失败', error.message) })
        }
      }
    `)
    await flush()
    const api = last('api')
    dispatch({ type: 'api-response', id: api?.id, ok: false, error: '引擎未运行' })
    await vi.waitFor(() => expect(messagesOf('notify')).toHaveLength(1))
    expect(messagesOf('notify')[0].body).toBe('引擎未运行')
  })

  it('未知 id 的 api-response 被忽略', () => {
    expect(() => dispatch({ type: 'api-response', id: 9999, ok: true, value: 1 })).not.toThrow()
  })

  it('settings.get 也走白名单桥接', async () => {
    load(`module.exports = { onActivate() { settings.get('aria2.rpcPort') } }`)
    await flush()
    expect(last('api')).toMatchObject({ method: 'settings.get', args: ['aria2.rpcPort'] })
  })
})

describe('插件宿主：终止', () => {
  beforeEach(async () => {
    await loadHost()
  })

  afterEach(() => {
    delete (process as unknown as Record<string, unknown>).parentPort
    vi.restoreAllMocks()
  })

  it('terminate 拒绝所有在途 API 调用并退出进程', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    load(`
      module.exports = {
        onActivate() {
          aria2.getGlobalStat().catch(function (error) { notify.send('中断', error.message) })
        }
      }
    `)
    await flush()
    dispatch({ type: 'terminate' })
    await vi.waitFor(() => expect(messagesOf('notify')).toHaveLength(1))
    expect(messagesOf('notify')[0].body).toContain('terminated')
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0))
  })

  it('非对象消息被忽略（不抛错）', () => {
    expect(() => dispatch(null)).not.toThrow()
    expect(() => dispatch('字符串')).not.toThrow()
  })
})
/**
 * 未覆盖的细节：错误序列化的非 Error 分支、不可 JSON 化的日志参数，
 * 以及受跟踪定时器在触发后/被插件清掉后的行为（D-16 的收尾条件）。
 */
describe('插件宿主：错误序列化与受跟踪定时器', () => {
  beforeEach(async () => {
    await loadHost()
  })

  afterEach(() => {
    delete (process as unknown as Record<string, unknown>).parentPort
    vi.restoreAllMocks()
  })

  it('插件抛非 Error 值时按字符串回传', async () => {
    load('module.exports = { onActivate() { throw "纯字符串错误" } }')
    await vi.waitFor(() => expect(messagesOf('activate-error')).toHaveLength(1))
    expect(String(messagesOf('activate-error')[0].error)).toBe('纯字符串错误')
  })

  it('console.log 的循环引用参数退化成字符串而不是让宿主崩掉', async () => {
    load(`
      module.exports = {
        onActivate() {
          var loop = {}
          loop.self = loop
          console.log(loop)
        }
      }
    `)
    await flush()
    expect(messagesOf('log')[0].args).toEqual(['[object Object]'])
  })

  it('受跟踪的 setTimeout 触发一次后不再重复', async () => {
    load(`
      module.exports = {
        onActivate() { setTimeout(function () { notify.send('timer', 'fired') }, 10) }
      }
    `)
    await vi.waitFor(() => expect(messagesOf('notify')).toHaveLength(1))
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(messagesOf('notify')).toHaveLength(1)
  })

  it('插件自己清掉的 setTimeout 与 setInterval 都不再触发', async () => {
    load(`
      module.exports = {
        onActivate() {
          var timer = setTimeout(function () { notify.send('timeout', 'x') }, 20)
          var interval = setInterval(function () { notify.send('interval', 'x') }, 20)
          clearTimeout(timer)
          clearInterval(interval)
        }
      }
    `)
    await new Promise(resolve => setTimeout(resolve, 60))
    expect(messagesOf('notify')).toHaveLength(0)
  })

  it('setInterval 在 deactivate 之前会持续触发', async () => {
    load(`
      module.exports = {
        onActivate() { setInterval(function () { notify.send('tick', 'x') }, 10) }
      }
    `)
    await vi.waitFor(() => expect(messagesOf('notify').length).toBeGreaterThanOrEqual(2))
    dispatch({ type: 'deactivate' })
    await vi.waitFor(() => expect(messagesOf('deactivated')).toHaveLength(1))
    const before = messagesOf('notify').length
    await new Promise(resolve => setTimeout(resolve, 60))
    expect(messagesOf('notify').length).toBe(before)
  })
})

