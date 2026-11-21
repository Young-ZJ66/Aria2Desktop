/**
 * downloader 的失败与重试边界（补充 downloader.test.ts 只覆盖的 fetchText 正常路径）。
 *
 * 关注点：瞬时断流要能重试、重试耗尽要报最后一次的真实原因、
 * 请求已失败后迟到的 response/data/end 事件不能二次结算（否则 Promise 会二次 resolve/reject）。
 *
 * 定时器一律用 drive() 驱动：一边推进假时钟一边检查是否已结算，
 * 避免「固定推 N 次」在重试链每次多一个 setTimeout 时错位。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'

interface Spec {
  statusCode?: number
  chunks?: Buffer[]
  headers?: Record<string, string | string[]>
  requestError?: Error
  /** response 自身触发 error（而非 request），用于覆盖流式响应中途断开的兜底 */
  responseError?: Error
  lateEvents?: boolean
  noResponse?: boolean
}

const holder = vi.hoisted(() => ({
  scripts: [] as Spec[],
  fallback: {} as Spec,
  requests: 0,
  aborts: 0,
  written: [] as Buffer[],
  ended: 0,
  destroyed: 0,
  removed: [] as string[],
  setProxyThrows: false,
  setProxyCalls: [] as unknown[],
  /** 让写流的 end 回调延后一拍触发，模拟真实 fs 写流收尾晚于网络事件 */
  deferEnd: false
}))

vi.mock('electron', () => ({
  net: {
    request: vi.fn(() => {
      holder.requests += 1
      const spec: Spec = holder.scripts.length > 0 ? holder.scripts.shift()! : holder.fallback
      const req = new EventEmitter() as EventEmitter & { end: () => void; abort: () => void }
      req.abort = () => { holder.aborts += 1 }
      req.end = () => {
        if (spec.noResponse) return
        setTimeout(() => {
          if (spec.requestError) {
            req.emit('error', spec.requestError)
            return
          }
          const res = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string | string[]> }
          res.statusCode = spec.statusCode ?? 200
          res.headers = spec.headers ?? {}
          req.emit('response', res)
          for (const chunk of spec.chunks ?? []) res.emit('data', chunk)
          if (spec.responseError) {
            res.emit('error', spec.responseError)
            return
          }
          res.emit('end')
          if (spec.lateEvents) {
            res.emit('data', Buffer.from('late'))
            res.emit('end')
            req.emit('error', new Error('late error'))
          }
        }, 0)
      }
      return req
    })
  },
  session: {
    fromPartition: vi.fn(() => ({
      setProxy: vi.fn(async (options: unknown) => {
        holder.setProxyCalls.push(options)
        if (holder.setProxyThrows) throw new Error('proxy unavailable')
      })
    }))
  }
}))

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  const fakeStream = () => {
    const stream = new EventEmitter() as EventEmitter & { write: (chunk: Buffer) => void; end: (cb?: () => void) => void; destroy: () => void }
    stream.write = (chunk: Buffer) => { holder.written.push(chunk) }
    stream.end = (cb?: () => void) => {
      holder.ended += 1
      if (holder.deferEnd) setTimeout(() => cb?.(), 0)
      else cb?.()
    }
    stream.destroy = () => { holder.destroyed += 1 }
    return stream
  }
  return {
    ...actual,
    default: actual,
    createWriteStream: vi.fn(() => fakeStream()),
    rmSync: vi.fn((target: string) => { holder.removed.push(String(target)) })
  }
})

async function loadDownloader() {
  vi.resetModules()
  return await import('./downloader')
}

/** 推进假时钟直到 Promise 结算（或超出预算），返回它实际结算出的值/错误 */
async function drive<T>(promise: Promise<T>, budgetMs = 120_000, step = 100): Promise<{ ok: boolean; value?: T; error?: unknown }> {
  let settled = false
  let value: T | undefined
  let error: unknown
  promise.then(
    (result) => { settled = true; value = result },
    (reason) => { settled = true; error = reason }
  )
  for (let elapsed = 0; elapsed < budgetMs && !settled; elapsed += step) {
    await vi.advanceTimersByTimeAsync(step)
  }
  if (!settled) return { ok: false }
  return { ok: true, value, error }
}

function reset(): void {
  holder.scripts.length = 0
  holder.fallback = {}
  holder.requests = 0
  holder.aborts = 0
  holder.written.length = 0
  holder.ended = 0
  holder.destroyed = 0
  holder.removed.length = 0
  holder.setProxyThrows = false
  holder.setProxyCalls.length = 0
  holder.deferEnd = false
  delete process.env.HTTPS_PROXY
  delete process.env.https_proxy
  delete process.env.HTTP_PROXY
  delete process.env.http_proxy
}

beforeEach(() => {
  vi.useFakeTimers()
  reset()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  reset()
})

describe('downloadToFile 的重试与进度', () => {
  it('首次失败后重试成功，并清理掉半截文件', async () => {
    const { downloadToFile } = await loadDownloader()
    holder.scripts.push({ statusCode: 500 })
    holder.scripts.push({ statusCode: 200, headers: { 'content-length': '5' }, chunks: [Buffer.from('hello')] })
    const progress: Array<{ percent: number }> = []
    const outcome = await drive(downloadToFile('https://example.invalid/a.bin', 'E:/tmp/a.bin', (p) => progress.push(p)))
    expect(outcome.ok).toBe(true)
    expect(outcome.error).toBeUndefined()
    expect(holder.requests).toBe(2)
    expect(holder.removed).toEqual(['E:/tmp/a.bin'])
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('[downloader] 下载失败（第 1 次），重试:'))
    expect(holder.written.map((chunk) => chunk.toString())).toEqual(['hello'])
    expect(progress[progress.length - 1]).toEqual({ percent: 100, transferred: 5, total: 5 })
  })

  it('三次都失败时抛出最后一次的错误（HTTP 503）', async () => {
    const { downloadToFile } = await loadDownloader()
    holder.fallback = { statusCode: 503 }
    const outcome = await drive(downloadToFile('https://example.invalid/a.bin', 'E:/tmp/a.bin'))
    expect(outcome.ok).toBe(true)
    expect(String(outcome.error)).toContain('HTTP 503')
    expect(holder.requests).toBe(3)
    expect(holder.removed).toHaveLength(3)
  })

  it('30 秒无数据视为断流（不是永远挂起）', async () => {
    const { downloadToFile } = await loadDownloader()
    holder.fallback = { noResponse: true }
    const outcome = await drive(downloadToFile('https://example.invalid/a.bin', 'E:/tmp/a.bin'))
    expect(outcome.ok).toBe(true)
    expect(String(outcome.error)).toContain('下载超时（30 秒无数据）')
    expect(holder.requests).toBe(3)
  })

  it('请求成功后迟到的 data / end / error 不会二次结算', async () => {
    const { downloadToFile } = await loadDownloader()
    holder.fallback = { statusCode: 200, headers: { 'content-length': '4' }, chunks: [Buffer.from('abcd')], lateEvents: true }
    const outcome = await drive(downloadToFile('https://example.invalid/a.bin', 'E:/tmp/a.bin'))
    expect(outcome.ok).toBe(true)
    expect(outcome.error).toBeUndefined()
    // 只写了一次 chunk，迟到的那份被 settled 守卫吞掉
    expect(holder.written.map((chunk) => chunk.toString())).toEqual(['abcd'])
    expect(holder.ended).toBe(1)
  })

  it('请求出错时按失败处理、中止请求并重试三次', async () => {
    const { downloadToFile } = await loadDownloader()
    holder.fallback = { requestError: new Error('socket hang up') }
    const outcome = await drive(downloadToFile('https://example.invalid/a.bin', 'E:/tmp/a.bin'))
    expect(outcome.ok).toBe(true)
    expect(String(outcome.error)).toContain('socket hang up')
    expect(holder.aborts).toBe(3)
    expect(holder.requests).toBe(3)
  })
})

describe('fetchText 的超时与重试', () => {
  it('10 秒无数据视为超时，重试三次后抛出超时原因', async () => {
    const { fetchText } = await loadDownloader()
    holder.fallback = { noResponse: true }
    const outcome = await drive(fetchText('https://example.invalid/latest'))
    expect(outcome.ok).toBe(true)
    expect(String(outcome.error)).toContain('获取校验文件超时')
    expect(holder.requests).toBe(3)
  })

  it('首次 500 后重试成功，并打印重试日志', async () => {
    const { fetchText } = await loadDownloader()
    holder.scripts.push({ statusCode: 500 })
    holder.fallback = { statusCode: 200, chunks: [Buffer.from('ok')] }
    const outcome = await drive(fetchText('https://example.invalid/latest'))
    expect(outcome.value).toBe('ok')
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('[downloader] 获取文本失败（第 1 次），重试:'))
  })

  it('每次都是 404 时抛出的仍是 HTTP 404（迟到事件不覆盖原因）', async () => {
    const { fetchText } = await loadDownloader()
    holder.fallback = { statusCode: 404, chunks: [Buffer.from('nope')], lateEvents: true }
    const outcome = await drive(fetchText('https://example.invalid/latest'))
    expect(outcome.ok).toBe(true)
    expect(String(outcome.error)).toContain('HTTP 404')
    expect(holder.requests).toBe(3)
  })
})

describe('响应流中途报错', () => {
  it('downloadToFile 在响应流报错时按失败重试，最终抛出该错误', async () => {
    const { downloadToFile } = await loadDownloader()
    holder.fallback = {
      statusCode: 200,
      headers: { 'content-length': '10' },
      chunks: [Buffer.from('abc')],
      responseError: new Error('ECONNRESET: response aborted')
    }
    const outcome = await drive(downloadToFile('https://example.invalid/a.bin', 'E:/tmp/a.bin'))
    expect(outcome.ok).toBe(true)
    expect(String(outcome.error)).toContain('ECONNRESET: response aborted')
    expect(holder.requests).toBe(3)
    expect(holder.destroyed).toBe(3)
  })

  it('写流收尾晚于网络失败时不会二次结算', async () => {
    const { downloadToFile } = await loadDownloader()
    // end 回调延后一拍：期间迟到的事件先把 Promise 判失败，回调再到时必须被 settled 守卫吞掉
    holder.deferEnd = true
    holder.fallback = {
      statusCode: 200,
      headers: { 'content-length': '4' },
      chunks: [Buffer.from('abcd')],
      lateEvents: true
    }
    const outcome = await drive(downloadToFile('https://example.invalid/a.bin', 'E:/tmp/a.bin'))
    expect(outcome.ok).toBe(true)
    expect(String(outcome.error)).toContain('late error')
    expect(holder.requests).toBe(3)
  })

  it('fetchText 在响应流报错时同样失败重试', async () => {
    const { fetchText } = await loadDownloader()
    holder.fallback = {
      statusCode: 200,
      chunks: [Buffer.from('partial')],
      responseError: new Error('stream closed unexpectedly')
    }
    const outcome = await drive(fetchText('https://example.invalid/latest'))
    expect(outcome.ok).toBe(true)
    expect(String(outcome.error)).toContain('stream closed unexpectedly')
    expect(holder.requests).toBe(3)
  })
})

describe('代理设置失败不影响下载', () => {
  it('setProxy 抛错时退回系统代理，请求照常发出', async () => {
    process.env.HTTPS_PROXY = 'http://127.0.0.1:7890'
    holder.setProxyThrows = true
    const { fetchText } = await loadDownloader()
    holder.fallback = { statusCode: 200, chunks: [Buffer.from('body')] }
    const outcome = await drive(fetchText('https://example.invalid/latest'))
    expect(outcome.value).toBe('body')
    expect(holder.setProxyCalls).toEqual([{ proxyRules: 'http://127.0.0.1:7890' }])
  })
})
