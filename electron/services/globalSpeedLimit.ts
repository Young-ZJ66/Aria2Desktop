/**
 * 全局限速的读取入口（供 aria2 之外的下载体共用）。
 *
 * 为什么需要它：全局限速的唯一权威来源是 aria2 的 max-overall-download-limit
 * 全局选项（内存态，引擎重启后回到配置文件里的值）。yt-dlp 的流媒体任务不进
 * aria2 队列，拿不到这个限制，于是"限速 1MB/s"对流媒体任务完全无效（D-10）。
 * yt-dlp 只能通过自己的 --limit-rate 参数限速，所以下载启动前必须先把这个值读出来。
 *
 * 读失败一律按"不限速"（0）处理：引擎没起来、RPC 超时、密钥不匹配都不该让
 * 流媒体下载失败——用户按下下载的意图优先，限速只是锦上添花。
 */

import { callAria2Rpc } from '../utils/aria2Rpc'
import { activeRpcOptions } from '../utils/activeRpcConfig'
import { getSettingsFresh } from '../utils/settingsAccessor'
import { parseLimitToBytes } from '../utils/speedLimitCore'
import { createLogger } from '../utils/logger'

const logger = createLogger('GlobalSpeedLimit')

/** aria2 里承载全局限速的全局选项名 */
export const GLOBAL_LIMIT_OPTION = 'max-overall-download-limit'

/**
 * 读取超时（毫秒）。
 * 刻意比其它 RPC 调用（默认 5000ms）短：这段延迟会加在"用户点下载到进程真正启动"
 * 之间，用户对这段时间的容忍度很低；读不到就当不限速，没必要让界面干等。
 */
export const GLOBAL_LIMIT_READ_TIMEOUT_MS = 1200

/**
 * 读当前全局限速（字节/秒；0 表示不限速）。
 *
 * 每次调用都直连 RPC 读：限速可能被渲染层、托盘、速度调度器、扩展 MCP 任一入口改过，
 * 主进程里没有可靠的缓存失效信号，缓存反而会下发过期值。
 */
export async function readGlobalSpeedLimitBytes(
  timeoutMs: number = GLOBAL_LIMIT_READ_TIMEOUT_MS
): Promise<number> {
  try {
    const options = (await callAria2Rpc({
      ...activeRpcOptions(getSettingsFresh()),
      method: 'aria2.getGlobalOption',
      timeoutMs
    })) as Record<string, string> | undefined
    return parseLimitToBytes(options?.[GLOBAL_LIMIT_OPTION] ?? '')
  } catch (error) {
    // debug 级别：引擎未运行是常态（用户可以先排队流媒体任务再启动引擎）
    logger.debug('读取全局限速失败，按不限速处理:', error)
    return 0
  }
}
