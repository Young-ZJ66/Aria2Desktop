import * as crypto from 'crypto'

/**
 * 浏览器扩展本地接口（打通方案 A）的纯逻辑与常量。
 *
 * 刻意不 import electron：来源/密钥判定是可单测的纯函数（与 utils/ipcSecurityCore 同一思路），
 * HTTP 服务本体在 services/extensionApiServer.ts。
 */

/**
 * 本扩展 ID，由签名密钥（`.crx/extension-key.pem`）推出——`npm run pack:extension` 会打印。
 * 更换签名密钥即变化，届时需同步本文件与 extension/README.md。
 *
 * 注意：**商店版是另一个 ID**（`fmjmpbnokancjlangmmepdpdebafkngp`，商店用自家密钥重签，
 * 见 src/shared/extensionStore.ts）。这里只用于旁加载/白名单说明，不参与来源判定——
 * 见下方 isAuthorizedExtensionRequest 的注释。
 */
export const EXTENSION_ID = 'ndikflbmajhflfndbjblihkifnfbmdon'

/** 本地接口端口。扩展侧 popup.js 硬编码同一值，改动必须两端同步 */
export const EXTENSION_API_PORT = 6801

/** 仅监听回环地址：接口不暴露到局域网 */
export const EXTENSION_API_HOST = '127.0.0.1'

/**
 * 允许通过接口创建任务的协议。
 * 与渲染层「新建任务」的口径一致，拦掉 file: / javascript: 这类危险或无效输入——
 * 接口是外部（扩展）入口，必须自己校验，不能假定调用方已校验。
 */
const ALLOWED_DOWNLOAD_SCHEMES = ['http:', 'https:', 'ftp:', 'sftp:', 'magnet:']

/** 校验下载链接协议是否可用（大小写不敏感；magnet 无 // 前缀，单独判断） */
export function isAllowedDownloadUri(url: string): boolean {
  const trimmed = url.trim()
  if (!trimmed) return false
  if (trimmed.toLowerCase().startsWith('magnet:')) return true
  try {
    return ALLOWED_DOWNLOAD_SCHEMES.includes(new URL(trimmed).protocol)
  } catch {
    return false
  }
}

/**
 * 是否允许为这个链接主动发出探测请求（读取 Content-Disposition）。
 *
 * 探测是"由本机向调用方给的地址发起请求"，属于 SSRF 面。这里只挡**明确无正当用途**的目标：
 * 回环地址、链路本地（含云元数据 169.254.169.254）、CGNAT 段与 .localhost。
 * **故意不挡局域网（10/172.16/192.168）**——用户从 NAS 下载是常见场景，
 * 挡掉会让这类链接拿不到真实文件名（探测失败只影响命名与分类，不影响下载本身）。
 * 真正的闸门仍是密钥鉴权，这里是纵深防御。
 */
export function isProbeAllowed(url: string): boolean {
  try {
    const parsed = new URL(url)
    // 只有 http(s) 才谈得上探测（ftp/sftp/magnet 没有这个头）
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
    if (host === 'localhost' || host.endsWith('.localhost')) return false
    if (host === '::1' || host.startsWith('fe80:')) return false

    const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
    if (ipv4) {
      const a = Number(ipv4[1])
      const b = Number(ipv4[2])
      if (a === 0 || a === 127) return false
      if (a === 169 && b === 254) return false
      if (a === 100 && b >= 64 && b <= 127) return false
    }
    return true
  } catch {
    return false
  }
}

/**
 * 解析请求目标中的 pathname（HTTP 服务里访问 req.url 的**唯一**入口）。
 *
 * 为什么要单独抽出来：`new URL('http://[', base)` 与 `new URL('//[', base)` 都会抛
 * TypeError: Invalid URL，而这段解析发生在鉴权**之前**——异常一旦逃逸成未处理的
 * Promise 拒绝，主进程会按 Node 默认策略直接退出（一条畸形请求即可打崩应用，
 * 且不需要密钥）。因此这里把失败统一收敛成 null，由调用方回 400。
 *
 * @returns 解析成功返回 pathname，畸形请求目标返回 null
 */
export function parseRequestPathname(requestUrl: string | undefined): string | null {
  try {
    return new URL(requestUrl ?? '/', `http://${EXTENSION_API_HOST}`).pathname
  } catch {
    return null
  }
}

/**
 * 净化调用方给出的下载文件名（`/api/resolve` 与 `/api/add` 的 `fileName` 参数）。
 *
 * 为什么必须净化：该值最终会作为 aria2 的 `out` 选项下发，而 `out` 与 `dir`、
 * `on-download-complete` 同属注入面。用仓库自带的 aria2c 实测过两种后果：
 * - `out=../escape.txt` → 任务"成功完成"，但文件写到**下载目录之外**（目录穿越）；
 * - `out=C:\Users\...\x.zip`（Windows 绝对路径，浏览器扩展拦截下载时给的就是这种）
 *   → 任务直接以 errorCode=18 失败（Windows 文件名不允许盘符冒号）。
 *
 * 规则：只保留最后一段（按两种分隔符切分）、剔除 Windows 非法字符与控制符，
 * 并拒绝 `.` / `..` 与空结果。与 utils/downloadNameProbe 的 sanitizeFileName 同口径。
 *
 * 放在本模块（不 import electron）是为了可单测——判错一次的代价是"能往任意目录写文件"。
 */
/** Windows 文件名非法字符（控制符另行按码点过滤，避免写出带控制字符的正则） */
const ILLEGAL_FILE_NAME_CHARS = '<>:"|?*'

export function sanitizeDownloadFileName(input: unknown): string {
  if (typeof input !== 'string' || !input) return ''
  const last = input.split(/[\\/]/).pop() ?? ''
  let cleaned = ''
  for (const ch of last) {
    // U+0000–U+001F（含换行/制表）会让 aria2 写出的文件名不可用，一律剔除
    if (ch.charCodeAt(0) <= 0x1f || ILLEGAL_FILE_NAME_CHARS.includes(ch)) continue
    cleaned += ch
  }
  cleaned = cleaned.trim()
  if (!cleaned || cleaned === '.' || cleaned === '..') return ''
  return cleaned
}

/** 判定一个文件名是否是"纯文件名"（不含任何路径成分，即已是净化后的形态） */
export function isPlainFileName(name: string): boolean {
  return !!name && sanitizeDownloadFileName(name) === name
}

/** 净化后的请求头：referer/user-agent 走 aria2 专用选项，其余进 header 数组 */
export interface SanitizedRequestHeaders {
  /** 任意请求头，每项形如 `Name: value`（不含 user-agent / referer） */
  header: string[]
  userAgent: string
  referer: string
}

/** 单条请求头最大长度（含名称） */
const MAX_HEADER_ENTRY_LENGTH = 4096
/** 请求头总长度上限：足够覆盖登录态 cookie，又不会让接口成为数据通道 */
const MAX_HEADER_TOTAL_LENGTH = 16384
/** 单次任务允许的请求头条数上限 */
const MAX_HEADER_COUNT = 24
/** HTTP 头名称的合法字符（RFC 7230 token） */
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
/** 逐跳头与长度相关头：交给 aria2/HTTP 栈自己决定，强行覆盖只会让请求失效 */
const BLOCKED_HEADER_NAMES = new Set([
  'host',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'upgrade',
  'proxy-connection'
])

/**
 * 净化扩展带来的请求头（`/api/add` 的 `headers` 字段）。
 *
 * 为什么必须净化：这些值最终会成为 aria2 的 `header` / `user-agent` / `referer` 选项，
 * 原样下发等于把"往下载请求里塞任意内容"的能力交给了调用方。实测风险有两类：
 * - 头值里的 CR/LF 可以**注入额外的请求头或请求体**（HTTP 响应/请求拆分）；
 * - `host` 之类的头被改写会让 aria2 连到非目标主机，绕过用户对下载地址的认知。
 *
 * 规则：只接受 `Name: value` 形态的字符串数组；名称按 RFC 7230 token 校验并剔除
 * 逐跳头；值长度与总长度都有上限；名称大小写归一为小写，`referer` / `user-agent`
 * 提升为专用字段（aria2 对这两个有独立选项，混在 header 里会被覆盖）。
 *
 * 放在本模块（不 import electron）是为了可单测——判错一次就是请求拆分漏洞。
 */
export function sanitizeRequestHeaders(input: unknown): SanitizedRequestHeaders {
  const result: SanitizedRequestHeaders = { header: [], userAgent: '', referer: '' }
  if (!Array.isArray(input)) return result

  let total = 0
  let accepted = 0
  for (const raw of input) {
    if (accepted >= MAX_HEADER_COUNT) break
    if (typeof raw !== 'string') continue

    // CR/LF 一律拒绝（不 trim 掉，直接判整条非法）：否则 `X-A: 1\r\nCookie: x` 会被拆成两条头。
    // 其余控制字符（NUL/VT/FF/DEL 等）同样不属于合法 header 值，一并整条拒绝，
    // 避免被 aria2 原样写进请求行后产生不可预期的行为
    const hasIllegalControl = raw.split('').some((ch) => {
      const code = ch.charCodeAt(0)
      return code <= 0x08 || code === 0x0b || code === 0x0c || (code >= 0x0e && code <= 0x1f) || code === 0x7f
    })
    if (raw.includes('\r') || raw.includes('\n') || hasIllegalControl || raw.length > MAX_HEADER_ENTRY_LENGTH) continue

    const colon = raw.indexOf(':')
    if (colon <= 0) continue

    const name = raw.slice(0, colon).trim().toLowerCase()
    const value = raw.slice(colon + 1).trim()
    if (!HEADER_NAME_PATTERN.test(name) || !value) continue
    if (BLOCKED_HEADER_NAMES.has(name)) continue

    total += raw.length
    if (total > MAX_HEADER_TOTAL_LENGTH) break
    accepted++

    if (name === 'user-agent') {
      result.userAgent = value.slice(0, 512)
      continue
    }
    if (name === 'referer') {
      result.referer = sanitizeReferer(value)
      continue
    }
    result.header.push(`${name}: ${value}`)
  }

  return result
}

/** referer 只接受 http(s) 绝对地址（aria2 会原样作为 Referer 发出） */
function sanitizeReferer(value: string): string {
  if (value.length > 2048) return ''
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? value : ''
  } catch {
    return ''
  }
}

/**
 * 配对请求的来源校验（/api/pair 是**唯一**不需要密钥的端点，因此来源必须从严）：
 * Origin 必须存在且是 chrome-extension:// 协议（浏览器上下文里只有扩展能发出这种源），
 * http(s)/空来源一律拒绝——配对是给"刚装好扩展、还没密钥"的场景用的，curl 与网页都没资格触发。
 *
 * 最后一道闸门是**用户在 App 里手动确认**（见服务的 confirmPairing 依赖）：
 * 本地恶意进程可以伪造 Origin，但伪造不出用户点击"允许"。
 * 而本就能读文件的本机进程早已能从 aria2.conf（明文 rpc-secret）拿到密钥，
 * 因此配对端点没有引入新的本地攻击面—— dialogs 确认挡住的是"用户没装扩展却弹窗"这类意外。
 *
 * 返回**布尔值**：来源字符串到此为止、不流入任何下游（弹窗/日志插值/响应体都是固定文案），
 * 数据流以本函数为终点，避免把请求侧字符串带进任何展示面。
 */
export function isExtensionOrigin(origin: string | undefined): boolean {
  if (!origin) return false
  // Chrome/Edge：32 位 a-p 字母 ID；Firefox：随机 UUID 形式的 moz-extension 源
  return /^chrome-extension:\/\/[a-p]{32}$/.test(origin)
    || /^moz-extension:\/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(origin)
}

export interface ExtensionApiAuthInput {
  /** 请求头 Authorization */
  authorization: string | undefined
  /** 请求头 Origin（非浏览器客户端不发该头） */
  origin: string | undefined
  /** 当前 RPC 密钥（settings.aria2.secret） */
  secret: string
}

/** 常数时间字符串比较，避免按字符逐位比较泄露信息（时序侧信道） */
function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

/**
 * 判定一次请求能否访问扩展本地接口。三道闸门：
 *
 * 1. **必须已配置 RPC 密钥**——没有密钥就没有可用的鉴权手段，此时直接不开接口
 *    （而不是退化成"仅靠来源判定"）；
 * 2. **Authorization 必须是 `Bearer <secret>`**（scheme 大小写不敏感、token 常数时间比较）；
 * 3. **来源合法**：浏览器上下文里只有扩展能发出 `chrome-extension://` 源；http(s) 网页一律拒绝
 *    （即便密钥泄露，网页也无法直接调用）。非浏览器客户端（如 curl 排障）不带 Origin，凭 1、2 放行。
 *
 * 注意这里**不**把 Origin 写死成 EXTENSION_ID：通过「加载已解压」安装的开发态扩展，
 * 其 ID 由目录路径派生，与签名 .crx 的 ID 不同；写死会让开发态完全不可用。
 * 真正的闸门是密钥，Origin 判定属纵深防御。
 */
export function isAuthorizedExtensionRequest(input: ExtensionApiAuthInput): boolean {
  const { authorization, origin, secret } = input

  if (!secret) return false
  if (!authorization) return false

  const parts = authorization.split(' ')
  if (parts.length !== 2) return false
  const [scheme, token] = parts
  if (scheme?.toLowerCase() !== 'bearer') return false
  if (!token || !timingSafeEqualStr(token, secret)) return false

  if (!origin) return true
  return origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://')
}
