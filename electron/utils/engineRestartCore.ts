/**
 * 引擎自动重启的策略（纯函数，独立于 electron / 子进程，便于单测）。
 *
 * 背景：`start()` 成功后无条件把 retryCount 清零，于是一个"能起来、几秒后就崩"
 * 的引擎（配置里某个值让 aria2 读会话文件就退出、端口被防火墙拦掉等）会无限循环：
 * 启动 → 崩 → 等 3 秒 → 启动 → 计数清零……既不会触发"重启次数超限"的止损，
 * 又会每 6 秒弹一次"引擎意外退出"的提示，日志也跟着刷屏。
 */

/** 进程存活超过这个时长，才算"这次启动是稳定的"，可以清零重试计数 */
export const STABLE_UPTIME_MS = 60_000

/** 首次重试间隔与上限：3s → 6s → 12s，封顶 30s */
export const BASE_RESTART_DELAY_MS = 3_000
export const MAX_RESTART_DELAY_MS = 30_000

/**
 * 第 `retryCount` 次重试前要等多久（retryCount 从 1 开始）。
 * 指数退避，避免崩溃循环时每 3 秒锤一次。
 */
export function nextRestartDelayMs(retryCount: number): number {
  const attempt = Number.isFinite(retryCount) && retryCount > 1 ? Math.floor(retryCount) : 1
  const delay = BASE_RESTART_DELAY_MS * 2 ** (attempt - 1)
  return Math.min(delay, MAX_RESTART_DELAY_MS)
}

/**
 * 这次退出是否说明"上一轮启动是稳定的"——只有稳定过才把重试计数清零。
 * `uptimeMs` 为 0/负数（拿不到启动时间）时保守按"不稳定"处理。
 */
export function shouldResetRetryCount(uptimeMs: number): boolean {
  return Number.isFinite(uptimeMs) && uptimeMs >= STABLE_UPTIME_MS
}
