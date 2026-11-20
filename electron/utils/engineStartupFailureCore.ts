/**
 * 引擎启动失败的分类与建议动作（纯函数，独立于 electron / 子进程，便于单测）。
 *
 * 背景：过去启动失败只弹一个笼统的「可执行文件缺失 / 端口被占用 / 配置文件错误」三选一，
 * 用户点完「继续」就没有下文了。其实底层早就知道得更清楚 ——
 * reclaimLeftoverEngineOnPort 会用 classifyRpcPortProbe 判定端口上到底蹲着什么
 * （遗留的本应用引擎 / 别的 aria2 / 非 aria2 服务 / 没人监听），
 * 只是这些结论没有翻译成「下一步该点哪里」。本模块负责这层翻译。
 */

/** 引擎启动失败的类型（与端口探测结论对齐，另加进程/配置类） */
export type EngineStartupFailureKind =
  | 'port-occupied-other-aria2'
  | 'port-non-aria2'
  | 'leftover-engine'
  | 'port-in-use-unknown'
  | 'missing-executable'
  | 'config-error'
  | 'unknown'

/** 建议动作（continue / quit 恒排在末尾，其余按有用程度排序） */
export type EngineStartupAction = 'change-port' | 'retry' | 'open-logs' | 'continue' | 'quit'

export interface EngineStartupFailureInfo {
  kind: EngineStartupFailureKind
  /** 一句话说明到底发生了什么（对话框正文首段） */
  summary: string
  /** 建议的下一步（对话框正文次段） */
  hint: string
  /** 按钮顺序即动作顺序 */
  actions: EngineStartupAction[]
  /** 是否值得让用户原地重试（端口类问题常常再试一次就好了） */
  retryable: boolean
}

/** 对话框按钮文案（主进程没有 i18n 上下文，与既有对话框一样固定中文） */
export const ENGINE_STARTUP_ACTION_LABELS: Record<EngineStartupAction, string> = {
  'change-port': '更换端口',
  retry: '重试启动',
  'open-logs': '查看日志',
  continue: '继续使用',
  quit: '退出应用'
}

/** 端口号从错误信息里抠出来（用于提示文案），找不到返回 null */
export function extractPortFromError(message: string): number | null {
  if (!message) return null
  const matched = message.match(/端口\s*(\d{2,5})/) ?? message.match(/port\s*(\d{2,5})/i)
  if (!matched) return null
  const port = Number(matched[1])
  return Number.isFinite(port) && port > 0 && port <= 65535 ? port : null
}

/**
 * 把启动失败归类。
 *
 * 判定顺序按「信息可靠度」从高到低：
 * 1. 端口探测已经给出明确结论的（reclaimLeftoverEngineOnPort 抛的那几条中文错误）
 * 2. 可执行文件 / 配置文件这类本地环境问题
 * 3. 兜底 unknown
 */
export function classifyEngineStartupError(error: unknown): EngineStartupFailureKind {
  const message = error instanceof Error ? error.message : String(error ?? '')
  if (!message) return 'unknown'
  const text = message.toLowerCase()

  // 端口上蹲着另一个 aria2（不认可本机密钥），不能自动杀
  if (message.includes('已被另一个 aria2 实例占用')) return 'port-occupied-other-aria2'
  // 端口上的服务根本不是 aria2
  if (message.includes('上监听的服务不是 aria2')) return 'port-non-aria2'
  // 本应用遗留的引擎没能退出
  if (message.includes('遗留 aria2 实例未能退出')) return 'leftover-engine'
  // 端口被占但没有更细的结论
  if (message.includes('端口是否被其它程序占用') || message.includes('端口已被占用')) {
    return 'port-in-use-unknown'
  }
  if (text.includes('eaddrinuse')) return 'port-in-use-unknown'

  // 可执行文件缺失 / 不可执行
  if (message.includes('可执行文件不存在') || message.includes('可执行文件缺失')) {
    return 'missing-executable'
  }
  if (message.includes('不可执行') || message.includes('权限')) return 'missing-executable'
  if (text.includes('enoent')) return 'missing-executable'

  // 配置文件 / 配置同步
  if (message.includes('配置文件同步验证失败') || message.includes('配置读取失败')) {
    return 'config-error'
  }

  return 'unknown'
}

/** 按类型给出说明、建议与按钮 */
export function buildEngineStartupFailureInfo(
  error: unknown,
  portHint?: number | null
): EngineStartupFailureInfo {
  const message = error instanceof Error ? error.message : String(error ?? '')
  const port = portHint ?? extractPortFromError(message)
  const portLabel = port === null ? '当前端口' : `端口 ${port}`
  const kind = classifyEngineStartupError(error)

  switch (kind) {
    case 'port-occupied-other-aria2':
      return {
        kind,
        summary: `${portLabel} 已被另一个 aria2 实例占用，且该实例不认可本应用的 RPC 密钥。`,
        hint: '为避免误杀其它下载器，本应用不会自动结束它。请关闭那个 aria2 实例，或在「设置 → 引擎设置」里换一个 rpc-listen-port 后重试。',
        actions: ['change-port', 'retry', 'open-logs', 'continue', 'quit'],
        retryable: true
      }
    case 'port-non-aria2':
      return {
        kind,
        summary: `${portLabel} 上监听的服务不是 aria2（响应不是合法的 JSON-RPC）。`,
        hint: '请关闭占用该端口的程序，或在「设置 → 引擎设置」里换一个 rpc-listen-port 后重试。',
        actions: ['change-port', 'retry', 'open-logs', 'continue', 'quit'],
        retryable: true
      }
    case 'leftover-engine':
      return {
        kind,
        summary: `${portLabel} 上的遗留 aria2 进程未能退出，导致新引擎无法绑定。`,
        hint: '请在任务管理器里结束残留的 aria2c 进程，然后点「重试启动」。',
        actions: ['retry', 'open-logs', 'change-port', 'continue', 'quit'],
        retryable: true
      }
    case 'port-in-use-unknown':
      return {
        kind,
        summary: `${portLabel} 可能已被其它程序占用，引擎未能开始监听。`,
        hint: '可以点「重试启动」；若反复失败，请在「设置 → 引擎设置」里换一个 rpc-listen-port，或先关闭占用该端口的程序。',
        actions: ['retry', 'change-port', 'open-logs', 'continue', 'quit'],
        retryable: true
      }
    case 'missing-executable':
      return {
        kind,
        summary: '找不到可用的 aria2 可执行文件（或没有执行权限）。',
        hint: '请在「设置 → 引擎设置」里确认引擎路径；若文件确实存在，请检查它是否被安全软件隔离、以及是否有执行权限。',
        actions: ['open-logs', 'retry', 'continue', 'quit'],
        retryable: false
      }
    case 'config-error':
      return {
        kind,
        summary: '引擎配置文件读写异常，启动被中止。',
        hint: '请查看日志确认是哪一项配置出错；本应用会拒绝写入无法解析的 aria2.conf，以免覆盖你的手工配置。',
        actions: ['open-logs', 'retry', 'continue', 'quit'],
        retryable: false
      }
    default:
      return {
        kind: 'unknown',
        summary: '下载引擎启动失败。',
        hint: '可以点「重试启动」再试一次；若仍然失败，请打开日志查看详细原因。',
        actions: ['retry', 'open-logs', 'continue', 'quit'],
        retryable: true
      }
  }
}
