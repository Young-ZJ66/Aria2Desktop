/**
 * D-31 首次启动向导的状态持久化。
 *
 * 抽成独立模块而不是塞在组件里：向导「完成 / 跳过 / 进行到第几步」都必须跨重启
 * 记住，否则用户每次启动都会被同一个弹窗拦住——这是最容易招人烦的一类设计。
 * 状态读写用可注入的 storage，方便在 node 环境单测（项目没有 happy-dom）。
 */

/** 四步：下载目录 / 浏览器扩展配对 / yt-dlp / 远程访问 */
export type OnboardingStepId = 'download' | 'extension' | 'ytdlp' | 'remote'

export const ONBOARDING_STEPS: readonly OnboardingStepId[] = [
  'download',
  'extension',
  'ytdlp',
  'remote'
] as const

/** pending=尚未完成，completed=走完全部步骤，skipped=用户主动跳过 */
export type OnboardingStatus = 'pending' | 'completed' | 'skipped'

export interface OnboardingState {
  status: OnboardingStatus
  /** 已经处理过的步骤（完成或点了「稍后再说」都算，避免重复打扰） */
  handledSteps: OnboardingStepId[]
  /** 最后更新时间，便于以后做「N 天后重新提示」之类策略 */
  updatedAt: number
}

export const ONBOARDING_STORAGE_KEY = 'onboarding.v1'

export function createInitialState(now = Date.now()): OnboardingState {
  return { status: 'pending', handledSteps: [], updatedAt: now }
}

function isStepId(value: unknown): value is OnboardingStepId {
  return typeof value === 'string' && (ONBOARDING_STEPS as readonly string[]).includes(value)
}

/** 解析存储内容；损坏或结构不对时当作「从未引导过」，而不是抛错卡住启动 */
export function parseOnboardingState(raw: unknown, now = Date.now()): OnboardingState {
  if (!raw || typeof raw !== 'object') return createInitialState(now)
  const data = raw as Partial<OnboardingState>
  const status: OnboardingStatus =
    data.status === 'completed' || data.status === 'skipped' ? data.status : 'pending'
  const handledSteps = Array.isArray(data.handledSteps)
    ? data.handledSteps.filter(isStepId)
    : []
  return {
    status,
    handledSteps,
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : now
  }
}

/** 是否应该在启动时弹出向导：只有 pending 才弹 */
export function shouldShowOnboarding(state: OnboardingState): boolean {
  return state.status === 'pending'
}

/** 标记某一步已处理（完成或「稍后再说」），并推进到下一步 */
export function handleStep(
  state: OnboardingState,
  step: OnboardingStepId,
  now = Date.now()
): OnboardingState {
  if (state.handledSteps.includes(step)) return state
  return { ...state, handledSteps: [...state.handledSteps, step], updatedAt: now }
}

/** 全部步骤都处理过 → 自动视为完成 */
export function isAllStepsHandled(state: OnboardingState): boolean {
  return ONBOARDING_STEPS.every(step => state.handledSteps.includes(step))
}

export function completeOnboarding(state: OnboardingState, now = Date.now()): OnboardingState {
  return { ...state, status: 'completed', updatedAt: now }
}

/** 跳过向导：此后不再自动弹出（本迭代不提供设置页重开入口，仅保留状态以便后续接入） */
export function skipOnboarding(state: OnboardingState, now = Date.now()): OnboardingState {
  return { ...state, status: 'skipped', updatedAt: now }
}

/** 下一个尚未处理的步骤；全部处理完返回 null */
export function nextPendingStep(state: OnboardingState): OnboardingStepId | null {
  return ONBOARDING_STEPS.find(step => !state.handledSteps.includes(step)) ?? null
}

/** 存储接口：只用到 getItem / setItem，便于测试注入 */
export interface OnboardingStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** 从 storage 读取状态；任何异常都退回初始态（引导状态不该阻塞启动） */
export function loadOnboardingState(
  storage: OnboardingStorage | null | undefined,
  now = Date.now()
): OnboardingState {
  if (!storage) return createInitialState(now)
  try {
    const raw = storage.getItem(ONBOARDING_STORAGE_KEY)
    if (!raw) return createInitialState(now)
    return parseOnboardingState(JSON.parse(raw), now)
  } catch {
    return createInitialState(now)
  }
}

/** 写入 storage；失败（隐私模式 / 配额满）时静默忽略，最多是下次再问一遍 */
export function saveOnboardingState(
  storage: OnboardingStorage | null | undefined,
  state: OnboardingState
): void {
  if (!storage) return
  try {
    storage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // 存不下就算了：不因为一次持久化失败打断用户的当前操作
  }
}
