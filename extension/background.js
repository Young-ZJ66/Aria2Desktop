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
  allowCookies: false,
  /**
   * 配对签发的受限 token（D-06）。取代过去的「把 RPC 密钥交给扩展」：
   * 密钥能删任意文件、改任意配置，token 只够做下载与任务管理，且可在 App 设置页单独撤销。
   * 与下面的 secret 并存：secret 是 1.4 及更早版本的手工配置方式，必须继续可用。
   */
  token: ''
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
const APP_API_PORT = 6801
const APP_API_BASE = 'http://localhost:' + APP_API_PORT
/** 建任务请求超时：App 侧可能要做一次文件名探测（只取响应头）+ 一次本机 RPC，留足余量 */
const APP_ADD_TIMEOUT_MS = 20000

/**
 * App 本地接口使用的凭据：优先配对 token，其次用户手填的 RPC 密钥（旧配置兼容）。
 * 两者在 App 侧都走 Authorization: Bearer，但 token 会额外受 scope 限制。
 */
function getAppCredential(config) {
  return (config && (config.token || config.secret)) || ''
}

/** App 本地接口统一鉴权头（Bearer 方案，与 App 侧 isAuthorizedExtensionRequestWithToken 对应）。
  X-Extension-Version：App 侧记录日志，用于两端版本协同排查 */
function buildAppApiHeaders(credential) {
  return { Authorization: 'Bearer ' + credential, 'X-Extension-Version': chrome.runtime.getManifest().version }
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
    case 'insufficient_scope':
      // token 缺少该操作所需权限：多出现在 App 侧收紧了授权范围，让用户重新配对即可
      return i18n('errInsufficientScope')
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
  const credential = getAppCredential(config)
  if (!credential) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), APP_ADD_TIMEOUT_MS)
  try {
    const body = fileNameHint ? { url, fileName: fileNameHint } : { url }
    if (headers.length > 0) body.headers = headers
    const response = await fetch(`${APP_API_BASE}/api/add`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildAppApiHeaders(credential)
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
    // 带上扩展名称/版本：App 侧确认框要显示"是哪个扩展在请求配对"（D-06）。
    // 名称只是展示信息，App 会净化后再展示，不参与任何授权判定。
    const response = await fetch(`${APP_API_BASE}/api/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: i18n('extName'), version: chrome.runtime.getManifest().version }),
      // App 侧等待用户确认无超时；给用户留足切换窗口与点击的时间
      signal: AbortSignal.timeout(120000)
    })
    const data = await response.json().catch(() => null)
    if (response.ok && data?.ok) {
      const config = await getConfig()
      await saveConfig({
        ...config,
        // D-06：App 现在只发受限 token，不再把 RPC 密钥交给扩展。
        // 兼容旧版 App（只会回 secret）：哪种存在就存哪种，凭据选择见 getAppCredential。
        token: typeof data.token === 'string' ? data.token : '',
        secret: typeof data.secret === 'string' ? data.secret : '',
        host: 'localhost',
        port: Number.isInteger(data.port) && data.port > 0 ? data.port : config.port
      })
      result = { ok: true }
      showNotification('pairingDoneTitle', i18n('pairingDoneDesc'))
    } else if (data?.code === 'pairing_denied') {
      result = { ok: false, error: i18n('pairingDenied') }
    } else if (data?.code === 'pairing_forbidden') {
      result = { ok: false, error: i18n('pairingForbidden') }
    } else if (data?.code === 'secret_required') {
      result = { ok: false, error: i18n('pairingSecretRequired') }
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

// ── 任务列表（弹窗任务页） ────────────────────────────────
function taskDisplayName(item) {
  const file = Array.isArray(item.files) && item.files[0] ? item.files[0] : null
  const path = file?.path || ''
  if (path) return path.split(/[\\/]/).pop() || path
  if (item.bittorrent?.info?.name) return item.bittorrent.info.name
  return item.gid
}

function normalizeTask(item, fallbackStatus) {
  return {
    gid: item.gid,
    status: item.status || fallbackStatus,
    name: taskDisplayName(item),
    totalLength: item.totalLength || '0',
    completedLength: item.completedLength || '0',
    downloadSpeed: item.downloadSpeed || '0',
    uploadSpeed: item.uploadSpeed || '0',
    errorMessage: item.errorMessage || ''
  }
}

/**
 * 把 App 侧的流媒体（yt-dlp）任务整成与 aria2 任务同形的记录。
 *
 * 为什么必须合并进来：yt-dlp 下载**不进 aria2 队列**，「智能解析本页视频」发起的任务
 * 在扩展里原本完全不可见（列表只拉 aria2 RPC 快照）。gid 直接用 App 的任务 id，
 * 并打上 source='stream'，动作据此决定发给 aria2 还是 App。
 */
function normalizeStreamTask(task) {
  const total = Number(task.totalBytes) || 0
  const completed = Number(task.downloadedBytes) || 0
  const percent = Math.max(0, Math.min(100, Number(task.percent) || 0))
  return {
    gid: String(task.id || ''),
    source: 'stream',
    status: task.status === 'complete' ? 'complete' : task.status === 'error' ? 'error' : task.status === 'paused' ? 'paused' : 'active',
    name: task.title || task.url || String(task.id || ''),
    totalLength: String(total),
    completedLength: String(completed || (total > 0 ? Math.round(total * percent / 100) : 0)),
    downloadSpeed: String(Number(task.speedBytes) || 0),
    uploadSpeed: '0',
    errorMessage: task.error || '',
    percent
  }
}

/**
 * 拉取 App 侧的流媒体任务列表。
 * @returns {Promise<Array>} 失败一律返回空数组：接口不可用（App 未运行/版本较旧）时，
 *          扩展仍应正常显示 aria2 任务，不能因为这一路失败让整张列表打不开。
 */
async function getStreamTasks(config) {
  const credential = getAppCredential(config)
  if (!credential) return []
  try {
    const response = await fetch(`${APP_API_BASE}/api/stream-tasks`, {
      headers: buildAppApiHeaders(credential),
      cache: 'no-store',
      signal: AbortSignal.timeout(4000)
    })
    if (!response.ok) return []
    const data = await response.json().catch(() => null)
    if (!data?.ok || !Array.isArray(data.tasks)) return []
    return data.tasks.map(normalizeStreamTask).filter(task => task.gid)
  } catch {
    return []
  }
}

/**
 * 把 App /api/tasks 返回的任务转成与 aria2 任务同形的记录。
 * App 侧已做过取名与字段映射（name/totalLength/...），这里只补默认值，
 * 不再走 taskDisplayName——那条路径依赖 files[0].path，对 App 聚合结果未必存在。
 */
function normalizeAppTask(item) {
  return {
    gid: String(item.gid || ''),
    status: item.status || 'complete',
    name: item.name || taskDisplayName(item),
    totalLength: String(item.totalLength || '0'),
    completedLength: String(item.completedLength || '0'),
    downloadSpeed: String(item.downloadSpeed || '0'),
    uploadSpeed: String(item.uploadSpeed || '0'),
    errorMessage: item.errorMessage || ''
  }
}

/** 概览数字要把流媒体任务算进去，否则「解析本页视频」后概览仍显示 0 个进行中 */
function buildTaskStats(base, streamTasks) {
  const streamActive = streamTasks.filter(task => task.status === 'active' || task.status === 'waiting' || task.status === 'paused').length
  const streamSpeed = streamTasks.reduce((sum, task) => sum + (task.status === 'active' ? Number(task.downloadSpeed) || 0 : 0), 0)
  return {
    downloadSpeed: String((Number(base?.downloadSpeed) || 0) + streamSpeed),
    uploadSpeed: String(base?.uploadSpeed || '0'),
    numActive: String((Number(base?.numActive) || 0) + streamActive),
    numWaiting: String(base?.numWaiting || '0')
  }
}

/**
 * 经 App 的 /api/tasks 受限端点拉任务快照（D-06）。
 *
 * 为什么改：过去扩展直接用 RPC 密钥连 6800，等于把「能删文件、能改配置」的完整引擎凭据
 * 交给扩展。配对只发受限 token 后，正常路径变成 App 侧聚合，扩展手里不再有引擎凭据。
 *
 * @returns {Promise<object|null>} null 表示接口不可用（App 未运行/版本较旧/scope 不足）→ 调用方回落直连
 */
async function fetchTasksViaApp(config) {
  const credential = getAppCredential(config)
  if (!credential) return null
  try {
    const [response, streamTasks] = await Promise.all([
      fetch(`${APP_API_BASE}/api/tasks`, {
        headers: buildAppApiHeaders(credential),
        cache: 'no-store',
        signal: AbortSignal.timeout(5000)
      }),
      getStreamTasks(config)
    ])
    if (!response.ok) return null
    const data = await response.json().catch(() => null)
    if (!data?.ok || !Array.isArray(data.tasks)) return null
    const aria2Tasks = data.tasks.map(normalizeAppTask).filter(task => task.gid)
    return {
      success: true,
      stats: buildTaskStats(data.stats, streamTasks),
      // 流媒体任务排在前面：它们通常是用户刚发起、正等着看进度的那条
      tasks: [...streamTasks, ...aria2Tasks]
    }
  } catch {
    return null
  }
}

async function getTasksSnapshot() {
  const config = await getConfig()
  if (!getAppCredential(config)) return { success: false, code: 'not_paired', error: i18n('sendNeedPairing') }

  // 1) 优先走 App：配对 token 只够读任务，拿不到引擎凭据（D-06）
  const viaApp = await fetchTasksViaApp(config)
  if (viaApp) return viaApp

  // 2) 回落直连引擎：只有仍保留 RPC 密钥的旧配置能走这条路
  if (!config.secret) return { success: false, code: 'app_unavailable', error: i18n('errAppUnavailable') }
  try {
    const [stats, active, waiting, stopped, streamTasks] = await Promise.all([
      rpcCall('aria2.getGlobalStat', [], config),
      rpcCall('aria2.tellActive', [], config),
      rpcCall('aria2.tellWaiting', [0, 50], config),
      rpcCall('aria2.tellStopped', [0, 20], config),
      getStreamTasks(config)
    ])
    const aria2Tasks = [
      ...active.map(item => normalizeTask(item, 'active')),
      ...waiting.map(item => normalizeTask(item, item.status || 'waiting')),
      ...stopped.map(item => normalizeTask(item, item.status || 'complete'))
    ]
    return {
      success: true,
      stats: buildTaskStats(stats, streamTasks),
      tasks: [...streamTasks, ...aria2Tasks]
    }
  } catch (error) {
    return { success: false, error: describeError(error, config) }
  }
}

/** 对流媒体（yt-dlp）任务执行动作：走 App 接口，aria2 根本不认识这些 id */
async function streamTaskAction(operation, id) {
  const config = await getConfig()
  const credential = getAppCredential(config)
  if (!credential) return { success: false, code: 'not_paired', error: i18n('sendNeedPairing') }
  try {
    const response = await fetch(`${APP_API_BASE}/api/stream-task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...buildAppApiHeaders(credential) },
      body: JSON.stringify({ action: operation, id }),
      signal: AbortSignal.timeout(8000)
    })
    const data = await response.json().catch(() => null)
    if (response.ok && data?.ok) return { success: true }
    if (data?.code === 'not_running') return { success: false, error: i18n('taskStreamNotRunning') }
    if (data?.code === 'not_paused') return { success: false, error: i18n('taskStreamNotPaused') }
    return { success: false, error: data?.error || i18n('errUnknown') }
  } catch {
    return { success: false, error: i18n('errCannotConnect', [`localhost:${APP_API_PORT}`]) }
  }
}

/**
 * 经 App 的 /api/task 受限端点操作 aria2 任务（D-06）。
 * @returns {Promise<object|null>} null 表示接口不可用 → 调用方回落直连 RPC
 */
async function taskActionViaApp(config, operation, gid) {
  const credential = getAppCredential(config)
  if (!credential) return null
  try {
    const response = await fetch(`${APP_API_BASE}/api/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...buildAppApiHeaders(credential) },
      body: JSON.stringify({ action: operation, gid }),
      signal: AbortSignal.timeout(8000)
    })
    if (!response.ok) return null
    const data = await response.json().catch(() => null)
    if (!data) return null
    if (data.ok) return { success: true }
    return { success: false, error: apiErrorMessage(data) }
  } catch {
    return null
  }
}

async function taskAction(operation, gid, source) {
  if (source === 'stream') return streamTaskAction(operation, gid)
  const config = await getConfig()
  if (!getAppCredential(config)) return { success: false, code: 'not_paired', error: i18n('sendNeedPairing') }

  // 优先走 App 受限端点（token 足够，且不需要把引擎凭据留在扩展里）
  const viaApp = await taskActionViaApp(config, operation, gid)
  if (viaApp) return viaApp

  // 回落直连：仅旧配置（手填 secret）可用
  if (!config.secret) return { success: false, code: 'app_unavailable', error: i18n('errAppUnavailable') }
  try {
    if (operation === 'pause') await rpcCall('aria2.pause', [gid], config)
    else if (operation === 'resume') await rpcCall('aria2.unpause', [gid], config)
    else if (operation === 'remove') {
      try { await rpcCall('aria2.remove', [gid], config) }
      catch { await rpcCall('aria2.removeDownloadResult', [gid], config) }
    } else return { success: false, error: 'unknown operation' }
    return { success: true }
  } catch (error) {
    return { success: false, error: describeError(error, config) }
  }
}

// ── 网络嗅探（弹窗嗅探页） ────────────────────────────────
// 每个 tab 维护最近 200 条请求，仅记录 HTTP(S) 资源；主文档请求用于判断导航并清空旧记录。
const snifferByTab = new Map()
const SNIFFER_LIMIT = 200
const SNIFFER_TYPES = ['sub_frame', 'xmlhttprequest', 'media', 'image', 'script', 'stylesheet', 'font', 'object', 'other']
const SNIFFER_STORAGE_PREFIX = 'snifferTab:'
const snifferPersistTimers = new Map()
const snifferHydratedTabs = new Set()

/**
 * 清单里的分片：HLS 的 .ts、DASH 的 .m4s。
 *
 * 为什么 .ts 也算（D-07）：HLS 的分片就是 .ts，一次播放会有几百个；它们既不能单独播放
 * （缺 init 段/编码参数），也不该作为普通视频被批量勾选下载。旧实现只认 .m4s，
 * 于是 .ts 落进下面的 videoExts 变成"可下载的普通视频"，用户批量下载后得到一堆无法播放的碎片。
 */
const SEGMENT_EXTS = ['ts', 'm4s']

function isMediaFragment(url) {
  return SEGMENT_EXTS.includes(extFromUrl(url))
}

// B 站 DASH 音频分片的文件名形如 42513599167-1-30216.m4s（302xx 为音频，1000xx 为视频）
function isBilibiliAudioSegment(url) {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || '')
    const match = /-(\d{5,6})\.m4s$/i.exec(name)
    return Boolean(match && /^302\d{2}$/.test(match[1]))
  } catch { return false }
}

/**
 * 播放列表清单（HLS/DASH）的扩展名。
 *
 * 为什么单列一类（D-07）：.m3u8/.mpd 本身只有几 KB，里面是分片索引，
 * 交给 aria2 只会下到一个清单文件、播放不了；而 .ts/.m4s 是清单里的分片，
 * 单独下载同样没有意义（几百个碎片、且缺 init 段）。
 * 正确做法是把清单交给 App 的流媒体模式（yt-dlp）整段解析。
 */
const PLAYLIST_EXTS = ['m3u8', 'mpd']

function isPlaylistUrl(url) {
  return PLAYLIST_EXTS.includes(extFromUrl(url))
}

function classifySniffedResource(details) {
  const ext = extFromUrl(details.url)
  const audioExts = ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus', 'wma', 'ape']
  // 注意：m3u8/mpd 已从 videoExts 移除，走下面的 playlist 分支（D-07）；
  // ts 也已移除——HLS 分片由 isMediaFragment 标记为 fragment，不能当普通视频下载（D-07）
  const videoExts = ['mp4', 'm4v', 'webm', 'mkv', 'mov', 'avi', 'wmv', 'flv', 'mpg', 'mpeg']
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif']
  if (details.type === 'image' || imageExts.includes(ext)) return 'image'
  if (audioExts.includes(ext) || (ext === 'm4s' && isBilibiliAudioSegment(details.url))) return 'audio'
  // 播放列表必须排在 video 判定之前：否则 m3u8 会命中 details.type === 'media' 被当成可直下的视频
  if (isPlaylistUrl(details.url)) return 'playlist'
  if (details.type === 'media' || videoExts.includes(ext) || ext === 'm4s') return 'video'
  return 'other'
}

function persistSnifferTab(tabId) {
  if (!chrome.storage?.session) return
  const key = SNIFFER_STORAGE_PREFIX + tabId
  const map = snifferByTab.get(tabId)
  try {
    if (map) chrome.storage.session.set({ [key]: [...map.values()] })
    else chrome.storage.session.remove(key)
  } catch { /* 存储不可用时仅保留内存数据 */ }
}

function scheduleSnifferPersist(tabId) {
  if (!chrome.storage?.session || snifferPersistTimers.has(tabId)) return
  const timer = setTimeout(() => {
    snifferPersistTimers.delete(tabId)
    persistSnifferTab(tabId)
  }, 250)
  snifferPersistTimers.set(tabId, timer)
}

async function hydrateSnifferTab(tabId) {
  if (snifferHydratedTabs.has(tabId)) return
  snifferHydratedTabs.add(tabId)
  if (!chrome.storage?.session) return
  try {
    const key = SNIFFER_STORAGE_PREFIX + tabId
    const stored = await chrome.storage.session.get(key)
    const rows = stored?.[key]
    if (!snifferByTab.has(tabId) && Array.isArray(rows)) {
      const map = new Map()
      for (const row of rows) if (row?.id && row?.url) map.set(row.id, row)
      if (map.size) snifferByTab.set(tabId, map)
    }
  } catch { /* 读取失败时从空列表开始 */ }
}

function rememberSniffedRequest(details) {
  if (details.tabId < 0 || !/^https?:/i.test(details.url || '')) return
  let map = snifferByTab.get(details.tabId)
  if (!map) { map = new Map(); snifferByTab.set(details.tabId, map) }
  const key = details.requestId || details.url
  if (!map.has(key) && map.size >= SNIFFER_LIMIT) {
    const oldest = map.keys().next().value
    if (oldest !== undefined) map.delete(oldest)
  }
  map.set(key, {
    id: key,
    url: details.url,
    method: details.method || 'GET',
    kind: classifySniffedResource(details),
    // playlist：交给流媒体而不是直下；fragment：清单里的分片，既不能直下也不该批量勾选
    playlist: isPlaylistUrl(details.url),
    fragment: isMediaFragment(details.url),
    type: details.type || 'other',
    statusCode: details.statusCode || 0,
    time: Date.now()
  })
  scheduleSnifferPersist(details.tabId)
}

if (chrome.webRequest?.onBeforeRequest) {
  chrome.webRequest.onBeforeRequest.addListener((details) => {
    if (details.tabId >= 0) {
      snifferByTab.delete(details.tabId)
      persistSnifferTab(details.tabId)
    }
  }, { urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] })
}
if (chrome.webRequest?.onCompleted) {
  chrome.webRequest.onCompleted.addListener(rememberSniffedRequest, { urls: ['http://*/*', 'https://*/*'], types: SNIFFER_TYPES })
}
if (chrome.tabs?.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    snifferByTab.delete(tabId)
    snifferHydratedTabs.delete(tabId)
    const timer = snifferPersistTimers.get(tabId)
    if (timer) { clearTimeout(timer); snifferPersistTimers.delete(tabId) }
    persistSnifferTab(tabId)
  })
}
if (chrome.webRequest?.onErrorOccurred) {
  chrome.webRequest.onErrorOccurred.addListener(rememberSniffedRequest, { urls: ['http://*/*', 'https://*/*'], types: SNIFFER_TYPES })
}

async function getSnifferData() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) return { success: false, error: i18n('mediaUnsupportedPage') }
    await hydrateSnifferTab(tab.id)
    const map = snifferByTab.get(tab.id)
    const all = map ? [...map.values()].reverse() : []
    // D-07：分片（.ts/.m4s）不进列表——HLS 一次播放有几百个，列出来会把整页刷满，
    // 勾选后下到的也只是无法播放的碎片。只把数量带出去，弹窗据此提示"用智能解析"。
    const items = all.filter(item => !item.fragment)
    return {
      success: true,
      tabId: tab.id,
      items,
      totalCount: all.length,
      fragmentCount: all.length - items.length,
      playlistCount: items.filter(item => item.playlist).length
    }
  } catch (error) {
    return { success: false, error: String(error instanceof Error ? error.message : error) }
  }
}

// Send download to Aria2
async function sendToAria2(url, options = {}, fileNameHint = '', pageUrl = '', extraHeaders = []) {
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
    // 弹窗「请求选项」里用户显式填写的头（如自定义 User-Agent）；Referer 走 pageUrl，避免重复
    if (Array.isArray(extraHeaders)) {
      for (const header of extraHeaders) {
        if (typeof header === 'string' && header.trim()) headers.push(header.trim())
      }
    }

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
  const credential = getAppCredential(config)
  if (!credential) return { handled: false }
  try {
    const response = await fetch(`${APP_API_BASE}/api/status`, {
      headers: buildAppApiHeaders(credential),
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
 * 通知 App 撤销本次配对的凭据（D-06：配对可撤销）。
 *
 * 只在扩展侧点「解除配对」时调用：本地清 token 与让 App 删掉服务端记录必须成对发生，
 * 否则 App 里会残留一条再也用不上的授权（设置页的"已配对扩展"列表会一直显示它）。
 *
 * 失败不阻塞本地解除：App 没运行 / 已是旧版本时，本地照样清干净，
 * 调用方只需要把结果当作"服务端是否同步成功"的提示。
 *
 * @returns {Promise<{success:boolean, revoked?:boolean, code?:string, error?:string}>}
 */
async function unpairViaApp() {
  const config = await getConfig()
  const credential = getAppCredential(config)
  if (!credential) return { success: false, code: 'not_paired' }
  try {
    const response = await fetch(`${APP_API_BASE}/api/unpair`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildAppApiHeaders(credential)
      },
      body: '{}',
      signal: AbortSignal.timeout(5000)
    })
    const data = await response.json().catch(() => null)
    if (!response.ok || !data) return { success: false, code: 'app_unavailable' }
    if (data.ok !== true) return { success: false, code: data.code || 'failed', error: apiErrorMessage(data) }
    return { success: true, revoked: data.revoked === true }
  } catch {
    return { success: false, code: 'app_unavailable' }
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
  const credential = getAppCredential(config)
  if (!credential) {
    return { success: false, code: 'not_paired', error: i18n('streamPageNeedPair') }
  }

  try {
    const response = await fetch(`${APP_API_BASE}/api/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...buildAppApiHeaders(credential) },
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
 * 把嗅探到的播放列表（.m3u8/.mpd）交给 App 的流媒体模式（D-07）。
 *
 * 为什么不直接下：清单本身只有几 KB，里面指向几十上百个分片，
 * 单下清单播放不了、单下分片也拼不成完整视频。yt-dlp 会自己解析清单、
 * 拉齐 init 段与全部分片并合并，这是唯一能得到可播放文件的路径。
 *
 * 与 streamPageVideo 的区别只是"交给 App 的东西不同"（播放列表 URL 而非页面 URL），
 * 走的仍是同一个 /api/stream 端点，错误码翻译也一致。
 */
async function streamPlaylistUrl(url, title) {
  if (!/^https?:\/\//i.test(url || '')) {
    return { success: false, code: 'invalid_url', error: i18n('streamPageUnsupported') }
  }
  const config = await getConfig()
  const credential = getAppCredential(config)
  if (!credential) {
    return { success: false, code: 'not_paired', error: i18n('streamPageNeedPair') }
  }

  try {
    const response = await fetch(`${APP_API_BASE}/api/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...buildAppApiHeaders(credential) },
      // title 用清单文件名：App 侧据此给输出文件取名，避免一堆 untitled
      body: JSON.stringify({ url, title: title || '' }),
      // 播放列表可能很长（直播回放/DASH 清单），给 yt-dlp 留足解析时间
      signal: AbortSignal.timeout(35000)
    })
    const data = await response.json().catch(() => null)
    if (response.ok && data?.ok) return { success: true }
    if (data?.code === 'ytdlp_missing') return { success: false, code: 'ytdlp_missing', error: i18n('streamPageYtdlpMissing') }
    if (data?.code === 'ffmpeg_missing') return { success: false, code: 'streamPageFfmpegMissing' }
    if (data?.code === 'invalid_url') return { success: false, code: 'invalid_url', error: i18n('streamPageUnsupported') }
    return { success: false, code: 'failed', error: i18n('streamPageFailed', [data?.error || String(response.status)]) }
  } catch {
    return { success: false, code: 'unreachable', error: i18n('streamPageUnreachable') }
  }
}

/**
 * 批量把播放列表交给流媒体模式（D-07）。
 * 并发 2：每条都要 App 侧起一个 yt-dlp 解析进程，同时开太多会互相抢带宽/CPU。
 */
async function streamPlaylists(urls) {
  const list = (Array.isArray(urls) ? urls : []).filter(url => typeof url === 'string' && url)
  let sent = 0
  const errors = []
  let cursor = 0
  const worker = async () => {
    while (cursor < list.length) {
      const url = list[cursor++]
      try {
        const result = await withTimeout(streamPlaylistUrl(url, ''), 40000)
        if (result && result.success) sent++
        else errors.push((result && result.error) || url)
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error))
      }
    }
  }
  const workers = []
  for (let i = 0; i < Math.min(2, list.length); i++) workers.push(worker())
  await Promise.all(workers)
  return { sent, failed: list.length - sent, errors }
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

// ── 批量发送（D-08）─────────────────────────────────────
// 旧实现是串行 for 循环：200 条链接每条都要等一次 App 建任务（含文件名探测），
// 实测最坏情况下要几分钟，期间弹窗只能显示"发送中"，用户既看不到进度也关不掉。
// 现在改为小并发 + 逐条回报 + 队列持久化：
// - 并发 4：App 侧每条都要打一次 aria2 RPC 与磁盘探测，再高会把本机引擎压出超时；
// - 单条 5s 超时：慢链接不再拖住整批，超时项单独标记，用户可重试；
// - 进度写 storage.session 并广播给弹窗：弹窗关掉再打开仍能看到真实进度；
// - SW 被回收后按 storage.session 里的队列续传（未完成项继续跑）。
const BATCH_CONCURRENCY = 4
const BATCH_ITEM_TIMEOUT_MS = 5000
const BATCH_QUEUE_KEY = 'batchQueue'
const BATCH_MAX_ITEMS = 200
let batchRunning = false
let batchCounter = 0
/** 正在跑的批次（并发触发时新链接并入它，而不是静默丢弃或并行抢本机引擎） */
let activeBatch = null

/** 给单条发送加超时：超时即判失败（结果未知，提示用户到列表确认），不阻塞整批 */
function withTimeout(promise, ms) {
  let timer
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(i18n('errTimeout'))), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/** 队列快照写入 storage.session（SW 重启后仍可续传；浏览器重启即清空，符合"临时队列"语义） */
function persistBatchState(state) {
  if (!chrome.storage?.session) return
  try {
    chrome.storage.session.set({ [BATCH_QUEUE_KEY]: state })
  } catch { /* 存储不可用时仅保留内存状态 */ }
}

/** 把进度广播给弹窗；弹窗没开时 sendMessage 会 reject，静默忽略 */
function broadcastBatchProgress(state) {
  try {
    chrome.runtime.sendMessage({ action: 'batchProgress', batch: state }).catch(() => {})
  } catch { /* 无接收方 */ }
}

function summarizeBatch(state) {
  const sent = state.items.filter(item => item.status === 'done').length
  const failed = state.items.filter(item => item.status === 'failed').length
  return {
    id: state.id,
    total: state.items.length,
    sent,
    failed,
    settled: sent + failed,
    running: batchRunning,
    errors: state.items.filter(item => item.status === 'failed').map(item => item.error || item.url).slice(0, 20),
    failedUrls: state.items.filter(item => item.status === 'failed').map(item => item.url)
  }
}

/**
 * 按并发上限跑完队列里所有 pending 项。
 * 用共享游标而不是分片：先完成的 worker 立刻取下一项，慢项不会让其它 worker 空转。
 */
async function runBatch(state) {
  // 已有批次在跑：把新链接追加进同一批（worker 的 while 条件读的是 items.length，
  // 追加后会被自动取走）。不并行开第二批——本机引擎扛不住两份 4 并发，
  // 也不该让弹窗同时显示两个进度条。
  if (batchRunning && activeBatch) {
    const existing = new Set(activeBatch.items.map(item => item.url))
    for (const item of state.items) {
      if (existing.has(item.url)) continue
      activeBatch.items.push(item)
      existing.add(item.url)
      if (activeBatch.items.length >= BATCH_MAX_ITEMS) break
    }
    persistBatchState(activeBatch)
    broadcastBatchProgress(summarizeBatch(activeBatch))
    return summarizeBatch(activeBatch)
  }
  batchRunning = true
  activeBatch = state
  persistBatchState(state)
  broadcastBatchProgress(summarizeBatch(state))

  let cursor = 0
  const worker = async () => {
    while (cursor < state.items.length) {
      const item = state.items[cursor++]
      if (!item || item.status !== 'pending') continue
      item.status = 'sending'
      try {
        const result = await withTimeout(sendToAria2(item.url, {}, '', state.pageUrl), BATCH_ITEM_TIMEOUT_MS)
        if (result && result.success) {
          item.status = 'done'
          delete item.error
        } else {
          item.status = 'failed'
          item.error = (result && result.error) || i18n('errUnknown')
        }
      } catch (error) {
        item.status = 'failed'
        item.error = error instanceof Error ? error.message : String(error)
      }
      persistBatchState(state)
      broadcastBatchProgress(summarizeBatch(state))
    }
  }

  const workers = []
  const width = Math.min(BATCH_CONCURRENCY, state.items.length)
  for (let i = 0; i < width; i++) workers.push(worker())
  try {
    await Promise.all(workers)
  } finally {
    batchRunning = false
    activeBatch = null
    persistBatchState(state)
    broadcastBatchProgress(summarizeBatch(state))
  }
  return summarizeBatch(state)
}

/**
 * 批量发送抓取到的链接（分类/重名/选项与单条发送一致）。
 * @returns 摘要 { id, total, sent, failed, errors } 供弹窗展示
 */
async function sendGrabbedLinks(links, pageUrl = '') {
  const items = []
  const seen = new Set()
  for (const item of Array.isArray(links) ? links : []) {
    const url = typeof item === 'string' ? item : item?.url
    if (!url || seen.has(url)) continue
    seen.add(url)
    items.push({ url, status: 'pending' })
    if (items.length >= BATCH_MAX_ITEMS) break
  }
  if (items.length === 0) return { id: '', total: 0, sent: 0, failed: 0, errors: [] }

  batchCounter += 1
  const state = { id: 'batch-' + Date.now() + '-' + batchCounter, pageUrl, createdAt: Date.now(), items }
  return runBatch(state)
}

/** 读取当前（或最近一次）批次状态，供弹窗打开时恢复进度显示 */
async function getBatchState() {
  if (!chrome.storage?.session) return { success: true, batch: null }
  try {
    const stored = await chrome.storage.session.get(BATCH_QUEUE_KEY)
    const state = stored?.[BATCH_QUEUE_KEY]
    if (!state || !Array.isArray(state.items)) return { success: true, batch: null }
    return { success: true, batch: summarizeBatch(state) }
  } catch {
    return { success: true, batch: null }
  }
}

/**
 * SW 冷启动时续传未完成的批次（D-08 可续传）。
 *
 * 注意 'sending' 项：SW 被回收时正在发送的那几条结果未知，一律退回 pending 重发。
 * 代价是极端情况下可能重复建任务（用户会在列表里看到两条），
 * 但比"整批静默丢失、用户以为发出去了"要好——且 App 侧重名改名会保住文件。
 */
async function resumePendingBatch() {
  if (!chrome.storage?.session || batchRunning) return
  try {
    const stored = await chrome.storage.session.get(BATCH_QUEUE_KEY)
    const state = stored?.[BATCH_QUEUE_KEY]
    if (!state || !Array.isArray(state.items)) return
    let pending = 0
    for (const item of state.items) {
      if (item.status === 'sending') { item.status = 'pending' }
      if (item.status === 'pending') pending++
    }
    if (pending === 0) return
    await runBatch(state)
  } catch { /* 续传失败不影响其它功能 */ }
}

// Context menu: Download link with Aria2
// SW 冷启动即预热配置缓存：onDeterminingFilename 可能早于任何 getConfig 调用触发，
// 没有缓存时拦截决策会跳过（漏拦）。storage 变更监听保持缓存实时。
void getConfig()
// SW 冷启动续传未完成的批量发送（D-08）：只在本文件被重新求值时执行一次
void resumePendingBatch()
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

// Firefox 兼容：downloads API 未实现 onDeterminingFilename（该事件为 Chromium 专属，
// Firefox 侧长期未实现，见 bugzilla 1245652）。在 Firefox 里 chrome.downloads 的这个属性是
// undefined，不加检测直接 addListener 会在脚本顶层抛 TypeError、炸掉整个 background
// （右键菜单、消息路由、配对全部失效）。特性检测后仅在事件存在时注册：Firefox 侧
// "拦截全部下载"功能因此不可用（没有该事件即无从拦截，也无替代 API），其余功能不受
// 影响；Chromium 行为不变。
const downloadsFilenameEvent = chrome.downloads?.onDeterminingFilename
if (downloadsFilenameEvent?.addListener) {
  downloadsFilenameEvent.addListener(onDeterminingFilename)
}

/**
 * 拦截失败后的兜底重下（D-09）：把引擎没接住的那次下载交还给浏览器，
 * 并**保留原来的文件名、来源页与请求头**。
 *
 * 旧实现只传 url：重下后的文件叫 download.bin、没有 Referer、也没有 Cookie，
 * 于是"需要登录的站点"在回落后依然 403——用户看到的是一次莫名其妙的失败，
 * 而真正的原因（兜底丢了上下文）被完全掩盖。
 *
 * @returns {Promise<boolean>} 是否成功发起浏览器下载
 */
async function retryViaBrowser(downloadItem, suggested, config) {
  const options = { url: downloadItem.url, conflictAction: 'uniquify' }
  // filename 必须是相对路径的纯文件名：downloadItem.filename 是绝对路径，直接用会被拒
  if (suggested) options.filename = suggested

  // 请求头：Referer 与（可选）Cookie 是登录站点能否成功的关键，兜底时一并带上
  const headers = []
  const referrer = downloadItem.referrer || downloadItem.finalUrl || ''
  if (/^https?:\/\//i.test(referrer)) headers.push({ name: 'Referer', value: referrer })
  if (config.allowCookies === true && chrome.cookies?.getAll) {
    try {
      const cookies = await chrome.cookies.getAll({ url: downloadItem.url })
      if (cookies && cookies.length > 0) {
        headers.push({ name: 'Cookie', value: cookies.map(c => `${c.name}=${c.value}`).join('; ') })
      }
    } catch { /* 未授予该站点权限时静默跳过 */ }
  }
  if (headers.length > 0) options.headers = headers

  return new Promise((resolve) => {
    try {
      chrome.downloads.download(options, (downloadId) => {
        // lastError 必须当场读掉，否则会在控制台报 "Unchecked runtime.lastError"
        const failed = Boolean(chrome.runtime.lastError) || downloadId === undefined
        resolve(!failed)
      })
    } catch {
      resolve(false)
    }
  })
}

/** 下载拦截监听体（注册处的 Firefox 兼容说明见上方） */
function onDeterminingFilename(downloadItem) {
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
      // 兜底重下（带 A3 护栏）：下载已被 cancel，resume 恢复不了，重新发起时
      // onDeterminingFilename 会因护栏而放行，浏览器正常下载。
      markRedownloaded(downloadItem.url)
      const restored = await retryViaBrowser(downloadItem, suggested, config)
      if (restored) {
        // 回落成功：告诉用户"没交给引擎，但浏览器这边接住了"，避免以为下载丢了
        showNotification('interceptFallbackTitle', i18n('interceptFallbackDesc'))
      } else {
        // 回落也失败：必须明确给出手动重下的地址，否则用户只剩一条被取消的记录
        showNotification('interceptFailed', i18n('interceptManualRetry', [downloadItem.url]), true)
      }
    }
  })()

  // 吞掉异步链路的意外错误（已各自处理），避免 unhandled rejection
  processing.catch(() => { /* 保留浏览器下载，静默 */ })

  // 告知 Chrome：决策异步给出（取消成功后本次下载即终止，无需 suggest）
  return true
}

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

  if (message.action === 'getTasks') {
    getTasksSnapshot().then(sendResponse)
    return true
  }

  if (message.action === 'taskAction') {
    taskAction(String(message.operation || ''), String(message.gid || ''), String(message.source || '')).then(sendResponse)
    return true
  }

  if (message.action === 'getSnifferData') {
    getSnifferData().then(sendResponse)
    return true
  }

  if (message.action === 'sendToAria2') {
    // pageUrl：弹窗把当前标签页地址带上，作为 Referer（登录站点下载成功的关键）
    // options.out：新建下载弹窗填写的文件名，作为 App 侧 fileNameHint；headers：自定义请求头
    sendToAria2(
      message.url,
      message.options || {},
      message.options?.out || '',
      message.pageUrl || '',
      message.headers || []
    ).then(sendResponse)
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
    sendGrabbedLinks(message.links || [], message.pageUrl || '').then(sendResponse)
    return true
  }

  if (message.action === 'getBatchState') {
    getBatchState().then(sendResponse)
    return true
  }

  if (message.action === 'streamPageVideo') {
    streamPageVideo(String(message.pageUrl || ''), String(message.title || '')).then(sendResponse)
    return true
  }

  if (message.action === 'streamPlaylist') {
    streamPlaylistUrl(String(message.url || ''), String(message.title || '')).then(sendResponse)
    return true
  }

  if (message.action === 'streamPlaylists') {
    streamPlaylists(message.urls || []).then(sendResponse)
    return true
  }

  if (message.action === 'startPairing') {
    startPairing().then(sendResponse)
    return true
  }

  if (message.action === 'unpairViaApp') {
    unpairViaApp().then(sendResponse)
    return true
  }
})
