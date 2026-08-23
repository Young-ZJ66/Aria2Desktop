import { safeStorage } from 'electron'
import type { AppSettings } from '../types/store'

/**
 * RPC secret 的 safeStorage 加解密工具。
 *
 * 存储格式：
 * - 加密：`v1:` + safeStorage.encryptString(secret) 的 base64
 * - 明文（旧数据 / safeStorage 不可用）：无前缀，直接存原字符串
 *
 * `v1:` 前缀用于确定性地区分密文与旧明文，避免误把明文 secret 当作密文解密。
 * 加密必须发生在主进程（safeStorage 仅主进程可用），渲染进程拿到的始终是解密后的明文。
 */

/** 加密密文前缀：无前缀的值一律视为旧明文，透明兼容 */
const CIPHER_PREFIX = 'v1:'

/** 是否已提示过 safeStorage 不可用（避免重复刷屏） */
let warnedUnavailable = false

/** 输出一次 safeStorage 不可用的降级提示 */
function warnEncryptionUnavailable(): void {
  if (warnedUnavailable) return
  warnedUnavailable = true
  console.warn(
    '[SecretCipher] safeStorage 不可用（系统密钥环缺失，常见于 Linux），RPC secret 将以明文存储。'
  )
}

/**
 * 加密单个 secret 明文。
 * - safeStorage 可用：返回 `v1:` + base64 密文
 * - safeStorage 不可用或加密失败：回退明文并告警
 */
export function encryptSecret(plaintext: string): string {
  if (!plaintext) return plaintext
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return CIPHER_PREFIX + safeStorage.encryptString(plaintext).toString('base64')
    }
  } catch (error) {
    console.warn('[SecretCipher] 加密 RPC secret 失败，回退明文存储:', error)
  }
  warnEncryptionUnavailable()
  return plaintext
}

/**
 * 解密单个已存储的 secret。
 * - 带 `v1:` 前缀：视为密文，解密后返回明文；解密失败/不可用时返回原值（降级，不静默清空）
 * - 无前缀：旧明文数据，透明返回，下次保存时自动升级为密文
 */
export function decryptSecret(stored: string): string {
  if (!stored) return stored
  if (!stored.startsWith(CIPHER_PREFIX)) return stored
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(stored.slice(CIPHER_PREFIX.length), 'base64'))
    }
  } catch (error) {
    console.warn('[SecretCipher] 解密 RPC secret 失败:', error)
  }
  warnEncryptionUnavailable()
  return stored
}

/**
 * 对 settings 中全部 secret 字段（aria2.secret 与 connectionProfiles[].config.secret）加密。
 * 返回新对象，不修改入参。
 */
export function encryptSettingsSecrets(settings: AppSettings): AppSettings {
  if (!settings || typeof settings !== 'object') return settings
  const result: AppSettings = { ...settings }
  if (result.aria2) {
    result.aria2 = { ...result.aria2, secret: encryptSecret(result.aria2.secret ?? '') }
  }
  if (Array.isArray(result.connectionProfiles)) {
    result.connectionProfiles = result.connectionProfiles.map(p =>
      p && p.config
        ? { ...p, config: { ...p.config, secret: encryptSecret(p.config.secret ?? '') } }
        : p
    )
  }
  return result
}

/**
 * 对 settings 中全部 secret 字段解密（兼容旧明文）。
 * 返回新对象，不修改入参。
 */
export function decryptSettingsSecrets(settings: AppSettings): AppSettings {
  if (!settings || typeof settings !== 'object') return settings
  const result: AppSettings = { ...settings }
  if (result.aria2) {
    result.aria2 = { ...result.aria2, secret: decryptSecret(result.aria2.secret ?? '') }
  }
  if (Array.isArray(result.connectionProfiles)) {
    result.connectionProfiles = result.connectionProfiles.map(p =>
      p && p.config
        ? { ...p, config: { ...p.config, secret: decryptSecret(p.config.secret ?? '') } }
        : p
    )
  }
  return result
}
