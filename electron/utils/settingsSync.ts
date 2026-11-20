/**
 * 设置导出/导入（配置同步）的纯逻辑。
 *
 * 为什么放在主进程而不是渲染层：
 * - includeSecrets 导出要带 safeStorage 解密后的真实密钥，只有主进程拿得到明文；
 * - 导入要落盘并触发 UPnP 等副作用，写入必须经主进程统一入口（settingsAccessor）。
 *
 * 本模块刻意不 import 任何 electron API（与 utils/secretCipher 同口径），全部是纯函数，
 * 因此可以直接单测。文件选择/读写、对话框与 IPC 注册都在 IpcController 里。
 * 数据结构契约见 src/shared/settingsSync.ts（主进程与渲染层共用）。
 */

import type { AppSettings } from '../../src/shared/appSettings'
import type { SettingsExport, SettingsImportReport } from '../../src/shared/settingsSync'

type JsonRecord = Record<string, unknown>

/** 导出文件里的 app 标识（与 SettingsExport.app 一致） */
export const SETTINGS_EXPORT_APP_ID = 'Aria2Desktop'

/** theme 的合法取值（与 AppSettings['theme'] 同步） */
const THEMES = new Set(['light', 'dark', 'auto'])

/**
 * 允许导入的 settings 顶层键（白名单）。
 *
 * **必须与 src/shared/appSettings.ts 的 AppSettings 接口保持同步**：接口新增顶层字段时
 * 这里要一起加，否则导出文件里有、导入时会被静默计入 skipped（字段丢失）；
 * 反之白名单里多出的键会被写进磁盘成为脏字段。settingsSync.test.ts 里有
 * "白名单与 AppSettings 全部顶层键一致"的守护用例，改接口时测试会直接报红。
 */
export const ALLOWED_SETTINGS_KEYS: readonly string[] = [
  // 常规设置
  'language',
  'theme',
  'refreshInterval',
  'autoConnect',
  'minimizeToTray',
  'keepWindowState',
  'autoLaunch',
  'downloadCompleteAction',
  'clipboardMonitorEnabled',
  // 连接设置
  'aria2',
  'connectionProfiles',
  'activeProfileId',
  // 下载设置
  'download',
  // 调度
  'speedSchedule',
  'downloadSchedule',
  // 分类 / BT / 队列
  'category',
  'bt',
  'queue',
  // 任务模板与完成规则
  'taskTemplates',
  'completionRules',
  // Headless Web 控制台
  'webConsole',
  // 插件
  'pluginMarket',
  'trustedPluginPublishers'
]

const ALLOWED_SETTINGS_KEY_SET = new Set(ALLOWED_SETTINGS_KEYS)

/**
 * 敏感字段清单（脱敏与"保留本地值"共用同一份口径，两条路径必须同步改）：
 *
 * - settings.aria2.secret                                        RPC 密钥（safeStorage 加密落盘）
 * - settings.connectionProfiles[].config.secret                  各连接预设的 RPC 密钥（同上）
 * - settings.webConsole.token                                    Web 控制台主令牌（等价 admin）
 * - settings.webConsole.tokens[].token                           细粒度 API Token
 * - settings.completionRules[].actions[]（type=webhook）.secret   Webhook HMAC 签名密钥
 * - settings.taskTemplates[].cookie                              任务模板里的 Cookie 凭据
 *
 * 最后一项不是 secret/token 命名，但同属凭据：把导出文件给别人等于交出登录态，故一并脱敏。
 * 另注意 secretCipher 只加密前两项，其余字段在磁盘上是明文，导出脱敏必须覆盖全部路径。
 */

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asRecord(value: unknown): JsonRecord | undefined {
  return isRecord(value) ? value : undefined
}

/** 非空字符串（脱敏只处理有值的字段，空值保持原样） */
function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/**
 * 深拷贝设置对象。
 *
 * 用自写递归而不是 structuredClone：后者在旧 Node 上不可用，且遇到函数/Proxy 会抛错；
 * 设置里只可能是 JSON 值，递归拷贝足够，也不会因为引用共享而让脱敏污染调用方的对象。
 */
function deepClone<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(item => deepClone(item)) as unknown as T
  }
  if (value instanceof Date) {
    return new Date(value.getTime()) as unknown as T
  }
  if (isRecord(value)) {
    const out: JsonRecord = {}
    for (const [key, item] of Object.entries(value)) {
      out[key] = deepClone(item)
    }
    return out as T
  }
  return value
}

/** 数组字段转 JsonRecord 列表（结构不对时按空数组处理，脱敏不该因脏数据抛错） */
function asRecordList(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord)
}

/**
 * 脱敏：返回深拷贝，把敏感字段的非空值替换为空字符串（保持结构存在，数组逐条处理）。
 *
 * 只清空"有值"的字段，是为了让导出文件本身能区分"用户没设"与"被脱敏"——
 * 导入侧据此判断是否需要保留本地值。
 */
export function redactSettings(settings: AppSettings): AppSettings {
  const next = deepClone(settings)
  const root = next as unknown as JsonRecord

  const aria2 = asRecord(root.aria2)
  if (aria2 && hasText(aria2.secret)) aria2.secret = ''

  for (const profile of asRecordList(root.connectionProfiles)) {
    const config = asRecord(profile.config)
    if (config && hasText(config.secret)) config.secret = ''
  }

  const webConsole = asRecord(root.webConsole)
  if (webConsole) {
    if (hasText(webConsole.token)) webConsole.token = ''
    for (const token of asRecordList(webConsole.tokens)) {
      if (hasText(token.token)) token.token = ''
    }
  }

  for (const rule of asRecordList(root.completionRules)) {
    for (const action of asRecordList(rule.actions)) {
      // 只清 webhook 动作的签名密钥；其它动作类型没有 secret 字段
      if (action.type === 'webhook' && hasText(action.secret)) action.secret = ''
    }
  }

  for (const template of asRecordList(root.taskTemplates)) {
    if (hasText(template.cookie)) template.cookie = ''
  }

  return next
}

/**
 * 按 id 匹配本地条目；导入文件里的条目 id 与本地对不上时退回同下标
 * （顺序变了但条目没变的场景仍能找回密钥）。
 */
function matchLocalEntry(imported: JsonRecord, localList: JsonRecord[], index: number): JsonRecord | undefined {
  const id = imported.id
  if (typeof id === 'string' && id !== '') {
    const found = localList.find(entry => entry.id === id)
    if (found) return found
  }
  return localList[index]
}

/**
 * 脱敏导入保护：导入值为空字符串且本地对应值非空时，保留本地值。
 *
 * 只对 data.redacted === true 的导出文件生效——未脱敏文件里的空字符串是用户的真实选择
 * （例如主动清空 RPC 密钥），必须照原样覆盖，否则"清空密钥"这个操作无法跨实例同步。
 *
 * 返回被保留的字段数（写入 SettingsImportReport.preservedSecrets）。
 */
function restoreSecrets(imported: AppSettings, local: AppSettings): number {
  const importedRoot = imported as unknown as JsonRecord
  const localRoot = local as unknown as JsonRecord
  let preserved = 0

  const restoreField = (target: JsonRecord | undefined, source: JsonRecord | undefined, field: string): void => {
    if (!target || !source) return
    if (target[field] !== '' || !hasText(source[field])) return
    target[field] = source[field]
    preserved++
  }

  restoreField(asRecord(importedRoot.aria2), asRecord(localRoot.aria2), 'secret')

  const localProfiles = asRecordList(localRoot.connectionProfiles)
  asRecordList(importedRoot.connectionProfiles).forEach((profile, index) => {
    const localProfile = matchLocalEntry(profile, localProfiles, index)
    restoreField(asRecord(profile.config), asRecord(localProfile?.config), 'secret')
  })

  const importedConsole = asRecord(importedRoot.webConsole)
  const localConsole = asRecord(localRoot.webConsole)
  if (importedConsole && localConsole) {
    restoreField(importedConsole, localConsole, 'token')
    const localTokens = asRecordList(localConsole.tokens)
    asRecordList(importedConsole.tokens).forEach((token, index) => {
      restoreField(token, matchLocalEntry(token, localTokens, index), 'token')
    })
  }

  const localRules = asRecordList(localRoot.completionRules)
  asRecordList(importedRoot.completionRules).forEach((rule, ruleIndex) => {
    const localRule = matchLocalEntry(rule, localRules, ruleIndex)
    const localActions = asRecordList(localRule?.actions)
    asRecordList(rule.actions).forEach((action, actionIndex) => {
      // 动作没有 id，只能按同下标对应
      if (action.type !== 'webhook') return
      restoreField(action, localActions[actionIndex], 'secret')
    })
  })

  const localTemplates = asRecordList(localRoot.taskTemplates)
  asRecordList(importedRoot.taskTemplates).forEach((template, index) => {
    restoreField(template, matchLocalEntry(template, localTemplates, index), 'cookie')
  })

  return preserved
}

/**
 * 构造导出对象。
 *
 * includeSecrets 为 false 时导出脱敏副本（redacted 标记为 true），便于把配置贴到 issue /
 * 发给别人排查；为 true 时导出真实密钥，用于自己换机迁移——**导出文件等同凭据**，
 * 渲染层必须在 UI 上明确提示。
 */
export function buildSettingsExport(settings: AppSettings, appVersion: string, includeSecrets: boolean): SettingsExport {
  const source = includeSecrets ? deepClone(settings) : redactSettings(settings)
  return {
    app: SETTINGS_EXPORT_APP_ID,
    version: appVersion,
    exportedAt: new Date().toISOString(),
    redacted: !includeSecrets,
    settings: source as unknown as Record<string, unknown>
  }
}

/** 导入结果：失败时只带中文错误消息，成功时带合并后的 settings 与报告 */
export type SettingsImportResult =
  | { ok: true; next: AppSettings; report: SettingsImportReport }
  | { ok: false; error: string }

/**
 * 最小类型校验：只拦"明显不是这个类型"的键，不做完整结构校验。
 *
 * 取舍：导入的是用户自己导出的文件，过严的结构校验会让跨版本迁移变脆（旧文件少个字段
 * 就整键被拒）；这里只保证"写入的类型不会让启动流程崩"，细粒度归一化交给渲染层的
 * mergeWithDefaults 与各服务的读取端兜底。
 *
 * 返回 null 表示通过，否则为中文原因。
 */
function validateSettingValue(key: string, value: unknown): string | null {
  switch (key) {
    case 'language':
      return typeof value === 'string' ? null : 'language 必须是字符串'
    case 'theme':
      if (typeof value !== 'string') return 'theme 必须是字符串'
      return THEMES.has(value) ? null : 'theme 必须是 light / dark / auto 之一'
    case 'refreshInterval':
      return typeof value === 'number' && Number.isFinite(value) ? null : 'refreshInterval 必须是数字'
    case 'webConsole':
      return isRecord(value) ? null : 'webConsole 必须是对象'
    case 'connectionProfiles':
      return Array.isArray(value) ? null : 'connectionProfiles 必须是数组'
    default:
      return null
  }
}

/**
 * 应用导入数据：校验 → 按顶层键白名单合并 → 脱敏保护。
 *
 * 合并语义是**顶层键整键替换**（不是深合并）：深合并会让"删除某条连接预设/某条完成规则"
 * 无法通过导入表达，而整键替换与 settings 的写入语义（渲染层整体提交）一致。
 */
export function applySettingsImport(current: AppSettings, data: unknown): SettingsImportResult {
  if (!isRecord(data)) {
    return { ok: false, error: '导入数据必须是对象' }
  }
  if (data.app !== SETTINGS_EXPORT_APP_ID) {
    return { ok: false, error: '不是 Aria2Desktop 的设置导出文件（app 字段不匹配）' }
  }
  if (!isRecord(data.settings)) {
    return { ok: false, error: '导出文件缺少 settings 对象' }
  }

  const redacted = data.redacted === true
  const next = deepClone(current)
  const nextRoot = next as unknown as JsonRecord
  const report: SettingsImportReport = { applied: [], skipped: [], rejected: [], preservedSecrets: 0 }

  for (const [key, value] of Object.entries(data.settings)) {
    if (!ALLOWED_SETTINGS_KEY_SET.has(key)) {
      // 导出文件里存在但本版本不接受：可能是更高版本导出的新键，跳过而不是报错
      report.skipped.push(key)
      continue
    }
    if (value === undefined) {
      // JSON 里不会有 undefined；直接传 JS 对象时才可能，按"没有可导入的值"处理
      report.skipped.push(key)
      continue
    }
    const reason = validateSettingValue(key, value)
    if (reason) {
      report.rejected.push({ key, reason })
      continue
    }
    nextRoot[key] = deepClone(value)
    report.applied.push(key)
  }

  if (redacted) {
    report.preservedSecrets = restoreSecrets(next, current)
  }

  return { ok: true, next, report }
}


/** 内置引擎 RPC 端口合法范围（与 Aria2Controller 的 MIN_PORT / MAX_PORT 同口径） */
export const ENGINE_PORT_MIN = 1024
export const ENGINE_PORT_MAX = 65535

/**
 * 导入的 settings 里「需要落到 aria2.conf」的引擎字段。
 *
 * 为什么单独抽出来：导入只写 settings（electron-store）时，aria2.conf 里仍是旧端口/旧密钥，
 * 于是"导入了配置但引擎行为没变"，用户看到的是「导入成功却毫无变化」。这些字段必须
 * 由主进程按 aria2.conf 的键名再落一次盘（见 Aria2Controller.applyImportedSettings）。
 */
export interface ImportedEngineSettings {
  port?: number
  secret?: string
  downloadDir?: string
  enableRpc?: boolean
  rpcAllowOriginAll?: boolean
  rpcListenAll?: boolean
  rpcSecure?: boolean
}

/** 从 settings 中抽出引擎字段；缺失或类型不对的字段一律不返回（保持引擎当前值） */
export function extractImportedEngineSettings(settings: AppSettings): ImportedEngineSettings {
  const result: ImportedEngineSettings = {}
  const aria2 = settings.aria2
  if (!aria2) return result

  const port = Number(aria2.port)
  if (aria2.port !== undefined && Number.isInteger(port) && port >= ENGINE_PORT_MIN && port <= ENGINE_PORT_MAX) {
    result.port = port
  }
  // 空串是有意义的取值（用户显式选择"无密钥"），必须原样带出去
  if (typeof aria2.secret === 'string') {
    result.secret = aria2.secret
  }
  if (typeof aria2.downloadDir === 'string' && aria2.downloadDir.trim() !== '') {
    result.downloadDir = aria2.downloadDir.trim().replace(/\\/g, '/')
  }
  if (typeof aria2.enableRpc === 'boolean') result.enableRpc = aria2.enableRpc
  if (typeof aria2.rpcAllowOriginAll === 'boolean') result.rpcAllowOriginAll = aria2.rpcAllowOriginAll
  if (typeof aria2.rpcListenAll === 'boolean') result.rpcListenAll = aria2.rpcListenAll
  if (typeof aria2.rpcSecure === 'boolean') result.rpcSecure = aria2.rpcSecure
  return result
}

/** 引擎设置的规范化结果：next 为可安全写入的 settings，normalized 记录被调整/丢弃的字段 */
export interface NormalizedEngineSettings {
  next: AppSettings
  normalized: string[]
}

/**
 * 规范化导入的引擎设置（纯函数）。
 *
 * 导入文件可能来自别的机器或手改过：端口写成字符串/越界、下载目录用反斜杠或空串。
 * 这些值若原样写进 aria2.conf，引擎会启动失败（越界端口）或把文件写到奇怪的位置，
 * 因此先就地修正，无法修正的字段直接丢弃（回落到本机当前值），并把字段名回报给调用方记日志。
 */
export function normalizeImportedEngineSettings(settings: AppSettings): NormalizedEngineSettings {
  const aria2 = settings.aria2
  if (!aria2) return { next: settings, normalized: [] }

  const normalized: string[] = []
  const nextAria2: NonNullable<AppSettings['aria2']> = { ...aria2 }

  if (aria2.port !== undefined) {
    const port = Number(aria2.port)
    if (!Number.isInteger(port) || port < ENGINE_PORT_MIN || port > ENGINE_PORT_MAX) {
      delete nextAria2.port
      normalized.push('aria2.port')
    } else if (port !== aria2.port) {
      nextAria2.port = port
      normalized.push('aria2.port')
    }
  }

  if (aria2.downloadDir !== undefined) {
    const dir = String(aria2.downloadDir).trim().replace(/\\/g, '/')
    if (dir === '') {
      delete nextAria2.downloadDir
      normalized.push('aria2.downloadDir')
    } else if (dir !== aria2.downloadDir) {
      nextAria2.downloadDir = dir
      normalized.push('aria2.downloadDir')
    }
  }

  if (aria2.secret !== undefined && typeof aria2.secret !== 'string') {
    delete nextAria2.secret
    normalized.push('aria2.secret')
  }

  if (normalized.length === 0) return { next: settings, normalized }
  return { next: { ...settings, aria2: nextAria2 }, normalized }
}
