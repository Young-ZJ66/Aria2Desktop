import * as http from 'http'
import * as path from 'path'
import { app, dialog } from 'electron'
import { createLogger } from '../utils/logger'
import { mainError } from '../utils/mainErrorCopy'
import { runtimeMainLocale } from '../utils/mainLocaleRuntime'
import { defaultExtensionName, extensionPairingCopy } from '../utils/mainProcessCopy'
import { getSettingsFresh } from '../utils/settingsAccessor'
import { activeRpcOptions } from '../utils/activeRpcConfig'
import { ExtensionTokenStore, TOKEN_FILE_NAME } from '../utils/extensionTokenStore'
import { callAria2Rpc } from '../utils/aria2Rpc'
import { checkYtdlpAvailable } from './ytdlpService'
import {
  discardStreamDownload,
  forgetStreamTask,
  listStreamTasks,
  pauseStreamDownload,
  resumeStreamDownload,
  startStreamDownload,
  type StreamDownloadEvent
} from './streamDownloadService'
import { probeDownloadFileName, resolveConflictingFileName } from '../utils/downloadNameProbe'
import {
  DEFAULT_EXTENSION_TOKEN_SCOPES,
  EXTENSION_API_HOST,
  EXTENSION_API_PORT,
  createExtensionToken,
  extensionIdFromOrigin,
  hasExtensionScope,
  isAllowedDownloadUri,
  isAuthorizedExtensionRequestWithToken,
  isExtensionOrigin,
  isPlainFileName,
  isProbeAllowed,
  normalizeExtensionVersionHeader,
  parseRequestPathname,
  sanitizeDownloadFileName,
  sanitizeExtensionName,
  sanitizeRequestHeaders,
  type ExtensionPairingInfo,
  type ExtensionRequestAuth,
  type ExtensionTokenRecord,
  type ExtensionTokenScope,
  type SanitizedRequestHeaders
} from '../utils/extensionApiCore'
import {
  MCP_CONFIRM_REQUIRED_TOOLS,
  MCP_ERROR_CODES,
  MCP_TOOL_SCOPES,
  buildInitializeResult,
  buildPromptsListResult,
  buildResourcesListResult,
  buildToolErrorResult,
  buildToolTextResult,
  buildToolsListResult,
  isNotification,
  mcpError,
  mcpResult,
  optConfirm,
  optNumber,
  optString,
  parseToolCallParams,
  pickTaskName
} from '../utils/mcpCore'
// 主进程产物是 CJS，运行时无法解析 @/ 别名，必须用相对路径引入 src/shared
import {
  CATEGORY_GENERAL,
  getCategoryTargetDirname,
  getFileExtension,
  getFileNameHintFromUri,
  resolveBaseDownloadDir,
  resolveCategory,
  resolveTargetDir
} from '../../src/shared/fileCategories'
import {
  EMPTY_EXTENSION_CONNECTION,
  normalizeExtensionVersion,
  type ExtensionConnection
} from '../../src/shared/extensionVersion'

/**
 * 浏览器扩展本地接口（打通方案 A 第 1 期）。
 *
 * 目的：让扩展不必自己"猜"——分类规则、文件名探测、重名处理等以后都由 App 决策，
 * 扩展只负责把链接交出去。本服务是这套协作的地基，先把「状态查询」跑通。
 *
 * 安全边界（四条缺一不可）：
 * - 只监听 127.0.0.1，不暴露到局域网；
 * - 必须带正确的 RPC 密钥（settings.aria2.secret），未配置密钥时接口整体不开；
 * - 拒绝 http(s) 网页来源（详见 utils/extensionApiCore 的判定注释）；
 * - 响应不带任何 CORS 头：网页即使知道地址也读不到内容。
 *
 * 另有一条**输入侧**约束：接口只收 url / fileName，且 fileName 会被净化到纯文件名
 * （`sanitizeDownloadFileName`）后才作为 aria2 的 `out` 下发——`out` 与 `dir` 同属
 * 注入面，未净化时 `../` 可让文件落到下载目录之外（已实测）。
 *
 * 可用性边界：接口只是增强能力，**启动失败（端口占用等）只记日志不影响应用其它功能**，
 * 扩展侧会自动回落到内置规则 + 直连 aria2。
 */

/** 提供给接口的数据源（由 main.ts 注入，避免服务反向依赖控制器，便于将来复用/测试） */
export interface ExtensionApiDeps {
  /** 应用版本（package.json 的 version） */
  getAppVersion: () => string
  /** 引擎进程状态 */
  getEngineProcessInfo: () => { isRunning: boolean; pid?: number }
  /**
   * 配对确认：弹出原生对话框让用户决定是否放行（/api/pair 的最后一道闸门）。
   * 刻意不接收来源侧数据（如扩展 ID）：弹窗文案是固定提示语，
   * 请求侧的任何字符串都不会进入对话框文本。返回 true 表示用户点击了"允许"。
   */
  confirmPairing: () => Promise<boolean>
  /**
   * 带信息的配对确认（D-06）。注入后优先于 confirmPairing：
   * 对话框里展示**净化过**的扩展名称 / ID / 来源，用户据此判断是不是自己装的那个扩展。
   * 未注入时服务自己用 electron dialog 展示（见 showPairingDialog）。
   */
  confirmPairingWithInfo?: (info: ExtensionPairingInfo) => Promise<boolean>
  /**
   * 把流媒体下载事件转发给主窗口。
   * 扩展发起的下载没有走渲染层的「流媒体页」，需要渲染层靠这些事件建立任务列表记录。
   */
  sendStreamEvent: (event: StreamDownloadEvent) => void
  /**
   * 用户级开关（设置页「扩展服务」）。未注入时视为启用；返回 false 时 apply() 会停止监听。
   * 真正的接线在 main.ts（由 root 统一接入），本服务只消费判定结果。
   */
  getServiceEnabled?: () => boolean
}

/** 引擎版本查询超时：接口要快速返回，拿不到版本不影响其它字段 */
const ENGINE_RPC_TIMEOUT_MS = 3000
/** 代建任务的 RPC 超时：本机调用，给足余量即可；必须明显小于扩展侧 20s 的请求超时，
 *  否则扩展先超时、而 App 其实已建好任务，容易让人误以为失败 */
const ADD_RPC_TIMEOUT_MS = 5000



/** 解析结果：目标目录、最终文件名、分类与重名信息 */
interface ResolvedTarget {
  url: string
  fileName: string
  dir: string
  subdir: string | null
  category: string
  conflict: boolean
  /** 重名时给出的带序号新名字（无冲突为空串） */
  out: string
}

export class ExtensionApiServer {
  private server: http.Server | null = null
  private readonly logger = createLogger('ExtensionApi')
  /**
   * 最近一次成功鉴权的扩展调用。只存在内存里：应用重启后重新采集即可——
   * 扩展每次调用都带版本头，用户一操作就能补上，没必要落盘。
   */
  private extensionConnection: ExtensionConnection = { ...EMPTY_EXTENSION_CONNECTION }
  /** 上一次记过日志的版本，避免扩展频繁调用时同一行日志刷屏 */
  private loggedExtensionVersion: string | null = null
  /** 最近一次 start() 指定的端口，供 apply() 在条件变化后重新监听 */
  private requestedPort: number = EXTENSION_API_PORT
  /** 实际监听状态：监听是异步的，只有 listen 回调里才置 true */
  private listening = false
  /** token 存储（懒初始化：app.getPath 在 app ready 前不可用） */
  private tokenStore: ExtensionTokenStore | null = null

  constructor(private readonly deps: ExtensionApiDeps) {}

  /**
   * 已签发的扩展 token（只读副本，给设置页展示"已配对扩展"用）。
   * 刻意**不**返回 token 原文以外的东西做隐藏：设置页要能按扩展撤销，就必须能区分是哪一个。
   */
  listPairedExtensions(): Array<Omit<ExtensionTokenRecord, 'token'> & { tokenPreview: string }> {
    return this.store().list().map((record) => ({
      scopes: record.scopes,
      extensionId: record.extensionId,
      extensionName: record.extensionName,
      origin: record.origin,
      createdAt: record.createdAt,
      lastSeenAt: record.lastSeenAt,
      // 只给前 8 位：足够让用户分辨，又不足以在截图/日志里泄露完整凭据
      tokenPreview: record.token.slice(0, 8)
    }))
  }

  /** 撤销某个扩展的全部配对凭据（设置页"撤销"按钮），返回撤销条数 */
  revokeExtension(extensionId: string): number {
    const removed = this.store().revokeExtension(extensionId)
    if (removed > 0) this.logger.info(`已撤销扩展 ${extensionId} 的配对凭据（${removed} 条）`)
    this.apply()
    return removed
  }

  /** 撤销单枚 token（按值），返回是否撤销成功 */
  revokeToken(token: string): boolean {
    const removed = this.store().revoke(token)
    if (removed) this.apply()
    return removed
  }

  private store(): ExtensionTokenStore {
    if (this.tokenStore) return this.tokenStore
    let filePath = ''
    try {
      filePath = path.join(app.getPath('userData'), TOKEN_FILE_NAME)
    } catch (error) {
      // app 尚未 ready 或环境异常：退化成纯内存存储，本次会话内仍可配对
      this.logger.warn('无法定位 userData 目录，扩展配对记录仅保存在内存:', error)
    }
    this.tokenStore = new ExtensionTokenStore(filePath, this.logger)
    return this.tokenStore
  }

  /**
   * 当前是否具备监听条件（D-06）：
   * - 用户在设置页关掉了扩展服务 → 不监听；
   * - 既没有 RPC 密钥、也没有任何已签发 token → 无法鉴权，不监听
   *   （旧实现会照常监听然后对每个请求回 401，等于凭空多开一个可探测端口）。
   */
  private shouldListen(): boolean {
    if (this.deps.getServiceEnabled && !this.deps.getServiceEnabled()) return false
    if (getSettingsFresh()?.aria2?.secret) return true
    return this.store().list().length > 0
  }

  /** 接口是否正在监听（设置页据此显示"扩展服务已开启/关闭"） */
  isListening(): boolean {
    return this.server !== null && this.listening
  }

  /**
   * 按当前条件同步监听状态：条件满足且未监听则开始监听，否则停止。
   * 幂等，可在设置变更（密钥/开关）后随时调用。
   */
  apply(): void {
    if (this.shouldListen()) {
      if (!this.server) this.listen(this.requestedPort)
      return
    }
    if (this.server) {
      this.logger.info('扩展服务已停用（未启用或无可用凭据），停止监听本地接口')
      this.stop()
    }
  }

  /** 最近一次扩展连接（设置页据此提示"该更新扩展了"；返回副本，调用方改不动内部状态） */
  getExtensionConnection(): ExtensionConnection {
    return { ...this.extensionConnection }
  }

  /**
   * 记录扩展版本。
   *
   * 放在鉴权之后、任何已授权调用都能记：用户可能只点一次下载、从不打开扩展弹窗，
   * 若只在 /api/status 上记录，这类用户永远显示"未检测到扩展"。
   * 版本号来自扩展（外部输入），先过 normalizeExtensionVersion；
   * 旧版扩展不带该头，此时保留上次已知版本，只刷新时间。
   */
  private recordExtensionConnection(req: http.IncomingMessage): void {
    const header = req.headers['x-extension-version']
    const version = normalizeExtensionVersion(Array.isArray(header) ? header[0] : header)
    this.extensionConnection = {
      version: version ?? this.extensionConnection.version,
      lastSeenAt: Date.now()
    }
    if (version && version !== this.loggedExtensionVersion) {
      this.loggedExtensionVersion = version
      this.logger.info(`扩展已连接（扩展 v${version}，App v${this.deps.getAppVersion()}）`)
    }
  }

  /**
   * 启动接口；重复调用无副作用。
   *
   * 注意这里**不一定**会真的监听：监听与否交给 apply() 按当前条件判断
   * （D-06：用户关掉扩展服务、或既无 RPC 密钥也无已配对 token 时不应占端口）。
   */
  start(port: number = EXTENSION_API_PORT): void {
    this.requestedPort = port
    this.apply()
  }

  /** 真正开始监听（只在 apply() 判定条件满足时调用） */
  private listen(port: number): void {
    if (this.server) return

    const server = http.createServer((req, res) => {
      // 必须自己吞掉 handler 的所有异常：这里若让异常逃成「未处理的 Promise 拒绝」，
      // 主进程会按 Node 默认策略（--unhandled-rejections=throw）直接退出。
      // 触发门槛极低——请求目标写成 `http://[` / `//[` 时 new URL 就会抛错，
      // 而解析发生在鉴权之前，畸形请求**不需要密钥**即可打崩整个应用。
      // 因此失败一律就地转成 500，绝不外泄（其余功能也不受本次请求影响）。
      this.handleRequest(req, res).catch((error: unknown) => {
        this.logger.error('接口请求处理异常:', error)
        if (res.headersSent) {
          res.end()
          return
        }
        try {
          this.send(res, 500, { ok: false, code: 'internal', error: 'Internal Error' })
        } catch {
          res.destroy()
        }
      })
    })

    // 请求行本身畸形（llhttp 解析失败）：直接断开，不进入业务逻辑
    server.on('clientError', (_error, socket) => {
      socket.destroy()
    })

    server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        this.logger.warn(`端口 ${port} 已被占用，浏览器扩展本地接口未启动（扩展将回落到内置规则）`)
      } else {
        this.logger.warn('浏览器扩展本地接口启动失败:', error)
      }
      this.server = null
      this.listening = false
    })

    server.listen(port, EXTENSION_API_HOST, () => {
      this.listening = true
      this.logger.info(`浏览器扩展本地接口已启动: http://${EXTENSION_API_HOST}:${port}`)
    })
    // 不阻止进程退出：接口不在应用的关键路径上
    server.unref()
    this.server = server
  }

  stop(): void {
    this.listening = false
    if (!this.server) return
    this.server.close()
    this.server = null
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // 请求目标不可解析时（绝对形式的 `http://[`、协议相对的 `//[` 等）直接 400：
    // 判定本体在 extensionApiCore.parseRequestPathname（纯函数、有回归用例），
    // 因为本函数位于任何鉴权之前，异常一旦逃出去就是主进程级故障（见 start() 的兜底说明）。
    const pathname = parseRequestPathname(req.url)
    if (pathname === null) {
      this.logger.warn('拒绝无法解析的请求目标')
      this.send(res, 400, { ok: false, code: 'bad_request', error: 'Bad Request' })
      return
    }

    // /api/pair 是唯一免密端点：必须在鉴权闸门**之前**处理，
    // 来源校验从严（仅扩展源）+ 用户确认兜底，见 handlePairing 的注释
    if (pathname === '/api/pair') {
      await this.handlePairing(req, res)
      return
    }

    // 密钥每次都直读（settings 的 secret 变化后必须立即生效，不能吃到缓存值）。
    // 扩展与内置引擎的直连回退共用这个密钥，因此保持本机引擎语义，不跟随远程预设。
    const secret = getSettingsFresh()?.aria2?.secret ?? ''
    // 两条凭据路径（D-06）：配对签发的受限 token（带 scope）优先，其次是用户手填的 RPC 密钥。
    // 后者是 1.4 及更早版本的手动配置方式，必须继续可用，否则老用户升级后扩展直接断连。
    const auth = isAuthorizedExtensionRequestWithToken({
      authorization: req.headers.authorization,
      origin: req.headers.origin,
      secret,
      tokens: this.store().list()
    })
    if (!auth.ok) {
      // 不区分"密钥错误"与"来源非法"，避免给探测者额外信息
      this.logger.warn(`拒绝未授权的接口调用（来源 ${req.headers.origin ?? '无'}）`)
      this.send(res, 401, { ok: false, code: 'unauthorized', error: 'Unauthorized' })
      return
    }
    if (auth.via === 'token' && auth.record) {
      // 记一次活跃时间（内部 60s 节流），设置页据此显示"最近使用"
      this.store().touch(auth.record.token)
    }

    // 鉴权通过才记版本：未经授权的请求不该影响"扩展已连接"的显示
    this.recordExtensionConnection(req)

    if (req.method !== 'GET' && req.method !== 'POST') {
      this.send(res, 405, { ok: false, code: 'method_not_allowed', error: 'Method Not Allowed' })
      return
    }

    if (pathname === '/api/status') {
      if (req.method !== 'GET') {
        this.send(res, 405, { ok: false, code: 'method_not_allowed', error: 'Method Not Allowed' })
        return
      }
      this.send(res, 200, await this.buildStatus())
      return
    }

    /**
     * GET /api/tasks：aria2 任务快照（受 tasks:read scope 保护）。
     *
     * 为什么加：1.4 里扩展要展示任务列表，只能拿 App 的 RPC 密钥直连 6800——
     * 这等于把"能删任意文件/改任意配置"的完整引擎凭据交给扩展。
     * 拆出只读端点后，配对得到的 token 只够读列表，拿不到引擎本身。
     */
    if (pathname === '/api/tasks') {
      if (req.method !== 'GET') {
        this.send(res, 405, { ok: false, code: 'method_not_allowed', error: 'Method Not Allowed' })
        return
      }
      if (!this.requireScope(auth, res, 'tasks:read')) return
      this.send(res, 200, await this.buildTasksSnapshot())
      return
    }

    /**
     * POST /api/task：对 aria2 任务执行 pause / resume / remove（受 tasks:control scope 保护）。
     * remove 语义与 aria2 一致：从队列移除，**不删**已下载文件。
     */
    if (pathname === '/api/task') {
      if (req.method !== 'POST') {
        this.send(res, 405, { ok: false, code: 'method_not_allowed', error: 'Method Not Allowed' })
        return
      }
      if (!this.requireScope(auth, res, 'tasks:control')) return
      let payload: unknown
      try {
        payload = await readJsonBody(req)
      } catch (error) {
        this.send(res, 400, { ok: false, code: 'bad_request', error: error instanceof Error ? error.message : 'Bad Request' })
        return
      }
      const action = (payload as { action?: unknown })?.action
      const gid = (payload as { gid?: unknown })?.gid
      if (typeof gid !== 'string' || !gid) {
        this.send(res, 400, { ok: false, code: 'invalid_gid', error: 'Invalid task gid' })
        return
      }
      if (action !== 'pause' && action !== 'resume' && action !== 'remove') {
        this.send(res, 400, { ok: false, code: 'invalid_action', error: 'Unsupported action' })
        return
      }
      this.send(res, 200, await this.applyTaskAction(action, gid))
      return
    }

    /**
     * POST /api/unpair：扩展主动交还自己的凭据（弹窗「解除配对」走这里）。
     *
     * 为什么需要：token 存在扩展的 storage 里，用户在本机应用里点「撤销」能清掉服务端记录，
     * 但扩展侧仍会拿着一枚死 token 反复 401；反过来用户在扩展里点「解除配对」时，
     * 服务端记录也必须一起删掉，否则"已配对"的授权会一直留在磁盘上。
     * 只允许撤销**本次请求所用的那枚 token**，密钥路径不能借这个端点删别人的授权。
     */
    if (pathname === '/api/unpair') {
      if (req.method !== 'POST') {
        this.send(res, 405, { ok: false, code: 'method_not_allowed', error: 'Method Not Allowed' })
        return
      }
      const record = auth.record
      if (auth.via !== 'token' || !record) {
        // 用密钥来的调用没有"自己的 token"可撤，明确告知而不是假装成功
        this.send(res, 200, { ok: true, revoked: false, code: 'not_a_token' })
        return
      }
      const revoked = this.store().revoke(record.token)
      this.logger.info(`扩展主动解除配对（${record.extensionName || record.extensionId || 'unknown'}）`)
      this.apply()
      this.send(res, 200, { ok: true, revoked })
      return
    }

    if (pathname === '/api/resolve') {
      if (req.method !== 'POST') {
        this.send(res, 405, { ok: false, code: 'method_not_allowed', error: 'Method Not Allowed' })
        return
      }
      if (!this.requireScope(auth, res, 'download:add')) return
      const body = await this.readBodyOrReject(req, res)
      if (!body) return
      if (!isAllowedDownloadUri(body.url)) {
        this.send(res, 400, { ok: false, code: 'invalid_url', error: 'Unsupported url' })
        return
      }
      this.send(res, 200, { ok: true, resolved: await this.resolveForUrl(body.url, body.fileName) })
      return
    }

    if (pathname === '/api/add') {
      if (req.method !== 'POST') {
        this.send(res, 405, { ok: false, code: 'method_not_allowed', error: 'Method Not Allowed' })
        return
      }
      if (!this.requireScope(auth, res, 'download:add')) return
      const body = await this.readBodyOrReject(req, res)
      if (!body) return
      const { status, payload } = await this.buildAdd(body.url, body.fileName, body.headers)
      this.send(res, status, payload)
      return
    }

    /**
     * POST /api/stream：把**整页链接**交给 App 的 yt-dlp 下载模式。
     * 用于 B 站这类音视频分离、直链带签名校验的站点（扩展自己拿不到可用的媒体地址）。
     * 需要 App 已安装 yt-dlp 与 ffmpeg，错误码由扩展负责翻译成人话。
     */
    if (pathname === '/api/stream') {
      if (req.method !== 'POST') {
        this.send(res, 405, { ok: false, code: 'method_not_allowed', error: 'Method Not Allowed' })
        return
      }
      if (!this.requireScope(auth, res, 'stream:control')) return
      const body = await this.readBodyOrReject(req, res)
      if (!body) return
      if (!isAllowedDownloadUri(body.url)) {
        this.send(res, 400, { ok: false, code: 'invalid_url', error: 'Unsupported url' })
        return
      }

      const ytdlp = await checkYtdlpAvailable()
      if (!ytdlp.available) {
        this.send(res, 200, { ok: false, code: 'ytdlp_missing', error: 'yt-dlp is not installed in the app' })
        return
      }

      const settings = getSettingsFresh()
      // 与普通下载一致：优先用户配置目录，未配置时落到系统下载目录
      const outputDir = resolveBaseDownloadDir(settings ?? undefined) || app.getPath('downloads')
      const started = await startStreamDownload(
        {
          url: body.url,
          title: typeof body.title === 'string' ? body.title.slice(0, 200) : undefined,
          outputDir
        },
        (event) => this.deps.sendStreamEvent(event)
      )
      this.send(res, 200, started.success
        ? { ok: true, id: started.id }
        : { ok: false, code: started.code ?? 'failed', error: started.error ?? 'Failed' })
      return
    }

    /**
     * GET /api/stream-tasks：流媒体（yt-dlp）任务列表。
     *
     * 为什么需要它：yt-dlp 下载**不进 aria2 队列**，扩展的下载列表原本只拉 aria2 RPC 快照，
     * 于是「智能解析本页视频」发起的下载在扩展里完全看不到。这里把 App 侧的任务快照交给扩展，
     * 由扩展与 aria2 任务合并展示（扩展侧按 source 字段区分动作该发给谁）。
     */
    if (pathname === '/api/stream-tasks') {
      if (req.method !== 'GET') {
        this.send(res, 405, { ok: false, code: 'method_not_allowed', error: 'Method Not Allowed' })
        return
      }
      if (!this.requireScope(auth, res, 'stream:control')) return
      this.send(res, 200, { ok: true, tasks: listStreamTasks() })
      return
    }

    /**
     * POST /api/stream-task：对流媒体任务执行 pause / resume / remove。
     *
     * 与 /api/stream 一样按任务 id 操作（id 来自 /api/stream 的返回或 /api/stream-tasks）。
     * remove 的语义与 aria2 的 remove 对齐：只从列表移除 + 终止进程/清理临时目录，
     * **不删除**已下载完成的文件（删文件仍走 App 内的删除对话框）。
     */
    if (pathname === '/api/stream-task') {
      if (req.method !== 'POST') {
        this.send(res, 405, { ok: false, code: 'method_not_allowed', error: 'Method Not Allowed' })
        return
      }
      if (!this.requireScope(auth, res, 'stream:control')) return
      let payload: unknown
      try {
        payload = await readJsonBody(req)
      } catch (error) {
        this.send(res, 400, { ok: false, code: 'bad_request', error: error instanceof Error ? error.message : 'Bad Request' })
        return
      }
      const action = (payload as { action?: unknown })?.action
      const id = (payload as { id?: unknown })?.id
      if (typeof id !== 'string' || !id) {
        this.send(res, 400, { ok: false, code: 'invalid_id', error: 'Invalid task id' })
        return
      }
      if (action !== 'pause' && action !== 'resume' && action !== 'remove') {
        this.send(res, 400, { ok: false, code: 'invalid_action', error: 'Unsupported action' })
        return
      }
      this.send(res, 200, await this.applyStreamTaskAction(action, id))
      return
    }

    /**
     * POST /api/mcp：MCP（Model Context Protocol）端点。
     *
     * 让 AI 客户端（Claude Desktop / Cursor / Agent）直接用自然语言驱动下载。
     * 与其它端点共用 Bearer 鉴权；工具集只覆盖下载管理（添加/查询/暂停/恢复），
     * URL 仍走 isAllowedDownloadUri 白名单。协议子集见 utils/mcpCore。
     */
    if (pathname === '/api/mcp') {
      if (req.method !== 'POST') {
        this.send(res, 405, { ok: false, code: 'method_not_allowed', error: 'Method Not Allowed' })
        return
      }
      // MCP 是 JSON-RPC 信封，没有 url 字段：不能走 readBodyOrReject（那是 resolve/add 的校验）
      let payload: unknown
      try {
        payload = await readJsonBody(req)
      } catch (error) {
        this.send(res, 400, { ok: false, code: 'bad_request', error: error instanceof Error ? error.message : 'Bad Request' })
        return
      }
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        this.send(res, 200, mcpError(null, MCP_ERROR_CODES.invalidRequest, 'Payload must be a JSON object'))
        return
      }
      await this.handleMcp(payload as Record<string, unknown>, res, auth)
      return
    }

    this.send(res, 404, { ok: false, code: 'not_found', error: 'Not Found' })
  }

  /**
   * MCP JSON-RPC 分发：initialize / tools/list / tools/call。
   * 通知（无 id）返回 202 无响应体；方法未知返回 -32601。
   * 工具执行失败用 buildToolErrorResult（isError: true），让模型看到原因而非协议错误。
   */
  private async handleMcp(
    body: Record<string, unknown>,
    res: http.ServerResponse,
    auth: ExtensionRequestAuth
  ): Promise<void> {
    const id = body.id
    const rpcId = typeof id === 'string' || typeof id === 'number' ? id : null
    const method = typeof body.method === 'string' ? body.method : ''

    // 通知（如 notifications/initialized）：MCP 要求无响应体
    if (isNotification(body)) {
      res.writeHead(202).end()
      return
    }

    if (!method) {
      this.send(res, 200, mcpError(rpcId, MCP_ERROR_CODES.invalidRequest, 'Missing method'))
      return
    }

    if (method === 'initialize') {
      this.send(res, 200, mcpResult(rpcId, buildInitializeResult(this.deps.getAppVersion())))
      return
    }

    if (method === 'ping') {
      this.send(res, 200, mcpResult(rpcId, {}))
      return
    }

    if (method === 'tools/list') {
      this.send(res, 200, mcpResult(rpcId, buildToolsListResult()))
      return
    }

    if (method === 'resources/list') {
      this.send(res, 200, mcpResult(rpcId, buildResourcesListResult()))
      return
    }

    const mcpParams = typeof body.params === 'object' && body.params !== null
      ? (body.params as Record<string, unknown>)
      : {}

    if (method === 'resources/read') {
      const uri = typeof mcpParams.uri === 'string' ? mcpParams.uri : ''
      try {
        const contents = await this.readMcpResource(uri)
        this.send(res, 200, mcpResult(rpcId, { contents }))
      } catch (error) {
        this.send(res, 200, mcpError(rpcId, MCP_ERROR_CODES.invalidParams, error instanceof Error ? error.message : String(error)))
      }
      return
    }

    if (method === 'prompts/list') {
      this.send(res, 200, mcpResult(rpcId, buildPromptsListResult()))
      return
    }

    if (method === 'prompts/get') {
      const name = typeof mcpParams.name === 'string' ? mcpParams.name : ''
      try {
        const result = await this.getMcpPrompt(name, mcpParams.arguments)
        this.send(res, 200, mcpResult(rpcId, result))
      } catch (error) {
        this.send(res, 200, mcpError(rpcId, MCP_ERROR_CODES.invalidParams, error instanceof Error ? error.message : String(error)))
      }
      return
    }

    if (method === 'tools/call') {
      const parsed = parseToolCallParams(body.params)
      if ('error' in parsed) {
        this.send(res, 200, mcpError(rpcId, MCP_ERROR_CODES.invalidParams, parsed.error))
        return
      }
      // 工具级 scope：MCP 之前完全没有 scope 校验，只读 token 也能删任务
      const requiredScope = MCP_TOOL_SCOPES[parsed.toolName]
      if (requiredScope && !this.requireScope(auth, res, requiredScope)) return

      // 破坏性工具必须显式确认：返回可读错误让模型去问用户，而不是直接执行
      if (
        (MCP_CONFIRM_REQUIRED_TOOLS as readonly string[]).includes(parsed.toolName) &&
        !optConfirm(parsed.args)
      ) {
        this.send(
          res,
          200,
          mcpResult(
            rpcId,
            buildToolErrorResult(
              `${parsed.toolName} is destructive and requires confirm=true. Ask the user for permission first, then call it again with confirm: true.`
            )
          )
        )
        return
      }

      const result = await this.callMcpTool(parsed.toolName, parsed.args)
      this.send(res, 200, mcpResult(rpcId, result))
      return
    }

    this.send(res, 200, mcpError(rpcId, MCP_ERROR_CODES.methodNotFound, `Unknown method: ${method}`))
  }

  /** 读取 MCP resource：统一返回 application/json 文本 */
  private async readMcpResource(uri: string): Promise<Array<Record<string, unknown>>> {
    const settings = getSettingsFresh()
    const rpcOptions = activeRpcOptions(settings)
    const rpc = (m: string, p: unknown[] = []) =>
      callAria2Rpc({ ...rpcOptions, method: m, params: p, timeoutMs: ENGINE_RPC_TIMEOUT_MS })

    let data: unknown
    if (uri === 'aria2://status/global') {
      data = await rpc('aria2.getGlobalStat')
    } else if (uri === 'aria2://tasks/active') {
      data = await rpc('aria2.tellActive', [['gid', 'status', 'totalLength', 'completedLength', 'downloadSpeed', 'files', 'bittorrent']])
    } else if (uri === 'aria2://tasks/waiting') {
      data = await rpc('aria2.tellWaiting', [0, 1000, ['gid', 'status', 'totalLength', 'completedLength', 'downloadSpeed', 'files', 'bittorrent']])
    } else if (uri === 'aria2://tasks/stopped') {
      data = await rpc('aria2.tellStopped', [0, 1000, ['gid', 'status', 'totalLength', 'completedLength', 'downloadSpeed', 'files', 'bittorrent', 'errorCode', 'errorMessage']])
    } else {
      throw new Error(`Unknown resource URI: ${uri}`)
    }
    return [{ uri, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }]
  }

  /** 生成 MCP prompt：返回单个 user 消息，让客户端直接发起分析 */
  private async getMcpPrompt(name: string, rawArgs: unknown): Promise<Record<string, unknown>> {
    const args = typeof rawArgs === 'object' && rawArgs !== null ? (rawArgs as Record<string, unknown>) : {}
    if (name === 'download_summary') {
      const status = typeof args.status === 'string' ? args.status : 'all'
      return {
        description: 'Summarize current downloads, speeds and any failures',
        messages: [{
          role: 'user',
          content: {
            type: 'text',
            text: `Use the Aria2 Desktop MCP tools to summarize the current "${status}" downloads: total count, aggregate speed, progress of each task, and any failed tasks with their error messages.`
          }
        }]
      }
    }
    if (name === 'diagnose_downloads') {
      const gid = typeof args.gid === 'string' ? args.gid : ''
      return {
        description: 'Diagnose slow or failed downloads using task and peer details',
        messages: [{
          role: 'user',
          content: {
            type: 'text',
            text: gid
              ? `Use get_task_status, get_task_peers and get_task_servers for gid ${gid}, then explain why the download is slow or failed and suggest concrete fixes.`
              : 'List current downloads, identify any slow or failed tasks, inspect their peers and servers, then explain likely causes and concrete fixes.'
          }
        }]
      }
    }
    throw new Error(`Unknown prompt: ${name}`)
  }

  /** MCP 工具实现：只覆盖下载管理，URL 走既有白名单 */
  private async callMcpTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const settings = getSettingsFresh()
    const rpcOptions = activeRpcOptions(settings)
    const rpc = (m: string, p: unknown[] = []) =>
      callAria2Rpc({ ...rpcOptions, method: m, params: p, timeoutMs: ENGINE_RPC_TIMEOUT_MS })

    try {
      switch (toolName) {
        case 'add_download': {
          const url = optString(args, 'url')
          if (url === undefined) return buildToolErrorResult('url is required')
          if (url === null) return buildToolErrorResult('url must be a string')
          if (!isAllowedDownloadUri(url)) {
            return buildToolErrorResult('URL is not allowed (only http/https/ftp/magnet/metalink are supported)')
          }
          const fileName = optString(args, 'fileName')
          if (fileName === null) return buildToolErrorResult('fileName must be a string')
          const options: Record<string, string> = {}
          if (fileName) {
            const safeName = sanitizeDownloadFileName(fileName)
            if (safeName) options.out = safeName
          }
          const gid = await rpc('aria2.addUri', [[url], options])
          return buildToolTextResult(`Download added. gid=${String(gid)}`)
        }

        case 'list_tasks': {
          // 注意顺序：先判 null（类型非法）再回落默认值，否则 '?? default' 会把类型错误吞掉
          const rawStatus = optString(args, 'status')
          if (rawStatus === null) return buildToolErrorResult('status must be a string')
          const status = rawStatus ?? 'default'
          const limitRaw = optNumber(args, 'limit', 20)
          if (limitRaw === null) return buildToolErrorResult('limit must be a number')
          const limit = Math.min(Math.max(limitRaw, 1), 100)
          const keys = ['gid', 'status', 'totalLength', 'completedLength', 'downloadSpeed', 'files', 'bittorrent']

          const fetchList = async (m: string, extra: unknown[] = []): Promise<Array<Record<string, unknown>>> => {
            const list = (await rpc(m, [...extra, keys])) as Array<Record<string, unknown>>
            return (list ?? []).slice(0, limit).map(t => ({
              gid: t.gid,
              status: t.status,
              name: pickTaskName(t as Parameters<typeof pickTaskName>[0]),
              size: t.totalLength,
              completed: t.completedLength,
              speed: t.downloadSpeed
            }))
          }

          let tasks: Array<Record<string, unknown>>
          if (status === 'active') tasks = await fetchList('aria2.tellActive')
          else if (status === 'waiting') tasks = await fetchList('aria2.tellWaiting', [0, limit])
          else if (status === 'stopped') tasks = await fetchList('aria2.tellStopped', [0, limit])
          else if (status === 'all') {
            const [a, w, s] = await Promise.all([
              fetchList('aria2.tellActive'),
              fetchList('aria2.tellWaiting', [0, limit]),
              fetchList('aria2.tellStopped', [0, limit])
            ])
            // 三类各取 limit 后再整体截断，避免 all 返回超过用户要求的条数
            tasks = [...a, ...w, ...s].slice(0, limit)
          } else {
            const [a, w] = await Promise.all([fetchList('aria2.tellActive'), fetchList('aria2.tellWaiting', [0, limit])])
            tasks = [...a, ...w].slice(0, limit)
          }
          return buildToolTextResult(JSON.stringify({ count: tasks.length, tasks }, null, 2))
        }

        case 'get_download_status': {
          const gid = optString(args, 'gid')
          if (gid === null) return buildToolErrorResult('gid must be a string')
          if (gid) {
            const task = (await rpc('aria2.tellStatus', [gid, [
              'gid', 'status', 'totalLength', 'completedLength', 'downloadSpeed', 'uploadSpeed',
              'connections', 'numSeeders', 'dir', 'files', 'errorCode', 'errorMessage'
            ]])) as Record<string, unknown>
            return buildToolTextResult(JSON.stringify(task, null, 2))
          }
          const stat = (await rpc('aria2.getGlobalStat')) as Record<string, unknown>
          return buildToolTextResult(
            JSON.stringify({
              downloadSpeed: stat.downloadSpeed,
              uploadSpeed: stat.uploadSpeed,
              numActive: stat.numActive,
              numWaiting: stat.numWaiting,
              numStopped: stat.numStopped
            })
          )
        }

        case 'get_task_status': {
          const gid = optString(args, 'gid')
          if (gid === undefined) return buildToolErrorResult('gid is required')
          if (gid === null) return buildToolErrorResult('gid must be a string')
          const task = (await rpc('aria2.tellStatus', [gid, [
            'gid', 'status', 'totalLength', 'completedLength', 'downloadSpeed', 'uploadSpeed',
            'connections', 'numSeeders', 'dir', 'files', 'errorCode', 'errorMessage', 'bittorrent'
          ]])) as Record<string, unknown>
          return buildToolTextResult(JSON.stringify(task, null, 2))
        }

        case 'pause_task':
        case 'resume_task': {
          const gid = optString(args, 'gid')
          if (gid === undefined) return buildToolErrorResult('gid is required')
          if (gid === null) return buildToolErrorResult('gid must be a string')
          await rpc(toolName === 'pause_task' ? 'aria2.pause' : 'aria2.unpause', [gid])
          return buildToolTextResult(`${toolName === 'pause_task' ? 'Paused' : 'Resumed'} task ${gid}`)
        }

        case 'remove_task': {
          const gid = optString(args, 'gid')
          if (gid === undefined) return buildToolErrorResult('gid is required')
          if (gid === null) return buildToolErrorResult('gid must be a string')
          // 只移除任务与结果记录，不删除磁盘文件（MCP 不暴露文件系统操作）
          try {
            await rpc('aria2.remove', [gid])
          } catch {
            // 已停止的任务 remove 会失败，继续尝试清结果
          }
          await rpc('aria2.removeDownloadResult', [gid])
          return buildToolTextResult(`Removed task ${gid} (downloaded files were kept)`)
        }

        case 'pause_all': {
          await rpc('aria2.pauseAll')
          return buildToolTextResult('All active tasks paused')
        }

        case 'resume_all': {
          await rpc('aria2.unpauseAll')
          return buildToolTextResult('All paused tasks resumed')
        }

        case 'set_speed_limit': {
          const download = optNumber(args, 'download', -1)
          if (download === null || download < 0) return buildToolErrorResult('download must be a non-negative number')
          const upload = optNumber(args, 'upload', -1)
          if (upload === null || (upload !== -1 && upload < 0)) {
            return buildToolErrorResult('upload must be a non-negative number')
          }
          const options: Record<string, string> = { 'max-overall-download-limit': String(Math.floor(download)) }
          if (upload !== -1) options['max-overall-upload-limit'] = String(Math.floor(upload))
          await rpc('aria2.changeGlobalOption', [options])
          return buildToolTextResult(`Speed limit set: download=${options['max-overall-download-limit']} B/s${upload !== -1 ? `, upload=${options['max-overall-upload-limit']} B/s` : ''}`)
        }

        case 'get_global_stats': {
          const stat = (await rpc('aria2.getGlobalStat')) as Record<string, unknown>
          return buildToolTextResult(JSON.stringify(stat, null, 2))
        }

        case 'get_version': {
          const version = await rpc('aria2.getVersion')
          return buildToolTextResult(JSON.stringify(version, null, 2))
        }

        case 'get_session_info': {
          const info = await rpc('aria2.getSessionInfo')
          return buildToolTextResult(JSON.stringify(info, null, 2))
        }

        case 'get_task_peers': {
          const gid = optString(args, 'gid')
          if (gid === undefined) return buildToolErrorResult('gid is required')
          if (gid === null) return buildToolErrorResult('gid must be a string')
          const peers = await rpc('aria2.getPeers', [gid])
          return buildToolTextResult(JSON.stringify(peers, null, 2))
        }

        case 'get_task_servers': {
          const gid = optString(args, 'gid')
          if (gid === undefined) return buildToolErrorResult('gid is required')
          if (gid === null) return buildToolErrorResult('gid must be a string')
          const servers = await rpc('aria2.getServers', [gid])
          return buildToolTextResult(JSON.stringify(servers, null, 2))
        }

        case 'get_task_files': {
          const gid = optString(args, 'gid')
          if (gid === undefined) return buildToolErrorResult('gid is required')
          if (gid === null) return buildToolErrorResult('gid must be a string')
          const files = await rpc('aria2.tellStatus', [gid, ['gid', 'status', 'dir', 'files', 'bittorrent']])
          return buildToolTextResult(JSON.stringify(files, null, 2))
        }

        case 'change_task_position': {
          const gid = optString(args, 'gid')
          if (gid === undefined) return buildToolErrorResult('gid is required')
          if (gid === null) return buildToolErrorResult('gid must be a string')
          const position = optNumber(args, 'position', 0)
          if (position === null || position < 0) return buildToolErrorResult('position must be a non-negative number')
          const rawHow = optString(args, 'how')
          if (rawHow === null) return buildToolErrorResult('how must be POS_SET, POS_CUR or POS_END')
          const how = rawHow ?? 'POS_SET'
          if (how !== 'POS_SET' && how !== 'POS_CUR' && how !== 'POS_END') {
            return buildToolErrorResult('how must be POS_SET, POS_CUR or POS_END')
          }
          const result = await rpc('aria2.changePosition', [gid, position, how])
          return buildToolTextResult(`Task ${gid} moved; new position=${String(result)}`)
        }

        case 'set_task_speed_limit': {
          const gid = optString(args, 'gid')
          if (gid === undefined) return buildToolErrorResult('gid is required')
          if (gid === null) return buildToolErrorResult('gid must be a string')
          const options: Record<string, string> = {}
          if (args.download !== undefined) {
            const download = optNumber(args, 'download', -1)
            if (download === null || download < 0) return buildToolErrorResult('download must be a non-negative number')
            options['max-download-limit'] = String(Math.floor(download))
          }
          if (args.upload !== undefined) {
            const upload = optNumber(args, 'upload', -1)
            if (upload === null || upload < 0) return buildToolErrorResult('upload must be a non-negative number')
            options['max-upload-limit'] = String(Math.floor(upload))
          }
          if (Object.keys(options).length === 0) return buildToolErrorResult('download or upload is required')
          await rpc('aria2.changeOption', [gid, options])
          return buildToolTextResult(`Task ${gid} speed limit updated: ${JSON.stringify(options)}`)
        }

        case 'set_max_concurrent': {
          const value = optNumber(args, 'value', 0)
          if (value === null || value < 1 || value > 50) return buildToolErrorResult('value must be between 1 and 50')
          await rpc('aria2.changeGlobalOption', [{ 'max-concurrent-downloads': String(value) }])
          return buildToolTextResult(`Maximum concurrent downloads set to ${value}`)
        }

        case 'get_global_options': {
          const options = await rpc('aria2.getGlobalOption')
          return buildToolTextResult(JSON.stringify(options, null, 2))
        }

        case 'purge_download_result': {
          const gid = optString(args, 'gid')
          if (gid === undefined) return buildToolErrorResult('gid is required')
          if (gid === null) return buildToolErrorResult('gid must be a string')
          await rpc('aria2.removeDownloadResult', [gid])
          return buildToolTextResult(`Removed result entry for ${gid}`)
        }

        case 'save_session': {
          await rpc('aria2.saveSession')
          return buildToolTextResult('Download session saved')
        }

        default:
          return buildToolErrorResult(`Unknown tool: ${toolName}`)
      }
    } catch (error) {
      return buildToolErrorResult(error instanceof Error ? error.message : String(error))
    }
  }

  /**
 * POST /api/pair：一键配对。
 *
 * 面向"刚装好扩展、还没有密钥"的场景：扩展带上自己的 Origin 请求配对，
 * App 弹原生对话框，用户点「允许」后返回 RPC 密钥与端口，
 * 扩展保存后即可使用——免去"到 App 设置里复制密钥再粘贴"的手工环节。
 *
 * 安全模型（三层）：
 * ① 仅本机（127.0.0.1）；② Origin 必须是 chrome-extension:// 或 moz-extension://（网页/curl 都触发不了）；
 * ③ 用户在 App 里手动确认——本地恶意进程能伪造 Origin，但伪造不出用户的点击。
 * 该端点不引入新的本地攻击面：能读文件的本机进程早已能从 aria2.conf 拿到明文密钥。
 *
 * 注意：来源中的扩展 ID 只进日志、**不进确认弹窗**——32 位 ID 对用户没有可验证性，
 * 弹窗文案是固定提示语，不存在把请求侧数据带入对话框文本的路径。
 */
  private async handlePairing(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (req.method !== 'POST') {
      this.send(res, 405, { ok: false, code: 'method_not_allowed', error: 'Method Not Allowed' })
      return
    }
    // 来源校验：Origin 必须是 chrome-extension:// 且 ID 段为 32 位 [a-p]。
    // 判定走 extensionApiCore 的纯函数（可单测），返回布尔——
    // 来源字符串到该函数为止，不进入任何弹窗、日志插值或响应体。
    if (!isExtensionOrigin(req.headers.origin)) {
      this.logger.warn('拒绝非法的配对请求（来源非浏览器扩展）')
      this.send(res, 403, { ok: false, code: 'pairing_forbidden', error: 'Forbidden' })
      return
    }

    const settings = getSettingsFresh()
    if (!settings?.aria2?.secret) {
      // RPC 未设密钥时扩展接口本身会拒绝所有请求（isAuthorizedExtensionRequest 要求非空密钥），
      // 过去这里返回 ok:true + secret:'' 会让扩展保存一个永远 401 的配置；直接明确失败并引导用户先设置密钥。
      this.send(res, 409, {
        ok: false,
        code: 'secret_required',
        error: mainError(runtimeMainLocale(), 'extension.secretRequired')
      })
      return
    }

    // 扩展自报的名称/版本只用于**展示**，一律先净化：
    // 名称来自请求体（可被任意字符串填充），绝不能原样进对话框或日志。
    let requestedName = ''
    try {
      const body = await readJsonBody(req)
      if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
        requestedName = sanitizeExtensionName((body as { name?: unknown }).name)
      }
    } catch {
      // 配对请求体是可选的：解析失败按"未提供名称"处理，不影响配对本身
      requestedName = ''
    }
    const origin = req.headers.origin ?? ''
    // 头值类型是 string | string[] | undefined（重复头会变数组），版本号只认单值
    const versionHeader = req.headers['x-extension-version']
    const info: ExtensionPairingInfo = {
      name: requestedName || defaultExtensionName(runtimeMainLocale()),
      extensionId: extensionIdFromOrigin(origin),
      origin,
      version: normalizeExtensionVersionHeader(typeof versionHeader === 'string' ? versionHeader : undefined)
    }

    let allowed = false
    try {
      // 确认链（D-06）：调用方注入的带信息确认框 → 服务内置的带信息对话框 → 旧的固定文案确认。
      // 之所以内置一份而不是要求 main.ts 注入：D-06 只改服务层就能落地，不必和正在改 main.ts 的分支冲突。
      if (this.deps.confirmPairingWithInfo) {
        allowed = await this.deps.confirmPairingWithInfo(info)
      } else if (typeof dialog?.showMessageBox === 'function') {
        allowed = await this.showPairingDialog(info)
      } else {
        // 无 GUI 环境（自动化脚本/无 dialog 的宿主）兜底到旧回调
        allowed = await this.deps.confirmPairing()
      }
    } catch (error) {
      // 对话框本身失败（宿主无 GUI、dialog 未就绪）时不能静默放行，回落到旧确认
      this.logger.warn('扩展配对确认框不可用，回落到旧确认流程:', error)
      try {
        allowed = await this.deps.confirmPairing()
      } catch {
        allowed = false
      }
    }
    if (!allowed) {
      this.logger.warn('用户拒绝了浏览器扩展的配对请求')
      this.send(res, 403, { ok: false, code: 'pairing_denied', error: 'Denied by user' })
      return
    }

    // 签发受限 token：**不再把 RPC 密钥交给扩展**（D-06）。
    // 密钥能删任意文件、改任意配置；token 只能做 scope 里列出的四件事，
    // 且可在设置页按扩展单独撤销，泄露面小得多。
    const token = createExtensionToken()
    const scopes = [...DEFAULT_EXTENSION_TOKEN_SCOPES]
    this.store().add({
      token,
      scopes,
      extensionId: info.extensionId,
      extensionName: info.name,
      origin: info.origin,
      createdAt: Date.now()
    })
    this.logger.info(`已允许浏览器扩展配对（${info.name} / ${info.extensionId || 'unknown'}）`)

    // 刚签发的 token 可能让"原本没有凭据所以没监听"的接口具备监听条件
    this.apply()

    const fresh = getSettingsFresh()
    this.send(res, 200, {
      ok: true,
      token,
      scopes,
      port: fresh?.aria2?.port ?? 6800,
      extensionId: info.extensionId
    })
  }

  /**
   * 默认的配对确认框（D-06）：调用方未注入 confirmPairingWithInfo 时使用。
   * 展示净化后的扩展名称/ID/来源，让用户能判断"是不是我刚装的那个扩展"。
   */
  private async showPairingDialog(info: ExtensionPairingInfo): Promise<boolean> {
    const copy = extensionPairingCopy(runtimeMainLocale())
    const detail = [
      `${copy.labelName}：${info.name}`,
      `${copy.labelExtensionId}：${info.extensionId || copy.unknown}`,
      `${copy.labelOrigin}：${info.origin}`,
      info.version ? `${copy.labelVersion}：${info.version}` : '',
      '',
      copy.canDo,
      copy.cannotDo
    ].filter((line) => line !== '').join('\n')
    const result = await dialog.showMessageBox({
      type: 'question',
      buttons: [copy.allow, copy.deny],
      defaultId: 0,
      cancelId: 1,
      title: copy.title,
      message: copy.message,
      detail
    })
    return result.response === 0
  }

  /**
   * scope 闸门：RPC 密钥路径（scopes === null）视为全权，token 路径按 scope 判定。
   * 不满足时直接回 403 并返回 false，调用方立即 return。
   */
  private requireScope(
    auth: ExtensionRequestAuth,
    res: http.ServerResponse,
    required: ExtensionTokenScope
  ): boolean {
    if (auth.scopes === null) return true
    if (hasExtensionScope(auth.scopes, required)) return true
    this.logger.warn(`扩展 token 缺少 scope：${required}`)
    this.send(res, 403, { ok: false, code: 'insufficient_scope', error: 'Forbidden' })
    return false
  }

  /** 读取并校验请求体：URL 必填，非法时直接回应 400 并返回 null */
  private async readBodyOrReject(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<{ url: string; fileName: unknown; headers: unknown; title: unknown } | null> {
    let payload: unknown
    try {
      payload = await readJsonBody(req)
    } catch (error) {
      this.send(res, 400, { ok: false, code: 'bad_request', error: error instanceof Error ? error.message : 'Bad Request' })
      return null
    }
    const url = (payload as { url?: unknown })?.url
    if (typeof url !== 'string' || !url.trim()) {
      this.send(res, 400, { ok: false, code: 'invalid_url', error: 'Invalid url' })
      return null
    }
    return {
      url: url.trim(),
      fileName: (payload as { fileName?: unknown })?.fileName,
      headers: (payload as { headers?: unknown })?.headers,
      title: (payload as { title?: unknown })?.title
    }
  }

  /**
   * 解析"这个链接该存到哪、叫什么名字"（/api/resolve 与 /api/add 共用）。
   *
   * 这是打通的核心价值——**分类规则以 App 为准**（用户自定义的子目录名、扩充的扩展名、
   * 自定义完整目录都生效），扩展不再需要自己维护一份内置规则。
   * 顺带把两件扩展做不了的事也办了：
   * - 探测真实文件名（App 在主进程发请求，不受扩展 host 权限限制）；
   * - 重名判断（需要读文件系统，扩展没有这个能力）。
   */
  private async resolveForUrl(url: string, fileNameHint: unknown): Promise<ResolvedTarget> {
    const settings = getSettingsFresh()
    const categories = settings?.category?.categories ?? []
    // 默认开启，与渲染层 settingsStore.categoryConfig 的口径保持一致
    const autoClassify = settings?.category?.autoClassify !== false
    const baseDir = resolveBaseDownloadDir(settings ?? undefined)

    // 文件名来源优先级：调用方给定（如浏览器解析出的下载名）> URL 末段 > 向服务器探测。
    // **三个来源一律净化**：这个值最终会作为 aria2 的 out 下发，未净化时
    // 调用方（持密钥的扩展）能借 `../` 把文件写到下载目录之外——见 sanitizeDownloadFileName。
    let fileName = sanitizeDownloadFileName(fileNameHint)
    if (!fileName) fileName = sanitizeDownloadFileName(getFileNameHintFromUri(url))
    // 探测是"本机向调用方给的地址发请求"，只对明确无正当用途的目标跳过（回环/链路本地/云元数据）
    if (!getFileExtension(fileName) && isProbeAllowed(url)) {
      const probed = await probeDownloadFileName(url)
      if (probed) fileName = sanitizeDownloadFileName(probed)
    }

    const rule = autoClassify && fileName
      ? resolveCategory(fileName, categories)
      : resolveCategory('', categories)
    const dir = resolveTargetDir(baseDir, rule)
    const subdir = rule.id === CATEGORY_GENERAL ? null : getCategoryTargetDirname(rule.id, rule.dir)

    // 重名：目标已存在且非"上次中断可续传"时给出带序号的新名字
    let out = ''
    let conflict = false
    if (fileName && dir) {
      const resolved = resolveConflictingFileName(dir, fileName)
      conflict = resolved.conflict
      if (conflict) out = resolved.fileName
    }

    return { url, fileName, dir, subdir, category: rule.id, conflict, out }
  }

  /**
   * POST /api/add：由 App 事务化完成「解析 → 重名 → 建任务」，扩展只发一个 URL。
   *
   * 为什么不接受调用方传入 aria2 选项：`dir`（任意路径写入）、`on-download-complete`
   * （任意命令执行）等都属于注入面，接口只收 url / fileName / headers，其余选项一律由 App
   * 按用户设置生成——这同时让扩展建的任务**与 App 内新建的任务选项一致**
   * （连接数、分片大小、是否自动开始），修正了此前扩展直连 aria2 时这些设置不生效的问题。
   *
   * headers 是唯一例外，且**必须净化后才下发**（见 sanitizeRequestHeaders）：
   * 浏览器扩展能把当前页面的 Cookie/Referer 带过来，否则需要登录的站点（网盘、论坛附件）
   * 从浏览器发起必然 401/403——这是扩展与独立下载器体验差距最大的一处。
   */
  private async buildAdd(
    url: string,
    fileNameHint: unknown,
    rawHeaders: unknown
  ): Promise<{ status: number; payload: Record<string, unknown> }> {
    if (!isAllowedDownloadUri(url)) {
      return { status: 400, payload: { ok: false, code: 'invalid_url', error: 'Unsupported url' } }
    }

    const settings = getSettingsFresh()
    const resolved = await this.resolveForUrl(url, fileNameHint)
    const headers: SanitizedRequestHeaders = sanitizeRequestHeaders(rawHeaders)

    const options: Record<string, unknown> = {}
    if (resolved.dir) options.dir = resolved.dir
    const out = resolved.out || resolved.fileName
    // 二次防线：out 必须是纯文件名。resolveForUrl 已净化过，这里再断言一次——
    // 双重保障的成本是零，而漏一次的后果是"能往下载目录之外写文件"（已实测）。
    if (out && isPlainFileName(out)) {
      options.out = out
    } else if (out) {
      this.logger.warn('丢弃不安全的 out 值，改由 aria2 按 URL 自行命名')
    }
    if (settings?.download?.maxConnectionPerServer) {
      options['max-connection-per-server'] = String(settings.download.maxConnectionPerServer)
    }
    if (settings?.download?.minSplitSize) options['min-split-size'] = settings.download.minSplitSize
    if (settings?.download?.autoStart === false) options.pause = 'true'

    // 请求头：aria2 的 `header` 是字符串数组，referer/user-agent 各有专用选项
    if (headers.header.length > 0) options.header = headers.header
    if (headers.userAgent) options['user-agent'] = headers.userAgent
    if (headers.referer) options.referer = headers.referer

    try {
      const gid = await callAria2Rpc({
        ...activeRpcOptions(settings),
        method: 'aria2.addUri',
        params: [[url], options],
        timeoutMs: ADD_RPC_TIMEOUT_MS
      })
      const where = `${resolved.category}${resolved.subdir ? `/${resolved.subdir}` : ''}${resolved.conflict ? '（重名已改名）' : ''}`
      // 只记录"带了几条头"，绝不记录头内容（Cookie 是凭据，落日志等于泄露）
      const headerNote = headers.header.length || headers.referer || headers.userAgent
        ? `，携带 ${headers.header.length} 条请求头${headers.referer ? ' + Referer' : ''}${headers.userAgent ? ' + UA' : ''}`
        : ''
      this.logger.info(`已代扩展创建任务 ${String(gid)}（${where}${headerNote}）`)
      return {
        status: 200,
        payload: {
          ok: true,
          gid,
          url,
          dir: resolved.dir,
          fileName: resolved.fileName,
          subdir: resolved.subdir,
          category: resolved.category,
          conflict: resolved.conflict,
          renamed: resolved.out
        }
      }
    } catch (error) {
      // RPC 失败（引擎未启动 / 密钥不匹配）如实回报，扩展侧按错误提示展示
      const message = error instanceof Error ? error.message : String(error)
      this.logger.warn(`代扩展创建任务失败: ${message}`)
      return { status: 502, payload: { ok: false, code: 'engine_unavailable', error: message } }
    }
  }

  /**
   * 对流媒体任务执行动作。返回体与扩展侧的错误码约定保持一致（ok/code/error）。
   *
   * 进程已经结束的任务（完成/失败）没有可暂停的进程：pause/resume 直接判失败，
   * 让扩展把提示落到用户面前，而不是假装成功。
   */
  private async applyStreamTaskAction(
    action: 'pause' | 'resume' | 'remove',
    id: string
  ): Promise<{ ok: boolean; code?: string; error?: string }> {
    if (action === 'pause') {
      return pauseStreamDownload(id)
        ? { ok: true }
        : { ok: false, code: 'not_running', error: 'Task is not running' }
    }
    if (action === 'resume') {
      // resume 现在是异步的（重新拉起前要读一次全局限速，见 streamDownloadService）
      return (await resumeStreamDownload(id))
        ? { ok: true }
        : { ok: false, code: 'not_paused', error: 'Task is not paused' }
    }

    // remove 只做"从列表移除"：终止进程、清临时目录，**不动已下载完成的文件**。
    // 与 aria2 的 remove 语义一致；扩展这边是一键操作、没有确认框，顺手删掉用户
    // 已经下完的文件等于无提示的数据丢失。要删文件请回 App 的任务列表（那里有确认）。
    await discardStreamDownload(id)
    forgetStreamTask(id)
    return { ok: true }
  }

  /**
   * GET /api/tasks：aria2 任务快照（D-06 新增，受 tasks:read scope 保护）。
   *
   * 形状对齐扩展侧已有的 getTasksSnapshot()：{ tasks, stats }。
   * 之所以不复用 MCP 的 list_tasks：那边返回给模型的是文本，这里是给扩展渲染的 JSON，
   * 字段与 aria2 原始键保持一致（扩展已经有 taskDisplayName/normalizeTask 在做映射）。
   */
  private async buildTasksSnapshot(): Promise<Record<string, unknown>> {
    const settings = getSettingsFresh()
    const rpc = (method: string, params: unknown[] = []) =>
      callAria2Rpc({ ...activeRpcOptions(settings), method, params, timeoutMs: ENGINE_RPC_TIMEOUT_MS })

    const keys = ['gid', 'status', 'totalLength', 'completedLength', 'downloadSpeed', 'files', 'bittorrent', 'errorCode', 'errorMessage']
    const fetchList = async (method: string, extra: unknown[] = []): Promise<Array<Record<string, unknown>>> => {
      const list = (await rpc(method, [...extra, keys])) as Array<Record<string, unknown>> | undefined
      return (list ?? []).map((task) => ({
        gid: task.gid,
        status: task.status,
        name: pickTaskName(task as Parameters<typeof pickTaskName>[0]),
        totalLength: task.totalLength,
        completedLength: task.completedLength,
        downloadSpeed: task.downloadSpeed,
        files: task.files,
        bittorrent: task.bittorrent,
        errorCode: task.errorCode,
        errorMessage: task.errorMessage
      }))
    }

    try {
      const [active, waiting, stopped, globalStat] = await Promise.all([
        fetchList('aria2.tellActive'),
        fetchList('aria2.tellWaiting', [0, 100]),
        fetchList('aria2.tellStopped', [0, 100]),
        rpc('aria2.getGlobalStat') as Promise<Record<string, unknown> | undefined>
      ])
      return {
        ok: true,
        tasks: [...active, ...waiting, ...stopped],
        stats: {
          downloadSpeed: globalStat?.downloadSpeed ?? '0',
          uploadSpeed: globalStat?.uploadSpeed ?? '0',
          numActive: globalStat?.numActive ?? '0',
          numWaiting: globalStat?.numWaiting ?? '0',
          numStopped: globalStat?.numStopped ?? '0'
        }
      }
    } catch (error) {
      // 引擎未启动/RPC 不可用：与 /api/add 一致用 200 + ok:false，让扩展按错误码提示
      const message = error instanceof Error ? error.message : String(error)
      this.logger.warn(`读取任务列表失败: ${message}`)
      return { ok: false, code: 'engine_unavailable', error: message }
    }
  }

  /**
   * POST /api/task：对 aria2 任务执行 pause / resume / remove（受 tasks:control scope 保护）。
   * remove 与 aria2 一致：从队列移除，**不删**已下载文件。
   */
  private async applyTaskAction(
    action: 'pause' | 'resume' | 'remove',
    gid: string
  ): Promise<{ ok: boolean; code?: string; error?: string }> {
    const settings = getSettingsFresh()
    const rpc = (method: string, params: unknown[] = []) =>
      callAria2Rpc({ ...activeRpcOptions(settings), method, params, timeoutMs: ENGINE_RPC_TIMEOUT_MS })

    try {
      if (action === 'pause') await rpc('aria2.pause', [gid])
      else if (action === 'resume') await rpc('aria2.unpause', [gid])
      else {
        await rpc('aria2.remove', [gid])
        // remove 只是停止下载，结果仍留在 stopped 列表里；再清一次结果才真正从列表消失
        try {
          await rpc('aria2.removeDownloadResult', [gid])
        } catch {
          // 已经不在结果列表里（例如刚完成）时忽略
        }
      }
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.warn(`任务操作 ${action} 失败: ${message}`)
      return { ok: false, code: 'engine_unavailable', error: message }
    }
  }

  /** GET /api/status：应用版本、引擎进程状态与版本、当前下载目录 */
  private async buildStatus(): Promise<Record<string, unknown>> {
    const settings = getSettingsFresh()
    const info = this.deps.getEngineProcessInfo()

    // 扩展版本已在鉴权后由 recordExtensionConnection 记录（见 handleRequest），
    // 这里不再重复读头，避免两处各记一份、日志翻倍

    let engineVersion = ''
    if (info.isRunning) {
      try {
        const result = await callAria2Rpc({
          ...activeRpcOptions(settings),
          method: 'aria2.getVersion',
          timeoutMs: ENGINE_RPC_TIMEOUT_MS
        }) as { version?: string } | undefined
        engineVersion = result?.version ?? ''
      } catch {
        // 进程在跑但 RPC 暂时取不到版本（刚启动/正忙）：不影响 running 判定
      }
    }

    return {
      ok: true,
      appVersion: this.deps.getAppVersion(),
      engine: {
        running: info.isRunning,
        pid: info.pid ?? null,
        version: engineVersion
      },
      downloadDir: settings?.aria2?.downloadDir || settings?.download?.defaultDir || ''
    }
  }

  private send(res: http.ServerResponse, status: number, payload: unknown): void {
    // 故意不写 CORS 头：扩展凭 host_permissions 不受同源限制，
    // 而普通网页因此读不到任何响应内容
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    })
    res.end(JSON.stringify(payload))
  }
}

/** 请求体大小上限：接口只接受一个 URL 与文件名，超过此值直接拒绝 */
const BODY_LIMIT_BYTES = 16 * 1024
/** 超限后仍继续丢弃读取的上限：让客户端能把请求写完并正常收到 400（超过则只能断开） */
const BODY_DRAIN_LIMIT_BYTES = 1024 * 1024

/**
 * 读取并解析 JSON 请求体（带大小限制）。
 *
 * 超限时**不立即 destroy 连接**：那样客户端会在还没读到响应前先遭遇 socket 错误，
 * 拿不到 400。改为继续把请求体读完（只丢弃、不累积，内存有界）后再回复错误；
 * 只有当超限流量本身超过丢弃上限（视为异常/恶意）才断开连接。
 */
function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let oversize = false

    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > BODY_LIMIT_BYTES) {
        oversize = true
        chunks.length = 0
        if (size > BODY_DRAIN_LIMIT_BYTES) {
          reject(new Error('Payload too large'))
          req.destroy()
        }
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (oversize) {
        reject(new Error('Payload too large'))
        return
      }
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {})
      } catch {
        reject(new Error('Invalid JSON'))
      }
    })
    req.on('error', (error) => reject(error))
  })
}
