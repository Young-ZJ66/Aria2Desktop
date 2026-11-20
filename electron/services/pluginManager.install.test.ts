import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

/**
 * 插件市场安装路径的安全不变式（D-02）。
 *
 * 验收项：篡改 registry 的测试包被拒绝；未签名包默认无法安装；开发者模式可安装
 * 但返回警告；升级写入失败时旧插件仍然可用。
 *
 * 这里用真实密钥对与真实临时目录，只把网络（fetch）与少量 fs 调用替换掉，
 * 因为被验证的正是"校验 + 落盘"这两步本身。
 */

const realFs = await vi.importActual<typeof import('node:fs')>('node:fs')

/** 测试内生成的 Ed25519 密钥对：签名逻辑必须能验证真实签名 */
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
const PUBLIC_KEY_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString()

const holder = vi.hoisted(() => ({
  userData: '',
  appPath: '',
  settings: {} as Record<string, unknown>,
  fetchBody: Buffer.alloc(0),
  fetchStatus: 200,
  failRenameTo: '' as string
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => holder.userData,
    getAppPath: () => holder.appPath,
    isPackaged: false
  },
  Notification: { isSupported: () => false },
  // 没有 utilityProcess：安装后的激活走 vm 回退，安装逻辑本身与运行时无关
  utilityProcess: undefined
}))

vi.mock('electron-store', () => ({
  default: class FakeStore {
    private data = new Map<string, unknown>()
    get(key: string) {
      return this.data.get(key)
    }
    set(key: string, value: unknown) {
      this.data.set(key, value)
    }
  }
}))

vi.mock('../utils/aria2Rpc', () => ({ callAria2Rpc: vi.fn() }))
vi.mock('../utils/settingsAccessor', () => ({
  getSettingsFresh: vi.fn(() => holder.settings)
}))
vi.mock('../utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
}))

// 升级失败场景需要让某一次 rename 抛错，其余 fs 行为保持真实
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    renameSync: (from: string, to: string) => {
      if (holder.failRenameTo && String(to) === holder.failRenameTo && String(from).includes('.tmp-')) {
        throw new Error('simulated rename failure')
      }
      return actual.renameSync(from, to)
    }
  }
})

import { PluginManager, canonicalizeRegistry, verifyRegistryTrust } from './pluginManager'
import { DEFAULT_TRUSTED_PLUGIN_PUBLISHERS } from '../../src/shared/appSettings'

type StoreLike = ConstructorParameters<typeof PluginManager>[0]

function makeStore(): StoreLike {
  return new (class {
    private data = new Map<string, unknown>()
    get(key: string) {
      return this.data.get(key)
    }
    set(key: string, value: unknown) {
      this.data.set(key, value)
    }
  })() as unknown as StoreLike
}

function sign(data: Buffer): string {
  return crypto.sign(null, data, privateKey).toString('base64')
}

const CODE = Buffer.from('module.exports = { onActivate() {} }\n', 'utf8')
const SHA = crypto.createHash('sha256').update(CODE).digest('hex')

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'market-demo',
    name: 'Market Demo',
    version: '2.0.0',
    entryUrl: 'https://example.com/market-demo.js',
    sha256: SHA,
    main: 'index.js',
    permissions: [],
    ...overrides
  }
}

function installedDir(id = 'market-demo'): string {
  return path.join(holder.userData, 'plugins', id)
}

let userData: string
let builtinRoot: string

beforeEach(() => {
  userData = realFs.mkdtempSync(path.join(os.tmpdir(), 'plugin-install-test-'))
  builtinRoot = realFs.mkdtempSync(path.join(os.tmpdir(), 'plugin-install-builtin-'))
  holder.userData = userData
  holder.appPath = builtinRoot
  holder.settings = { aria2: { port: 6800, secret: 'rpc' }, pluginMarket: { developerMode: false } }
  holder.fetchBody = CODE
  holder.fetchStatus = 200
  holder.failRenameTo = ''

  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: holder.fetchStatus >= 200 && holder.fetchStatus < 300,
    status: holder.fetchStatus,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-length' ? String(holder.fetchBody.length) : null) },
    arrayBuffer: async () => holder.fetchBody.buffer.slice(holder.fetchBody.byteOffset, holder.fetchBody.byteOffset + holder.fetchBody.length)
  })))
})

afterEach(() => {
  vi.unstubAllGlobals()
  realFs.rmSync(userData, { recursive: true, force: true })
  realFs.rmSync(builtinRoot, { recursive: true, force: true })
})

describe('签名强制（D-02）', () => {
  it('调用方没传可信发布者时回落到内置官方公钥，未签名包被拒绝', async () => {
    const manager = new PluginManager(makeStore())

    const result = await manager.installFromRegistry(entry(), [])

    expect(result.success).toBe(false)
    expect(result.error).toBe('SIGNATURE_REQUIRED')
    expect(realFs.existsSync(installedDir())).toBe(false)
    // 内置默认公钥必须是非空集合，否则"默认强制签名"只是空话
    expect(DEFAULT_TRUSTED_PLUGIN_PUBLISHERS.length).toBeGreaterThan(0)
  })

  it('签名无法被任何可信公钥验证时拒绝安装', async () => {
    const manager = new PluginManager(makeStore())

    const result = await manager.installFromRegistry(
      entry({ signature: sign(CODE) }),
      [PUBLIC_KEY_PEM.replace(/[A-Za-z0-9+/=]/g, (ch) => (ch === '=' ? 'A' : ch === 'A' ? 'B' : 'A'))]
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe('SIGNATURE_INVALID')
    expect(realFs.existsSync(installedDir())).toBe(false)
  })

  it('签名有效时安装成功，且新装插件默认不自动启用', async () => {
    const manager = new PluginManager(makeStore())

    const result = await manager.installFromRegistry(
      entry({ signature: sign(CODE) }),
      [PUBLIC_KEY_PEM]
    )

    expect(result.success).toBe(true)
    expect(result.warning).toBeUndefined()
    expect(realFs.existsSync(path.join(installedDir(), 'manifest.json'))).toBe(true)
    const info = manager.getPlugins().find(plugin => plugin.manifest.id === 'market-demo')
    expect(info).toBeDefined()
    // 装完即运行等于"用户还没确认权限，代码已经在跑"
    expect(info?.enabled).toBe(false)
  })

  it('入口文件被篡改（sha256 不匹配）时拒绝，即使签名有效', async () => {
    const manager = new PluginManager(makeStore())
    const tampered = Buffer.from('module.exports = { onActivate() { /* backdoor */ } }\n', 'utf8')

    const result = await manager.installFromRegistry(
      entry({ sha256: crypto.createHash('sha256').update(tampered).digest('hex'), signature: sign(tampered) }),
      [PUBLIC_KEY_PEM]
    )

    // 下载到的内容与清单声明的哈希不符 → 直接拒绝
    expect(result.success).toBe(false)
    expect(result.error).toBe('CHECKSUM_MISMATCH')
    expect(realFs.existsSync(installedDir())).toBe(false)
  })

  it('开发者模式允许安装未签名包，但返回显式警告', async () => {
    holder.settings = { aria2: { port: 6800, secret: 'rpc' }, pluginMarket: { developerMode: true } }
    const manager = new PluginManager(makeStore())

    const result = await manager.installFromRegistry(entry(), [])

    expect(result.success).toBe(true)
    expect(result.warning).toBe('UNSIGNED_DEVELOPER_MODE')
    expect(realFs.existsSync(installedDir())).toBe(true)
  })

  it('开发者模式关闭时，调用方显式传 developerMode=false 也不能绕过签名', async () => {
    holder.settings = { aria2: { port: 6800, secret: 'rpc' }, pluginMarket: { developerMode: true } }
    const manager = new PluginManager(makeStore())

    const result = await manager.installFromRegistry(entry(), [], { developerMode: false })

    expect(result.success).toBe(false)
    expect(result.error).toBe('SIGNATURE_REQUIRED')
  })
})

describe('注册表签名校验（D-02）', () => {
  const registry = {
    version: 1,
    plugins: [
      {
        id: 'market-demo',
        name: 'Market Demo',
        version: '2.0.0',
        entryUrl: 'https://example.com/market-demo.js',
        sha256: SHA
      }
    ]
  }

  function signedRegistry() {
    const payload = Buffer.from(canonicalizeRegistry(registry), 'utf8')
    return { ...registry, signature: crypto.sign(null, payload, privateKey).toString('base64') }
  }

  it('签名有效时通过，篡改条目后失效', () => {
    const signed = signedRegistry()
    expect(verifyRegistryTrust(signed, [PUBLIC_KEY_PEM])).toBe(true)

    const tampered = { ...signed, plugins: [{ ...signed.plugins[0], entryUrl: 'https://evil.example/x.js' }] }
    expect(verifyRegistryTrust(tampered, [PUBLIC_KEY_PEM])).toBe(false)
  })

  it('缺少签名一律拒绝，且不接受 RSA 公钥降级', () => {
    expect(verifyRegistryTrust(registry, [PUBLIC_KEY_PEM])).toBe(false)

    const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
    const rsaPem = rsa.publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const signed = signedRegistry()
    expect(verifyRegistryTrust(signed, [rsaPem])).toBe(false)
  })

  it('调用方没传可信发布者时回落到内置官方公钥', () => {
    // 内置公钥与测试密钥不同，故这里应判失败——证明回落的确实是内置集合，
    // 而不是"没有公钥就放行"。
    expect(verifyRegistryTrust(signedRegistry(), [])).toBe(false)
    expect(DEFAULT_TRUSTED_PLUGIN_PUBLISHERS.length).toBeGreaterThan(0)
  })

  it('规范化与签名工具脚本口径一致（键序无关）', () => {
    const reordered = { plugins: registry.plugins, version: 1 }
    expect(canonicalizeRegistry(reordered)).toBe(canonicalizeRegistry(registry))
  })
})

describe('升级原子性（D-02）', () => {
  it('升级写入失败时保留旧插件目录，旧插件仍可用', async () => {
    const manager = new PluginManager(makeStore())
    const first = await manager.installFromRegistry(entry({ version: '1.0.0', signature: sign(CODE) }), [PUBLIC_KEY_PEM])
    expect(first.success).toBe(true)

    const oldManifest = JSON.parse(realFs.readFileSync(path.join(installedDir(), 'manifest.json'), 'utf8')) as { version: string }
    expect(oldManifest.version).toBe('1.0.0')

    // 让"临时目录 → 正式目录"的 rename 失败，模拟磁盘/权限问题
    holder.failRenameTo = installedDir()
    const upgrade = await manager.installFromRegistry(
      entry({ version: '2.0.0', signature: sign(CODE) }),
      [PUBLIC_KEY_PEM],
      { upgrade: true }
    )

    expect(upgrade.success).toBe(false)
    expect(upgrade.error).toBe('UPGRADE_FAILED')

    // 关键断言：旧版本目录与清单还在，没有变成空壳
    expect(realFs.existsSync(path.join(installedDir(), 'manifest.json'))).toBe(true)
    const manifestAfter = JSON.parse(realFs.readFileSync(path.join(installedDir(), 'manifest.json'), 'utf8')) as { version: string }
    expect(manifestAfter.version).toBe('1.0.0')
    expect(realFs.existsSync(path.join(installedDir(), 'index.js'))).toBe(true)
    expect(manager.getPlugins().some(plugin => plugin.manifest.id === 'market-demo')).toBe(true)

    // 不留临时/备份目录
    const leftovers = realFs.readdirSync(path.join(holder.userData, 'plugins'))
      .filter(name => name.includes('.tmp-') || name.includes('.bak-'))
    expect(leftovers).toEqual([])
  })

  it('升级成功时版本被替换，且保留原有停用状态', async () => {
    const manager = new PluginManager(makeStore())
    await manager.installFromRegistry(entry({ version: '1.0.0', signature: sign(CODE) }), [PUBLIC_KEY_PEM])

    const upgraded = await manager.installFromRegistry(
      entry({ version: '2.0.0', signature: sign(CODE) }),
      [PUBLIC_KEY_PEM],
      { upgrade: true }
    )

    expect(upgraded.success).toBe(true)
    const manifest = JSON.parse(realFs.readFileSync(path.join(installedDir(), 'manifest.json'), 'utf8')) as { version: string }
    expect(manifest.version).toBe('2.0.0')
    // 新装时是停用的，升级不应偷偷把它启用
    expect(manager.getPlugins().find(plugin => plugin.manifest.id === 'market-demo')?.enabled).toBe(false)
  })
})
