/**
 * 把主进程返回的更新失败原因归类。
 *
 * 为什么要做这一层：`UpdateController.downloadUpdate()` 的 error 是给开发看的原样字符串
 * （`getaddrinfo ENOTFOUND github.com`、`Download failed: 404`、`manual_download_required`），
 * 而渲染层把它整句塞进了「更新下载失败：{error}」——用户看到的就是一段英文和状态码。
 * 归类之后，界面按类别给中文说明，原串只在真正无法归类时才展示。
 */
export type UpdateErrorKind =
  | 'network'
  | 'rateLimited'
  | 'assetMissing'
  | 'checksum'
  | 'redirect'
  | 'devMode'
  | 'manualDownload'
  | 'busy'
  | 'noUpdate'
  | 'unknown'

const NETWORK_ERRORS =
  /\b(ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ECONNABORTED|EHOSTUNREACH|ENETUNREACH|getaddrinfo|socket hang up|network is unreachable|request timed out)\b/i

/**
 * Chromium 网络栈的错误名（`net::ERR_*`）。
 *
 * 组件安装走的是 Electron 的网络栈，代理挂掉时抛的是
 * `net::ERR_PROXY_CONNECTION_FAILED` 这类名字，跟 Node 的 `E*` 错误不是一套，
 * 上面那条规则一个都匹配不到。凡是 `net::ERR_` 都是网络层失败，
 * 对用户的意义一致（连不上，检查网络或代理）。
 */
const CHROMIUM_NET_ERRORS = /net::ERR_[A-Z_]+/i

/** 归类一个更新失败原因；无法识别时返回 'unknown'（调用方再决定是否展示原串） */
export function classifyUpdateError(raw: string | undefined | null): UpdateErrorKind {
  const text = typeof raw === 'string' ? raw : ''
  if (!text.trim()) return 'unknown'

  if (/manual_download_required/i.test(text)) return 'manualDownload'
  if (/development mode/i.test(text)) return 'devMode'
  if (/already in progress/i.test(text)) return 'busy'
  if (/no update available/i.test(text)) return 'noUpdate'
  // 校验失败的提示可能是中文，也可能带 "SHA-256"/"checksum"
  if (/sha-?256|checksum|校验/i.test(text)) return 'checksum'

  // GitHub 限流：releases/latest 或安装包下载直接 403/429
  if (/:\s*(403|429)\b/.test(text)) return 'rateLimited'
  // 安装包缺失：tag 存在但那一版没传对应文件
  if (/download failed:\s*404\b/i.test(text)) return 'assetMissing'

  if (NETWORK_ERRORS.test(text) || CHROMIUM_NET_ERRORS.test(text)) return 'network'
  if (/too many redirects|no release tag found|unexpected status from releases/i.test(text)) return 'redirect'

  return 'unknown'
}

/**
 * 分类 -> 文案键（'unknown' 不在表里：那种情况保留原串）。
 *
 * 放在 shared 里而不是组件里，是为了让测试能拿它和语言包对账——这里的键是拼接使用
 * （`generalSettings.${key}`），静态扫描脚本看不见，漏一个就是界面上一条空白提示。
 */
/**
 * 同一个分类器也用来解释「下载 yt-dlp / ffmpeg 失败」：这两种失败几乎都发生在
 * 同一个 GitHub Release 下载上（网络被挡、被限流、标签里没有对应平台的包），
 * 报错串的形状完全一样。只挑对用户有意义的几类，其余保留原串。
 */
export const COMPONENT_ERROR_MESSAGE_KEYS: Partial<Record<UpdateErrorKind, string>> = {
  network: 'componentErrorNetwork',
  rateLimited: 'componentErrorRateLimited',
  assetMissing: 'componentErrorAssetMissing',
  checksum: 'componentErrorChecksum',
  redirect: 'componentErrorRedirect'
}

export const UPDATE_ERROR_MESSAGE_KEYS: Record<Exclude<UpdateErrorKind, 'unknown'>, string> = {
  network: 'updateErrorNetwork',
  rateLimited: 'updateErrorRateLimited',
  assetMissing: 'updateErrorAssetMissing',
  checksum: 'updateErrorChecksum',
  redirect: 'updateErrorRedirect',
  devMode: 'updateErrorDevMode',
  manualDownload: 'updateErrorManualDownload',
  busy: 'updateErrorBusy',
  noUpdate: 'updateErrorNoUpdate'
}
