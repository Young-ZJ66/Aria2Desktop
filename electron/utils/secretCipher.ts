import { safeStorage } from 'electron'
import { createLogger } from './logger'
import type { AppSettings } from '../types/store'
// 主进程产物是 CJS，运行时无法解析 @/ 别名，必须用相对路径引入 src/shared
import { SECRET_CIPHER_PREFIX } from '../../src/shared/secretPrefix'

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
 * 前缀常量与"用户输入不得使用该前缀"的判定在 src/shared/secretPrefix.ts——
 * 渲染层的表单校验也要用同一份，两边各写一份正则迟早失配。
 *
 * 加密必须发生在主进程（safeStorage 仅主进程可用），渲染进程拿到的始终是解密后的明文。
 */

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
  if (plaintext.startsWith(SECRET_CIPHER_PREFIX)) {
    logger.error('[SecretCipher] 输入已是密文，拒绝二次加密（避免密钥被嵌套加密破坏）')
    return plaintext
  }

  try {
    if (safeStorage.isEncryptionAvailable()) {
      return SECRET_CIPHER_PREFIX + safeStorage.encryptString(plaintext).toString('base64')
    }
  } catch (error) {
    logger.warn('[SecretCipher] 加密 RPC secret 失败，回退明文存储:', error)
  }
  warnEncryptionUnavailable()
  return plaintext
}

/**
 * 解密单个已存储的 secret。
 * - 带 `v1:` 前缀：视为密文，解密后返回明文
 * - 无前缀：旧明文数据，透明返回，下次保存时自动升级为密文
 * - **解密失败或 safeStorage 不可用时返回空串**（绝不返回密文本身）
 *
 * 注意：调用方若要把解密结果**写回磁盘**，必须走 settingsAccessor 的 `saveSettings()`——
 * 它在写边界拿磁盘原值判断是否需要保留原密文，避免瞬时解密失败把密钥永久清空。
 */
export function decryptSecret(stored: string): string {
  if (!stored) return stored
  if (!stored.startsWith(SECRET_CIPHER_PREFIX)) return stored
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(stored.slice(SECRET_CIPHER_PREFIX.length), 'base64'))
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
 * 决定某个 secret 字段该往磁盘写什么。
 *
 * 保留原密文的**三个条件必须同时成立**：
 * 1. 新值为空（用户没填、或内存里就是解密失败的空值）；
 * 2. 磁盘上原值是非空密文（有东西可保留）；
 * 3. 该密文**此刻解不出**（说明是"暂时读不出"，不是"用户就想清空"）。
 *
 * 少任何一条都照常写新值——所以系统正常时用户清空密钥依然会被清空，
 * 用户意图不会被这条保护吞掉。
 */
function sealSecret(nextPlain: string | undefined, previouslyStored: string | undefined): string {
  const plain = nextPlain ?? ''
  if (
    plain === '' &&
    previouslyStored &&
    previouslyStored.startsWith(SECRET_CIPHER_PREFIX) &&
    decryptSecret(previouslyStored) === ''
  ) {
    logger.warn('[SecretCipher] 密钥暂时解不出（系统密钥环不可用？），保留磁盘上的原密文而非写入空值')
    return previouslyStored
  }
  return encryptSecret(plain)
}

/**
 * 对 settings 中全部 secret 字段（aria2.secret 与 connectionProfiles[].config.secret）加密。
 * 返回新对象，不修改入参。
 *
 * @param previouslyStored **磁盘上现存的**（未解密的）settings，用于判定是否需要保留原密文；
 *        首次写入传 `null`。参数刻意做成必填：漏传会让"密钥不被清空"的保护静默失效。
 *
 * 为什么不靠内存对象的身份来判定：真实写盘路径要么跨 IPC（渲染层整体回写 settings，
 * 结构化克隆后是全新对象），要么用对象展开拼新对象——曾用 WeakMap 记对象身份的实现，
 * 在这两条主路径上必然落空，保护等于没有。磁盘原值是无状态、跨进程都成立的事实来源；
 * 连接预设按 `id` 匹配，数组重排/增删也不受影响。
 */
export function encryptSettingsSecrets(settings: AppSettings, previouslyStored: AppSettings | null): AppSettings {
  if (!settings || typeof settings !== 'object') return settings
  const result: AppSettings = { ...settings }
  if (result.aria2) {
    result.aria2 = {
      ...result.aria2,
      secret: sealSecret(result.aria2.secret, previouslyStored?.aria2?.secret)
    }
  }
  if (Array.isArray(result.connectionProfiles)) {
    result.connectionProfiles = result.connectionProfiles.map(p => {
      if (!p?.config) return p
      const storedBefore = previouslyStored?.connectionProfiles?.find(x => x?.id === p.id)?.config?.secret
      return {
        ...p,
        config: { ...p.config, secret: sealSecret(p.config.secret, storedBefore) }
      }
    })
  }
  return result
}

/**
 * 对 settings 中全部 secret 字段解密（兼容旧明文）。
 * 返回新对象，不修改入参。
 *
 * 解密失败的字段在内存里为空串（绝不把密文当明文用）。**保护不在这里做**：
 * 是否保留原密文由写边界的 `encryptSettingsSecrets` 依据磁盘原值决定，
 * 这样跨 IPC 的"读-改-写"同样受保护。
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
