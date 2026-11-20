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
