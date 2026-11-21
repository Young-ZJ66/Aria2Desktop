import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  body: '{"a":1}',
  error: null,
  timeout: false,
  spawnCalls: []
}))

vi.mock('node:http', async () => {
  const { EventEmitter: Emitter } = await import('node:events')
  return {
    default: {
      request(url, options, callback) {
        const req = new Emitter()
        req.destroy = (error) => { req.emit('error', error) }
        req.end = () => {
          if (h.error) { req.emit('error', h.error); return }
          if (h.timeout) { req.emit('timeout'); return }
          const res = new Emitter()
          callback(res)
          queueMicrotask(() => { res.emit('data', h.body); res.emit('end') })
        }
        return req
      }
    }
  }
})

vi.mock('node:child_process', () => ({
  spawnSync: (command, args, options) => {
    h.spawnCalls.push({ command, args, options })
    return { status: 0 }
  }
}))

const { collectErrors, connect, createReporter, evalIn, httpJson, killTree } = await import('./cdp.mjs')

function resetHttp() {
  h.body = '{"a":1}'
  h.error = null
  h.timeout = false
}

afterEach(() => {
  resetHttp()
  h.spawnCalls = []
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('httpJson', () => {
  it('把响应体解析成 JSON', async () => {
    h.body = '{"targets":[]}'
    await expect(httpJson('http://127.0.0.1:9222/json/list')).resolves.toEqual({ targets: [] })
  })

  it('空响应体解析成 null 而不是抛错', async () => {
    h.body = ''
    await expect(httpJson('http://127.0.0.1:9222/json/list')).resolves.toBeNull()
  })

  it('响应体不是 JSON 时原样返回文本', async () => {
    h.body = '<html>not json</html>'
    await expect(httpJson('http://127.0.0.1:9222/json/list')).resolves.toBe('<html>not json</html>')
  })

  it('请求超时后 reject（不会永远 pending）', async () => {
    h.timeout = true
    await expect(httpJson('http://127.0.0.1:9222/json/list')).rejects.toThrow('timeout')
  })

  it('连接错误时 reject', async () => {
    h.error = new Error('ECONNREFUSED')
    await expect(httpJson('http://127.0.0.1:9222/json/list')).rejects.toThrow('ECONNREFUSED')
  })
})

class FakeWebSocket {
  static autoOpen = true

  constructor(url) {
    this.url = url
    this.sent = []
    this.closed = false
    FakeWebSocket.last = this
    if (FakeWebSocket.autoOpen) setTimeout(() => this.onopen?.({}), 0)
  }

  send(payload) {
    this.sent.push(JSON.parse(payload))
  }

  close() {
    this.closed = true
    this.onclose?.({})
  }
}

describe('connect', () => {
  it('连接失败时 reject 并带上地址', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    FakeWebSocket.autoOpen = false
    try {
      const pending = connect('ws://127.0.0.1:9222/devtools/page/1')
      await new Promise((resolve) => setTimeout(resolve, 5))
      FakeWebSocket.last.onerror({})
      await expect(pending).rejects.toThrow('CDP 连接失败')
    } finally {
      FakeWebSocket.autoOpen = true
    }
  })

  it('close() 关闭底层套接字', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const session = await connect('ws://fake')
    session.close()
    expect(FakeWebSocket.last.closed).toBe(true)
  })

  it('无 id 的事件消息收进 events，不干扰在等的命令', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const session = await connect('ws://fake')
    const pending = session.send('Runtime.evaluate', { expression: '1' }, 1000)
    const { id } = FakeWebSocket.last.sent[0]
    FakeWebSocket.last.onmessage({ data: JSON.stringify({ method: 'Log.entryAdded', params: { entry: { level: 'error' } } }) })
    FakeWebSocket.last.onmessage({ data: JSON.stringify({ id: 999, result: { ok: true } }) })
    FakeWebSocket.last.onmessage({ data: JSON.stringify({ id, result: { result: { value: 1 } } }) })
    await expect(pending).resolves.toEqual({ id, result: { result: { value: 1 } } })
    expect(session.events).toHaveLength(1)
    expect(session.events[0].method).toBe('Log.entryAdded')
  })
})

describe('evalIn', () => {
  it('返回求值结果并带 returnByValue / awaitPromise', async () => {
    const calls = []
    const session = {
      send: async (method, params) => {
        calls.push({ method, params })
        return { result: { result: { value: 42 } } }
      }
    }
    await expect(evalIn(session, '6*7')).resolves.toBe(42)
    expect(calls[0].method).toBe('Runtime.evaluate')
    expect(calls[0].params).toEqual({ expression: '6*7', returnByValue: true, awaitPromise: true })
  })

  it('页面内抛异常时把异常文本带回 Node 侧', async () => {
    const session = {
      send: async () => ({ result: { exceptionDetails: { text: 'Uncaught TypeError: x is undefined' } } })
    }
    await expect(evalIn(session, 'x.y')).rejects.toThrow('求值异常')
    await expect(evalIn(session, 'x.y')).rejects.toThrow('Uncaught TypeError: x is undefined')
  })

  it('表达式过长时截断到 120 字符再拼进错误文案', async () => {
    const session = { send: async () => ({ result: { exceptionDetails: { text: 'boom' } } }) }
    const long = 'a'.repeat(500)
    await expect(evalIn(session, long)).rejects.toThrow('a'.repeat(120))
    await expect(evalIn(session, long)).rejects.not.toThrow('a'.repeat(121))
  })
})

describe('collectErrors', () => {
  it('只收未捕获异常与 error 级日志', () => {
    const session = {
      events: [
        { method: 'Runtime.exceptionThrown' },
        { method: 'Log.entryAdded', params: { entry: { level: 'error' } } },
        { method: 'Log.entryAdded', params: { entry: { level: 'warn' } } },
        { method: 'Runtime.consoleAPICalled' },
        { method: 'Log.entryAdded' }
      ]
    }
    expect(collectErrors(session)).toHaveLength(2)
  })

  it('没有事件时返回空数组', () => {
    expect(collectErrors({ events: [] })).toEqual([])
  })
})

describe('killTree', () => {
  it('pid 为空时什么也不做', () => {
    killTree(0)
    killTree(undefined)
    expect(h.spawnCalls).toHaveLength(0)
  })

  it('Windows 上用 taskkill /T /F 结束整棵树', () => {
    const original = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    try {
      killTree(4321)
    } finally {
      Object.defineProperty(process, 'platform', { value: original, configurable: true })
    }
    expect(h.spawnCalls).toHaveLength(1)
    expect(h.spawnCalls[0].command).toBe('taskkill')
    expect(h.spawnCalls[0].args).toEqual(['/PID', '4321', '/T', '/F'])
  })

  it('POSIX 上先杀进程组，失败再退化成杀单个 pid', () => {
    const original = process.platform
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('ESRCH')
    })
    try {
      expect(() => killTree(1234)).not.toThrow()
    } finally {
      Object.defineProperty(process, 'platform', { value: original, configurable: true })
    }
    expect(kill.mock.calls).toEqual([[-1234, 'SIGKILL'], [1234, 'SIGKILL']])
  })

  it('进程已退出时连退化路径失败也不抛', () => {
    const original = process.platform
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('ESRCH')
    })
    try {
      expect(() => killTree(9)).not.toThrow()
    } finally {
      Object.defineProperty(process, 'platform', { value: original, configurable: true })
    }
    expect(kill).toHaveBeenCalledTimes(2)
  })
})

describe('createReporter', () => {
  it('check 记录结果并按 PASS/FAIL 打印', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const reporter = createReporter()
    reporter.check('第一条', true, '细节')
    reporter.check('第二条', false)
    expect(reporter.results).toEqual([
      { name: '第一条', ok: true, detail: '细节' },
      { name: '第二条', ok: false, detail: '' }
    ])
    const text = log.mock.calls.flat().join(' ')
    expect(text).toContain('PASS 第一条 :: 细节')
    expect(text).toContain('FAIL 第二条')
  })

  it('failed 只返回失败项，summary 返回失败数量', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const reporter = createReporter()
    reporter.check('ok', true)
    reporter.check('bad', false, '原因')
    expect(reporter.failed).toHaveLength(1)
    expect(reporter.summary()).toBe(1)
  })

  it('CI 上把失败断言升格成 ::error:: 注解并转义换行与百分号', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    process.env.GITHUB_ACTIONS = 'true'
    try {
      const reporter = createReporter()
      reporter.check('失败项 100%', false, '第一行\n第二行')
      reporter.summary()
    } finally {
      delete process.env.GITHUB_ACTIONS
    }
    const text = log.mock.calls.flat().join('\n')
    expect(text).toContain('::error title=失败项 100%25::第一行%0A第二行')
  })

  it('CI 上失败超过 10 条时给出剩余条数提示', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    process.env.GITHUB_ACTIONS = 'true'
    try {
      const reporter = createReporter()
      for (let index = 0; index < 12; index += 1) reporter.check('第' + index + '项', false, '原因')
      reporter.summary()
    } finally {
      delete process.env.GITHUB_ACTIONS
    }
    const text = log.mock.calls.flat().join('\n')
    expect(text).toContain('还有 2 条失败断言未列出')
  })
})
