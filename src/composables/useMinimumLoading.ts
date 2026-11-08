/**
 * 最短加载时长工具。
 *
 * 本机检测、刷新状态等操作经常在几毫秒内完成，按钮的 loading 状态
 * 会在同一个绘制帧内 true → false，看起来只是“闪一下”，用户无法确认
 * 操作是否执行。统一让这类操作至少持续 minMs，保证加载动画可见。
 *
 * 仅影响 UI 反馈时长，不改变操作本身的返回值或异常。
 */
import type { Ref } from 'vue'

const DEFAULT_MIN_MS = 450

export async function withMinimumDuration<T>(
  action: () => Promise<T>,
  minMs = DEFAULT_MIN_MS
): Promise<T> {
  const startedAt = Date.now()
  try {
    return await action()
  } finally {
    const remaining = minMs - (Date.now() - startedAt)
    if (remaining > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, remaining))
    }
  }
}

/** 已记录开始时间时，补齐剩余的最短加载时长（供手动管理 loading 的场景使用） */
export async function ensureMinimumDuration(
  startedAt: number,
  minMs = DEFAULT_MIN_MS
): Promise<void> {
  const remaining = minMs - (Date.now() - startedAt)
  if (remaining > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, remaining))
  }
}

/** 同时管理一个 boolean loading ref 的最短加载版本 */
export async function runWithMinimumLoading<T>(
  loading: Ref<boolean>,
  action: () => Promise<T>,
  minMs = DEFAULT_MIN_MS
): Promise<T> {
  loading.value = true
  try {
    return await withMinimumDuration(action, minMs)
  } finally {
    loading.value = false
  }
}
