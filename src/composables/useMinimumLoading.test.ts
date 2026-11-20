import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { ensureMinimumDuration, runWithMinimumLoading, withMinimumDuration } from './useMinimumLoading'

/**
 * 最短加载时长的回归测试。
 *
 * 这些函数只影响「loading 动画可见性」，但两条不变量必须成立：
 * 1) 动作本身抛错要原样抛出（不能被时长补齐吞掉）；
 * 2) 动作耗时超过最短时长时不能额外拖延（否则慢请求会被人为再加 450ms）。
 */
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('withMinimumDuration', () => {
  it('动作很快完成时补齐到最短时长', async () => {
    let done = false
    const promise = withMinimumDuration(async () => 'ok', 450).then((value) => { done = true; return value })
    await vi.advanceTimersByTimeAsync(0)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(449)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(promise).resolves.toBe('ok')
  })

  it('动作耗时超过最短时长时不额外等待', async () => {
    const promise = withMinimumDuration(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600))
      return 'slow'
    }, 450)
    await vi.advanceTimersByTimeAsync(600)
    await expect(promise).resolves.toBe('slow')
  })

  it('动作抛错时原样抛出（不能因为补齐时长被吞掉）', async () => {
    const promise = withMinimumDuration(async () => { throw new Error('boom') }, 450)
    const assertion = expect(promise).rejects.toThrow('boom')
    await vi.advanceTimersByTimeAsync(450)
    await assertion
  })
})

describe('ensureMinimumDuration', () => {
  it('已超时则不等待', async () => {
    const startedAt = Date.now() - 1000
    let done = false
    const promise = ensureMinimumDuration(startedAt, 450).then(() => { done = true })
    await vi.advanceTimersByTimeAsync(0)
    await promise
    expect(done).toBe(true)
  })

  it('不足时补齐剩余时长', async () => {
    const startedAt = Date.now()
    let done = false
    const promise = ensureMinimumDuration(startedAt, 450).then(() => { done = true })
    await vi.advanceTimersByTimeAsync(449)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await promise
    expect(done).toBe(true)
  })
})

describe('runWithMinimumLoading', () => {
  it('执行期间 loading 为 true，结束后复位', async () => {
    const loading = ref(false)
    const promise = runWithMinimumLoading(loading, async () => 'ok', 450)
    expect(loading.value).toBe(true)
    await vi.advanceTimersByTimeAsync(450)
    await expect(promise).resolves.toBe('ok')
    expect(loading.value).toBe(false)
  })

  it('动作抛错时 loading 也要复位', async () => {
    const loading = ref(false)
    const promise = runWithMinimumLoading(loading, async () => { throw new Error('boom') }, 450)
    const assertion = expect(promise).rejects.toThrow('boom')
    await vi.advanceTimersByTimeAsync(450)
    await assertion
    expect(loading.value).toBe(false)
  })
})
