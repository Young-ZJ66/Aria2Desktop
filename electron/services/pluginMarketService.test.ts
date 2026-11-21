import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as crypto from 'node:crypto'

/**
 * 插件市场注册表信任（D-02）。
 *
 * 不变式：
 * - 非空注册表必须由可信发布者签名，否则整份列表被拒绝（不能逐条跳过）；
 * - 空注册表允许无签名——空清单没有可安装内容，篡改成空表只是拒绝服务，
 *   不能借此装入代码；
 * - 签名校验覆盖条目内容：改一个 entryUrl 就会验签失败。
 */

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
const PUBLIC_KEY_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString()

const holder = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  responseBody: '' as string,
  responseStatus: 200
}))

vi.mock('../utils/settingsAccessor', () => ({
  getSettingsFresh: vi.fn(() => holder.settings)
}))

vi.mock('../utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
}))

import { PluginMarketService } from './pluginMarketService'

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(item => canonicalize(item)).join(',') + ']'
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).filter(key => record[key] !== undefined).sort()
  return '{' + keys.map(key => JSON.stringify(key) + ':' + canonicalize(record[key])).join(',') + '}'
}

function signedRegistry(registry: Record<string, unknown>): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...registry }
  delete rest.signature
  const payload = Buffer.from(canonicalize(rest), 'utf8')
  const signature = crypto.sign(null, payload, privateKey).toString('base64')
  return { ...rest, signature }
}

const ENTRY = {
  id: 'auto-retry',
  name: 'Auto Retry',
  version: '1.0.0',
  entryUrl: 'https://example.com/auto-retry.js',
  sha256: 'a'.repeat(64)
}

function makeMarket(): PluginMarketService {
  const manager = {
    getPlugins: () => [],
    installFromRegistry: vi.fn(async () => ({ success: true }))
  }
  return new PluginMarketService(manager as never)
}

beforeEach(() => {
  holder.settings = {
    pluginMarket: { enabled: true, registryUrl: 'https://example.com/registry.json' },
    trustedPluginPublishers: [PUBLIC_KEY_PEM]
  }
  holder.responseBody = ''
  holder.responseStatus = 200
  vi.stubGlobal('fetch', vi.fn(async () => new Response(holder.responseBody, { status: holder.responseStatus })))
})

describe('PluginMarketService 注册表信任', () => {
  it('空清单允许无签名（没有可安装内容，篡改成空表只是拒绝服务）', async () => {
    holder.responseBody = JSON.stringify({ version: 1, plugins: [] })
    const result = await makeMarket().list()
    expect(result.success).toBe(true)
    expect(result.plugins).toEqual([])
  })

  it('非空清单缺签名时拒绝整个列表', async () => {
    holder.responseBody = JSON.stringify({ version: 1, plugins: [ENTRY] })
    const result = await makeMarket().list()
    expect(result.success).toBe(false)
    expect(result.error).toBe('REGISTRY_SIGNATURE_INVALID')
    expect(result.plugins).toEqual([])
  })

  it('可信发布者签名的清单被接受', async () => {
    holder.responseBody = JSON.stringify(signedRegistry({ version: 1, plugins: [ENTRY] }))
    const result = await makeMarket().list()
    expect(result.success).toBe(true)
    expect(result.plugins.map(item => item.id)).toEqual(['auto-retry'])
  })

  it('签名后篡改条目内容会被拒绝', async () => {
    const signed = signedRegistry({ version: 1, plugins: [ENTRY] })
    const tampered = { ...signed, plugins: [{ ...ENTRY, entryUrl: 'https://evil.example.com/payload.js' }] }
    holder.responseBody = JSON.stringify(tampered)
    const result = await makeMarket().list()
    expect(result.success).toBe(false)
    expect(result.error).toBe('REGISTRY_SIGNATURE_INVALID')
  })

  it('非 https 的 entryUrl 即使签名有效也被逐条过滤', async () => {
    const bad = { ...ENTRY, id: 'insecure', entryUrl: 'http://example.com/a.js' }
    holder.responseBody = JSON.stringify(signedRegistry({ version: 1, plugins: [bad] }))
    const result = await makeMarket().list()
    expect(result.success).toBe(true)
    expect(result.plugins).toEqual([])
  })
})

/** 用一个可编程的假 PluginManager 构造市场服务，便于断言安装调用参数 */
function makeMarketWith(overrides: {
  plugins?: { manifest: { id: string; version: string } }[]
  installResult?: unknown
} = {}) {
  const installFromRegistry = vi.fn(async () => overrides.installResult ?? { success: true })
  const market = new PluginMarketService({
    getPlugins: () => overrides.plugins ?? [],
    installFromRegistry
  } as never)
  return { market, installFromRegistry }
}

describe('PluginMarketService 列表入口的拒绝分支', () => {
  it('市场被关闭时直接返回 MARKET_DISABLED，不发请求', async () => {
    holder.settings = {
      pluginMarket: { enabled: false, registryUrl: 'https://example.com/registry.json' },
      trustedPluginPublishers: [PUBLIC_KEY_PEM]
    }
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await makeMarket().list()

    expect(result).toEqual({ success: false, plugins: [], error: 'MARKET_DISABLED' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('注册表地址不是 https 时拒绝（防被改成明文地址）', async () => {
    holder.settings = {
      pluginMarket: { enabled: true, registryUrl: 'http://example.com/registry.json' },
      trustedPluginPublishers: [PUBLIC_KEY_PEM]
    }
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await makeMarket().list()

    expect(result.error).toBe('INVALID_REGISTRY_URL')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('注册表地址留空时回落到官方默认地址', async () => {
    holder.settings = {
      pluginMarket: { enabled: true, registryUrl: '   ' },
      trustedPluginPublishers: [PUBLIC_KEY_PEM]
    }
    holder.responseBody = JSON.stringify({ version: 1, plugins: [] })
    const fetchMock = vi.fn(async (_url: string) => new Response(holder.responseBody, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await makeMarket().list()

    expect(result.success).toBe(true)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('plugin-registry.json')
  })

  it('HTTP 非 2xx 时带出状态码', async () => {
    holder.responseStatus = 503
    holder.responseBody = 'unavailable'

    const result = await makeMarket().list()

    expect(result).toEqual({ success: false, plugins: [], error: 'HTTP_503' })
  })

  it('响应体不是合法 JSON 时返回 INVALID_REGISTRY', async () => {
    holder.responseBody = '{ not json'

    expect((await makeMarket().list()).error).toBe('INVALID_REGISTRY')
  })

  it('JSON 合法但没有 plugins 数组时返回 INVALID_REGISTRY', async () => {
    holder.responseBody = JSON.stringify({ version: 1 })

    expect((await makeMarket().list()).error).toBe('INVALID_REGISTRY')
  })

  it('顶层直接是数组时也接受（兼容旧格式）', async () => {
    holder.responseBody = JSON.stringify([])

    const result = await makeMarket().list()

    expect(result.success).toBe(true)
    expect(result.plugins).toEqual([])
  })

  it('网络异常（fetch 抛错）时返回 NETWORK_ERROR 而不是抛出去', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    }))

    const result = await makeMarket().list()

    expect(result).toEqual({ success: false, plugins: [], error: 'NETWORK_ERROR' })
  })

  it('Content-Length 声明超过上限时直接拒绝，不下载正文', async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(0))
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: (name: string) => (name.toLowerCase() === 'content-length' ? String(3 * 1024 * 1024) : null) },
      arrayBuffer
    })))

    const result = await makeMarket().list()

    expect(result.error).toBe('REGISTRY_TOO_LARGE')
    expect(arrayBuffer).not.toHaveBeenCalled()
  })

  it('没有 Content-Length 但实际字节数超过上限时同样拒绝', async () => {
    const oversized = new Uint8Array(2 * 1024 * 1024 + 1)
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      arrayBuffer: async () => oversized.buffer
    })))

    expect((await makeMarket().list()).error).toBe('REGISTRY_TOO_LARGE')
  })

  it('同 id 重复、缺字段、sha256 非法的条目被逐条过滤', async () => {
    const dup = { ...ENTRY, name: 'Second Copy' }
    const missingSha = { id: 'no-sha', name: 'No Sha', version: '1.0.0', entryUrl: 'https://example.com/a.js' }
    const badSha = { ...ENTRY, id: 'bad-sha', sha256: 'not-a-hash' }
    const badUrl = { ...ENTRY, id: 'bad-url', entryUrl: 'https://example.com/a.js', sha256: 'b'.repeat(64) }
    holder.responseBody = JSON.stringify(
      signedRegistry({ version: 1, plugins: [ENTRY, dup, missingSha, badSha, badUrl] })
    )

    const result = await makeMarket().list()

    expect(result.success).toBe(true)
    expect(result.plugins.map(item => item.id)).toEqual(['auto-retry', 'bad-url'])
  })

  it('十秒内的重复调用命中缓存，不再发第二次请求', async () => {
    holder.responseBody = JSON.stringify({ version: 1, plugins: [] })
    const fetchMock = vi.fn(async () => new Response(holder.responseBody, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const market = makeMarket()

    await market.list()
    await market.list()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('force 为 true 时绕过缓存重新拉取', async () => {
    holder.responseBody = JSON.stringify({ version: 1, plugins: [] })
    const fetchMock = vi.fn(async () => new Response(holder.responseBody, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const market = makeMarket()

    await market.list()
    await market.list(true)

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('clearCache 之后下一次调用重新拉取', async () => {
    holder.responseBody = JSON.stringify({ version: 1, plugins: [] })
    const fetchMock = vi.fn(async () => new Response(holder.responseBody, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const market = makeMarket()

    await market.list()
    market.clearCache()
    await market.list()

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('已安装的插件在列表里被标记，并带出本地版本', async () => {
    holder.responseBody = JSON.stringify(signedRegistry({ version: 1, plugins: [ENTRY] }))
    const { market } = makeMarketWith({ plugins: [{ manifest: { id: 'auto-retry', version: '0.9.0' } }] })

    const result = await market.list()

    expect(result.plugins[0]).toMatchObject({ id: 'auto-retry', installed: true, installedVersion: '0.9.0' })
  })
})

describe('PluginMarketService 安装入口', () => {
  it('插件 id 非法时直接拒绝，不拉注册表', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { market, installFromRegistry } = makeMarketWith()

    expect(await market.install('../../etc/passwd')).toEqual({ success: false, error: 'INVALID_ID' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(installFromRegistry).not.toHaveBeenCalled()
  })

  it('列表拉取失败时把失败原因原样返回', async () => {
    holder.responseStatus = 500
    const { market, installFromRegistry } = makeMarketWith()

    expect(await market.install('auto-retry')).toEqual({ success: false, error: 'HTTP_500' })
    expect(installFromRegistry).not.toHaveBeenCalled()
  })

  it('注册表里没有该 id 时返回 NOT_FOUND', async () => {
    holder.responseBody = JSON.stringify(signedRegistry({ version: 1, plugins: [ENTRY] }))
    const { market, installFromRegistry } = makeMarketWith()

    expect(await market.install('not-listed')).toEqual({ success: false, error: 'NOT_FOUND' })
    expect(installFromRegistry).not.toHaveBeenCalled()
  })

  it('首次安装时 upgrade 为 false，并带上可信发布者列表', async () => {
    holder.responseBody = JSON.stringify(signedRegistry({ version: 1, plugins: [ENTRY] }))
    const { market, installFromRegistry } = makeMarketWith()

    await market.install('auto-retry')

    expect(installFromRegistry).toHaveBeenCalledTimes(1)
    const [entry, trusted, options] = installFromRegistry.mock.calls[0] as unknown as [
      { id: string },
      string[],
      { upgrade: boolean }
    ]
    expect(entry.id).toBe('auto-retry')
    expect(trusted).toEqual([PUBLIC_KEY_PEM])
    expect(options.upgrade).toBe(false)
  })

  it('已安装旧版本时 upgrade 为 true', async () => {
    holder.responseBody = JSON.stringify(signedRegistry({ version: 1, plugins: [ENTRY] }))
    const { market, installFromRegistry } = makeMarketWith({
      plugins: [{ manifest: { id: 'auto-retry', version: '0.9.0' } }]
    })

    await market.install('auto-retry')

    const [, , options] = installFromRegistry.mock.calls[0] as unknown as [unknown, unknown, { upgrade: boolean }]
    expect(options.upgrade).toBe(true)
  })

  it('已安装同版本时 upgrade 为 false（不重复升级）', async () => {
    holder.responseBody = JSON.stringify(signedRegistry({ version: 1, plugins: [ENTRY] }))
    const { market, installFromRegistry } = makeMarketWith({
      plugins: [{ manifest: { id: 'auto-retry', version: '1.0.0' } }]
    })

    await market.install('auto-retry')

    const [, , options] = installFromRegistry.mock.calls[0] as unknown as [unknown, unknown, { upgrade: boolean }]
    expect(options.upgrade).toBe(false)
  })

  it('安装失败时把 PluginManager 的错误原样带回', async () => {
    holder.responseBody = JSON.stringify(signedRegistry({ version: 1, plugins: [ENTRY] }))
    const { market } = makeMarketWith({ installResult: { success: false, error: 'CHECKSUM_MISMATCH' } })

    expect(await market.install('auto-retry')).toEqual({ success: false, error: 'CHECKSUM_MISMATCH' })
  })
})
