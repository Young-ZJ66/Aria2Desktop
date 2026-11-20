import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PLUGIN_REGISTRY_URL,
  DEFAULT_TRUSTED_PLUGIN_PUBLISHERS,
  PLUGIN_REGISTRY_PINNED_TAG
} from './appSettings'

/** Ed25519 SPKI 的 DER 前缀（OID 1.3.101.112），见 RFC 8410 */
const ED25519_SPKI_PREFIX = '302a300506032b6570032100'

function derOf(pem: string): string {
  const body = pem
    .replace('-----BEGIN PUBLIC KEY-----', '')
    .replace('-----END PUBLIC KEY-----', '')
    .replace(/\s+/g, '')
  return Buffer.from(body, 'base64').toString('hex')
}

describe('插件注册表默认值（D-02）', () => {
  it('固定 tag 是发布标签格式，绝不能用 main', () => {
    expect(PLUGIN_REGISTRY_PINNED_TAG).toMatch(/^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/)
    expect(PLUGIN_REGISTRY_PINNED_TAG).not.toBe('main')
    expect(PLUGIN_REGISTRY_PINNED_TAG.startsWith('v')).toBe(true)
  })

  it('默认注册表地址指向该 tag 的 raw plugin-registry.json', () => {
    expect(DEFAULT_PLUGIN_REGISTRY_URL).toBe(
      'https://raw.githubusercontent.com/Young-ZJ66/Aria2Desktop/' +
        PLUGIN_REGISTRY_PINNED_TAG +
        '/plugin-registry.json'
    )
    expect(DEFAULT_PLUGIN_REGISTRY_URL).toContain('/' + PLUGIN_REGISTRY_PINNED_TAG + '/')
    expect(DEFAULT_PLUGIN_REGISTRY_URL.endsWith('/plugin-registry.json')).toBe(true)
    expect(DEFAULT_PLUGIN_REGISTRY_URL.startsWith('https://')).toBe(true)
  })

  it('默认发布者清单非空——空清单等于默认不校验任何签名', () => {
    expect(DEFAULT_TRUSTED_PLUGIN_PUBLISHERS.length).toBeGreaterThan(0)
  })

  it('每个内置公钥都是 Ed25519 SPKI PEM', () => {
    for (const pem of DEFAULT_TRUSTED_PLUGIN_PUBLISHERS) {
      expect(pem.startsWith('-----BEGIN PUBLIC KEY-----')).toBe(true)
      expect(pem.trimEnd().endsWith('-----END PUBLIC KEY-----')).toBe(true)
      // 用 DER 前缀确认算法是 Ed25519，而不是 RSA/EC 公钥误填进来
      expect(derOf(pem).startsWith(ED25519_SPKI_PREFIX)).toBe(true)
      // 原始公钥 32 字节：DER 总长 44 字节
      expect(derOf(pem).length / 2).toBe(44)
    }
  })

  it('公钥之间不重复（轮换时追加，不是复制粘贴）', () => {
    expect(new Set(DEFAULT_TRUSTED_PLUGIN_PUBLISHERS).size).toBe(
      DEFAULT_TRUSTED_PLUGIN_PUBLISHERS.length
    )
  })
})
