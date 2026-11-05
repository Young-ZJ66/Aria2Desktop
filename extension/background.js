/**
 * Aria2 Desktop Browser Extension - Background Service Worker
 * 把浏览器中的下载发送到 Aria2 Desktop（通过 JSON-RPC）。
 *
 * 设计要点（均为"用户体验/健壮性"考虑，不是可选装饰）：
 * - 所有 RPC 都带超时：否则对端半死不活时 popup 会一直转圈，用户不知道发生了什么；
 * - 所有失败都翻译成人话（"Failed to fetch" 对用户毫无意义），并给出下一步该做什么；
 * - 通知失败不能影响下载本身（权限被系统关闭等情况一律静默兜底）。
 */

const DEFAULT_CONFIG = {
  host: 'localhost',
  port: 6800,
  secret: '',
  path: '/jsonrpc',
  enabled: true,
  interceptAll: false,
  /** 允许把当前页面的 Cookie 随任务下发（需已授予全站访问权限，见弹窗开关） */
  allowCookies: false
}

/** RPC 超时：本地引擎正常在毫秒级返回，6 秒足够，超过即视为不可达 */
const RPC_TIMEOUT_MS = 6000

/** 不应交给 Aria2 的协议（浏览器内部页、扩展自身、本地生成内容） */
const SKIPPED_SCHEMES = ['chrome-extension:', 'chrome:', 'about:', 'blob:', 'data:', 'filesystem:']

const i18n = (key, substitutions) => chrome.i18n.getMessage(key, substitutions) || key

/**
 * 与 App 内置的默认分类规则保持一致（App 中用户自定义的分类规则，扩展无法感知）。
 * 命中扩展名时把任务放进对应子目录，避免"什么都堆在主目录"。
 */
const CATEGORY_RULES = [
  { dir: 'Video', exts: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mpg', 'mpeg', 'ts', '3gp', 'rmvb', 'rm', 'f4v'] },
  { dir: 'Music', exts: ['mp3', 'flac', 'wav', 'aac', 'ogg', 'opus', 'm4a', 'wma', 'ape', 'mid', 'midi'] },
  { dir: 'Images', exts: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tif', 'tiff', 'psd', 'raw', 'heic'] },
  { dir: 'Documents', exts: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'epub', 'mobi', 'azw3', 'csv', 'rtf', 'odt'] },
  { dir: 'Compressed', exts: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso', 'br', 'zst', 'tgz'] },
  { dir: 'Programs', exts: ['exe', 'msi', 'apk', 'deb', 'rpm', 'dmg', 'pkg', 'appx', 'bat', 'sh', 'appimage'] }
]

/** 提取文件名中的扩展名（小写、不含点），无则返回空串 */
function getFileExtension(fileName) {
  const base = fileName.split(/[\\/]/).pop() || fileName
  const dot = base.lastIndexOf('.')
  return dot > 0 && dot < base.length - 1 ? base.slice(dot + 1).toLowerCase() : ''
}

/** 从 URL 提取扩展名（取 pathname 最后一段），无则返回空串 */
function extFromUrl(url) {
  try {
    const { pathname } = new URL(url)
    return getFileExtension(decodeURIComponent(pathname.split('/').pop() || ''))
  } catch {
    return ''
  }
}

/**
 * 收敛为**纯文件名**：只保留最后一段（按两种分隔符切分），剔除 Windows 非法字符
 * （含盘符冒号）与控制符，并拒绝 `.` / `..` 与空结果。
 *
 * 为什么要取末段而不是删分隔符：aria2 的 `out` 必须是相对 `dir` 的文件名，
 * 而两处输入都可能是路径——Content-Disposition 可能带目录成分，
 * `chrome.downloads` 的 `downloadItem.filename` 更是**绝对本地路径**。
 * 直接当 out 传的实测后果：任务以 errorCode=18 失败（Windows 不允许盘符冒号）；
 * 若含 `../` 则会让 aria2 把文件写到下载目录之外。
 * 口径与 App 侧 extensionApiCore.sanitizeDownloadFileName 保持一致。
 */
function sanitizeFileName(name) {
  if (typeof name !== 'string' || !name) return ''
  const last = name.split(/[\\/]/).pop() || ''
  let cleaned = ''
  for (const ch of last) {
    // U+0000–U+001F 控制符与 Windows 非法字符一律剔除
    if (ch.charCodeAt(0) <= 0x1f || '<>:"|?*'.includes(ch)) continue
    cleaned += ch
  }
  cleaned = cleaned.trim()
  if (!cleaned || cleaned === '.' || cleaned === '..') return ''
  return cleaned
}

/** 引擎的全局下载目录（aria2 的 dir）。service worker 生命周期内缓存，引擎未启动时缓存空串以免反复等超时 */
let cachedEngineDir = null
async function getEngineDownloadDir(config) {
  if (cachedEngineDir !== null) return cachedEngineDir
  try {
    const options = await rpcCall('aria2.getGlobalOption', [], config, 3000)
    cachedEngineDir = typeof options?.dir === 'string' ? options.dir : ''
  } catch {
    cachedEngineDir = ''
  }
  return cachedEngineDir
}

/** 本机 App 本地接口地址：端口与 electron/utils/extensionApiCore.ts 的 EXTENSION_API_PORT 一致。
 * 用 localhost 而不是 127.0.0.1：实测系统代理开着时，Chromium 页面里对 127.0.0.1 这类
 * IP 字面量的请求可能被代理拦截而失败，localhost 因隐式绕过规则仍直连
 * （App 侧同理，见 src/shared/connectionDiagnostics.ts）。 */
const APP_API_BASE = 'http://localhost:6801'
/** 建任务请求超时：App 侧可能要做一次文件名探测（只取响应头）+ 一次本机 RPC，留足余量 */
const APP_ADD_TIMEOUT_MS = 20000

/** App 本地接口统一鉴权头（Bearer 方案，与 App 侧 isAuthorizedExtensionRequest 对应）。
  X-Extension-Version：App 侧记录日志，用于两端版本协同排查 */
function buildAppApiHeaders(secret) {
  return { Authorization: 'Bearer ' + secret, 'X-Extension-Version': chrome.runtime.getManifest().version }
}

/**
 * 把接口返回的错误码翻译成用户能看懂的话。
 * 直接透传引擎原始报文（如 aria2 的英文报错）对用户没有价值，故按码映射；
 * 未知码才回落到服务端原文。
 */
function apiErrorMessage(data) {
  switch (data?.code) {
    case 'engine_unavailable':
      return i18n('errEngineUnavailable')
    case 'unauthorized':
      return i18n('errUnauthorized')
    case 'invalid_url':
      return i18n('errApiInvalidUrl')
    default:
      return data?.error || i18n('errUnknown')
  }
}

/**
 * 汇总要随任务下发的请求头（Referer + Cookie）。
 *
 * 为什么需要：需要登录的站点（网盘、论坛附件、企业内网）从浏览器发起时天然带 Cookie/Referer，
 * 换成独立下载器后这两样消失了，请求直接 401/403。此前扩展完全不带，这类链接必然失败。
 *
 * 边界：
 * - 只对 http(s) 目标采集（magnet/ftp 没有 Cookie 语义，带上反而让 aria2 拒绝）；
 * - Cookie 需要宿主权限才能读到，未授予时 getAll 会抛错/返回空——一律按"没有 Cookie"处理，
 *   绝不因为采集失败而阻塞下载；
 * - Referer 不需要额外权限，来源是下载项自带的 referrer 或当前标签页地址。
 */
async function collectRequestHeaders(url, pageUrl, allowCookies) {
  const headers = []
  if (!/^https?:\/\//i.test(url)) return headers

  if (pageUrl && /^https?:\/\//i.test(pageUrl)) {
    headers.push(`Referer: ${pageUrl}`)
  }

  if (!allowCookies || !chrome.cookies?.getAll) return headers
  try {
    const cookies = await chrome.cookies.getAll({ url })
    if (cookies && cookies.length > 0) {
      headers.push('Cookie: ' + cookies.map(c => `${c.name}=${c.value}`).join('; '))
    }
  } catch { /* 未授予该站点权限时静默跳过 */ }
  return headers
}

/**
 * 把请求头数组落到 aria2 选项上（**回落路径专用**：不经 App 时由扩展自己下发）。
 * aria2 对 referer / user-agent 有专用选项，混在 header 里会被覆盖，故先挑出这两个。
 */
function applyHeadersToOptions(options, headers) {
  const extra = []
  for (const raw of headers || []) {
    if (typeof raw !== 'string') continue
    const idx = raw.indexOf(':')
    if (idx <= 0) continue
    const name = raw.slice(0, idx).trim().toLowerCase()
    const value = raw.slice(idx + 1).trim()
    if (!value) continue
    if (name === 'referer') options.referer = value
    else if (name === 'user-agent') options['user-agent'] = value
    else extra.push(`${name}: ${value}`)
  }
  if (extra.length > 0) options.header = extra
  return options
}

/**
 * 让 App 直接建任务：解析目录、重名改名、选项套用（连接数/分片/是否自动开始）全部在 App 侧完成。
 * 这样扩展建的任务与 App 内新建的任务**行为一致**，扩展也不必再自己维护一份分类规则。
 *
 * @returns null 表示接口不可用（App 未运行 / 未授权 / 版本较旧）→ 调用方回落直连 aria2；
 *          返回 {success:false} 表示失败且**不应回落**（见下方超时说明）。
 */
async function addViaApp(url, config, fileNameHint = '', headers = []) {
  if (!config.secret) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), APP_ADD_TIMEOUT_MS)
  try {
    const body = fileNameHint ? { url, fileName: fileNameHint } : { url }
    if (headers.length > 0) body.headers = headers
    const response = await fetch(`${APP_API_BASE}/api/add`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildAppApiHeaders(config.secret)
      },
      body: JSON.stringify(body),
      signal: controller.signal
    })
    // 鉴权失败 / 路由不存在（App 版本较旧）→ 视为接口不可用，走直连
    if (response.status === 401 || response.status === 404 || response.status === 405) return null

    const data = await response.json().catch(() => null)
    if (!data) return null
    if (!data.ok) return { success: false, error: apiErrorMessage(data) }

    return {
      success: true,
      gid: data.gid,
      subdir: data.subdir || null,
      conflict: data.conflict === true,
      renamed: data.renamed || '',
      resolvedBy: 'app'
    }
  } catch (error) {
    // 超时**绝不能**回落：App 可能已经建好任务（只是回包慢），再走直连会重复建一个。
    // 只有"连接失败"类错误（App 没运行）才是真正该回落的场景，它不会走到这里——
    // 那种情况下 fetch 立即抛 TypeError 且请求未送达。为稳妥起见，用 abort 与否区分：
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { success: false, error: i18n('errTimeout') }
    }
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** 回落路径：内置默认规则（与 App 的内置默认一致）。真实文件名探测由 App 侧完成。
 * @returns {{dir: string, subdir: string|null, source: string}}
 */
async function resolveTarget(url, config, fileNameHint = '') {
  const resolved = await resolveCategoryDir(url, config, fileNameHint)
  return { dir: resolved.dir || '', subdir: resolved.subdir || null, source: 'builtin' }
}

/**
 * 组装"已发送"通知文案：重名改名优先展示（用户最需要知道没覆盖原文件），
 * 其次报告分类子目录。
 */
function buildSentMessage(result, keys) {
  if (result.conflict && result.renamed) return i18n(keys.renamed, [result.renamed])
  if (result.subdir) return i18n(keys.subdir, [result.subdir])
  return i18n(keys.plain)
}
/**
 * 按扩展名解析分类子目录（**回落路径专用**：App 接口不可用时用内置默认规则）。
 * 优先用 fileNameHint（如浏览器已确定的文件名，比 URL 可靠——跳转链接的 URL 往往没有扩展名），
 * 其次看 URL 本身。返回 { dir, subdir }（命中）或 { skip: 原因 }。
 */
async function resolveCategoryDir(url, config, fileNameHint = '') {
  const base = await getEngineDownloadDir(config)
  if (!base) return { skip: 'engineDirUnknown' }
  const ext = getFileExtension(fileNameHint) || extFromUrl(url)
  if (!ext) return { skip: 'noExt' }
  const rule = CATEGORY_RULES.find(r => r.exts.includes(ext))
  if (!rule) return { skip: 'noMatch' }
  const sep = base.includes('\\') ? '\\' : '/'
  return { dir: `${base.replace(/[/\\]+$/, '')}${sep}${rule.dir}`, subdir: rule.dir }
}

// Load config from storage
/** 配置的同步缓存：onDeterminingFilename 这类必须同步决策的监听器使用。
  SW 冷启动时先以默认值占位，storage 读取/变更到达后即刷新 */
let cachedConfig = { ...DEFAULT_CONFIG }

async function getConfig() {
  const result = await chrome.storage.local.get('config')
  cachedConfig = { ...DEFAULT_CONFIG, ...result.config }
  return cachedConfig
}

function getCachedConfig() {
  return cachedConfig
}

// Save config to storage
async function saveConfig(config) {
  cachedConfig = { ...DEFAULT_CONFIG, ...config }
  await chrome.storage.local.set({ config })
}

/**
 * 一键配对（**必须在 Service Worker 里执行**，这是本次弹窗重构的关键修复）：
 * 点击「配对」后用户要切到 Aria2 Desktop 点「允许」，而浏览器 action 弹窗一失去焦点就被销毁，
 * 在 popup 里发 fetch 会随之中止——配对永远无法在弹窗内完成。挪到 SW：
 * 弹窗可关、浏览器可最小化，请求照常进行；结果写入 storage 并发系统通知。
 *
 * 结果三态：{ ok:true }（已写入配置）；{ ok:false, error }（失败原因）。
 * 同时把最近一次结果存到 storage.lastPairing，供重新打开的弹窗展示。
 */
async function startPairing() {
  let result
  // MV3 的 Service Worker 空闲约 30s 会被浏览器回收；而用户切到 App、读完确认框再点「允许」
  // 很可能超过 30s。SW 一旦被回收，进行中的 fetch 会被中断，**App 已允许但扩展没写入密钥**
  // ——表现为"配对成功却仍显示未配对，点去配对又重复弹窗"。
  // 定时调用扩展 API 可重置空闲计时，把 SW 保活到配对返回（最长受下面的 120s 超时约束）。
  const keepAlive = setInterval(() => {
    try {
      chrome.runtime.getPlatformInfo()?.catch?.(() => {})
    } catch {
      // 忽略：保活失败不应影响配对本身
    }
  }, 20000)
  try {
    const response = await fetch(`${APP_API_BASE}/api/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      // App 侧等待用户确认无超时；给用户留足切换窗口与点击的时间
      signal: AbortSignal.timeout(120000)
    })
    const data = await response.json().catch(() => null)
    if (response.ok && data?.ok) {
      const config = await getConfig()
      await saveConfig({
        ...config,
        secret: data.secret || '',
        host: 'localhost',
        port: Number.isInteger(data.port) && data.port > 0 ? data.port : config.port
      })
      result = { ok: true }
      showNotification('pairingDoneTitle', i18n('pairingDoneDesc'))
    } else if (data?.code === 'pairing_denied') {
      result = { ok: false, error: i18n('pairingDenied') }
    } else if (data?.code === 'pairing_forbidden') {
      result = { ok: false, error: i18n('pairingForbidden') }
    } else {
      result = { ok: false, error: i18n('pairingFailed') }
    }
  } catch (error) {
    result = error instanceof DOMException && error.name === 'AbortError'
      ? { ok: false, error: i18n('pairingTimeout') }
      : { ok: false, error: i18n('pairingUnreachable') }
  }
  try {
    await chrome.storage.local.set({ lastPairing: { ...result, at: Date.now() } })
  } finally {
    clearInterval(keepAlive)
  }
  return result
}

// Build Aria2 JSON-RPC request
function buildRpcRequest(method, params = [], secret = '') {
  const rpcParams = secret ? [`token:${secret}`, ...params] : params
  return {
    jsonrpc: '2.0',
    id: Date.now().toString(36),
    method,
    params: rpcParams
  }
}

/**
 * 把底层错误翻译成用户看得懂、并且知道下一步怎么做的一句话。
 * 例：`Failed to fetch` → "无法连接到 localhost:6800 —— 请确认 Aria2 Desktop 正在运行"。
 */
function describeError(error, config) {
  const raw = error instanceof Error ? error.message : String(error ?? '')

  if (error instanceof DOMException && error.name === 'AbortError') {
    return i18n('errTimeout')
  }
  if (/failed to fetch|networkerror|connection refused|err_connection|err_name/i.test(raw)) {
    return i18n('errCannotConnect', [`${config.host}:${config.port}`])
  }
  if (/unauthorized|\btoken\b|secret|401/i.test(raw)) {
    return i18n('errUnauthorized')
  }
  return raw || i18n('errUnknown')
}

/** 统一的 RPC 调用（带超时 + 错误翻译） */
async function rpcCall(method, params, config, timeoutMs = RPC_TIMEOUT_MS) {
  const rpcUrl = `http://${config.host}:${config.port}${config.path}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildRpcRequest(method, params, config.secret)),
      signal: controller.signal
    })
    const data = await response.json()
    if (data.error) {
      // RPC 层错误（如密钥不正确）走同一条翻译路径
      throw new Error(data.error.message)
    }
    return data.result
  } finally {
    clearTimeout(timer)
  }
}

// Send download to Aria2
async function sendToAria2(url, options = {}, fileNameHint = '', pageUrl = '') {
  const config = await getConfig()
  if (!config.enabled) return { success: false, error: i18n('errDisabled') }

  try {
    // 入口统一净化：out 与 fileNameHint 都可能来自 chrome.downloads（绝对本地路径），
    // 直接下发会让任务以 errorCode=18 失败——详见 sanitizeFileName 的注释。
    const cleanOptions = { ...options }
    const plainOut = sanitizeFileName(cleanOptions.out)
    if (plainOut) cleanOptions.out = plainOut
    else delete cleanOptions.out
    const plainHint = sanitizeFileName(fileNameHint) || plainOut

    // 页面上下文（Referer + 可选 Cookie）：登录站点能否下载成功基本取决于它
    const headers = await collectRequestHeaders(url, pageUrl, config.allowCookies === true)

    const callerSpecifiedDir = Object.keys(cleanOptions).includes('dir')

    // 1) 优先让 App 建任务：用户自定义分类规则生效、重名统一处理，
    //    且套用与 App 内新建一致的 aria2 选项（连接数/分片/是否自动开始）
    if (!callerSpecifiedDir) {
      const viaApp = await addViaApp(url, config, plainHint, headers)
      if (viaApp) return viaApp
    }

    // 2) 回落：扩展直连 aria2（内置默认分类规则），保证 App 未运行/未授权时仍可用
    const target = callerSpecifiedDir
      ? { dir: '', subdir: null, source: 'caller' }
      : await resolveTarget(url, config, plainHint)

    const finalOptions = { ...cleanOptions }
    if (target.dir) finalOptions.dir = target.dir
    applyHeadersToOptions(finalOptions, headers)

    const gid = await rpcCall('aria2.addUri', [[url], finalOptions], config)
    return {
      success: true,
      gid,
      subdir: target.subdir,
      resolvedBy: target.source,
      engineDirKnown: cachedEngineDir !== null && cachedEngineDir !== ''
    }
  } catch (error) {
    return { success: false, error: describeError(error, config) }
  }
}

// Test connection to Aria2
async function testConnection() {
  const config = await getConfig()
  try {
    const result = await rpcCall('aria2.getVersion', [], config)
    return { success: true, version: result.version, enabled: config.enabled }
  } catch (error) {
    return { success: false, error: describeError(error, config), enabled: config.enabled }
  }
}

/**
 * 经 App 本地接口查询引擎状态（弹窗状态条优先走这里，能区分"引擎未启动"与"接口不可达"）。
 * @returns {handled:boolean, engineRunning?:boolean, engineVersion?:string}
 *          handled=false 表示接口不可用（App 未运行/未授权/版本较旧），调用方应回落直连 RPC
 */
async function getAppStatus() {
  const config = await getConfig()
  if (!config.secret) return { handled: false }
  try {
    const response = await fetch(`${APP_API_BASE}/api/status`, {
      headers: buildAppApiHeaders(config.secret),
      cache: 'no-store',
      signal: AbortSignal.timeout(3000)
    })
    if (!response.ok) return { handled: false }
    const data = await response.json().catch(() => null)
    if (!data?.ok || !data.engine) return { handled: false }
    return {
      handled: true,
      engineRunning: data.engine.running === true,
      engineVersion: data.engine.version ? String(data.engine.version) : ''
    }
  } catch {
    return { handled: false }
  }
}

/**
 * 把整页链接交给 App 的 yt-dlp 下载模式。
 *
 * 与直链发送的区别：交给 App 的是**页面地址**，由 App 解析并合并音视频。
 * 适用于 B 站这类 MSE/DASH 页面（扩展拿不到可用的媒体直链）。
 * 需要的 App 能力（yt-dlp / ffmpeg）由 App 侧检查，这里只负责翻译错误码。
 */
async function streamPageVideo(pageUrl, title) {
  if (!/^https?:\/\//i.test(pageUrl || '')) {
    return { success: false, code: 'invalid_url', error: i18n('streamPageUnsupported') }
  }
  const config = await getConfig()
  if (!config.secret) {
    return { success: false, code: 'not_paired', error: i18n('streamPageNeedPair') }
  }

  try {
    const response = await fetch(`${APP_API_BASE}/api/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...buildAppApiHeaders(config.secret) },
      body: JSON.stringify({ url: pageUrl, title: title || '' }),
      signal: AbortSignal.timeout(35000)
    })
    const data = await response.json().catch(() => null)
    if (response.ok && data?.ok) return { success: true }
    if (data?.code === 'ytdlp_missing') return { success: false, code: 'ytdlp_missing', error: i18n('streamPageYtdlpMissing') }
    if (data?.code === 'ffmpeg_missing') return { success: false, code: 'ffmpeg_missing', error: i18n('streamPageFfmpegMissing') }
    if (data?.code === 'invalid_url') return { success: false, code: 'invalid_url', error: i18n('streamPageUnsupported') }
    return { success: false, code: 'failed', error: i18n('streamPageFailed', [data?.error || String(response.status)]) }
  } catch {
    // 请求超时 / App 未运行 / 接口不可达都归到这里
    return { success: false, code: 'unreachable', error: i18n('streamPageUnreachable') }
  }
}

/**
 * 显示系统通知。
 * 通知是"锦上添花"：权限缺失、被系统关闭、或不可用时一律静默失败，
 * 绝不能因为通知发不出去而让下载流程报错。
 */
function showNotification(titleKey, message, isError = false) {
  if (!chrome.notifications?.create) return
  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: i18n(titleKey),
      message,
      priority: isError ? 2 : 1
    }, () => { void chrome.runtime.lastError })
  } catch { /* 忽略 */ }
}

/**
 * 在页面里跑的媒体探测函数（注入到目标标签页执行，不能引用本文件任何变量）。
 *
 * 只收集**可直接下载**的地址：`<video src>` / `<source src>` / `poster` 不取。
 * `blob:` 与 `m3u8/mpd` 另行标记原因——它们要么是 MSE 拼出来的流、要么是分片清单，
 * 直接交给 aria2 只会得到一个几 KB 的清单文件，需要 App 的流媒体模式处理。
 */
function detectPageMedia() {
  const items = []
  const seen = new Set()
  const push = (url, kind, label) => {
    if (!url || seen.has(url)) return
    seen.add(url)
    items.push({ url, kind, label: (label || '').slice(0, 80) })
  }
  // blob: 说明视频是 MSE 拼出来的，真实分片在网络层，扩展看不到
  for (const video of document.querySelectorAll('video')) {
    const src = video.currentSrc || video.src || ''
    if (!src) continue
    const label = video.getAttribute('title') || video.getAttribute('aria-label') || ''
    if (src.startsWith('blob:')) push(src, 'blob', label)
    else if (/\.(m3u8|mpd)(?:[?#]|$)/i.test(src)) push(src, 'stream', label)
    else push(src, 'file', label)
    for (const source of video.querySelectorAll('source')) {
      const s = source.src
      if (s) push(s, /\.(m3u8|mpd)(?:[?#]|$)/i.test(s) ? 'stream' : 'file', '')
    }
  }
  // <audio> 同样支持（播客、音频页），语义与 video 一致
  for (const audio of document.querySelectorAll('audio')) {
    const src = audio.currentSrc || audio.src || ''
    if (src) push(src, src.startsWith('blob:') ? 'blob' : 'file', '')
  }
  return items.slice(0, 20)
}

/** 探测当前标签页的媒体地址（需要 scripting + 该标签页的临时宿主权限，即用户点击扩展图标时授予） */
async function detectActiveTabMedia() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id || !/^https?:/i.test(tab.url || '')) {
      return { success: false, error: i18n('mediaUnsupportedPage') }
    }
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: detectPageMedia
    })
    const items = Array.isArray(results) && results[0] ? results[0].result || [] : []
    return { success: true, items, pageUrl: tab.url || '' }
  } catch (error) {
    // 未授予该站点权限 / 页面是受限页（chrome://、商店页）时都会走到这里
    return { success: false, error: i18n('mediaPermissionDenied'), detail: String(error instanceof Error ? error.message : error) }
  }
}

/**
 * 抓取当前标签页的全部可下载链接（批量发送功能的数据源）。
 * 收集范围：页面内所有 http(s) 锚点（按 URL 去重）+ video/audio/source 的 src。
 * 执行在目标页面上下文里（chrome.scripting），本函数必须自包含——
 * 不能引用 background.js 的任何闭包变量。
 */
/**
 * 注入目标页面执行的链接采集器（必须自包含：不能引用 background.js 的闭包）。
 * 收集所有 http(s) 锚点（按 URL 去重）+ video/audio/source 的 src。
 */
function collectPageLinks() {
  const seen = new Set()
  const out = []
  for (const anchor of document.querySelectorAll('a[href]')) {
    let url
    try {
      url = new URL(anchor.getAttribute('href'), location.href).href
    } catch {
      continue
    }
    if (!/^https?:/i.test(url) || seen.has(url)) continue
    seen.add(url)
    const text = (anchor.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80)
    out.push({ url, text })
  }
  for (const el of document.querySelectorAll('video[src], audio[src], source[src]')) {
    let url
    try {
      url = new URL(el.getAttribute('src'), location.href).href
    } catch {
      continue
    }
    if (!/^https?:/i.test(url) || seen.has(url)) continue
    seen.add(url)
    out.push({ url, text: el.tagName.toLowerCase() + ' media' })
  }
  return out.slice(0, 200)
}

async function grabActiveTabLinks() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id || !/^https?:/i.test(tab.url || '')) {
      return { success: false, error: i18n('mediaUnsupportedPage') }
    }
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: collectPageLinks
    })
    const links = Array.isArray(results) && results[0] ? results[0].result || [] : []
    return { success: true, links, pageUrl: tab.url || '' }
  } catch (error) {
    return { success: false, error: i18n('mediaPermissionDenied'), detail: String(error instanceof Error ? error.message : error) }
  }
}

/** 批量发送抓取到的链接：逐条走 sendToAria2（分类/重名/选项与单条发送一致）。
    返回 { sent, failed, errors } 供弹窗展示结果 */
async function sendGrabbedLinks(links) {
  let sent = 0
  const errors = []
  for (const item of links) {
    const url = typeof item === 'string' ? item : item?.url
    if (!url) continue
    try {
      const result = await sendToAria2(url)
      if (result.success) sent++
      else errors.push(result.error || url)
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  return { sent, failed: links.length - sent, errors }
}

// Context menu: Download link with Aria2
// SW 冷启动即预热配置缓存：onDeterminingFilename 可能早于任何 getConfig 调用触发，
// 没有缓存时拦截决策会跳过（漏拦）。storage 变更监听保持缓存实时。
void getConfig()
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.config) {
    cachedConfig = { ...DEFAULT_CONFIG, ...changes.config.newValue }
  }
})

chrome.runtime.onInstalled.addListener(async () => {
  // 更新版本时旧菜单仍然存在，直接用同名 id 创建会报 "Cannot create item with duplicate id"，
  // 因此先清空再建。
  await chrome.contextMenus.removeAll()
  chrome.contextMenus.create({
    id: 'download-with-aria2',
    title: i18n('contextMenuTitle'),
    contexts: ['link', 'video', 'audio']
  })
})

// Handle context menu click
chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== 'download-with-aria2') return

  const url = info.linkUrl || info.srcUrl
  if (!url) return

  // info.pageUrl 需要 tabs/宿主权限才拿得到；拿不到时只是少一个 Referer，不影响下载
  const result = await sendToAria2(url, {}, '', info.pageUrl || '')
  if (result.success) {
    // 分类/重名结果直接告诉用户：既是有用信息，也让"没分类/被改名"立刻可见、可排查
    showNotification('downloadSent', buildSentMessage(result, {
      plain: 'downloadSentDesc',
      subdir: 'downloadSentToSubdir',
      renamed: 'downloadSentRenamed'
    }))
  } else {
    showNotification('downloadFailed', result.error, true)
  }
})

// Intercept downloads when enabled
// 拦截失败的兜底重下护栏：记录刚兜底重下的 URL 与时间。
// 没有它，"取消→重下→再拦截→再取消"会无限循环（onDeterminingFilename 对
// chrome.downloads.download() 发起的下载同样触发）。
const recentRedownloads = new Map()

function isRecentRedownload(url) {
  const at = recentRedownloads.get(url)
  if (at === undefined) return false
  if (Date.now() - at > 30000) {
    recentRedownloads.delete(url)
    return false
  }
  return true
}

function markRedownloaded(url) {
  recentRedownloads.set(url, Date.now())
  // 防止 Map 无限增长
  if (recentRedownloads.size > 50) {
    const oldest = [...recentRedownloads.entries()].sort((a, b) => a[1] - b[1])[0]
    if (oldest) recentRedownloads.delete(oldest[0])
  }
}

chrome.downloads.onDeterminingFilename.addListener((downloadItem) => {
  // 竞态防御（A2）：本监听器必须**同步**返回 true（表示"异步给决策"），
  // Chrome 才会等我们；此前是 async 函数——第一个 await 期间 Chrome 已按默认
  // 文件名继续下载，小文件在 cancel 落地前就完成了，cancel 对已完成的下载
  // 会失败且不在任何 try/catch 内，炸掉整个处理器（sendToAria2 与兜底全部
  // 走不到，且留下 unhandled rejection）。
  //
  // 拦截决策基于模块级配置缓存（同步可读，见 getCachedConfig）；
  // 实际的 cancel/sendToAria2 异步进行，返回 true 后 Chrome 会等待。
  const config = getCachedConfig()
  if (!config || !config.enabled || !config.interceptAll) return
  if (SKIPPED_SCHEMES.some(scheme => downloadItem.url.startsWith(scheme))) return
  // A3 护栏：刚由本兜底重下的下载不再拦截，否则"取消→重下→再拦截"死循环
  if (isRecentRedownload(downloadItem.url)) return

  const processing = (async () => {
    // 先取消浏览器下载（快文件可能已完成——cancel 对已完成的下载会失败，
    // 此时保留浏览器下载结果，仅提示拦截失败的原因）
    try {
      await chrome.downloads.cancel(downloadItem.id)
    } catch {
      showNotification('interceptFailed', i18n('errCannotConnect', [downloadItem.url]), true)
      return
    }

    // downloadItem.filename 是**绝对本地路径**（Chrome 语义），必须收敛成纯文件名：
    // aria2 的 out 是相对 dir 的，传绝对路径会直接 errorCode=18（sendToAria2 入口也会再兜一次）。
    const suggested = sanitizeFileName(downloadItem.filename)
    const options = suggested ? { out: suggested } : {}
    // referrer 由浏览器给出（发起这次下载的页面），是登录站点下载成功的关键
    const result = await sendToAria2(downloadItem.url, options, suggested, downloadItem.referrer || '')

    if (result.success) {
      showNotification('intercepted', buildSentMessage(result, {
        plain: 'interceptedDesc',
        subdir: 'interceptedToSubdir',
        renamed: 'interceptedRenamed'
      }))
      // 抹掉浏览器下载列表里那条"已取消"记录，避免用户看到一条吓人的失败项
      chrome.downloads.erase({ id: downloadItem.id }, () => { void chrome.runtime.lastError })
    } else {
      showNotification('interceptFailed', result.error, true)
      // 兜底重下（带 A3 护栏）：下载已被 cancel，resume 恢复不了，重新发起时
      // onDeterminingFilename 会因护栏而放行，浏览器正常下载。
      markRedownloaded(downloadItem.url)
      chrome.downloads.download({ url: downloadItem.url }, () => { void chrome.runtime.lastError })
    }
  })()

  // 吞掉异步链路的意外错误（已各自处理），避免 unhandled rejection
  processing.catch(() => { /* 保留浏览器下载，静默 */ })

  // 告知 Chrome：决策异步给出（取消成功后本次下载即终止，无需 suggest）
  return true
})

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getConfig') {
    getConfig().then(sendResponse)
    return true
  }

  if (message.action === 'saveConfig') {
    saveConfig(message.config).then(() => sendResponse({ success: true }))
    return true
  }

  if (message.action === 'testConnection') {
    testConnection().then(sendResponse)
    return true
  }

  if (message.action === 'getAppStatus') {
    getAppStatus().then(sendResponse)
    return true
  }

  if (message.action === 'sendToAria2') {
    // pageUrl：弹窗把当前标签页地址带上，作为 Referer（登录站点下载成功的关键）
    sendToAria2(message.url, message.options || {}, '', message.pageUrl || '').then(sendResponse)
    return true
  }

  if (message.action === 'detectPageMedia') {
    detectActiveTabMedia().then(sendResponse)
    return true
  }

  if (message.action === 'grabPageLinks') {
    grabActiveTabLinks().then(sendResponse)
    return true
  }

  if (message.action === 'sendGrabbedLinks') {
    sendGrabbedLinks(message.links || []).then(sendResponse)
    return true
  }

  if (message.action === 'streamPageVideo') {
    streamPageVideo(String(message.pageUrl || ''), String(message.title || '')).then(sendResponse)
    return true
  }

  if (message.action === 'startPairing') {
    startPairing().then(sendResponse)
    return true
  }
})
