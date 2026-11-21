import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CDP_COMMAND_TIMEOUT_MS, capture, connect, removeDirWithRetry, sleep, waitFor } from './cdp.mjs'

function tempFile(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-test-'))
  return path.join(dir, name)
}

describe('waitFor', () => {
  it('条件成立时返回最后一次取到的值', async () => {
    let calls = 0
    const value = await waitFor(async () => (++calls >= 2 ? 'ok' : null), { intervalMs: 1, timeoutMs: 1000 })
    expect(value).toBe('ok')
    expect(calls).toBe(2)
  })

  it('超时抛出带 label 的错误', async () => {
    await expect(waitFor(async () => null, { intervalMs: 1, timeoutMs: 30, label: '示例条件' })).rejects.toThrow('示例条件')
  })

  it('条件抛错时继续轮询，不直接失败', async () => {
    let calls = 0
    const value = await waitFor(async () => {
      calls += 1
      if (calls === 1) throw new Error('还没就绪')
      return 'ready'
    }, { intervalMs: 1, timeoutMs: 1000 })
    expect(value).toBe('ready')
  })
})

describe('capture', () => {
  it('截图成功时写盘并返回路径', async () => {
    const file = tempFile('ok.png')
    const session = { send: async () => ({ result: { data: Buffer.from('png-bytes').toString('base64') } }) }
    await expect(capture(session, file)).resolves.toBe(file)
    expect(fs.readFileSync(file, 'utf8')).toBe('png-bytes')
  })

  // 回归：截图是辅助产物，一次超时不该让整轮 e2e 挂死（CI 曾因此 40 分钟超时）
  it('截图失败时只告警并返回 null，不抛错', async () => {
    const warn = vi.spyOn(console, 'log').mockImplementation(() => {})
    const session = { send: async () => { throw new Error('CDP 命令超时（15000ms）：Page.captureScreenshot') } }
    await expect(capture(session, tempFile('fail.png'))).resolves.toBeNull()
    expect(warn.mock.calls.flat().join(' ')).toContain('截图跳过')
    warn.mockRestore()
  })

  it('传入 clip 时透传给 Page.captureScreenshot（局部放大截图）', async () => {
    const file = tempFile('clip.png')
    const calls = []
    const session = { send: async (method, params, timeoutMs) => {
      calls.push({ method, params, timeoutMs })
      return { result: { data: Buffer.from('clip-bytes').toString('base64') } }
    } }
    await expect(capture(session, file, { clip: { x: 1, y: 2, width: 3, height: 4, scale: 4 }, timeoutMs: 9000 })).resolves.toBe(file)
    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe('Page.captureScreenshot')
    expect(calls[0].params).toEqual({ format: 'png', clip: { x: 1, y: 2, width: 3, height: 4, scale: 4 } })
    expect(calls[0].timeoutMs).toBe(9000)
  })

  it('不传 clip 时只发 format 参数（整屏截图行为不变）', async () => {
    const calls = []
    const session = { send: async (method, params, timeoutMs) => {
      calls.push({ method, params, timeoutMs })
      return { result: { data: Buffer.from('full').toString('base64') } }
    } }
    await capture(session, tempFile('full.png'))
    expect(calls[0].params).toEqual({ format: 'png' })
    expect(calls[0].timeoutMs).toBe(15000)
  })

  it('返回内容缺 data 字段时同样不抛错', async () => {
    const warn = vi.spyOn(console, 'log').mockImplementation(() => {})
    const session = { send: async () => ({ result: {} }) }
    await expect(capture(session, tempFile('empty.png'))).resolves.toBeNull()
    warn.mockRestore()
  })
})

describe('removeDirWithRetry', () => {
  it('目录存在时删除并返回 true', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-cleanup-'))
    fs.writeFileSync(path.join(dir, 'a.txt'), 'x')
    await expect(removeDirWithRetry(dir)).resolves.toBe(true)
    expect(fs.existsSync(dir)).toBe(false)
  })

  it('目录本来就不存在也返回 true（force 忽略 ENOENT）', async () => {
    await expect(removeDirWithRetry(path.join(os.tmpdir(), 'cdp-cleanup-missing-' + Date.now()))).resolves.toBe(true)
  })

  // 回归：CI 上 Chrome 被杀后句柄释放慢，一次性 rmSync 抛 EBUSY，整轮 e2e 在清理阶段被判失败
  it('遇到 EBUSY 时重试，最终成功', async () => {
    const real = fs.rmSync
    let calls = 0
    const spy = vi.spyOn(fs, 'rmSync').mockImplementation((target, options) => {
      calls += 1
      if (calls === 1) {
        const error = new Error('EBUSY: resource busy or locked')
        error.code = 'EBUSY'
        throw error
      }
      return real(target, options)
    })
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-cleanup-retry-'))
    await expect(removeDirWithRetry(dir, { attempts: 3, delayMs: 1 })).resolves.toBe(true)
    expect(calls).toBe(2)
    expect(fs.existsSync(dir)).toBe(false)
    spy.mockRestore()
  })

  it('重试耗尽后只告警不抛错（临时目录残留不该改写测试结论）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const spy = vi.spyOn(fs, 'rmSync').mockImplementation(() => {
      const error = new Error('EPERM: operation not permitted')
      error.code = 'EPERM'
      throw error
    })
    await expect(removeDirWithRetry(path.join(os.tmpdir(), 'cdp-cleanup-fail'), { attempts: 3, delayMs: 1 })).resolves.toBe(false)
    expect(spy).toHaveBeenCalledTimes(3)
    expect(warn.mock.calls.flat().join(' ')).toContain('临时目录清理失败')
    spy.mockRestore()
    warn.mockRestore()
  })

  // attempts 传 0 时循环一次都不进，函数必须仍然给出布尔结论而不是 undefined
  it('重试次数为 0 时直接返回 false，且不去动磁盘', async () => {
    const spy = vi.spyOn(fs, 'rmSync')
    await expect(removeDirWithRetry(path.join(os.tmpdir(), 'cdp-cleanup-zero'), { attempts: 0 })).resolves.toBe(false)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('常量', () => {
  it('CDP 命令超时是有限正数（防止 send 永远 pending）', () => {
    expect(Number.isFinite(CDP_COMMAND_TIMEOUT_MS)).toBe(true)
    expect(CDP_COMMAND_TIMEOUT_MS).toBeGreaterThan(0)
  })

  it('sleep 按毫秒等待', async () => {
    const started = Date.now()
    await sleep(20)
    expect(Date.now() - started).toBeGreaterThanOrEqual(15)
  })
})

describe('connect.send 超时兜底', () => {
  class FakeWebSocket {
    constructor(url) {
      this.url = url
      this.sent = []
      FakeWebSocket.last = this
      // connect() 在 ws.onopen 里才 resolve，所以构造后异步触发一次
      setTimeout(() => this.onopen?.({}), 0)
    }
    send(payload) {
      this.sent.push(JSON.parse(payload))
    }
    close() {
      this.onclose?.({})
    }
  }

  it('命令无响应时按超时 reject，并带上方法名', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const session = await connect('ws://fake')
    const pending = session.send('Page.captureScreenshot', {}, 20)
    await expect(pending).rejects.toThrow('CDP 命令超时（20ms）：Page.captureScreenshot')
    vi.unstubAllGlobals()
  })

  it('正常回包时 resolve 并把 timer 清掉', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const session = await connect('ws://fake')
    const pending = session.send('Runtime.evaluate', { expression: '1' }, 1000)
    const { id } = FakeWebSocket.last.sent.at(-1)
    FakeWebSocket.last.onmessage({ data: JSON.stringify({ id, result: { result: { value: 1 } } }) })
    await expect(pending).resolves.toEqual({ id, result: { result: { value: 1 } } })
    vi.unstubAllGlobals()
  })

  it('连接关闭时把未完成的命令拒掉，而不是永远 pending', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const session = await connect('ws://fake')
    const pending = session.send('Runtime.evaluate', { expression: '1' }, 5000)
    FakeWebSocket.last.onclose({})
    await expect(pending).rejects.toThrow('CDP 连接已关闭')
    vi.unstubAllGlobals()
  })

  it('ws.send 同步抛错时也 reject，不留 pending', async () => {
    class ThrowOnSend extends FakeWebSocket {
      send() {
        throw new Error('socket 已关闭')
      }
    }
    vi.stubGlobal('WebSocket', ThrowOnSend)
    const session = await connect('ws://fake')
    await expect(session.send('Runtime.evaluate', { expression: '1' }, 5000)).rejects.toThrow('CDP 命令发送失败：Runtime.evaluate')
    vi.unstubAllGlobals()
  })
})
