/**
 * verify-published-registry.mjs 的单元测试。
 *
 * 关注两件事：
 *   1. 客户端口径必须一致——空清单免签、非空清单必须验签通过，签名错/缺失一律拒绝；
 *   2. 固定 tag 与 package.json 版本必须对齐，否则用户会拉到上一版的注册表。
 * 网络比对（--online）不在单测覆盖范围：它依赖 GitHub raw 可达，交给发版前手动跑。
 */

import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { DEFAULT_TRUSTED_PLUGIN_PUBLISHERS, PLUGIN_REGISTRY_PINNED_TAG } from '../../src/shared/appSettings.ts'
import { REGISTRY_SCHEMA_VERSION, signRegistry } from './sign-registry.mjs'
import { expectedTagForVersion, inspectRegistry, payloadsMatch } from './verify-published-registry.mjs'

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString()
const PRIVATE_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

function sampleRegistry() {
  return {
    version: REGISTRY_SCHEMA_VERSION,
    plugins: [
      {
        id: 'demo-plugin',
        name: 'Demo',
        version: '1.0.0',
        entryUrl: 'https://example.com/demo.js',
        sha256: 'a'.repeat(64)
      }
    ]
  }
}

describe('注册表校验口径（与客户端一致）', () => {
  it('空清单免签即可通过', () => {
    expect(inspectRegistry({ version: REGISTRY_SCHEMA_VERSION, plugins: [] })).toMatchObject({ ok: true, empty: true })
  })

  it('非空清单缺签名直接拒绝', () => {
    expect(inspectRegistry(sampleRegistry(), [PUBLIC_PEM])).toMatchObject({ ok: false, error: 'REGISTRY_UNSIGNED' })
  })

  it('签名可被可信公钥验证时通过', () => {
    const signed = signRegistry(sampleRegistry(), PRIVATE_PEM)
    expect(inspectRegistry(signed, [PUBLIC_PEM])).toMatchObject({ ok: true, empty: false, signed: true })
  })

  it('签名被篡改后拒绝', () => {
    const signed = signRegistry(sampleRegistry(), PRIVATE_PEM)
    const tampered = structuredClone(signed)
    tampered.plugins[0].sha256 = 'b'.repeat(64)
    expect(inspectRegistry(tampered, [PUBLIC_PEM])).toMatchObject({ ok: false, error: 'REGISTRY_SIGNATURE_INVALID' })
  })

  it('结构非法时返回结构错误', () => {
    expect(inspectRegistry({ version: 999, plugins: [] }).error).toBe('UNSUPPORTED_REGISTRY_VERSION')
    expect(inspectRegistry(null).ok).toBe(false)
  })

  it('空清单带了坏签名也要报错（说明签名流程出问题）', () => {
    const empty = { version: REGISTRY_SCHEMA_VERSION, plugins: [], signature: 'bm90LWEtc2ln' }
    expect(inspectRegistry(empty, [PUBLIC_PEM])).toMatchObject({ ok: false, error: 'REGISTRY_SIGNATURE_INVALID' })
  })
})

describe('已发布内容比对', () => {
  it('载荷一致时返回 true（忽略 signature 与键序）', () => {
    const signed = signRegistry(sampleRegistry(), PRIVATE_PEM)
    const reordered = { plugins: signed.plugins, version: signed.version, signature: signed.signature }
    expect(payloadsMatch(signed, reordered)).toBe(true)
    expect(payloadsMatch(signed, sampleRegistry())).toBe(true)
  })

  it('内容不同时返回 false', () => {
    const signed = signRegistry(sampleRegistry(), PRIVATE_PEM)
    const other = structuredClone(signed)
    other.plugins[0].version = '2.0.0'
    expect(payloadsMatch(signed, other)).toBe(false)
  })
})

describe('固定 tag 与版本对齐', () => {
  it('tag 是版本号加 v 前缀', () => {
    expect(expectedTagForVersion('1.5.0-beta.2')).toBe('v1.5.0-beta.2')
    expect(expectedTagForVersion(' 1.5.0 ')).toBe('v1.5.0')
    expect(expectedTagForVersion('')).toBe('v')
  })

  it('仓库当前固定 tag 与 package.json 版本一致', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const path = await import('node:path')
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
    expect(PLUGIN_REGISTRY_PINNED_TAG).toBe(expectedTagForVersion(pkg.version))
  })

  it('内置可信公钥非空（默认必须验签）', () => {
    expect(DEFAULT_TRUSTED_PLUGIN_PUBLISHERS.length).toBeGreaterThan(0)
    for (const pem of DEFAULT_TRUSTED_PLUGIN_PUBLISHERS) {
      expect(pem).toContain('BEGIN PUBLIC KEY')
    }
  })
})
