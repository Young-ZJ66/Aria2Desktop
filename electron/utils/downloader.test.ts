/**
 * downloader 的 HTTP 文本获取测试。
 *
 * fetchText 用于 GitHub Release 元信息 JSON（标题/正文含 emoji、中文等多字节
 * UTF-8 字符）。这些内容按网络 chunk 边界切开后，逐 chunk 解码会把跨界的
 * 多字节序列撕成 U+FFFD 替换符——必须整块拼接后一次性解码。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'

interface FakeResponseSpec {
  statusCode?: number
  chunks?: Buffer[]
  headers?: Record<string, string | string[]>
}

/** 测试用「服务器行为」：每次请求都按同一份脚本响应 */
let respondWith: (() => FakeResponseSpec) | null = null
let abortCount = 0

vi.mock('electron', () => ({
  net: {
    request: vi.fn(() => {
      const req = new EventEmitter() as EventEmitter & {
        end: () => void
        abort: () => void
      }
      req.end = () => {
        // 模拟网络往返：宏任务后按脚本发响应
        setTimeout(() => {
          const spec = respondWith?.() ?? { statusCode: 200, chunks: [] }
          const res = new EventEmitter() as EventEmitter & {
            statusCode: number
            headers: Record<string, string | string[]>
          }
          res.statusCode = spec.statusCode ?? 200
          res.headers = spec.headers ?? {}
          req.emit('response', res)
          for (const chunk of spec.chunks ?? []) res.emit('data', chunk)
          res.emit('end')
        }, 0)
      }
      req.abort = () => {
        abortCount++
      }
      return req
    })
  },
  session: {
    fromPartition: vi.fn(() => ({ setProxy: vi.fn(async () => {}) }))
  }
}))

async function loadDownloader() {
  vi.resetModules()
  abortCount = 0
  const mod = await import('./downloader')
  return mod
}

beforeEach(() => {
  respondWith = null
})

afterEach(() => {
  vi.useRealTimers()
})

describe('fetchText', () => {
  it('多字节 UTF-8 字符跨 chunk 边界时保持完整（逐 chunk 解码会撕成乱码）', { timeout: 15000 }, async () => {
    const { fetchText } = await loadDownloader()
    const json = JSON.stringify({ name: 'yt-dlp 🎉 中文版说明' })
    const buf = Buffer.from(json, 'utf8')
    // 找一个落在多字节序列中间的切点：emoji 位于 "🎉" 处
    const emojiIndex = buf.indexOf('🎉')
    expect(emojiIndex).toBeGreaterThan(0)
    const cut = emojiIndex + 1 // emoji 4 字节的中间
    const chunks = [buf.subarray(0, cut), buf.subarray(cut)]
    respondWith = () => ({ statusCode: 200, chunks })

    const body = await fetchText('https://example.invalid/latest')
    expect(body).toBe(json)
    expect(JSON.parse(body)).toEqual({ name: 'yt-dlp 🎉 中文版说明' })
  })

  it('超过字节上限时拒绝并中止请求', { timeout: 15000 }, async () => {
    const { fetchText } = await loadDownloader()
    const big = Buffer.alloc(1024, 0x61)
    respondWith = () => ({ statusCode: 200, chunks: [big, big] })
    await expect(fetchText('https://example.invalid/latest', 512)).rejects.toThrow('响应体过大')
    expect(abortCount).toBeGreaterThanOrEqual(1)
  })

  it('非 2xx 状态码直接失败', { timeout: 15000 }, async () => {
    const { fetchText } = await loadDownloader()
    respondWith = () => ({ statusCode: 404, chunks: [] })
    await expect(fetchText('https://example.invalid/latest')).rejects.toThrow('HTTP 404')
  })

  it('大 JSON 里大量多字节字符拼接后仍可解析', { timeout: 15000 }, async () => {
    const { fetchText } = await loadDownloader()
    const items = Array.from({ length: 200 }, (_, i) => ({ name: `发布 ${i} 🎉 描述文本` }))
    const json = JSON.stringify({ release: items })
    const buf = Buffer.from(json, 'utf8')
    // 每 7 字节切一刀，制造大量跨界多字节序列
    const chunks: Buffer[] = []
    for (let i = 0; i < buf.length; i += 7) chunks.push(buf.subarray(i, Math.min(i + 7, buf.length)))
    respondWith = () => ({ statusCode: 200, chunks })

    const body = await fetchText('https://example.invalid/latest')
    expect(JSON.parse(body)).toEqual({ release: items })
  })
})
