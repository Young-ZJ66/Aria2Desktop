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

/**
 * 解析分类子目录。优先用 fileNameHint（如浏览器已确定的文件名，比 URL 可靠——跳转链接的 URL
 * 往往没有扩展名），其次看 URL 本身。
 * 返回 { dir, subdir }（命中）或 { skip: 原因 }（未命中，便于向用户解释为什么没分类）。
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
    // 调用方已指定目录时不做分类；否则按扩展名归类（与 App 内置默认分类一致）
    const callerSpecifiedDir = Object.keys(options).includes('dir')
    let resolved = callerSpecifiedDir
      ? { skip: 'callerSpecified' }
      : await resolveCategoryDir(url, config, fileNameHint)
    let probedName = ''

    // URL 里识别不出分类（网盘直链等：URL 没有文件名），且用户开启了探测：
    // 向文件服务器取一次真实文件名（只取响应头，不下载正文）。这一步同时修复右键下载
    // 网盘直链时文件名乱码的问题——乱码来自 aria2 对 Content-Disposition 里
    // 非 ASCII 字节的兼容缺陷，显式传 out 即可绕开。
    if (!callerSpecifiedDir && !resolved.dir && config.allowProbe && /^https?:\/\//i.test(url)) {
      probedName = await probeDownloadFileName(url)
      if (probedName) {
        resolved = await resolveCategoryDir(url, config, probedName)
      }
    }

    const finalOptions = { ...options }
    if (resolved.dir) finalOptions.dir = resolved.dir
    if (probedName && !options.out) finalOptions.out = probedName

    const gid = await rpcCall('aria2.addUri', [[url], finalOptions], config)
    return {
      success: true,
      gid,
      subdir: resolved.subdir || null,
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
    // 分类结果直接告诉用户：既是有用信息，也让"没分类"立刻可见、可排查
    showNotification('downloadSent', result.subdir ? i18n('downloadSentToSubdir', [result.subdir]) : i18n('downloadSentDesc'))
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
    showNotification('intercepted', result.subdir ? i18n('interceptedToSubdir', [result.subdir]) : i18n('interceptedDesc'))
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

  if (message.action === 'sendToAria2') {
    sendToAria2(message.url, message.options || {}).then(sendResponse)
    return true
  }
})
