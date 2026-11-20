/**
 * 主进程面向用户的文案（对话框与系统通知）。
 *
 * 为什么集中放这里：主进程没有 i18n 实例（语言包在渲染层），文案散落在
 * WindowController / extensionApiServer / streamDownloadService / completionRuleService
 * 各处，很容易一半中文一半英文。统一收口后，新增主进程文案只需在这里加一条，
 * 并由 mainProcessCopy.test.ts 保证英文侧不残留中文。
 *
 * 只区分中/英：其余 19 种语言在渲染层已完整覆盖，主进程退回英文比退回中文更通用。
 */
import type { MainLocale } from './mainLocale'

/** 渲染进程连续崩溃后的兜底对话框 */
export interface RendererCrashCopy {
  title: string
  message: string
  detail: string
  restart: string
  close: string
}

const RENDERER_CRASH: Record<MainLocale, RendererCrashCopy> = {
  zh: {
    title: '界面进程异常',
    message: '界面进程连续崩溃，已停止自动恢复',
    detail: '请尝试重新启动应用；如果问题持续出现，请导出诊断报告并反馈。',
    restart: '重新启动',
    close: '关闭'
  },
  en: {
    title: 'Interface process error',
    message: 'The interface process crashed repeatedly; auto-recovery has stopped',
    detail: 'Try restarting the app. If the problem persists, export a diagnostics report and report it.',
    restart: 'Restart',
    close: 'Close'
  }
}

export function rendererCrashCopy(locale: MainLocale): RendererCrashCopy {
  return RENDERER_CRASH[locale] ?? RENDERER_CRASH.zh
}

/** 浏览器扩展配对确认框（扩展名/ID/来源由调用方按行拼进 detail） */
export interface ExtensionPairingCopy {
  title: string
  message: string
  allow: string
  deny: string
  labelName: string
  labelExtensionId: string
  labelOrigin: string
  labelVersion: string
  unknown: string
  canDo: string
  cannotDo: string
}

const EXTENSION_PAIRING: Record<MainLocale, ExtensionPairingCopy> = {
  zh: {
    title: '浏览器扩展请求配对',
    message: '是否允许该浏览器扩展连接 Aria2 Desktop？',
    allow: '允许',
    deny: '拒绝',
    labelName: '扩展名称',
    labelExtensionId: '扩展 ID',
    labelOrigin: '来源',
    labelVersion: '版本',
    unknown: '未知',
    canDo: '允许后该扩展可以：添加下载任务、查看与控制任务列表、发起流媒体下载。',
    cannotDo: '它**不会**拿到你的 RPC 密钥，你可以随时在扩展设置页撤销授权。'
  },
  en: {
    title: 'Browser extension pairing request',
    message: 'Allow this browser extension to connect to Aria2 Desktop?',
    allow: 'Allow',
    deny: 'Deny',
    labelName: 'Extension name',
    labelExtensionId: 'Extension ID',
    labelOrigin: 'Origin',
    labelVersion: 'Version',
    unknown: 'unknown',
    canDo: 'If allowed, the extension can add downloads, list and control tasks, and start media downloads.',
    cannotDo: 'It does **not** get your RPC secret, and you can revoke access on the extension settings page at any time.'
  }
}

export function extensionPairingCopy(locale: MainLocale): ExtensionPairingCopy {
  return EXTENSION_PAIRING[locale] ?? EXTENSION_PAIRING.zh
}

/**
 * UPnP 端口映射的失败原因。
 *
 * 这些文案由主进程生成、经 IPC 直接显示在 BT 设置页与诊断页，因此必须跟主进程语言
 * 一致；用 reason 作为键而不是直接把字符串散落在 upnpService 里，是为了让
 * mainProcessCopy.test.ts 能校验两种语言都齐全、英文侧没有残留中文。
 */
export type UpnpFailureReason =
  | 'no-gateway'
  | 'device-description-unreadable'
  | 'wanipconnection-unsupported'
  | 'no-lan-address'
  | 'remote-engine'
  | 'rejected'

const UPNP_FAILURE: Record<UpnpFailureReason, Record<MainLocale, string>> = {
  'no-gateway': { zh: '未发现支持 UPnP 的路由器', en: 'No UPnP-capable router was found' },
  'device-description-unreadable': {
    zh: '路由器设备描述不可读',
    en: 'The router description document could not be read'
  },
  'wanipconnection-unsupported': {
    zh: '路由器不支持 WANIPConnection 映射服务',
    en: 'The router does not support the WANIPConnection mapping service'
  },
  'no-lan-address': { zh: '未获取到局域网地址', en: 'Could not determine the local network address' },
  'remote-engine': {
    zh: '当前连接为远程引擎，UPnP 仅对本机引擎生效',
    en: 'A remote engine is connected; UPnP only applies to a local engine'
  },
  rejected: { zh: '端口映射被路由器拒绝', en: 'The router rejected the port mapping' }
}

export function upnpFailureMessage(locale: MainLocale, reason: UpnpFailureReason): string {
  return (UPNP_FAILURE[reason] ?? UPNP_FAILURE.rejected)[locale]
}

/** 扩展未自报名称时的展示名（配对对话框里出现） */
export function defaultExtensionName(locale: MainLocale): string {
  return locale === 'en' ? 'Aria2 Download Extension' : 'Aria2 下载扩展'
}

/**
 * Web 控制台的 HTTPS 配置错误。
 *
 * 这些文案由 webConsoleServer.apply() 生成，原样显示在「远程访问」设置页的错误标签里，
 * 因此必须跟主进程语言一致（否则英文用户看到的是中文报错，无从判断该改哪里）。
 */
export type WebConsoleTlsErrorKind = 'pair-required' | 'absolute-path' | 'load-failed' | 'lan-requires-tls'

export function webConsoleTlsError(locale: MainLocale, kind: WebConsoleTlsErrorKind, detail = ''): string {
  const table: Record<WebConsoleTlsErrorKind, Record<MainLocale, string>> = {
    'pair-required': {
      zh: 'HTTPS 需要同时配置证书与私钥文件路径',
      en: 'HTTPS requires both a certificate and a private key file path'
    },
    'absolute-path': {
      zh: 'HTTPS 证书与私钥需要填写绝对路径',
      en: 'HTTPS certificate and key must be absolute paths'
    },
    'load-failed': {
      zh: 'HTTPS 证书加载失败',
      en: 'Failed to load the HTTPS certificate'
    },
    'lan-requires-tls': {
      zh: '局域网访问需要 HTTPS：请在「远程访问」中配置证书与私钥，或改为只监听 127.0.0.1 并由反向代理终止 TLS',
      en: 'LAN access requires HTTPS: configure a certificate and key under Remote Access, or listen on 127.0.0.1 only and let a reverse proxy terminate TLS'
    }
  }
  const base = table[kind][locale]
  return detail ? `${base}：${detail}` : base
}

/**
 * 流媒体下载的失败原因。
 *
 * 这些字符串经 IPC 返回给渲染层，由 StreamPane / 任务列表直接展示；
 * 渲染层只在 error 为空时才回落到自己的 i18n 文案，所以主进程必须给出对应语言。
 */
export type StreamDownloadErrorKind =
  | 'too-many'
  | 'ffmpeg-missing'
  | 'no-output-file'
  | 'create-output-dir'
  | 'create-temp-dir'

export function streamDownloadError(
  locale: MainLocale,
  kind: StreamDownloadErrorKind,
  detail = '',
  limit = 0
): string {
  if (kind === 'too-many') {
    return locale === 'en'
      ? `Too many concurrent stream downloads (limit: ${limit}). Wait for the current ones to finish.`
      : `同时进行的流媒体下载已达上限（${limit} 条），请等待当前任务结束`
  }
  if (kind === 'ffmpeg-missing') {
    return locale === 'en'
      ? 'This download needs ffmpeg (merging audio/video, MP3 extraction or subtitle conversion). Install it or configure its path in Settings first.'
      : '该下载需要 ffmpeg（合并音轨/转 MP3/字幕转换），请先下载或安装后在设置中配置'
  }
  if (kind === 'no-output-file') {
    return locale === 'en' ? 'The download finished but no output file was found' : '下载完成但未找到输出文件'
  }
  const base = kind === 'create-output-dir'
    ? (locale === 'en' ? 'Could not create the output folder' : '无法创建保存目录')
    : (locale === 'en' ? 'Could not create the temporary folder' : '无法创建临时目录')
  return detail ? `${base}：${detail}` : base
}

/**
 * 下载类系统通知标题。
 *
 * 完成规则里的 notify 动作允许用户自定义标题，只有未填时才落到这里的默认值；
 * 流媒体下载完成通知没有自定义入口，直接用默认值。
 */
export function downloadNotificationTitle(locale: MainLocale, succeeded: boolean): string {
  if (locale === 'en') return succeeded ? 'Download complete' : 'Download failed'
  return succeeded ? '下载完成' : '下载失败'
}
