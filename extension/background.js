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
  /** 允许向文件服务器探测真实文件名（需已授予全站访问权限，见弹窗开关） */
  allowProbe: false
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

/** 清理文件名：去掉路径分隔符/引号/控制符与首尾空白 */
function sanitizeFileName(name) {
  return name.replace(/[/\\]/g, '').replace(/["'\r\n]/g, '').trim()
}

/**
 * 解析 Content-Disposition 头里的 filename。
 * 兼容 RFC 5987（filename*=UTF-8''...）、带引号、无引号、百分号编码，
 * 以及「服务器直接发原始 UTF-8 字节、被按 latin1 误读成乱码」的情况（无损修复）。
 */
function parseContentDisposition(header) {
  if (!header) return ''
  const star = /filename\*\s*=\s*([^']*)'[^']*'([^;\s]+)/i.exec(header)
  if (star && star[2]) {
    try {
      return sanitizeFileName(decodeURIComponent(star[2]))
    } catch { /* 解码失败继续尝试普通形态 */ }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header)
  if (plain && plain[1]) {
    let value = plain[1].trim()
    if (value.includes('%')) {
      try {
        value = decodeURIComponent(value)
      } catch { /* 保持原样 */ }
    }
    const repaired = Buffer.from(value, 'latin1').toString('utf8')
    if (!repaired.includes('\uFFFD')) value = repaired
    return sanitizeFileName(value)
  }
  return ''
}

/**
 * 向文件服务器探测真实文件名：GET + Range: bytes=0-0，响应头一到手立刻断开（不下载正文）。
 * 任何失败（超时/非 2xx/无文件名头）都返回空串，调用方降级处理，绝不阻塞任务创建。
 */
async function probeDownloadFileName(url, timeoutMs = 6000) {
  if (!/^https?:\/\//i.test(url)) return ''
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-0', 'User-Agent': 'aria2/1.37.0' },
      redirect: 'follow',
      signal: controller.signal
    })
    response.body?.cancel().catch(() => {})
    if (!response.ok) return ''
    return parseContentDisposition(response.headers.get('content-disposition') ?? '')
  } catch {
    return ''
  } finally {
    clearTimeout(timer)
  }
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

/** 本机 App 本地接口地址：端口与 electron/utils/extensionApiCore.ts 的 EXTENSION_API_PORT 一致 */
const APP_API_BASE = 'http://127.0.0.1:6801'
/** 建任务请求超时：App 侧可能要做一次文件名探测（只取响应头）+ 一次本机 RPC，留足余量 */
const APP_ADD_TIMEOUT_MS = 20000

/** App 本地接口统一鉴权头（Bearer 方案，与 App 侧 isAuthorizedExtensionRequest 对应） */
function buildAppApiHeaders(secret) {
  return { Authorization: 'Bearer ' + secret }
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
 * 让 App 直接建任务：解析目录、重名改名、选项套用（连接数/分片/是否自动开始）全部在 App 侧完成。
 * 这样扩展建的任务与 App 内新建的任务**行为一致**，扩展也不必再自己维护一份分类规则。
 *
 * @returns null 表示接口不可用（App 未运行 / 未授权 / 版本较旧）→ 调用方回落直连 aria2；
 *          返回 {success:false} 表示失败且**不应回落**（见下方超时说明）。
 */
async function addViaApp(url, config, fileNameHint = '') {
  if (!config.secret) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), APP_ADD_TIMEOUT_MS)
  try {
    const response = await fetch(`${APP_API_BASE}/api/add`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.secret}`
      },
      body: JSON.stringify(fileNameHint ? { url, fileName: fileNameHint } : { url }),
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

/** 回落路径：内置默认规则（与 App 的内置默认一致）+ 本地探测（需用户开启探测开关） */
async function resolveWithBuiltinRules(url, config, fileNameHint = '') {
  let resolved = await resolveCategoryDir(url, config, fileNameHint)
  let out = ''
  if (!resolved.dir && config.allowProbe && /^https?:\/\//i.test(url)) {
    const probedName = await probeDownloadFileName(url)
    if (probedName) {
      resolved = await resolveCategoryDir(url, config, probedName)
      out = probedName
    }
  }
  return { dir: resolved.dir || '', subdir: resolved.subdir || null, out, conflict: false }
}

/**
 * 解析目标目录与文件名。**仅用于回落路径**：App 接口不可用时的内置默认规则 + 本地探测。
 * @returns {{dir: string, subdir: string|null, out: string, conflict: boolean, source: string}}
 */
async function resolveTarget(url, config, fileNameHint = '') {
  return { ...(await resolveWithBuiltinRules(url, config, fileNameHint)), source: 'builtin' }
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
async function getConfig() {
  const result = await chrome.storage.local.get('config')
  return { ...DEFAULT_CONFIG, ...result.config }
}

// Save config to storage
async function saveConfig(config) {
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
  await chrome.storage.local.set({ lastPairing: { ...result, at: Date.now() } })
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
async function sendToAria2(url, options = {}, fileNameHint = '') {
  const config = await getConfig()
  if (!config.enabled) return { success: false, error: i18n('errDisabled') }

  try {
    const callerSpecifiedDir = Object.keys(options).includes('dir')

    // 1) 优先让 App 建任务：用户自定义分类规则生效、重名统一处理，
    //    且套用与 App 内新建一致的 aria2 选项（连接数/分片/是否自动开始）
    if (!callerSpecifiedDir) {
      const viaApp = await addViaApp(url, config, fileNameHint || options.out || '')
      if (viaApp) return viaApp
    }

    // 2) 回落：扩展直连 aria2（内置默认规则 + 本地探测），保证 App 未运行/未授权时仍可用
    const target = callerSpecifiedDir
      ? { dir: '', subdir: null, out: '', conflict: false, source: 'caller' }
      : await resolveTarget(url, config, fileNameHint)

    const finalOptions = { ...options }
    if (target.dir) finalOptions.dir = target.dir
    // out 优先级：调用方给定（如浏览器解析出的文件名）> 本地探测结果
    if (!options.out && target.out) finalOptions.out = target.out

    const gid = await rpcCall('aria2.addUri', [[url], finalOptions], config)
    return {
      success: true,
      gid,
      subdir: target.subdir,
      conflict: target.conflict,
      renamed: target.out || '',
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

// Context menu: Download link with Aria2
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

  const result = await sendToAria2(url)
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
chrome.downloads.onDeterminingFilename.addListener(async (downloadItem) => {
  const config = await getConfig()
  if (!config.enabled || !config.interceptAll) return
  if (SKIPPED_SCHEMES.some(scheme => downloadItem.url.startsWith(scheme))) return

  // 先取消浏览器下载，再交给 Aria2
  await chrome.downloads.cancel(downloadItem.id)

  // 此事件的职责就是决定文件名：downloadItem.filename 此时已由浏览器确定（含真实扩展名）。
  // 传 out 保留原始文件名；同时把它作为分类依据——跳转链接的 URL 往往没有扩展名，
  // 浏览器解析出的文件名比 URL 可靠得多。
  const options = downloadItem.filename ? { out: downloadItem.filename } : {}
  const result = await sendToAria2(downloadItem.url, options, downloadItem.filename)

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
    // 兜底：下载已被 cancel，resume 是恢复不了的，只能重新发起，
    // 否则用户会以为"下载凭空消失了"。
    try {
      await chrome.downloads.download({ url: downloadItem.url })
    } catch { /* 重新发起也失败时保持静默，用户仍可从浏览器下载记录重试 */ }
  }
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
    sendToAria2(message.url, message.options || {}).then(sendResponse)
    return true
  }

  if (message.action === 'startPairing') {
    startPairing().then(sendResponse)
    return true
  }
})
