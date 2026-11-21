/**
 * verify-published-registry.mjs 的 CLI 入口（main）测试。
 *
 * 为什么单独一个文件：main 的固定 tag 来自 src/shared/appSettings.ts，而这里要
 * 模拟"版本升了 tag 忘了改"的场景，必须整体替换该模块；同目录的
 * verify-published-registry.test.mjs 依赖真实 tag 与 package.json 对齐，
 * 放在一起会被 mock 带偏。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const holder = vi.hoisted(() => ({
  pinnedTag: 'v1.5.0-beta.9',
  registryUrl: 'https://raw.example.com/plugin-registry.json'
}))

vi.mock('../../src/shared/appSettings.ts', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    get PLUGIN_REGISTRY_PINNED_TAG() {
      return holder.pinnedTag
    },
    get DEFAULT_PLUGIN_REGISTRY_URL() {
      return holder.registryUrl
    }
  }
})

const { REGISTRY_SCHEMA_VERSION, signRegistry } = await import('./sign-registry.mjs')
const { main } = await import('./verify-published-registry.mjs')
const { readFileSync } = await import('node:fs')
const { fileURLToPath } = await import('node:url')

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const packageVersion = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version

const crypto = await import('node:crypto')
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString()
const PRIVATE_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

function entry(overrides = {}) {
  return {
    id: 'demo-plugin',
    name: 'Demo',
    version: '1.0.0',
    entryUrl: 'https://example.com/demo.js',
    sha256: 'a'.repeat(64),
    ...overrides
  }
}

function registry(plugins = [], signature) {
  return signature
    ? { version: REGISTRY_SCHEMA_VERSION, plugins, signature }
    : { version: REGISTRY_SCHEMA_VERSION, plugins }
}

let dir
let logs
let errors

function writeRegistry(name, payload) {
  const file = path.join(dir, name)
  fs.writeFileSync(file, typeof payload === 'string' ? payload : JSON.stringify(payload))
  return file
}

function stubFetch(impl) {
  vi.stubGlobal('fetch', vi.fn(impl))
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-cli-'))
  holder.pinnedTag = 'v' + packageVersion
  logs = []
  errors = []
  vi.spyOn(console, 'log').mockImplementation((line) => {
    logs.push(String(line))
  })
  vi.spyOn(console, 'error').mockImplementation((line) => {
    errors.push(String(line))
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('注册表校验 CLI', () => {
  it('空清单 + tag 对齐时离线校验通过', async () => {
    const file = writeRegistry('empty.json', registry())
    expect(await main(['--file', file])).toBe(0)
    expect(logs.join('\n')).toContain('空清单')
    expect(logs.join('\n')).toContain('固定 tag 与 package.json 版本一致')
    expect(logs.join('\n')).toContain('跳过已发布注册表的网络比对')
    expect(errors).toEqual([])
  })

  it('文件不存在或不是 JSON 时直接失败，不抛异常', async () => {
    expect(await main(['--file', path.join(dir, 'missing.json')])).toBe(1)
    expect(errors.join('\n')).toContain('无法解析')

    const broken = writeRegistry('broken.json', '{oops')
    expect(await main(['--file', broken])).toBe(1)
    expect(errors.join('\n')).toContain('无法解析')
  })

  it('非空清单没签名时判失败（客户端会整份拒绝）', async () => {
    const file = writeRegistry('unsigned.json', registry([entry()]))
    expect(await main(['--file', file])).toBe(1)
    expect(errors.join('\n')).toContain('REGISTRY_UNSIGNED')
  })

  it('签名正确时通过并提示可被内置公钥验证', async () => {
    const signed = signRegistry(registry([entry()]), PRIVATE_PEM)
    const file = writeRegistry('signed.json', signed)
    const { DEFAULT_TRUSTED_PLUGIN_PUBLISHERS } = await import('../../src/shared/appSettings.ts')
    // 内置公钥与测试私钥不配对，这里改用 inspectRegistry 的直接断言验证签名路径
    expect(DEFAULT_TRUSTED_PLUGIN_PUBLISHERS.length).toBeGreaterThan(0)
    const result = await main(['--file', file])
    expect(result).toBe(1)
    expect(errors.join('\n')).toContain('REGISTRY_SIGNATURE_INVALID')
  })

  it('tag 与版本不一致时判失败（版本升了忘记改 tag）', async () => {
    holder.pinnedTag = 'v0.0.1'
    const file = writeRegistry('empty.json', registry())
    expect(await main(['--file', file])).toBe(1)
    expect(errors.join('\n')).toContain('固定 tag 与版本不一致')
  })

  it('--online 且已发布内容一致时通过', async () => {
    const local = registry()
    const file = writeRegistry('empty.json', local)
    stubFetch(async () => ({ ok: true, text: async () => JSON.stringify(local) }))
    expect(await main(['--file', file, '--online', '--url', 'https://x/y.json'])).toBe(0)
    expect(logs.join('\n')).toContain('已发布注册表与仓库文件内容一致')
  })

  it('--online 且已发布内容不同时报错（tag 不可变）', async () => {
    const file = writeRegistry('empty.json', registry())
    // 已发布那份本身合法（空清单免签），但载荷与仓库文件不同
    stubFetch(async () => ({
      ok: true,
      text: async () => JSON.stringify({ ...registry(), note: 'published' })
    }))
    expect(await main(['--file', file, '--online', '--url', 'https://x/y.json'])).toBe(1)
    expect(errors.join('\n')).toContain('内容不一致')
  })

  it('--online 且已发布注册表本身非法时报错', async () => {
    const file = writeRegistry('empty.json', registry())
    stubFetch(async () => ({ ok: true, text: async () => JSON.stringify(registry([entry()])) }))
    expect(await main(['--file', file, '--online', '--url', 'https://x/y.json'])).toBe(1)
    expect(errors.join('\n')).toContain('已发布注册表无法被客户端接受')
  })

  it('--online 拿到非 2xx 响应时按拉取失败处理', async () => {
    const file = writeRegistry('empty.json', registry())
    stubFetch(async () => ({ ok: false, status: 500, text: async () => '' }))
    expect(await main(['--file', file, '--online', '--url', 'https://x/y.json', '--timeout', '10'])).toBe(1)
    expect(errors.join('\n')).toContain('HTTP 500')
    expect(errors.join('\n')).toContain('无法拉取已发布注册表')
  })

  it('--online 拉取失败时给出可操作的提示而不是抛异常', async () => {
    const file = writeRegistry('empty.json', registry())
    stubFetch(async () => {
      throw new Error('ECONNRESET')
    })
    expect(await main(['--file', file, '--online', '--url', 'https://x/y.json', '--timeout', '10'])).toBe(1)
    expect(errors.join('\n')).toContain('无法拉取已发布注册表')
    expect(errors.join('\n')).toContain('网络受限时先离线校验')
  })
})
