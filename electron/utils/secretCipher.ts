import { safeStorage } from 'electron'
import { createLogger } from './logger'
import type { AppSettings } from '../types/store'
// 主进程产物是 CJS，运行时无法解析 @/ 别名，必须用相对路径引入 src/shared
import type { ConnectionProfile } from '../../src/shared/appSettings'

// 本文件日志文案自带 [SecretCipher] 前缀（历史风格），故 scope 传空避免前缀重复
// 注意：这里只记录失败原因，绝不打印密钥明文/密文（安全红线）
const logger = createLogger('')

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
  logger.warn(
    '[SecretCipher] safeStorage 不可用（系统密钥环缺失，常见于 Linux），RPC secret 将以明文存储。'
  )
}

/**
 * 加密单个 secret 明文。
 * - safeStorage 可用：返回 `v1:` + base64 密文
 * - safeStorage 不可用或加密失败：回退明文并告警
 * - **输入已是密文（`v1:` 前缀）时原样返回**：见下方幂等护栏
 */
export function encryptSecret(plaintext: string): string {
  if (!plaintext) return plaintext

  // 幂等护栏：对密文再加密一次会得到 v1:<encrypt("v1:...")>，
  // 而每一次"读-改-写"（渲染层改任一设置都会整体回写 settings）都会再套一层，
  // 于是密钥在嵌套加密里越陷越深、且日志里看不出原因——属不可自愈的静默损坏。
  // 正常路径不该出现密文入参；出现即说明上游把"解密失败"的返回值当明文用了，
  // 因此这里拒绝加密并留下错误日志（同时见 decryptSecret 的失败分支）。
  if (plaintext.startsWith(CIPHER_PREFIX)) {
    logger.error('[SecretCipher] 输入已是密文，拒绝二次加密（避免密钥被嵌套加密破坏）')
    return plaintext
  }

  try {
    if (safeStorage.isEncryptionAvailable()) {
      return CIPHER_PREFIX + safeStorage.encryptString(plaintext).toString('base64')
    }
  } catch (error) {
    logger.warn('[SecretCipher] 加密 RPC secret 失败，回退明文存储:', error)
  }
  warnEncryptionUnavailable()
  return plaintext
}

/**
 * 用户能否把 secret 设置成以 `v1:` 开头的值？
 * 不能：这是保留前缀，用于区分密文与旧明文。用户输入这类值时必须在**入口处拒绝**，
 * 否则会被 encryptSecret 的幂等护栏原样存储、再被 decryptSecret 当密文解密失败而清空。
 */
export function isReservedSecretPrefix(plaintext: string): boolean {
  return plaintext.startsWith(CIPHER_PREFIX)
}

/**
 * 解密单个已存储的 secret。
 * - 带 `v1:` 前缀：视为密文，解密后返回明文
 * - 无前缀：旧明文数据，透明返回，下次保存时自动升级为密文
 * - **解密失败或 safeStorage 不可用时返回空串**（绝不返回密文本身）
 *
 * 注意：调用方若要把解密结果**写回磁盘**，必须改用 `decryptSettingsSecrets` ——
 * 它会记录哪些字段解密失败，回写时保留原密文，避免把"暂时读不出"的密钥永久清空。
 */
export function decryptSecret(stored: string): string {
  if (!stored) return stored
  if (!stored.startsWith(CIPHER_PREFIX)) return stored
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(stored.slice(CIPHER_PREFIX.length), 'base64'))
    }
  } catch (error) {
    logger.warn('[SecretCipher] 解密 RPC secret 失败:', error)
  }
  warnEncryptionUnavailable()

  // 这里**不能**返回 stored（即那串 `v1:...` 密文）：
  // 那等于把必然错误的字符串当明文密钥使用，而且它在下次保存时会被再加密一层
  //（配合 encryptSecret 的护栏现在会拒绝，但正确的做法是根本不产生这个值）。
  // 返回空串让上层走"重新生成密钥"的可恢复分支（Aria2Controller.initialize 会自动补一个），
  // 代价是旧密钥失效——但它本来就已经不可用了，用户至少能重新连上。
  logger.error('[SecretCipher] RPC secret 无法解密，已按空值处理（应用会自动重新生成密钥）')
  return ''
}

/**
 * 解密失败字段的原密文暂存（WeakMap 按解密产物 settings 对象追踪）。
 *
 * 背景：解密失败时 decryptSecret 返回 ''（正确——密文绝不能当明文用），但一次瞬时失败
 * （DPAPI 密钥暂不可用、系统密钥环未就绪）若恰逢"读-改-写"回写，'' 会被持久化，
 * 原密文被永久清空且无法恢复。本表让 encryptSettingsSecrets 能识别"这个空串来自解密失败"，
 * 回写时保留磁盘上的原密文，等系统恢复后仍能解出。
 */
const undecryptableCiphertexts = new WeakMap<object, { aria2?: string; profiles: Map<ConnectionProfile, string> }>()

/**
 * 对 settings 中全部 secret 字段（aria2.secret 与 connectionProfiles[].config.secret）加密。
 * 返回新对象，不修改入参。
 *
 * 若入参来自 decryptSettingsSecrets 且其中有字段解密失败（登记在案），对应字段**原样保留
 * 磁盘上的原密文**而不是加密空串——避免瞬时解密失败把密钥永久清空。
 */
export function encryptSettingsSecrets(settings: AppSettings): AppSettings {
  if (!settings || typeof settings !== 'object') return settings
  const failed = undecryptableCiphertexts.get(settings)
  const result: AppSettings = { ...settings }
  if (result.aria2) {
    const preserved = failed?.aria2
    result.aria2 = {
      ...result.aria2,
      // 解密失败的字段保留原密文；其余照常加密
      secret: preserved !== undefined ? preserved : encryptSecret(result.aria2.secret ?? '')
    }
  }
  if (Array.isArray(result.connectionProfiles)) {
    result.connectionProfiles = result.connectionProfiles.map(p => {
      if (!p?.config) return p
      const preservedProfile = failed?.profiles.get(p)
      return {
        ...p,
        config: {
          ...p.config,
          secret: preservedProfile !== undefined ? preservedProfile : encryptSecret(p.config.secret ?? '')
        }
      }
    })
  }
  return result
}

/**
 * 对 settings 中全部 secret 字段解密（兼容旧明文）。
 * 返回新对象，不修改入参。
 *
 * 解密失败的字段：内存中为空串（绝不把密文当明文用），但失败事实已登记——
 * 该对象随后若被 encryptSettingsSecrets 回写磁盘，对应字段保留原密文不被清空。
 */
export function decryptSettingsSecrets(settings: AppSettings): AppSettings {
  if (!settings || typeof settings !== 'object') return settings
  const result: AppSettings = { ...settings }
  const record: { aria2?: string; profiles: Map<ConnectionProfile, string> } = { profiles: new Map() }
  if (result.aria2) {
    const stored = result.aria2.secret ?? ''
    const plain = decryptSecret(stored)
    result.aria2 = { ...result.aria2, secret: plain }
    // 登记解密失败（有密文但解不出）：回写时保留原密文
    if (!plain && stored.startsWith(CIPHER_PREFIX)) record.aria2 = stored
  }
  if (Array.isArray(result.connectionProfiles)) {
    result.connectionProfiles = result.connectionProfiles.map(p => {
      if (!p?.config) return p
      const stored = p.config.secret ?? ''
      const plain = decryptSecret(stored)
      const cloned = { ...p, config: { ...p.config, secret: plain } }
      if (!plain && stored.startsWith(CIPHER_PREFIX)) record.profiles.set(cloned, stored)
      return cloned
    })
  }
  // 只有真的存在失败项才登记（避免正常路径累积 WeakMap 条目）
  if (record.aria2 !== undefined || record.profiles.size > 0) {
    undecryptableCiphertexts.set(result, record)
  }
  return result
}
