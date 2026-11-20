import { describe, expect, it, vi } from 'vitest'
import {
  ONBOARDING_STEPS,
  ONBOARDING_STORAGE_KEY,
  completeOnboarding,
  createInitialState,
  handleStep,
  isAllStepsHandled,
  loadOnboardingState,
  nextPendingStep,
  parseOnboardingState,
  saveOnboardingState,
  shouldShowOnboarding,
  skipOnboarding,
  type OnboardingState,
  type OnboardingStorage
} from './onboardingState'

function memoryStorage(initial: Record<string, string> = {}): OnboardingStorage & { data: Record<string, string> } {
  const data = { ...initial }
  return {
    data,
    getItem: (key: string) => (key in data ? data[key] : null),
    setItem: (key: string, value: string) => {
      data[key] = value
    }
  }
}

describe('onboardingState（D-31 首次启动向导状态）', () => {
  it('初始状态是 pending 且没有任何已处理步骤', () => {
    const state = createInitialState(1000)
    expect(state.status).toBe('pending')
    expect(state.handledSteps).toEqual([])
    expect(state.updatedAt).toBe(1000)
    expect(shouldShowOnboarding(state)).toBe(true)
  })

  it('四步顺序固定为 下载目录 → 扩展 → yt-dlp → 远程', () => {
    expect(ONBOARDING_STEPS).toEqual(['download', 'extension', 'ytdlp', 'remote'])
  })

  it('handleStep 记录步骤且去重，不改动其它步骤', () => {
    const first = handleStep(createInitialState(1), 'download', 2)
    expect(first.handledSteps).toEqual(['download'])
    expect(first.updatedAt).toBe(2)

    // 重复处理同一步不产生重复项，且返回原对象（不无谓触发持久化）
    const again = handleStep(first, 'download', 3)
    expect(again).toBe(first)
  })

  it('四步全部处理完才算完成，nextPendingStep 返回 null', () => {
    let state: OnboardingState = createInitialState(1)
    expect(nextPendingStep(state)).toBe('download')

    state = handleStep(state, 'download')
    expect(nextPendingStep(state)).toBe('extension')
    expect(isAllStepsHandled(state)).toBe(false)

    state = handleStep(state, 'extension')
    state = handleStep(state, 'ytdlp')
    expect(nextPendingStep(state)).toBe('remote')

    state = handleStep(state, 'remote')
    expect(isAllStepsHandled(state)).toBe(true)
    expect(nextPendingStep(state)).toBeNull()
  })

  it('completeOnboarding / skipOnboarding 之后不再自动弹出', () => {
    const completed = completeOnboarding(createInitialState(1), 9)
    expect(completed.status).toBe('completed')
    expect(completed.updatedAt).toBe(9)
    expect(shouldShowOnboarding(completed)).toBe(false)

    const skipped = skipOnboarding(createInitialState(1), 10)
    expect(skipped.status).toBe('skipped')
    expect(skipped.updatedAt).toBe(10)
    expect(shouldShowOnboarding(skipped)).toBe(false)
  })

  it('parseOnboardingState 容忍损坏数据：非法状态回落 pending，非步骤项被过滤', () => {
    expect(parseOnboardingState(null, 5)).toEqual({ status: 'pending', handledSteps: [], updatedAt: 5 })
    expect(parseOnboardingState('nope', 5)).toEqual({ status: 'pending', handledSteps: [], updatedAt: 5 })

    const parsed = parseOnboardingState(
      { status: 'bogus', handledSteps: ['download', 'unknown-step', 42], updatedAt: 'x' },
      7
    )
    expect(parsed.status).toBe('pending')
    expect(parsed.handledSteps).toEqual(['download'])
    expect(parsed.updatedAt).toBe(7)
  })

  it('loadOnboardingState 无 storage / 无记录 / 坏 JSON 都退回初始态', () => {
    expect(loadOnboardingState(null, 3).status).toBe('pending')
    expect(loadOnboardingState(memoryStorage(), 3).status).toBe('pending')

    const broken = memoryStorage({ [ONBOARDING_STORAGE_KEY]: '{not json' })
    expect(loadOnboardingState(broken, 3)).toEqual(createInitialState(3))
  })

  it('loadOnboardingState 能读回已保存的完成状态（重启后不再打扰）', () => {
    const storage = memoryStorage()
    const state = completeOnboarding(handleStep(createInitialState(1), 'download'), 2)
    saveOnboardingState(storage, state)
    expect(loadOnboardingState(storage)).toEqual(state)
  })

  it('saveOnboardingState 在 storage 抛错时静默忽略', () => {
    const throwing: OnboardingStorage = {
      getItem: () => null,
      setItem: vi.fn(() => {
        throw new Error('quota exceeded')
      })
    }
    expect(() => saveOnboardingState(throwing, createInitialState())).not.toThrow()
    expect(() => saveOnboardingState(null, createInitialState())).not.toThrow()
  })
})
