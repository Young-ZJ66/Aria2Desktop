/**
 * aria2 退出码（errorCode）到用户能懂的说明。
 *
 * 为什么需要：任务失败时详情里显示的是引擎原话——
 * `errorCode 18` 或一段英文（`Could not create directory`）。
 * 用户看到的是"下载失败"，不知道该改什么；搜索引擎里"aria2 错误 18"这类查询
 * 反而比界面更管用，说明界面没把关键信息翻译出来。
 *
 * 这里只做"码 → 分类"的纯映射，具体文案走语言包（键见 ARIA2_ERROR_MESSAGE_KEYS），
 * 这样分类表能和语言包对账（i18n-keys.test.mjs 会校验每个键都存在）。
 *
 * 码表出处：aria2 手册 EXIT CODES（1-32），只收录用户可能遇到且有明确动作的那些，
 * 其余归入 other / unknown，界面回落引擎原话。
 */

export type Aria2ErrorKind =
  | 'unknown'
  | 'timeout'
  | 'notFound'
  | 'resourceExhausted'
  | 'network'
  | 'diskFull'
  | 'fileExists'
  | 'cannotCreateDir'
  | 'cannotCreateFile'
  | 'filesystem'
  | 'dns'
  | 'authFailed'
  | 'tooManyRedirects'
  | 'serverBusy'
  | 'checksum'
  | 'other'

/** aria2 退出码 → 分类；未收录的码返回 other，非法输入返回 unknown */
export function classifyAria2Error(code: string | number | null | undefined): Aria2ErrorKind {
  if (code === null || code === undefined) return 'unknown'
  const text = String(code).trim()
  if (!/^\d+$/.test(text)) return 'unknown'
  const numeric = Number(text)
  if (numeric === 0) return 'unknown'

  switch (numeric) {
    case 2:
      return 'timeout'
    case 3:
      return 'notFound'
    case 4:
      return 'resourceExhausted'
    case 6:
      return 'network'
    case 9:
      return 'diskFull'
    case 13:
      return 'fileExists'
    case 16:
      return 'cannotCreateFile'
    case 17:
      return 'filesystem'
    case 18:
      return 'cannotCreateDir'
    case 19:
      return 'dns'
    case 24:
      return 'authFailed'
    case 23:
      return 'tooManyRedirects'
    case 29:
      return 'serverBusy'
    case 32:
      return 'checksum'
    default:
      return 'other'
  }
}

/**
 * 分类 → 语言包键（`taskDetail.aria2Error.*`）。
 *
 * 组件里是 `t(`taskDetail.aria2Error.${kind}`)` 拼接，静态扫描看不见，
 * 所以映射表放在 shared 里，让 i18n 守卫测试能逐项对账。
 */
export const ARIA2_ERROR_MESSAGE_KEYS: Record<Exclude<Aria2ErrorKind, 'unknown'>, string> = {
  timeout: 'timeout',
  notFound: 'notFound',
  resourceExhausted: 'resourceExhausted',
  network: 'network',
  diskFull: 'diskFull',
  fileExists: 'fileExists',
  cannotCreateFile: 'cannotCreateFile',
  filesystem: 'filesystem',
  cannotCreateDir: 'cannotCreateDir',
  dns: 'dns',
  authFailed: 'authFailed',
  tooManyRedirects: 'tooManyRedirects',
  serverBusy: 'serverBusy',
  checksum: 'checksum',
  other: 'other'
}
