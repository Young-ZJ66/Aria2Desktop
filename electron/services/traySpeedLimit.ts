/**
 * 托盘快捷限速切换（主进程直连引擎 RPC，不经渲染层——托盘在窗口隐藏时也必须可用）。
 *
 * 与渲染层 AppFooter 的限速开关语义一致：两者都在动作时读当前全局选项再切换，
 * 因此天然保持一致；记忆值各自独立（会话级，不写设置）。
 * 与速度调度的仲裁见 speedLimitCore 头注释：同一规则窗口内手动切换不被覆盖，
 * 窗口切换/结束、引擎重启（scheduler.reapply）时调度器收回控制权。
 */

import { callAria2Rpc } from '../utils/aria2Rpc'
import { getSettingsFresh } from '../utils/settingsAccessor'
import { activeRpcOptions } from '../utils/activeRpcConfig'
import { createLogger } from '../utils/logger'
import { parseLimitToBytes, resolveLimitToggle } from '../utils/speedLimitCore'

// 本文件日志文案自带 [TraySpeedLimit] 前缀（历史风格），故 scope 传空避免前缀重复
const logger = createLogger('')

/** 从不限速恢复时使用的记忆值（会话级） */
let rememberedLimit = '1048576'

/** 托盘菜单刷新用的状态快照 */
export interface SpeedLimitSnapshot {
  limited: boolean
  /** 限速值字节/秒（不限速为 0） */
  limitBytes: number
}

function engineRpcConfig(): ReturnType<typeof activeRpcOptions> {
  return activeRpcOptions(getSettingsFresh())
}

/** 读取当前限速状态（引擎不可达返回 null，调用方保持菜单原文案） */
export async function readSpeedLimit(): Promise<SpeedLimitSnapshot | null> {
  const rpc = engineRpcConfig()
  try {
    const options = await callAria2Rpc({
      ...rpc,
      method: 'aria2.getGlobalOption'
    })
    const raw = (options as Record<string, string> | undefined)?.['max-overall-download-limit']
    const bytes = parseLimitToBytes(raw ?? '')
    if (bytes > 0) rememberedLimit = (raw ?? '').trim()
    return { limited: bytes > 0, limitBytes: bytes }
  } catch (error) {
    logger.warn('[TraySpeedLimit] 读取限速状态失败（引擎未运行？）:', error)
    return null
  }
}

/** 切换限速并返回切换后的状态（读取或下发失败返回 null，调用方保持菜单原文案） */
export async function toggleSpeedLimit(): Promise<SpeedLimitSnapshot | null> {
  const rpc = engineRpcConfig()
  try {
    const options = await callAria2Rpc({
      ...rpc,
      method: 'aria2.getGlobalOption'
    })
    const raw = (options as Record<string, string> | undefined)?.['max-overall-download-limit']

    const decision = resolveLimitToggle({ currentRaw: raw, remembered: rememberedLimit })
    rememberedLimit = decision.remembered

    await callAria2Rpc({
      ...rpc,
      method: 'aria2.changeGlobalOption',
      params: [{ 'max-overall-download-limit': decision.nextRaw }]
    })
    logger.info(`[TraySpeedLimit] 限速切换 → ${decision.nextRaw}`)
    return { limited: decision.limited, limitBytes: decision.limitBytes }
  } catch (error) {
    logger.warn('[TraySpeedLimit] 切换限速失败:', error)
    return null
  }
}
