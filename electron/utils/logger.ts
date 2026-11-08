import log from 'electron-log/main'
import path from 'path'
import { isDevMode } from './appEnv'

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

  // 未打包（开发）时控制台全量输出，打包后只留 warn/error。
  // 口径统一走 appEnv（Electron 43 下 app.isPackaged 在开发态也可能为 true，见该模块注释）
  const isDev = isDevMode

  // 文件：保留 info 及以上；固定写到 <userData>/logs/main.log，
  // 与项目其它数据（config/aria2/persisted-tasks）同处 userData，便于整体收集
  log.transports.file.level = 'info'
  log.transports.file.maxSize = 5 * 1024 * 1024
  // electron-log 在 macOS 默认写到 ~/Library/Logs/<appName>，而 Windows/Linux 写到
  // <userData>/logs。统一固定到 userData：打包冒烟、用户“打开日志目录”和问题排查
  // 才能跨平台依赖同一个路径，也避免 ARIA2_E2E_USER_DATA 隔离目录漏掉日志。
  log.transports.file.resolvePathFn = (variables) =>
    path.join(variables.userData, 'logs', variables.fileName ?? 'main.log')

  // 控制台：开发 debug、生产 warn
  log.transports.console.level = isDev ? 'debug' : 'warn'

  log.info(`[Logger] 日志已初始化（控制台级别=${isDev ? 'debug' : 'warn'}，文件级别=info）`)
}

/**
 * 应用自身日志文件的绝对路径与所在目录。
 *
 * 用户报障时最需要的就是这个文件，但它藏在 userData 深层目录里，手动找起来很费劲；
 * 设置页的「打开日志目录」直接用它，不自己拼路径——electron-log 换存储位置时这里自动跟随。
 */
export function getLogFilePaths(): { file: string; dir: string } {
  const file = log.transports.file.getFile().path
  return { file, dir: path.dirname(file) }
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
