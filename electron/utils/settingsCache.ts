/**
 * 极简的"读一次、缓存住、可失效"缓存（纯逻辑，**禁止 import electron**）。
 *
 * 为什么单独拆出这一层：缓存语义（命中 / 失效 / 写后读一致）是本项目最容易出错的点之一——
 * 一旦出现"写完还读到旧值"，表现就是"改了密钥但 RPC 鉴权仍用旧密钥 → 连不上"这类难查的故障。
 * 这类逻辑必须能在不依赖 electron 的环境下被单测覆盖。
 *
 * 用 hasCache 布尔位而不是 `cached !== undefined` 判断是否已缓存：
 * T 本身可能就是 undefined（例如 store 里没有 settings 键时的兜底值），用值判断会反复重读。
 */

export interface SettingsCache<T> {
  /** 读缓存；未缓存时调用 read() 一次并缓存 */
  get(): T
  /** 强制重新读取并刷新缓存 */
  reload(): T
  /** 使缓存失效；下次 get() 会重新读取 */
  invalidate(): void
  /** 直接用给定值填充缓存（写入路径调用，避免"写完立刻读"再解析一次） */
  set(next: T): void
}

export function createSettingsCache<T>(read: () => T): SettingsCache<T> {
  let cached: T | undefined
  let hasCache = false

  return {
    get(): T {
      if (!hasCache) {
        cached = read()
        hasCache = true
      }
      return cached as T
    },

    reload(): T {
      cached = read()
      hasCache = true
      return cached as T
    },

    invalidate(): void {
      cached = undefined
      hasCache = false
    },

    set(next: T): void {
      cached = next
      hasCache = true
    }
  }
}
