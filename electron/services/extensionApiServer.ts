import * as http from 'http'
import { createLogger } from '../utils/logger'
import { getSettingsFresh } from '../utils/settingsAccessor'
import { callAria2Rpc } from '../utils/aria2Rpc'
import { probeDownloadFileName, resolveConflictingFileName } from '../utils/downloadNameProbe'
import {
  EXTENSION_API_HOST,
  EXTENSION_API_PORT,
  isAllowedDownloadUri,
  isAuthorizedExtensionRequest,
  isPlainFileName,
  isProbeAllowed,
  parseRequestPathname,
  sanitizeDownloadFileName,
  getPairingExtensionId
} from '../utils/extensionApiCore'
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

  constructor(private readonly deps: ExtensionApiDeps) {}

  /** 启动接口；重复调用无副作用 */
  start(port: number = EXTENSION_API_PORT): void {
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
    })

    server.listen(port, EXTENSION_API_HOST, () => {
      this.logger.info(`浏览器扩展本地接口已启动: http://${EXTENSION_API_HOST}:${port}`)
    })
    // 不阻止进程退出：接口不在应用的关键路径上
    server.unref()
    this.server = server
  }

  stop(): void {
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

    // 密钥每次都直读（settings 的 secret 变化后必须立即生效，不能吃到缓存值）
    const secret = getSettingsFresh()?.aria2?.secret ?? ''
    const authorized = isAuthorizedExtensionRequest({
      authorization: req.headers.authorization,
      origin: req.headers.origin,
      secret
    })
    if (!authorized) {
      // 不区分"密钥错误"与"来源非法"，避免给探测者额外信息
      this.logger.warn(`拒绝未授权的接口调用（来源 ${req.headers.origin ?? '无'}）`)
      this.send(res, 401, { ok: false, code: 'unauthorized', error: 'Unauthorized' })
      return
    }

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

    if (pathname === '/api/resolve') {
      if (req.method !== 'POST') {
        this.send(res, 405, { ok: false, code: 'method_not_allowed', error: 'Method Not Allowed' })
        return
      }
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
      const body = await this.readBodyOrReject(req, res)
      if (!body) return
      const { status, payload } = await this.buildAdd(body.url, body.fileName)
      this.send(res, status, payload)
      return
    }

    this.send(res, 404, { ok: false, code: 'not_found', error: 'Not Found' })
  }

  /**
 * POST /api/pair：一键配对。
 *
 * 面向"刚装好扩展、还没有密钥"的场景：扩展带上自己的 Origin 请求配对，
 * App 弹原生对话框，用户点「允许」后返回 RPC 密钥与端口，
 * 扩展保存后即可使用——免去"到 App 设置里复制密钥再粘贴"的手工环节。
 *
 * 安全模型（三层）：
 * ① 仅本机（127.0.0.1）；② Origin 必须是 chrome-extension://（网页/curl 都触发不了）；
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
    // 判定走 extensionApiCore 的纯函数（可单测），这里只取布尔结果——
    // 来源字符串不进入任何弹窗、日志插值或响应体。
    const isExtensionOrigin = getPairingExtensionId(req.headers.origin) !== null
    if (!isExtensionOrigin) {
      this.logger.warn('拒绝非法的配对请求（来源非浏览器扩展）')
      this.send(res, 403, { ok: false, code: 'pairing_forbidden', error: 'Forbidden' })
      return
    }

    const settings = getSettingsFresh()
    if (!settings?.aria2?.secret) {
    // 引擎没设密钥（RPC 无保护）：扩展直接连即可，无需配对
      this.send(res, 200, { ok: true, secret: '', port: settings?.aria2?.port ?? 6800, note: 'no_secret' })
      return
    }

    let allowed = false
    try {
      allowed = await this.deps.confirmPairing()
    } catch {
      allowed = false
    }
    if (!allowed) {
      this.logger.warn('用户拒绝了浏览器扩展的配对请求')
      this.send(res, 403, { ok: false, code: 'pairing_denied', error: 'Denied by user' })
      return
    }

    this.logger.info('已允许浏览器扩展配对')
    // 用户确认后才直读密钥（确认期间密钥可能已被修改）
    const fresh = getSettingsFresh()
    this.send(res, 200, {
      ok: true,
      secret: fresh?.aria2?.secret ?? '',
      port: fresh?.aria2?.port ?? 6800
    })
  }

  /** 读取并校验请求体：URL 必填，非法时直接回应 400 并返回 null */
  private async readBodyOrReject(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<{ url: string; fileName: unknown } | null> {
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
    return { url: url.trim(), fileName: (payload as { fileName?: unknown })?.fileName }
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
   * （任意命令执行）等都属于注入面，接口只收 url / fileName，其余选项一律由 App 按用户设置生成——
   * 这同时让扩展建的任务**与 App 内新建的任务选项一致**（连接数、分片大小、是否自动开始），
   * 修正了此前扩展直连 aria2 时这些设置不生效的问题。
   */
  private async buildAdd(url: string, fileNameHint: unknown): Promise<{ status: number; payload: Record<string, unknown> }> {
    if (!isAllowedDownloadUri(url)) {
      return { status: 400, payload: { ok: false, code: 'invalid_url', error: 'Unsupported url' } }
    }

    const settings = getSettingsFresh()
    const resolved = await this.resolveForUrl(url, fileNameHint)

    const options: Record<string, string> = {}
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

    try {
      const gid = await callAria2Rpc({
        port: settings?.aria2?.port ?? 6800,
        secret: settings?.aria2?.secret ?? '',
        method: 'aria2.addUri',
        params: [[url], options],
        timeoutMs: ADD_RPC_TIMEOUT_MS
      })
      const where = `${resolved.category}${resolved.subdir ? `/${resolved.subdir}` : ''}${resolved.conflict ? '（重名已改名）' : ''}`
      this.logger.info(`已代扩展创建任务 ${String(gid)}（${where}）`)
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

  /** GET /api/status：应用版本、引擎进程状态与版本、当前下载目录 */
  private async buildStatus(): Promise<Record<string, unknown>> {
    const settings = getSettingsFresh()
    const info = this.deps.getEngineProcessInfo()

    let engineVersion = ''
    if (info.isRunning) {
      try {
        const result = await callAria2Rpc({
          port: settings?.aria2?.port ?? 6800,
          secret: settings?.aria2?.secret ?? '',
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
