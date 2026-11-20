import { spawnSync } from 'child_process'
import * as net from 'net'
import { createLogger, type ScopedLogger } from '../utils/logger'

const logger = createLogger('EngineShutdownService')

/** 默认最长等待时间：与 Aria2ProcessManager 自身的优雅退出预算保持一致 */
export const DEFAULT_ENGINE_SHUTDOWN_MAX_WAIT_MS = 8000

export interface EngineProcessManagerLike {
  isRunning(): boolean
  stop(): Promise<boolean>
  getProcessInfo?: () => { isRunning?: boolean; pid?: number | null }
}

export interface EngineShutdownOptions {
  /** 延迟获取管理器：安装流程开始时管理器可能尚未初始化 */
  getProcessManager: () => EngineProcessManagerLike | null
  /** 当前 RPC 端口；返回 null 表示本次不检查端口释放 */
  getPort?: () => number | null
  /** 注入端口探活，默认使用本机 TCP 连接探测 */
  isPortInUse?: (port: number) => Promise<boolean>
  /** 注入强杀实现，默认 Windows taskkill /F /T、其它平台 SIGKILL */
  forceKill?: (pid: number) => void | Promise<void>
  getPid?: (manager: EngineProcessManagerLike) => number | null
  pollIntervalMs?: number
  /** 强杀后继续等待进程退出/端口释放的宽限时间 */
  forceKillWaitMs?: number
  sleep?: (ms: number) => Promise<void>
  logger?: ScopedLogger
}

export interface EngineShutdownResult {
  success: boolean
  /** 是否因为等待超时而执行了强杀 */
  forced: boolean
  /** 等满预算仍未确认进程退出且端口释放 */
  timedOut: boolean
  processExited: boolean
  portReleased: boolean
  waitedMs: number
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** 探测本机 TCP 端口是否仍有监听者。连接成功或超时都按“占用”处理，避免误判为已释放。 */
export function probeLocalPortInUse(port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const socket = net.createConnection({ host: '127.0.0.1', port })

    const finish = (inUse: boolean): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(inUse)
    }

    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

/** 轮询等待端口释放；返回 true 表示在预算内释放。 */
export async function waitForPortRelease(
  port: number,
  timeoutMs: number,
  isPortInUse: (port: number) => Promise<boolean> = probeLocalPortInUse,
  intervalMs = 100
): Promise<boolean> {
  const deadline = Date.now() + Math.max(0, timeoutMs)
  while (Date.now() <= deadline) {
    if (!(await isPortInUse(port))) return true
    if (Date.now() >= deadline) break
    await defaultSleep(intervalMs)
  }
  return false
}

/** 强制结束进程树：Windows 用 taskkill /F /T，类 Unix 用 SIGKILL。 */
export function forceKillProcessTree(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 0) return
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { windowsHide: true, stdio: 'ignore' })
    } else {
      process.kill(pid, 'SIGKILL')
    }
  } catch (error) {
    logger.warn(`[EngineShutdownService] 强制结束进程 ${pid} 失败:`, error)
  }
}

/**
 * 重启安装前的引擎关闭服务。
 *
 * 设计要点：
 * - 不直接 await manager.stop()：Aria2ProcessManager.stop() 内部最长可能等 16 秒（优雅退出 8s + SIGTERM 8s），
 *   而更新流程只允许等 8 秒；因此启动 stop 后并发轮询 isRunning/端口。
 * - 超时后主动强杀进程树，并继续等待一个短宽限期，尽量保证新版本启动时端口已空闲。
 * - 故意不把“端口是否释放”混入 Aria2ProcessManager 的职责：管理器只知道自己的 child，端口可能被它的子进程或遗留实例占着。
 */
export class EngineShutdownService {
  private readonly options: EngineShutdownOptions
  private readonly log: ScopedLogger

  constructor(options: EngineShutdownOptions) {
    this.options = options
    this.log = options.logger ?? logger
  }

  async requestShutdownAndWait(maxWaitMs = DEFAULT_ENGINE_SHUTDOWN_MAX_WAIT_MS): Promise<EngineShutdownResult> {
    const startedAt = Date.now()
    const pollIntervalMs = Math.max(10, this.options.pollIntervalMs ?? 100)
    const forceKillWaitMs = Math.max(0, this.options.forceKillWaitMs ?? 3000)
    const sleep = this.options.sleep ?? defaultSleep
    const isPortInUse = this.options.isPortInUse ?? probeLocalPortInUse
    const port = this.options.getPort?.() ?? null

    let manager = this.options.getProcessManager()
    let stopPromise: Promise<boolean> | null = null
    if (manager && manager.isRunning()) {
      // 与轮询并发执行，避免 stop() 自身的长等待吃掉我们的 maxWaitMs 预算
      stopPromise = Promise.resolve()
        .then(() => manager!.stop())
        .catch((error) => {
          this.log.warn('[EngineShutdownService] manager.stop() 失败（继续轮询进程状态）:', error)
          return false
        })
    }

    const checkPortReleased = async (): Promise<boolean> => {
      if (port === null || !Number.isInteger(port) || port <= 0) return true
      try {
        return !(await isPortInUse(port))
      } catch (error) {
        this.log.warn(`[EngineShutdownService] 探测端口 ${port} 失败，按占用处理:`, error)
        return false
      }
    }

    let processExited = !manager || !manager.isRunning()
    let portReleased = await checkPortReleased()

    while ((!processExited || !portReleased) && Date.now() - startedAt < maxWaitMs) {
      await sleep(Math.min(pollIntervalMs, Math.max(1, maxWaitMs - (Date.now() - startedAt))))
      manager = this.options.getProcessManager()
      processExited = !manager || !manager.isRunning()
      if (!portReleased) portReleased = await checkPortReleased()
    }

    let forced = false
    if (!processExited || !portReleased) {
      if (!processExited && manager) {
        const pid = this.options.getPid?.(manager) ?? manager.getProcessInfo?.()?.pid ?? null
        if (typeof pid === 'number' && pid > 0) {
          forced = true
          this.log.warn(`[EngineShutdownService] aria2 在 ${maxWaitMs}ms 内未退出，强制结束进程树 pid=${pid}`)
          try {
            if (this.options.forceKill) await this.options.forceKill(pid)
            else forceKillProcessTree(pid)
          } catch (error) {
            this.log.error('[EngineShutdownService] 强制结束 aria2 进程失败:', error)
          }
        } else {
          this.log.warn('[EngineShutdownService] aria2 未退出但拿不到 pid，无法强杀')
        }
      }

      const forceDeadline = Date.now() + forceKillWaitMs
      while ((!processExited || !portReleased) && Date.now() < forceDeadline) {
        await sleep(Math.min(pollIntervalMs, Math.max(1, forceDeadline - Date.now())))
        manager = this.options.getProcessManager()
        processExited = !manager || !manager.isRunning()
        if (!portReleased) portReleased = await checkPortReleased()
      }
    }

    // 不让仍在内部等待的 stop() 拖住调用方；它会在后台自然结束
    if (stopPromise) {
      await Promise.race([stopPromise.then(() => undefined), sleep(10)])
    }

    const success = processExited && portReleased
    const waitedMs = Date.now() - startedAt
    if (success) {
      this.log.info(
        `[EngineShutdownService] aria2 已关闭（进程退出=${processExited}, 端口释放=${portReleased}, 强制=${forced}, 耗时 ${waitedMs}ms）`
      )
    } else {
      this.log.warn(
        `[EngineShutdownService] 等待 aria2 关闭超时（进程退出=${processExited}, 端口释放=${portReleased}, 强制=${forced}, 耗时 ${waitedMs}ms）`
      )
    }

    return { success, forced, timedOut: !success, processExited, portReleased, waitedMs }
  }
}

export interface RestartAndInstallDeps {
  saveSession: (timeoutMs: number) => Promise<{ success: boolean; error?: string }>
  requestShutdownAndWait: (maxWaitMs: number) => Promise<EngineShutdownResult>
  restartAndInstall: () => Promise<{ success: boolean; error?: string }>
  restartEngine: () => Promise<{ success: boolean; error?: string }>
  logger?: ScopedLogger
}

export interface RestartAndInstallResult {
  success: boolean
  error?: string
  engineShutdown?: EngineShutdownResult
  engineRestart?: { success: boolean; error?: string }
}

/**
 * 更新安装编排：保存会话 → 等引擎退出/端口释放 → 打开安装程序；打开失败时重启引擎，避免用户留在“无引擎”状态。
 * 抽成纯编排函数便于单测覆盖三条关键路径（正常、超时强杀、openPath 失败重启）。
 */
export async function performRestartAndInstall(deps: RestartAndInstallDeps): Promise<RestartAndInstallResult> {
  const log = deps.logger ?? logger

  try {
    const saved = await deps.saveSession(3000)
    if (!saved.success) {
      log.warn('[UpdateInstall] 更新安装前保存 aria2 会话失败，未完成任务可能从恢复列表消失:', saved.error)
    }
  } catch (error) {
    log.warn('[UpdateInstall] 更新安装前保存 aria2 会话异常，继续安装流程:', error)
  }

  let engineShutdown: EngineShutdownResult | undefined
  try {
    engineShutdown = await deps.requestShutdownAndWait(DEFAULT_ENGINE_SHUTDOWN_MAX_WAIT_MS)
    if (!engineShutdown.success) {
      log.warn('[UpdateInstall] aria2 未能在预算内完全退出，安装程序仍将继续启动:', engineShutdown)
    }
  } catch (error) {
    log.warn('[UpdateInstall] 等待 aria2 关闭时异常，继续安装流程:', error)
  }

  let installResult: { success: boolean; error?: string }
  try {
    installResult = await deps.restartAndInstall()
  } catch (error) {
    installResult = { success: false, error: error instanceof Error ? error.message : String(error) }
  }

  if (installResult.success) {
    return { success: true, engineShutdown }
  }

  const errorMessage = installResult.error || '无法启动安装程序'
  log.error('[UpdateInstall] 启动安装程序失败，正在重启 aria2 引擎:', errorMessage)

  let engineRestart: { success: boolean; error?: string } | undefined
  try {
    engineRestart = await deps.restartEngine()
    if (!engineRestart.success) {
      log.error('[UpdateInstall] 安装失败后重启 aria2 引擎也失败:', engineRestart.error)
    }
  } catch (error) {
    engineRestart = { success: false, error: error instanceof Error ? error.message : String(error) }
    log.error('[UpdateInstall] 安装失败后重启 aria2 引擎异常:', error)
  }

  return { success: false, error: errorMessage, engineShutdown, engineRestart }
}
