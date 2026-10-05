import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * secretCipher 的回归用例。
 *
 * 这里 mock 掉 electron / electron-log：本模块是纯加解密逻辑，
 * 桩化后可在 node 环境直接验证「密钥不会被嵌套加密破坏」这条红线。
 */
const safeStorageMock = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => true),
  // 用可逆的假算法代替 DPAPI：只要保证 encrypt/decrypt 成对即可验证嵌套问题
  encryptString: vi.fn((plain: string) => Buffer.from(`enc(${plain})`, 'utf8')),
  decryptString: vi.fn((buf: Buffer) => {
    const text = buf.toString('utf8')
    const match = /^enc\((.*)\)$/s.exec(text)
    if (!match) throw new Error('bad ciphertext')
    return match[1]
  })
}))

vi.mock('electron', () => ({ safeStorage: safeStorageMock, app: { isPackaged: false, getPath: () => '' } }))
vi.mock('electron-log/main', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), transports: { file: {}, console: {} } }
}))

const { encryptSecret, decryptSecret, encryptSettingsSecrets, decryptSettingsSecrets } = await import('./secretCipher')
type Settings = Parameters<typeof encryptSettingsSecrets>[0]

beforeEach(() => {
  safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
  safeStorageMock.encryptString.mockClear()
  safeStorageMock.decryptString.mockClear()
})

describe('encryptSecret / decryptSecret', () => {
  it('可用时产出 v1: 前缀密文，且能往返解出原文', () => {
    const stored = encryptSecret('my-secret')
    expect(stored.startsWith('v1:')).toBe(true)
    expect(decryptSecret(stored)).toBe('my-secret')
  })

  it('旧明文（无前缀）透明兼容', () => {
    expect(decryptSecret('legacy-plain-secret')).toBe('legacy-plain-secret')
    expect(encryptSecret('')).toBe('')
    expect(decryptSecret('')).toBe('')
  })

  it('幂等护栏：已是密文时拒绝二次加密（防止嵌套加密逐层加深）', () => {
    const once = encryptSecret('my-secret')
    safeStorageMock.encryptString.mockClear()

    const twice = encryptSecret(once)

    expect(twice).toBe(once)                                   // 原样返回
    expect(safeStorageMock.encryptString).not.toHaveBeenCalled() // 且没有再走加密
  })

  it('解密失败时返回空串而非密文（否则密文会被当成明文密钥继续流转）', () => {
    const stored = encryptSecret('my-secret')
    safeStorageMock.decryptString.mockImplementationOnce(() => { throw new Error('DPAPI 不可用') })

    const result = decryptSecret(stored)

    expect(result).toBe('')
    expect(result).not.toBe(stored)
    expect(result.startsWith('v1:')).toBe(false)
  })

  it('safeStorage 不可用时同样返回空串（不返回密文）', () => {
    const stored = encryptSecret('my-secret')
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)

    expect(decryptSecret(stored)).toBe('')
  })

  it('safeStorage 不可用时加密回退明文（无前缀），仍可被透明读回', () => {
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    const stored = encryptSecret('my-secret')

    expect(stored).toBe('my-secret')
    expect(stored.startsWith('v1:')).toBe(false)
    expect(decryptSecret(stored)).toBe('my-secret')
  })
})

describe('settings 级加解密（读-改-写循环不得破坏密钥）', () => {
  const settings: Settings = {
    aria2: { port: 6800, secret: 'rpc-secret-value' },
    connectionProfiles: [
      {
        id: 'p1',
        name: '本机',
        config: { host: '127.0.0.1', port: 6800, protocol: 'http', path: '/jsonrpc', secret: 'profile-secret' }
      }
    ]
  }

  it('加密后磁盘上不含明文，解密后完全还原', () => {
    const onDisk = encryptSettingsSecrets(settings)
    expect(onDisk.aria2?.secret).not.toBe('rpc-secret-value')
    expect(onDisk.connectionProfiles?.[0]?.config?.secret).not.toBe('profile-secret')

    const restored = decryptSettingsSecrets(onDisk)
    expect(restored.aria2?.secret).toBe('rpc-secret-value')
    expect(restored.connectionProfiles?.[0]?.config?.secret).toBe('profile-secret')
  })

  it('反复"解密 → 改别的字段 → 加密"不会让密钥嵌套加深', () => {
    // 模拟渲染层：读设置（已解密）→ 改一个无关字段 → 整体回写
    let onDisk = encryptSettingsSecrets(settings)
    const secretLayers: string[] = []

    for (let i = 0; i < 3; i++) {
      const inMemory = decryptSettingsSecrets(onDisk)
      inMemory.theme = i % 2 === 0 ? 'dark' : 'light'
      onDisk = encryptSettingsSecrets(inMemory)
      secretLayers.push(onDisk.aria2?.secret ?? '')
    }

    // 每轮的密文必须相同（= 只加密了一层），且解密始终得到原始密钥
    expect(new Set(secretLayers).size).toBe(1)
    expect(decryptSecret(secretLayers[2] ?? '')).toBe('rpc-secret-value')
  })
})
