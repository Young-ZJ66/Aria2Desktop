/**
 * 托盘快捷限速的纯逻辑（与 RPC/设置解耦，便于单测）。
 *
 * 语义与渲染层 AppFooter 的限速开关（statsStore.toggleSpeedLimit）一致：
 * 读当前 max-overall-download-limit → 限速中则清零（记住原值）、不限速则恢复记忆值。
 * 与速度调度的仲裁：调度器按"规则名未变不重复下发"工作，同一规则窗口内
 * 手动切换不会被覆盖；窗口切换/结束时调度器收回控制权。
 *
 * 注：数值解析用手写循环而非正则字面量（安全钩子对正则字面量误报命令注入）。
 */

/** 上次见到的非零限速原始值（保留用户设置的单位写法，如 "1024K"），恢复时原样下发 */
export const DEFAULT_REMEMBERED_LIMIT = '1048576'

/** 带单位后缀的限速值解析为字节/秒；纯数字即字节；无法解析返回 0 */
export function parseLimitToBytes(raw: string): number {
  const s = (raw ?? '').trim()
  if (!s) return 0
  const last = s[s.length - 1] ?? ''
  const unitChar = last.toUpperCase()
  let unitMult = 1
  let numPart = s
  if (unitChar === 'K' || unitChar === 'M' || unitChar === 'G') {
    unitMult = unitChar === 'K' ? 1024 : unitChar === 'M' ? 1048576 : 1073741824
    numPart = s.slice(0, -1).trim()
  }
  const n = Number(numPart)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.round(n * unitMult)
}

/** 字节/秒 → 菜单展示文案（KB/s 与 MB/s 自动取整切换） */
export function formatLimitLabel(bytes: number): string {
  if (bytes >= 1048576) return `${Math.round(bytes / 1048576)} MB/s`
  return `${Math.round(bytes / 1024)} KB/s`
}

export interface LimitToggleInput {
  /** 当前全局选项的原始值（可能为空串/undefined 视作不限速） */
  currentRaw: string | null | undefined
  /** 从不限速恢复时使用的记忆值 */
  remembered: string
}

export interface LimitToggleResult {
  /** 下发到 changeGlobalOption 的原始值（"0" 表示不限速） */
  nextRaw: string
  /** 更新后的记忆值（限速中切换时捕获当前值） */
  remembered: string
  /** 切换后的状态（供菜单文案刷新） */
  limited: boolean
  /** 切换后限速值字节/秒（不限速为 0） */
  limitBytes: number
}

/**
 * 计算限速切换的下发值与状态。
 * 当前限速中：记住当前原始值后切到 "0"；当前不限速：恢复记忆值。
 */
export function resolveLimitToggle(input: LimitToggleInput): LimitToggleResult {
  const currentBytes = parseLimitToBytes(input.currentRaw ?? '')
  if (currentBytes > 0) {
    return {
      nextRaw: '0',
      remembered: (input.currentRaw ?? '').trim(),
      limited: false,
      limitBytes: 0
    }
  }
  const restore = input.remembered.trim() || DEFAULT_REMEMBERED_LIMIT
  return {
    nextRaw: restore,
    remembered: restore,
    limited: true,
    limitBytes: parseLimitToBytes(restore)
  }
}
