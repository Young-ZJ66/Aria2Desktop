/**
 * plugin-registry 签名工具的单元测试（D-02）。
 *
 * 关注点是"签名载荷的规范化"和"只接受 Ed25519"两条硬约束：
 * 客户端与维护者两端必须对同一份 registry 算出同一串字节，否则签名永远对不上；
 * 同时不能让 RSA 之类的密钥混进来把签名校验降级成"换个算法也能过"。
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  REGISTRY_SCHEMA_VERSION,
  canonicalize,
  readPem,
  registryPayload,
  signRegistry,
  validateRegistry,
  verifyRegistrySignature
} from './sign-registry.mjs'

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString()
const PRIVATE_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

/** 一个形状合法的最小 registry（插件条目字段与客户端 RegistryPluginEntry 对齐） */
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

const tmpDirs = []
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function tmpFile(name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-registry-'))
  tmpDirs.push(dir)
  const file = path.join(dir, name)
  fs.writeFileSync(file, content, 'utf8')
  return file
}

describe('registry 规范化（客户端与维护者必须一致）', () => {
  it('对象键排序、数组顺序保持，结果稳定', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
    expect(canonicalize({ z: [3, 1], a: { d: 4, c: 5 } })).toBe('{"a":{"c":5,"d":4},"z":[3,1]}')
    // 同一份数据不同键序 → 同一串字节，否则签名会因为 JSON.stringify 的插入顺序而失效
    expect(canonicalize({ a: 1, b: 2 })).toBe(canonicalize({ b: 2, a: 1 }))
  })

  it('signature 字段本身不参与签名计算', () => {
    const registry = sampleRegistry()
    const signed = signRegistry(registry, PRIVATE_PEM)
    expect(registryPayload(signed).equals(registryPayload(registry))).toBe(true)
  })
})

describe('签名与校验', () => {
  it('签名后的 registry 可被对应公钥验证通过', () => {
    const signed = signRegistry(sampleRegistry(), PRIVATE_PEM)
    expect(typeof signed.signature).toBe('string')
    expect(verifyRegistrySignature(signed, PUBLIC_PEM)).toBe(true)
  })

  it('篡改任何字段后签名失效', () => {
    const signed = signRegistry(sampleRegistry(), PRIVATE_PEM)
    const tampered = structuredClone(signed)
    tampered.plugins[0].sha256 = 'b'.repeat(64)
    expect(verifyRegistrySignature(tampered, PUBLIC_PEM)).toBe(false)
  })

  it('往列表里塞一个额外插件也会让签名失效', () => {
    const signed = signRegistry(sampleRegistry(), PRIVATE_PEM)
    const tampered = structuredClone(signed)
    tampered.plugins.push({ ...tampered.plugins[0], id: 'evil-plugin' })
    expect(verifyRegistrySignature(tampered, PUBLIC_PEM)).toBe(false)
  })

  it('缺失签名的 registry 直接判定为无效', () => {
    expect(verifyRegistrySignature(sampleRegistry(), PUBLIC_PEM)).toBe(false)
  })

  it('非 Ed25519 公钥一律拒绝，不走降级路径', () => {
    const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
    const rsaPublicPem = rsa.publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const signed = signRegistry(sampleRegistry(), PRIVATE_PEM)
    expect(verifyRegistrySignature(signed, rsaPublicPem)).toBe(false)
  })
})

describe('结构校验', () => {
  it('合法 registry 通过', () => {
    expect(validateRegistry(sampleRegistry())).toEqual({ ok: true })
  })

  it('版本号不匹配时拒绝', () => {
    expect(validateRegistry({ ...sampleRegistry(), version: 999 })).toEqual({
      ok: false,
      error: 'UNSUPPORTED_REGISTRY_VERSION'
    })
  })

  it('条目缺字段或字段非法时拒绝', () => {
    const base = sampleRegistry()
    const cases = [
      { ...base, plugins: [{ ...base.plugins[0], id: '..' }] },
      { ...base, plugins: [{ ...base.plugins[0], version: '' }] },
      { ...base, plugins: [{ ...base.plugins[0], entryUrl: 'http://example.com/demo.js' }] },
      { ...base, plugins: [{ ...base.plugins[0], sha256: 'xyz' }] },
      { ...base, plugins: 'nope' }
    ]
    for (const registry of cases) {
      expect(validateRegistry(registry).ok).toBe(false)
    }
  })
})

describe('CLI 读写 PEM', () => {
  it('readPem 去掉 BOM 但保留换行', () => {
    const file = tmpFile('key.pem', `\uFEFF${PUBLIC_PEM}`)
    const text = readPem(file)
    expect(text.startsWith('-----BEGIN PUBLIC KEY-----')).toBe(true)
    expect(text).toContain('\n')
  })
})
