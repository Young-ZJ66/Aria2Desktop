import { describe, expect, it, vi } from 'vitest'
import { lookupPeerLocations } from './ipGeo'

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as unknown as Response
}

describe('lookupPeerLocations 的超时保护', () => {
  it('请求超过 8 秒未返回时主动 abort，并按失败返回空对象', async () => {
    vi.useFakeTimers()
    try {
      let signal: AbortSignal | undefined
      const fetcher = vi.fn((_url: string, init: { signal?: AbortSignal }) => {
        signal = init.signal
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
      })
      const pending = lookupPeerLocations(['1.1.1.1'], fetcher as never)
      await vi.advanceTimersByTimeAsync(8000)
      await expect(pending).resolves.toEqual({})
      expect(signal?.aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('lookupPeerLocations 批量查 Peer 地理位置', () => {
  it('空列表不发请求', async () => {
    const fetcher = vi.fn()
    await expect(lookupPeerLocations([], fetcher as never)).resolves.toEqual({})
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('去重、去空白后最多查 100 个 IP', async () => {
    const fetcher = vi.fn(async () => jsonResponse([]))
    const ips = ['1.1.1.1', '1.1.1.1', '  ', '2.2.2.2', ...Array.from({ length: 120 }, (_, i) => `10.0.0.${i}`)]
    await lookupPeerLocations(ips, fetcher as never)
    const body = JSON.parse((fetcher.mock.calls[0] as unknown as [string, { body: string }])[1].body)
    expect(body.length).toBe(100)
    expect(body.filter((ip: string) => ip === '1.1.1.1')).toHaveLength(1)
    expect(body).not.toContain('')
  })

  it('只保留 status=success 且有 countryCode 的行，国家码转大写', async () => {
    const fetcher = vi.fn(async () => jsonResponse([
      { status: 'success', query: '1.1.1.1', country: 'Australia', countryCode: 'au' },
      { status: 'fail', query: '2.2.2.2', country: 'China', countryCode: 'CN' },
      { status: 'success', query: '3.3.3.3', country: 'Nowhere' },
      { status: 'success', country: 'NoQuery', countryCode: 'US' }
    ]))
    await expect(lookupPeerLocations(['1.1.1.1', '2.2.2.2', '3.3.3.3'], fetcher as never)).resolves.toEqual({
      '1.1.1.1': { country: 'Australia', countryCode: 'AU' }
    })
  })

  it('缺少 country 时用国家码兜底', async () => {
    const fetcher = vi.fn(async () => jsonResponse([{ status: 'success', query: '1.1.1.1', countryCode: 'jp' }]))
    await expect(lookupPeerLocations(['1.1.1.1'], fetcher as never)).resolves.toEqual({
      '1.1.1.1': { country: 'jp', countryCode: 'JP' }
    })
  })

  it('非 2xx 响应返回空对象（面板保持「未知」，不影响任务详情）', async () => {
    const fetcher = vi.fn(async () => jsonResponse([], false))
    await expect(lookupPeerLocations(['1.1.1.1'], fetcher as never)).resolves.toEqual({})
  })

  it('请求抛错时吞掉异常返回空对象', async () => {
    const fetcher = vi.fn(async () => { throw new Error('offline') })
    await expect(lookupPeerLocations(['1.1.1.1'], fetcher as never)).resolves.toEqual({})
  })

  it('响应体不是数组时也不抛错', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ error: 'rate limited' }))
    await expect(lookupPeerLocations(['1.1.1.1'], fetcher as never)).resolves.toEqual({})
  })
})
