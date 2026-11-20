/**
 * 主进程返回给渲染层的错误文案（校验失败 / 操作结果）。
 *
 * 与 mainProcessCopy.ts 的分工：那边是"对话框与系统通知"这类主进程自己展示的文案，
 * 这里是"经 IPC 回到渲染层、由页面直接显示"的错误串（安装失败、订阅校验失败、
 * 引擎启动失败等）。两者都必须跟主进程语言一致——英文用户看到中文报错时，
 * 既不知道出了什么事，也不知道该改哪里。
 *
 * 用法：mainError(locale, 'ytdlp.notInstalled')；带占位符的用 {name} 形式，
 * 由第三个参数替换。中文串刻意保持与历史字面量逐字一致，避免既有单测与日志检索失效。
 */
import type { MainLocale } from './mainLocale'

/** 一条文案的中英两份（导出便于测试与调用方约束形状） */
export interface MainErrorPair {
  zh: string
  en: string
}

const TABLE = {
  // ---- yt-dlp ----
  'ytdlp.notInstalled': { zh: 'yt-dlp 未安装', en: 'yt-dlp is not installed' },
  'ytdlp.versionUnresolved': { zh: '无法解析最新版本号', en: 'Could not resolve the latest version number' },
  'ytdlp.platformUnsupported': {
    zh: '当前平台暂不支持自动下载 yt-dlp，请手动安装并加入系统 PATH',
    en: 'Automatic yt-dlp download is not supported on this platform; install it manually and add it to PATH'
  },
  'ytdlp.checksumMissing': {
    zh: '官方校验文件中缺少该平台的 SHA-256，已停止安装',
    en: 'The official checksum file has no SHA-256 for this platform, so the installation was stopped'
  },
  'ytdlp.checksumMismatch': {
    zh: 'SHA-256 校验失败（期望 {expected}…，实际 {actual}…）',
    en: 'SHA-256 verification failed (expected {expected}…, got {actual}…)'
  },
  'ytdlp.playlistEmpty': {
    zh: '未解析到播放列表条目（该链接可能不是播放列表）',
    en: 'No playlist entries were parsed (the link may not be a playlist)'
  },
  'ytdlp.timeout': { zh: 'yt-dlp 执行超时', en: 'yt-dlp timed out' },
  'ytdlp.notDetected': {
    zh: '未检测到 yt-dlp。可在流媒体页一键下载，或自行安装并加入系统 PATH。',
    en: 'yt-dlp was not found. Install it from the Media tab, or install it yourself and add it to PATH.'
  },

  // ---- ffmpeg ----
  'ffmpeg.notInstalled': { zh: 'ffmpeg 未安装', en: 'ffmpeg is not installed' },
  'ffmpeg.noBuildDate': {
    zh: '当前版本不含构建日期，无法自动比较（请自行更新）',
    en: 'This build has no build date, so it cannot be compared automatically (update it manually)'
  },
  'ffmpeg.updateUnsupported': {
    zh: '当前平台不支持自动更新 ffmpeg',
    en: 'Automatic ffmpeg updates are not supported on this platform'
  },
  'ffmpeg.latestUnavailable': {
    zh: '未能获取最新构建信息',
    en: 'Could not fetch the latest build information'
  },
  'ffmpeg.platformUnsupported': {
    zh: '当前平台暂不支持自动下载 ffmpeg，请手动安装并加入系统 PATH（macOS 可执行 brew install ffmpeg）',
    en: 'Automatic ffmpeg download is not supported on this platform; install it manually and add it to PATH (on macOS run brew install ffmpeg)'
  },
  'ffmpeg.checksumMissing': {
    zh: '官方校验文件中缺少该平台的 SHA-256，已停止安装',
    en: 'The official checksum file has no SHA-256 for this platform, so the installation was stopped'
  },
  'ffmpeg.checksumMismatch': {
    zh: 'SHA-256 校验失败（期望 {expected}…，实际 {actual}…）',
    en: 'SHA-256 verification failed (expected {expected}…, got {actual}…)'
  },
  'ffmpeg.binaryMissing': {
    zh: '解压后未找到 ffmpeg 可执行文件，归档结构可能已变化',
    en: 'No ffmpeg executable was found after extraction; the archive layout may have changed'
  },
  'ffmpeg.timeout': { zh: 'ffmpeg 执行超时', en: 'ffmpeg timed out' },
  'ffmpeg.notDetected': {
    zh: '未检测到 ffmpeg。可在此处一键下载，或自行安装并加入系统 PATH。',
    en: 'ffmpeg was not found. Download it here, or install it yourself and add it to PATH.'
  },
  'ffmpeg.tarUnavailable': {
    zh: '系统未提供 tar，无法解压 ffmpeg 归档',
    en: 'No system tar is available, so the ffmpeg archive could not be extracted'
  },
  'ffmpeg.extractTimeout': { zh: 'ffmpeg 解压超时', en: 'Extracting ffmpeg timed out' },
  'ffmpeg.extractFailed': {
    zh: '解压 ffmpeg 归档失败：{detail}',
    en: 'Failed to extract the ffmpeg archive: {detail}'
  },
  'ffmpeg.unknownReason': { zh: '未知原因', en: 'unknown reason' },

  // ---- RSS 订阅 ----
  'rss.notFound': { zh: '订阅不存在', en: 'The subscription does not exist' },
  'rss.invalid': { zh: '订阅数据无效', en: 'The subscription data is invalid' },
  'rss.nameEmpty': { zh: '订阅名称不能为空', en: 'The subscription name cannot be empty' },
  'rss.nameTooLong': {
    zh: '订阅名称不能超过 100 字符',
    en: 'The subscription name cannot exceed 100 characters'
  },
  'rss.urlScheme': {
    zh: '订阅地址必须以 http:// 或 https:// 开头',
    en: 'The subscription URL must start with http:// or https://'
  },
  'rss.filterType': { zh: '过滤模式必须是字符串', en: 'The filter pattern must be a string' },
  'rss.filterRegex': {
    zh: '过滤正则无效: {pattern}',
    en: 'Invalid filter regular expression: {pattern}'
  },
  'rss.dirAbsolute': { zh: '下载目录必须是绝对路径', en: 'The download folder must be an absolute path' },
  'rss.noLink': {
    zh: '条目没有可下载的 magnet/http(s) 链接',
    en: 'The entry has no downloadable magnet/http(s) link'
  },
  'rss.unsupportedUrl': {
    zh: '仅支持 http(s) 地址: {url}',
    en: 'Only http(s) URLs are supported: {url}'
  },
  'rss.redirectNotHttp': {
    zh: '重定向目标不是 http(s) 地址',
    en: 'The redirect target is not an http(s) URL'
  },
  'rss.untitled': { zh: '（无标题）', en: '(untitled)' },
  'rss.duplicateSkipped': { zh: '重复条目，已跳过', en: 'Duplicate entry skipped' },

  // ---- 监听文件夹 ----
  'watch.notFound': { zh: '监听文件夹不存在', en: 'The watched folder does not exist' },
  'watch.invalid': { zh: '配置数据无效', en: 'The configuration data is invalid' },
  'watch.pathEmpty': { zh: '监听路径不能为空', en: 'The watch path cannot be empty' },
  'watch.pathAbsolute': { zh: '监听路径必须是绝对路径', en: 'The watch path must be an absolute path' },
  'watch.pathNotDir': { zh: '监听路径不是文件夹', en: 'The watch path is not a folder' },
  'watch.pathInaccessible': {
    zh: '监听路径不存在或不可访问',
    en: 'The watch path does not exist or is not accessible'
  },
  'watch.dirAbsolute': { zh: '下载目录必须是绝对路径', en: 'The download folder must be an absolute path' },
  'watch.alreadyImported': { zh: '内容已导入过，跳过', en: 'Content already imported; skipped' },
  'watch.cleanupFailed': {
    zh: '已添加到 aria2，但清理/归档源文件失败: {detail}',
    en: 'Added to aria2, but cleaning up or archiving the source file failed: {detail}'
  },

  // ---- Tracker 订阅 ----
  'tracker.noSource': {
    zh: '没有可用的订阅源（仅支持 https:// 地址）',
    en: 'No usable subscription source (only https:// URLs are supported)'
  },
  'tracker.allFailed': { zh: '所有订阅源均不可用', en: 'All subscription sources are unavailable' },
  'tracker.writeFailed': { zh: '写入 aria2 配置失败', en: 'Failed to write the aria2 configuration' },
  'tracker.unsupportedUrl': {
    zh: '仅支持 https:// 订阅源: {url}',
    en: 'Only https:// subscription sources are supported: {url}'
  },

  // ---- Webhook ----
  'webhook.entryMissing': { zh: '队列条目不存在', en: 'The queue entry does not exist' },

  // ---- 设置导入 ----
  'import.notObject': { zh: '导入数据必须是对象', en: 'The imported data must be an object' },
  'import.appMismatch': {
    zh: '不是 Aria2Desktop 的设置导出文件（app 字段不匹配）',
    en: 'This is not an Aria2Desktop settings export (the app field does not match)'
  },
  'import.missingSettings': {
    zh: '导出文件缺少 settings 对象',
    en: 'The export file has no settings object'
  },
  'import.validate.language': { zh: 'language 必须是字符串', en: 'language must be a string' },
  'import.validate.theme': { zh: 'theme 必须是字符串', en: 'theme must be a string' },
  'import.validate.themeValue': {
    zh: 'theme 必须是 light / dark / auto 之一',
    en: 'theme must be one of light / dark / auto'
  },
  'import.validate.refreshInterval': {
    zh: 'refreshInterval 必须是数字',
    en: 'refreshInterval must be a number'
  },
  'import.validate.webConsole': { zh: 'webConsole 必须是对象', en: 'webConsole must be an object' },
  'import.validate.connectionProfiles': {
    zh: 'connectionProfiles 必须是数组',
    en: 'connectionProfiles must be an array'
  },

  // ---- 浏览器扩展 ----
  'extension.secretRequired': {
    zh: '请先在「设置 → RPC 与安全」设置 RPC 密钥，再配对扩展',
    en: 'Set an RPC secret under Settings → RPC & Security before pairing the extension'
  },

  // ---- 引擎启动/运行 ----
  'engine.startFailed': {
    zh: 'Aria2 进程启动失败，请检查可执行文件与配置',
    en: 'The aria2 process failed to start; check the executable and the configuration'
  },
  'engine.startFailedWithOutput': {
    zh: 'Aria2 进程启动失败，请检查可执行文件与配置。\n\nAria2 输出:\n{detail}',
    en: 'The aria2 process failed to start; check the executable and the configuration.\n\naria2 output:\n{detail}'
  },
  'engine.executableMissing': {
    zh: 'Aria2 可执行文件不存在: {path}',
    en: 'The aria2 executable does not exist: {path}'
  },
  'engine.rpcNotReady': {
    zh: 'Aria2 RPC 服务未就绪（端口 {port}）。请检查该端口是否被其它程序占用，或 RPC 相关配置是否正确。',
    en: 'The aria2 RPC service is not ready (port {port}). Check whether another program is using that port, or whether the RPC configuration is correct.'
  },
  'engine.processExited': {
    zh: 'Aria2 进程异常退出，代码: {code}',
    en: 'The aria2 process exited unexpectedly with code {code}'
  },
  'engine.startTimeout': { zh: 'Aria2 启动超时', en: 'aria2 startup timed out' },
  'engine.configSyncVerifyFailed': {
    zh: '配置文件同步验证失败',
    en: 'Configuration file sync verification failed'
  },
  'engine.stopFailed': { zh: '停止进程失败', en: 'Failed to stop the process' },
  'engine.startProcessFailed': { zh: '启动进程失败', en: 'Failed to start the process' },
  'engine.configReadFailed': {
    zh: 'aria2 配置读取失败，已拒绝写入以避免覆盖用户配置',
    en: 'Failed to read the aria2 configuration; writing was refused to avoid overwriting your settings'
  },
  'engine.leftoverNotExited': {
    zh: 'RPC 端口 {port} 上的遗留 aria2 实例未能退出，请手动结束残留的 aria2c 进程后重试',
    en: 'The leftover aria2 instance on RPC port {port} did not exit; end the remaining aria2c process manually and retry'
  },
  'engine.portOccupiedOtherAria2': {
    zh: 'RPC 端口 {port} 已被另一个 aria2 实例占用（不认可本机密钥）。为避免误杀其它下载器，本应用不会自动结束它；请关闭该实例或更换 rpc-listen-port 后重试。',
    en: 'RPC port {port} is already used by another aria2 instance that does not accept this app secret. To avoid killing other downloaders this app will not terminate it; close that instance or change rpc-listen-port and retry.'
  },
  'engine.portNonAria2': {
    zh: 'RPC 端口 {port} 上监听的服务不是 aria2（响应不是 JSON-RPC）。请在「引擎设置」里换一个 rpc-listen-port。',
    en: 'The service listening on RPC port {port} is not aria2 (its response is not JSON-RPC). Change rpc-listen-port under Engine Settings.'
  },
  'engine.managerUninitialized': { zh: 'Aria2 manager 未初始化', en: 'The aria2 manager is not initialized' },
  'engine.portNotReleased': {
    zh: '未能确认 aria2 进程退出，请查看日志',
    en: 'Could not confirm that the aria2 process exited; check the logs'
  },
  'engine.configWriteFailed': {
    zh: '配置文件写入失败: {detail}',
    en: 'Failed to write the configuration file: {detail}'
  },
  'engine.headlessStartFailed': {
    zh: 'Aria2 下载引擎启动失败: {detail}',
    en: 'The aria2 download engine failed to start: {detail}'
  },
  'engine.configBaselineUnreadable': {
    zh: 'aria2 配置基线不可读，已拒绝写盘以避免覆盖用户配置',
    en: 'The aria2 configuration baseline is unreadable; the write was refused to avoid overwriting your settings'
  },
  'engine.configBaselineEmpty': {
    zh: 'aria2 配置基线为空，已拒绝写盘以避免覆盖用户配置',
    en: 'The aria2 configuration baseline is empty; the write was refused to avoid overwriting your settings'
  },

  // ---- 应用更新 ----
  'update.checksumFormat': {
    zh: 'SHA-256 校验文件格式异常，已拒绝自动安装，请从 GitHub Release 手动下载',
    en: 'The SHA-256 checksum file is malformed; automatic installation was refused. Download the installer manually from GitHub Releases'
  },
  'update.checksumMismatch': {
    zh: 'SHA-256 校验失败：期望 {expected}…，实际 {actual}…',
    en: 'SHA-256 verification failed: expected {expected}…, got {actual}…'
  },
  'update.installerLaunchFailed': {
    zh: '无法启动安装程序',
    en: 'Could not launch the installer'
  }
} as const

export type MainErrorKey = keyof typeof TABLE

/** 全部可用键（供测试遍历，避免新增条目漏掉另一种语言） */
export const MAIN_ERROR_KEYS = Object.keys(TABLE) as MainErrorKey[]

/**
 * 取错误文案并替换 {name} 占位符。
 *
 * 未知键原样返回键名：这类错误只可能来自代码写错，返回键名比返回空串更容易定位。
 */
export function mainError(
  locale: MainLocale,
  key: MainErrorKey,
  params?: Record<string, string | number>
): string {
  const entry = TABLE[key]
  if (!entry) return key
  const template = entry[locale] ?? entry.zh
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (
    name in params ? String(params[name]) : match
  ))
}
