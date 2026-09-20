import log from 'electron-log/main'
import { app } from 'electron'

/**
 * 主进程统一日志（electron-log 薄封装）。
 *
 * 为什么封装而不是直接在各文件调 electron-log：
 * 1. **固定模块前缀**：各模块调 `createLogger('WindowController')`，输出统一为 `[WindowController] 消息`，
 *    与项目既有日志风格一致（不依赖 electron-log 的 scope 渲染细节，避免升级后前缀形态变化）。
 * 2. **集中级别策略**：生产只把 warn/error 打到控制台（降噪），info 及以上仍落盘供排查用户问题。
 * 3. **便于测试 mock**：不替换全局 console（那会造成隐式耦合），各模块显式持有 logger。
 *
 * 级别策略（在 setupLogging 中设置）：
 * - 文件 `<userData>/logs/main.log`：`info` 及以上，5MB 轮转（用户报障时可回溯完整启动/运行流程）
 * - 控制台：开发 `debug` 全量；生产 `warn`（避免刷屏，需要细节看日志文件）
 *
 * 安全红线：密钥、令牌等敏感值一律不得写入日志（见各调用点的脱敏注释）。
 */

/** 提供给各模块的日志方法（与 console 的常用方法对齐，便于平滑迁移） */
export interface ScopedLogger {
  debug(message: string, ...args: unknown[]): void
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

let initialized = false

/**
 * 初始化日志（在 main.ts 入口尽早调用一次）。
 * 幂等：重复调用只生效一次。
 */
export function setupLogging(): void {
  if (initialized) return
  initialized = true

  // 未打包（开发）时控制台全量输出，打包后只留 warn/error
  const isDev = !app.isPackaged

  // 文件：保留 info 及以上；路径使用 electron-log 默认（<userData>/logs/main.log），
  // 与项目其它数据（config/aria2/persisted-tasks）同处 userData，便于整体收集
  log.transports.file.level = 'info'
  log.transports.file.maxSize = 5 * 1024 * 1024

  // 控制台：开发 debug、生产 warn
  log.transports.console.level = isDev ? 'debug' : 'warn'

  log.info(`[Logger] 日志已初始化（控制台级别=${isDev ? 'debug' : 'warn'}，文件级别=info）`)
}

/**
 * 创建带固定模块前缀的 logger。
 * @param scope 模块名（如 'WindowController'），输出形如 `[WindowController] 消息`
 */
export function createLogger(scope: string): ScopedLogger {
  const prefix = scope ? `[${scope}]` : ''
  const withPrefix = (message: string): string => (prefix ? `${prefix} ${message}` : message)
  return {
    debug: (message: string, ...args: unknown[]) => log.debug(withPrefix(message), ...args),
    info: (message: string, ...args: unknown[]) => log.info(withPrefix(message), ...args),
    warn: (message: string, ...args: unknown[]) => log.warn(withPrefix(message), ...args),
    error: (message: string, ...args: unknown[]) => log.error(withPrefix(message), ...args)
  }
}
