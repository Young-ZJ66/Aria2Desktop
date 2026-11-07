/**
 * IPC 写入边界的数据校验（主进程侧，可单测）。
 *
 * 渲染进程并不是"完全可信"的：页面若被 XSS/恶意插件内容攻破，它能调用 preload 暴露的
 * set-store-value 等通道。这里对写入 settings / windowState / taskSources 的载荷做
 * 结构白名单校验，避免任意对象被持久化后污染启动流程。
 *
 * 设计口径：
 * - 已知字段类型错误 → 整个请求拒绝（不静默丢字段，否则用户设置会"保存成功但没生效"）；
 * - 未知字段 → 丢弃（前后端版本不一致时容忍旧字段，绝不把任意键写进磁盘）；
 * - 字符串/数组都限制长度，防止用超大载荷撑爆 electron-store。
 */

import type {
  AppSettings,
  CategoryRule,
  ConnectionProfile,
  SpeedScheduleRule
} from '../../src/shared/appSettings'

type JsonRecord = Record<string, unknown>

const MAX_STRING = 32768
const MAX_ARRAY = 500

class ValidationError extends Error {}

function fail(message: string): never {
  throw new ValidationError(message)
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown, field: string, max = MAX_STRING): string {
  if (typeof value !== 'string') fail(`${field} 必须是字符串`)
  if (value.length > max) fail(`${field} 过长`)
  return value
}

function readBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') fail(`${field} 必须是布尔值`)
  return value
}

function readNumber(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${field} 必须是数字`)
  if (value < min || value > max) fail(`${field} 超出范围`)
  return value
}

function readInteger(value: unknown, field: string, min: number, max: number): number {
  const n = readNumber(value, field, min, max)
  if (!Number.isInteger(n)) fail(`${field} 必须是整数`)
  return n
}

function readArray<T>(value: unknown, field: string, max = MAX_ARRAY, item?: (v: unknown, i: number) => T): T[] {
  if (!Array.isArray(value)) fail(`${field} 必须是数组`)
  if (value.length > max) fail(`${field} 条目过多`)
  return item ? value.map(item) : (value as T[])
}

function readProtocol(value: unknown, field: string): 'http' | 'https' | 'ws' | 'wss' {
  if (value !== 'http' && value !== 'https' && value !== 'ws' && value !== 'wss') {
    fail(`${field} 协议非法`)
  }
  return value
}

function readTime(value: unknown, field: string): string {
  const text = readString(value, field, 5)
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) fail(`${field} 时间格式必须为 HH:mm`)
  return text
}

function readDays(value: unknown, field: string): number[] {
  return readArray<number>(value, field, 7, (item, index) => readInteger(item, `${field}[${index}]`, 0, 6))
}

function readSpeedRule(value: unknown, field: string): SpeedScheduleRule {
  if (!isRecord(value)) fail(`${field} 必须是对象`)
  return {
    name: readString(value.name, `${field}.name`, 100),
    days: readDays(value.days, `${field}.days`),
    startTime: readTime(value.startTime, `${field}.startTime`),
    endTime: readTime(value.endTime, `${field}.endTime`),
    downloadLimit: readNumber(value.downloadLimit, `${field}.downloadLimit`, 0, Number.MAX_SAFE_INTEGER),
    uploadLimit: readNumber(value.uploadLimit, `${field}.uploadLimit`, 0, Number.MAX_SAFE_INTEGER)
  }
}

function readDownloadScheduleRule(value: unknown, field: string): { name: string; enabled: boolean; days: number[]; startTime: string; endTime: string } {
  if (!isRecord(value)) fail(`${field} 必须是对象`)
  return {
    name: readString(value.name, `${field}.name`, 100),
    enabled: readBoolean(value.enabled, `${field}.enabled`),
    days: readDays(value.days, `${field}.days`),
    startTime: readTime(value.startTime, `${field}.startTime`),
    endTime: readTime(value.endTime, `${field}.endTime`)
  }
}

function readCategoryRule(value: unknown, field: string): CategoryRule {
  if (!isRecord(value)) fail(`${field} 必须是对象`)
  const result: CategoryRule = {
    id: readString(value.id, `${field}.id`, 100),
    dir: readString(value.dir, `${field}.dir`, 200),
    extensions: readArray<string>(value.extensions, `${field}.extensions`, 200, (item, index) =>
      readString(item, `${field}.extensions[${index}]`, 32).replace(/^\./, '').toLowerCase()
    )
  }
  if ('customDir' in value && value.customDir !== undefined) {
    result.customDir = readString(value.customDir, `${field}.customDir`)
  }
  if ('name' in value && value.name !== undefined) {
    result.name = readString(value.name, `${field}.name`, 100)
  }
  if ('custom' in value && value.custom !== undefined) {
    result.custom = readBoolean(value.custom, `${field}.custom`)
  }
  return result
}

function readConnectionProfile(value: unknown, field: string): ConnectionProfile {
  if (!isRecord(value) || !isRecord(value.config)) fail(`${field} 必须是连接预设对象`)
  return {
    id: readString(value.id, `${field}.id`, 100),
    name: readString(value.name, `${field}.name`, 100),
    config: {
      host: readString(value.config.host, `${field}.config.host`, 255),
      port: readInteger(value.config.port, `${field}.config.port`, 1, 65535),
      protocol: readProtocol(value.config.protocol, `${field}.config.protocol`),
      secret: readString(value.config.secret, `${field}.config.secret`, 4096),
      path: readString(value.config.path, `${field}.config.path`, 1024)
    }
  }
}

/** 校验并归一化 settings；返回只包含已知字段的新对象 */
export function sanitizeSettingsInput(input: unknown): AppSettings {
  if (!isRecord(input)) fail('settings 必须是对象')
  const out: AppSettings = {}

  if ('language' in input) out.language = readString(input.language, 'settings.language', 20)
  if ('theme' in input) {
    if (input.theme !== 'light' && input.theme !== 'dark' && input.theme !== 'auto') fail('settings.theme 非法')
    out.theme = input.theme
  }
  if ('refreshInterval' in input) out.refreshInterval = readInteger(input.refreshInterval, 'settings.refreshInterval', 250, 600000)
  for (const field of ['autoConnect', 'minimizeToTray', 'keepWindowState', 'autoLaunch'] as const) {
    if (field in input) out[field] = readBoolean(input[field], `settings.${field}`)
  }
  if ('downloadCompleteAction' in input) {
    const action = input.downloadCompleteAction
    if (action !== 'none' && action !== 'shutdown' && action !== 'hibernate' && action !== 'close'
      && action !== 'open-folder' && action !== 'open-file') {
      fail('settings.downloadCompleteAction 非法')
    }
    out.downloadCompleteAction = action
  }
  if ('clipboardMonitorEnabled' in input) {
    out.clipboardMonitorEnabled = readBoolean(input.clipboardMonitorEnabled, 'settings.clipboardMonitorEnabled')
  }

  if ('aria2' in input) {
    if (!isRecord(input.aria2)) fail('settings.aria2 必须是对象')
    const a = input.aria2
    const aria2: NonNullable<AppSettings['aria2']> = {}
    if ('host' in a) aria2.host = readString(a.host, 'settings.aria2.host', 255)
    if ('port' in a) aria2.port = readInteger(a.port, 'settings.aria2.port', 1, 65535)
    if ('secret' in a) aria2.secret = readString(a.secret, 'settings.aria2.secret', 4096)
    if ('secretAutogenerated' in a) aria2.secretAutogenerated = readBoolean(a.secretAutogenerated, 'settings.aria2.secretAutogenerated')
    if ('protocol' in a) aria2.protocol = readProtocol(a.protocol, 'settings.aria2.protocol')
    if ('path' in a) aria2.path = readString(a.path, 'settings.aria2.path', 1024)
    if ('autoStart' in a) aria2.autoStart = readBoolean(a.autoStart, 'settings.aria2.autoStart')
    if ('downloadDir' in a) aria2.downloadDir = readString(a.downloadDir, 'settings.aria2.downloadDir')
    for (const field of ['enableRpc', 'rpcAllowOriginAll', 'rpcListenAll', 'rpcSecure'] as const) {
      if (field in a) aria2[field] = readBoolean(a[field], `settings.aria2.${field}`)
    }
    out.aria2 = aria2
  }

  if ('connectionProfiles' in input) {
    out.connectionProfiles = readArray(input.connectionProfiles, 'settings.connectionProfiles', 100, (item, i) =>
      readConnectionProfile(item, `settings.connectionProfiles[${i}]`)
    )
  }
  if ('activeProfileId' in input) out.activeProfileId = readString(input.activeProfileId, 'settings.activeProfileId', 100)

  if ('download' in input) {
    if (!isRecord(input.download)) fail('settings.download 必须是对象')
    const d = input.download
    const download: NonNullable<AppSettings['download']> = {}
    if ('defaultDir' in d) download.defaultDir = readString(d.defaultDir, 'settings.download.defaultDir')
    if ('maxConcurrentDownloads' in d) download.maxConcurrentDownloads = readInteger(d.maxConcurrentDownloads, 'settings.download.maxConcurrentDownloads', 1, 100)
    if ('maxConnectionPerServer' in d) download.maxConnectionPerServer = readInteger(d.maxConnectionPerServer, 'settings.download.maxConnectionPerServer', 1, 100)
    if ('minSplitSize' in d) download.minSplitSize = readString(d.minSplitSize, 'settings.download.minSplitSize', 32)
    for (const field of ['autoStart', 'autoExtract', 'autoDeleteArchive'] as const) {
      if (field in d) download[field] = readBoolean(d[field], `settings.download.${field}`)
    }
    if ('recentSaveDirs' in d) {
      download.recentSaveDirs = readArray<string>(d.recentSaveDirs, 'settings.download.recentSaveDirs', 20, (item, i) =>
        readString(item, `settings.download.recentSaveDirs[${i}]`)
      )
    }
    out.download = download
  }

  if ('speedSchedule' in input) {
    if (!isRecord(input.speedSchedule)) fail('settings.speedSchedule 必须是对象')
    out.speedSchedule = {
      enabled: readBoolean(input.speedSchedule.enabled, 'settings.speedSchedule.enabled'),
      rules: readArray(input.speedSchedule.rules, 'settings.speedSchedule.rules', 100, (item, i) =>
        readSpeedRule(item, `settings.speedSchedule.rules[${i}]`)
      )
    }
  }

  if ('downloadSchedule' in input) {
    if (!isRecord(input.downloadSchedule)) fail('settings.downloadSchedule 必须是对象')
    out.downloadSchedule = {
      enabled: readBoolean(input.downloadSchedule.enabled, 'settings.downloadSchedule.enabled'),
      rules: readArray(input.downloadSchedule.rules, 'settings.downloadSchedule.rules', 100, (item, i) =>
        readDownloadScheduleRule(item, `settings.downloadSchedule.rules[${i}]`)
      )
    }
  }

  if ('category' in input) {
    if (!isRecord(input.category)) fail('settings.category 必须是对象')
    out.category = {}
    if ('autoClassify' in input.category) out.category.autoClassify = readBoolean(input.category.autoClassify, 'settings.category.autoClassify')
    if ('categories' in input.category) {
      out.category.categories = readArray(input.category.categories, 'settings.category.categories', 200, (item, i) =>
        readCategoryRule(item, `settings.category.categories[${i}]`)
      )
    }
  }

  if ('bt' in input) {
    if (!isRecord(input.bt)) fail('settings.bt 必须是对象')
    out.bt = {}
    if ('upnpEnabled' in input.bt) out.bt.upnpEnabled = readBoolean(input.bt.upnpEnabled, 'settings.bt.upnpEnabled')
  }

  return out
}

/** 校验窗口状态；返回 undefined 表示载荷非法 */
export function sanitizeWindowStateInput(input: unknown): Record<string, unknown> | null {
  try {
    if (!isRecord(input)) fail('windowState 必须是对象')
    const out: Record<string, unknown> = {}
    if ('bounds' in input && input.bounds !== undefined) {
      if (!isRecord(input.bounds)) fail('windowState.bounds 必须是对象')
      const b = input.bounds
      out.bounds = {
        x: readInteger(b.x, 'windowState.bounds.x', -100000, 100000),
        y: readInteger(b.y, 'windowState.bounds.y', -100000, 100000),
        width: readInteger(b.width, 'windowState.bounds.width', 100, 20000),
        height: readInteger(b.height, 'windowState.bounds.height', 100, 20000)
      }
    }
    for (const field of ['isMaximized', 'isFullScreen'] as const) {
      if (field in input) out[field] = readBoolean(input[field], `windowState.${field}`)
    }
    return out
  } catch {
    return null
  }
}

/** 校验任务来源缓存（taskSources）：只保留结构合法的记录 */
export function sanitizeTaskSourcesInput(input: unknown): Record<string, unknown> | null {
  try {
    if (!isRecord(input)) fail('taskSources 必须是对象')
    const entries = Object.entries(input)
    if (entries.length > 2000) fail('taskSources 条目过多')
    const out: Record<string, unknown> = {}
    for (const [gid, raw] of entries) {
      if (!gid || gid.length > 128 || !isRecord(raw)) continue
      const source = raw.source
      if (!isRecord(source)) continue
      let sanitizedSource: Record<string, unknown>
      if (source.kind === 'uri') {
        const uris = readArray<string>(source.uris, 'source.uris', 100, (item, i) => readString(item, `source.uris[${i}]`, 8192))
        sanitizedSource = { kind: 'uri', uris }
      } else if (source.kind === 'torrent') {
        sanitizedSource = { kind: 'torrent', torrent: readString(source.torrent, 'source.torrent', 20 * 1024 * 1024) }
        if ('uris' in source && source.uris !== undefined) {
          sanitizedSource.uris = readArray<string>(source.uris, 'source.uris', 100, (item, i) => readString(item, `source.uris[${i}]`, 8192))
        }
      } else if (source.kind === 'metalink') {
        sanitizedSource = { kind: 'metalink', metalink: readString(source.metalink, 'source.metalink', 20 * 1024 * 1024) }
      } else {
        continue
      }
      const record: Record<string, unknown> = { source: sanitizedSource, createdAt: Date.now() }
      if ('createdAt' in raw && typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt)) record.createdAt = raw.createdAt
      if ('options' in raw && isRecord(raw.options)) {
        const options: Record<string, string> = {}
        for (const [key, value] of Object.entries(raw.options).slice(0, 200)) {
          if (typeof value === 'string' && key.length <= 200 && value.length <= 8192) options[key] = value
        }
        record.options = options
      }
      out[gid] = record
    }
    return out
  } catch {
    return null
  }
}

/** 仅允许无凭据的 http/https URL（用于交给 yt-dlp 等外部程序的目标地址） */
export function isSafeHttpUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 8192) return false
  try {
    const url = new URL(raw)
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
  } catch {
    return false
  }
}
