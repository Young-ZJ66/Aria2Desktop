import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Store from 'electron-store'
import type { AppSettings, StoreData } from '../types/store'

/**
 * settingsAccessor 的回归用例。
 *
 * 这个模块是主进程读写 settings 的唯一入口，历史上出过两类事故：
 * 1. 写回时把磁盘上的 RPC 密钥清空（"新值为空"被当成"用户清空了密钥"）；
 * 2. 缓存新旧不一致（写完立刻读到旧值）。
 * 因此这里盯的不是解密算法，而是**读写边界**的语义：
 * 何时走缓存、何时必须直读、写回时哪些值必须原样保留。
 */

const safeStorageMock = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn((plain: string) => Buffer.from(`enc(${plain})`, 'utf8')),
  decryptString: vi.fn((buf: Buffer) => {
    const text = buf.toString('utf8')
    const match = /^enc\((.*)\)$/s.exec(text)
    if (!match) throw new Error('bad ciphertext')
    return match[1]
  })
}))

vi.mock('electron', () => ({
  safeStorage: safeStorageMock,
  app: { isPackaged: false, getPath: () => '' }
}))
vi.mock('electron-log/main', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), transports: { file: {}, console: {} } }
}))

/** 够用的 electron-store 替身：只在测试里模拟 get/set/onDidChange 三件事 */
class FakeStore {
  data: Record<string, unknown> = {}
  private listeners: Array<() => void> = []

  get(key: string, fallback?: unknown) {
    return key in this.data ? this.data[key] : fallback
  }

  set(key: string, value: unknown) {
    this.data[key] = value
    this.listeners.forEach((fn) => fn())
  }

  onDidChange(_key: string, callback: () => void) {
    this.listeners.push(callback)
    return () => {
      this.listeners = this.listeners.filter((fn) => fn !== callback)
    }
  }

  /** 模拟"文件被外部改掉"：只改内存值，不发变更事件 */
  pokeRaw(settings: unknown) {
    this.data.settings = settings
  }

  asStore() {
    return this as unknown as Store<StoreData>
  }
}

/** 每个用例都重新加载模块：boundStore/settingsCache 是模块级单例 */
async function loadModule() {
  vi.resetModules()
  return import('./settingsAccessor')
}

function settingsWithSecret(secret: string): AppSettings {
  return {
    aria2: { host: 'localhost', port: 6800, protocol: 'http', secret, path: '/jsonrpc' },
    connectionProfiles: [],
    activeProfileId: 'default'
  } as unknown as AppSettings
}

const CIPHER_PREFIX = 'v1:'

describe('settingsAccessor', () => {
  beforeEach(() => {
    safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
    vi.clearAllMocks()
  })

  it('未绑定 store 时读取立即失败（初始化顺序错误要当场暴露）', async () => {
    const { getSettings } = await loadModule()
    expect(() => getSettings()).toThrow(/bindSettingsStore/)
  })

  it('未绑定 store 时写入立即失败', async () => {
    const { saveSettings } = await loadModule()
    expect(() => saveSettings(settingsWithSecret('abc'))).toThrow(/bindSettingsStore/)
  })

  it('读到的 secret 是明文，而不是磁盘上的密文', async () => {
    const { bindSettingsStore, getSettings } = await loadModule()
    const store = new FakeStore()
    // 手写一个合法密文：v1: + base64(enc(secret))
    store.pokeRaw({ ...settingsWithSecret(`${CIPHER_PREFIX}${Buffer.from('enc(s3cret)').toString('base64')}`) })
    bindSettingsStore(store.asStore())
    expect(getSettings().aria2?.secret).toBe('s3cret')
  })

  it('缓存命中：底层数据被外部改动但没发事件时，仍返回缓存值', async () => {
    const { bindSettingsStore, getSettings } = await loadModule()
    const store = new FakeStore()
    store.pokeRaw(settingsWithSecret('first'))
    bindSettingsStore(store.asStore())
    expect(getSettings().aria2?.secret).toBe('first')

    store.pokeRaw(settingsWithSecret('second'))
    expect(getSettings().aria2?.secret).toBe('first')
  })

  it('store 发出 settings 变更后缓存作废', async () => {
    const { bindSettingsStore, getSettings } = await loadModule()
    const store = new FakeStore()
    store.pokeRaw(settingsWithSecret('first'))
    bindSettingsStore(store.asStore())
    expect(getSettings().aria2?.secret).toBe('first')

    // 走 set 才会触发 onDidChange（等同于任何一处写点）
    store.set('settings', settingsWithSecret('second'))
    expect(getSettings().aria2?.secret).toBe('second')
  })

  it('getSettingsFresh 绕过缓存，永远读磁盘现值', async () => {
    const { bindSettingsStore, getSettings, getSettingsFresh } = await loadModule()
    const store = new FakeStore()
    store.pokeRaw(settingsWithSecret('first'))
    bindSettingsStore(store.asStore())
    expect(getSettings().aria2?.secret).toBe('first')

    store.pokeRaw(settingsWithSecret('second'))
    expect(getSettings().aria2?.secret).toBe('first')
    expect(getSettingsFresh().aria2?.secret).toBe('second')
  })

  it('写入时落盘的是密文，且写完立刻读到新值', async () => {
    const { bindSettingsStore, getSettings, saveSettings } = await loadModule()
    const store = new FakeStore()
    bindSettingsStore(store.asStore())

    saveSettings(settingsWithSecret('fresh-secret'))

    const onDisk = store.data.settings as AppSettings
    expect(onDisk.aria2?.secret?.startsWith(CIPHER_PREFIX)).toBe(true)
    expect(onDisk.aria2?.secret).not.toContain('fresh-secret')
    expect(getSettings().aria2?.secret).toBe('fresh-secret')
  })

  it('新密钥为空、磁盘密文暂时解不开时保留原密文（不能把密钥清空）', async () => {
    const { bindSettingsStore, getSettings, saveSettings } = await loadModule()
    const store = new FakeStore()
    // 解不开的密文：v1: 前缀合法，但内容不是本机密钥能解的
    const undecryptable = `${CIPHER_PREFIX}${Buffer.from('not-our-ciphertext').toString('base64')}`
    store.pokeRaw({ ...settingsWithSecret(undecryptable) })
    bindSettingsStore(store.asStore())
    // 解密失败按空值处理（应用会重新生成密钥），这里先确认前提成立
    expect(getSettings().aria2?.secret).toBe('')

    saveSettings(settingsWithSecret(''))

    const onDisk = store.data.settings as AppSettings
    expect(onDisk.aria2?.secret).toBe(undecryptable)
  })

  it('用户确实清空密钥时，磁盘上一并清空（保留原密文只针对"解不开"的情况）', async () => {
    const { bindSettingsStore, saveSettings } = await loadModule()
    const store = new FakeStore()
    const encrypted = `${CIPHER_PREFIX}${Buffer.from('enc(old-secret)').toString('base64')}`
    store.pokeRaw({ ...settingsWithSecret(encrypted) })
    bindSettingsStore(store.asStore())

    saveSettings(settingsWithSecret(''))

    const onDisk = store.data.settings as AppSettings
    expect(onDisk.aria2?.secret).toBe('')
  })

  it('safeStorage 不可用时退回明文存储，不丢密钥', async () => {
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    const { bindSettingsStore, saveSettings, getSettings } = await loadModule()
    const store = new FakeStore()
    bindSettingsStore(store.asStore())

    saveSettings(settingsWithSecret('plain-secret'))

    const onDisk = store.data.settings as AppSettings
    expect(onDisk.aria2?.secret).toBe('plain-secret')
    expect(getSettings().aria2?.secret).toBe('plain-secret')
  })
})
