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
 * @returns 合法时返回扩展 ID，否则 null。**调用方只应把它当布尔闸门用**：
 *          扩展 ID 只进日志、不进确认弹窗/错误响应（32 位 ID 对用户没有可验证性，
 *          且要避免把请求侧字符串带进任何展示面）。
 */
export function getPairingExtensionId(origin: string | undefined): string | null {
  if (!origin) return null
  const match = /^chrome-extension:\/\/([a-p]{32})$/.exec(origin)
  return match?.[1] ?? null
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
  return origin.startsWith('chrome-extension://')
}
