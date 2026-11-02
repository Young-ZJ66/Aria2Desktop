/**
 * 浏览器扩展与应用之间的版本协同（纯函数，主进程与测试共用）。
 *
 * 为什么需要：扩展是独立于应用发布、独立升级的。用户装了扩展之后，应用升级到
 * 需要新接口的版本、而扩展还停在旧版时，表现是"某些按钮点了没反应"——没有报错，
 * 也没有任何提示，用户很难自己想到是扩展旧了。扩展每次调用本地接口都会带
 * `X-Extension-Version` 头，主进程把它记下来，设置页据此提示"该更新扩展了"。
 *
 * 两条约定：
 * - 版本号来自扩展，属于**外部输入**，进状态、进日志前先按 `normalizeExtensionVersion`
 *   校验；不合格一律当作"未知"，不原样透传到界面。
 * - 比较只按点分数字段逐段比（`1.10.0 > 1.9.0`），不引入 semver 依赖——两端的
 *   版本号都是 "主.次.修" 形式，用到预发布标记的可能性为零。
 */

/** 扩展与应用的一次连接记录（版本可能未知：旧版扩展不带该头） */
export interface ExtensionConnection {
  /** 最近一次看到的扩展版本；null 表示没拿到（旧版扩展或从未连接） */
  version: string | null
  /** 最近一次成功鉴权调用的时间戳（ms）；null 表示从未连接过 */
  lastSeenAt: number | null
}

/** 从未连接过的初始值（IPC 未就绪时也用它，界面据此显示"尚未检测到扩展"） */
export const EMPTY_EXTENSION_CONNECTION: ExtensionConnection = { version: null, lastSeenAt: null }

/** 允许的版本号形状：1 ~ 4 段数字，每段不超过 5 位（扩展自报，必须限制长度） */
const VERSION_PATTERN = /^\d{1,5}(\.\d{1,5}){0,3}$/

/**
 * 归一化扩展上报的版本号。
 * 不合规（非字符串、空串、超长、含其他字符）一律返回 null——调用方按"版本未知"处理。
 */
export function normalizeExtensionVersion(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return VERSION_PATTERN.test(trimmed) ? trimmed : null
}

/** 按点分数字段逐段比较：a > b 返回 1，相等 0，a < b 返回 -1（缺的段按 0 计） */
export function compareExtensionVersions(a: string, b: string): number {
  const left = a.split('.').map(Number)
  const right = b.split('.').map(Number)
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const x = left[index] ?? 0
    const y = right[index] ?? 0
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

/**
 * 扩展是否比应用旧。
 *
 * 版本未知（旧版扩展不带头部）不算"旧"：那种情况界面另有文案提示"版本未知，建议更新"，
 * 不必再挤一条"过旧"的错误样式。
 */
export function isExtensionOutdated(
  extensionVersion: string | null,
  appVersion: string
): boolean {
  if (!extensionVersion || !VERSION_PATTERN.test(appVersion)) return false
  return compareExtensionVersions(extensionVersion, appVersion) < 0
}
