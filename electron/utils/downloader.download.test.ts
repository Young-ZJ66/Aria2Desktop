/**
 * downloader 的文件下载测试。
 *
 * downloadToFile 是更新安装包与 ffmpeg 资产的实际下载路径：跟随重定向、
 * 进度回调、失败重试（每次从头下载，避免把半截文件当完整文件）、
 * 30 秒无数据超时。这里用可控的假 net.request 把这些分支都钉住。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

type Mode = 'ok' | 'http-error' | 'request-error' | 'stream-error' | 'silent'

interface Spec {
  mode: Mode
  statusCode?: number
  chunks?: Buffer[]
  total?: number
}

const h = vi.hoisted(() => ({
  script: [] as Spec[],
  requestCount: 0,
  abortCount: 0,
  requestOptions: [] as Array<Record<string, unknown>>
}))

vi.mock('electron', () => ({
  net: {
    request: (options: Record<string, unknown>) => {
      h.requestOptions.push(options)
      const spec = h.script[Math.min(h.requestCount, h.script.length - 1)]
      h.requestCount++
      const req = new EventEmitter() as EventEmitter & { end: () => void; abort: () => void }
      req.end = () => {
        if (spec.mode === 'silent') return
        queueMicrotask(() => {
          if (spec.mode === 'request-error') {
            req.emit('error', new Error('ECONNRESET'))
            return
          }
          const res = new EventEmitter() as EventEmitter & {
            statusCode: number
            headers: Record<string, string>
          }
          res.statusCode = spec.mode === 'http-error' ? (spec.statusCode ?? 500) : 200
          const chunks = spec.chunks ?? []
          const total = spec.total ?? chunks.reduce((sum, chunk) => sum + chunk.length, 0)
          res.headers = { 'content-length': String(total) }
          req.emit('response', res)
          if (spec.mode === 'http-error') return
          for (const chunk of chunks) res.emit('data', chunk)
          if (spec.mode === 'stream-error') {
            res.emit('error', new Error('ETIMEDOUT'))
            return
          }
          res.emit('end')
        })
      }
      req.abort = () => {
        h.abortCount++
      }
      return req
    }
  },
  session: {
    fromPartition: () => ({ setProxy: async () => {} })
  }
}))

let tmpRoot = ''

async function loadDownloader() {
  vi.resetModules()
  return await import('./downloader')
}

beforeEach(() => {
  h.script = []
  h.requestCount = 0
  h.abortCount = 0
  h.requestOptions = []
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'downloader-test-'))
})

afterEach(() => {
  vi.useRealTimers()
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

describe('downloadToFile', () => {
  it('把响应体写进目标文件并回报 100% 进度', async () => {
    const { downloadToFile } = await loadDownloader()
    const payload = Buffer.from('hello update payload', 'utf8')
    h.script = [{ mode: 'ok', chunks: [payload.subarray(0, 7), payload.subarray(7)] }]
    const dest = path.join(tmpRoot, 'update.zip')
    const progress: number[] = []

    await downloadToFile('https://example.invalid/update.zip', dest, (item) => progress.push(item.percent))

    expect(fs.readFileSync(dest)).toEqual(payload)
    expect(progress[progress.length - 1]).toBe(100)
    expect(h.requestOptions[0]).toMatchObject({
      url: 'https://example.invalid/update.zip',
      redirect: 'follow',
      useSessionCookies: false
    })
  })

  it('非 2xx 视为失败并清掉半截文件', { timeout: 30000 }, async () => {
    vi.useFakeTimers()
    const { downloadToFile } = await loadDownloader()
    h.script = [{ mode: 'http-error', statusCode: 503 }]
    const dest = path.join(tmpRoot, 'update.zip')
    fs.writeFileSync(dest, 'partial')

    const pending = downloadToFile('https://example.invalid/update.zip', dest)
    const assertion = expect(pending).rejects.toThrow('下载失败：HTTP 503')
    await vi.advanceTimersByTimeAsync(10000)
    await assertion
    expect(fs.existsSync(dest)).toBe(false)
    expect(h.requestCount).toBe(3)
  })

  it('瞬时网络错误会重试，第三次成功时正常完成', { timeout: 30000 }, async () => {
    vi.useFakeTimers()
    const { downloadToFile } = await loadDownloader()
    const payload = Buffer.from('ok', 'utf8')
    h.script = [{ mode: 'request-error' }, { mode: 'request-error' }, { mode: 'ok', chunks: [payload] }]
    const dest = path.join(tmpRoot, 'update.zip')

    const pending = downloadToFile('https://example.invalid/update.zip', dest)
    await vi.advanceTimersByTimeAsync(10000)
    await pending

    expect(h.requestCount).toBe(3)
    expect(fs.readFileSync(dest)).toEqual(payload)
  })

  it('三次都失败时抛出错误，不会无限重试', { timeout: 30000 }, async () => {
    vi.useFakeTimers()
    const { downloadToFile } = await loadDownloader()
    h.script = [{ mode: 'request-error' }]
    const dest = path.join(tmpRoot, 'update.zip')

    const pending = downloadToFile('https://example.invalid/update.zip', dest)
    const assertion = expect(pending).rejects.toThrow('ECONNRESET')
    await vi.advanceTimersByTimeAsync(20000)
    await assertion
    expect(h.requestCount).toBe(3)
  })

  it('30 秒没有任何数据就判定超时并中止请求', { timeout: 30000 }, async () => {
    vi.useFakeTimers()
    const { downloadToFile } = await loadDownloader()
    h.script = [{ mode: 'silent' }]
    const dest = path.join(tmpRoot, 'update.zip')

    const pending = downloadToFile('https://example.invalid/update.zip', dest)
    // 先 flush 一轮微任务：getDownloadSession 是异步的，空闲计时器要等它 resolve 之后才装上
    await vi.advanceTimersByTimeAsync(0)
    const assertion = expect(pending).rejects.toThrow('下载超时')
    // 每次尝试都要等满 30 秒空闲超时，三次尝试加上退避一共约 93 秒
    for (let attempt = 0; attempt < 4; attempt++) await vi.advanceTimersByTimeAsync(31000)
    await assertion
    expect(h.abortCount).toBeGreaterThanOrEqual(1)
  })

  it('响应流中途出错时整轮失败，不会把半截文件当成下载成功', { timeout: 30000 }, async () => {
    vi.useFakeTimers()
    const { downloadToFile } = await loadDownloader()
    h.script = [{ mode: 'stream-error', chunks: [Buffer.from('partial')], total: 100 }]
    const dest = path.join(tmpRoot, 'update.zip')

    const pending = downloadToFile('https://example.invalid/update.zip', dest)
    await vi.advanceTimersByTimeAsync(0)
    const assertion = expect(pending).rejects.toThrow('ETIMEDOUT')
    await vi.advanceTimersByTimeAsync(20000)
    await assertion
    // 重试三次都失败才算整轮失败（这里只断言"没成功"：写流创建是异步的，
    // 失败后 rmSync 与流真正创建文件之间存在窗口，用文件是否存在判断会不稳定）
    expect(h.requestCount).toBe(3)
  })
})
