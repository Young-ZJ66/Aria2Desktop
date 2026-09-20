import type Store from 'electron-store'
import { createSettingsCache, type SettingsCache } from './settingsCache'
import { decryptSettingsSecrets, encryptSettingsSecrets } from './secretCipher'
import type { StoreData, AppSettings } from '../types/store'

/**
 * 主进程读取 settings 的唯一入口（收敛此前 14 处重复的
 * `decryptSettingsSecrets(this.store.get('settings', {}) as AppSettings)`）。
 *
 * 收益与取舍（如实说明）：
 * - 主要收益是**统一口径**：读 / 强制重读 / 写 三条路径各自语义明确，不再散落各处；
 *   顺带消掉窗口事件路径（close、ready-to-show）上的重复解密——这正是当初的诉求。
 * - 性能收益本身有限（解密并不昂贵），所以**凡是有可能影响正确性的读，一律走直读**
 *   （见下方 getSettingsFresh 的适用场景），不为了性能牺牲新鲜度。
 *
 * 新鲜度为什么不退化（这是引入缓存的前提）：
 * - 改造前 `store.get('settings')` 取的是 electron-store 的**内存值**，外部改文件同样感知不到；
 * - 这里挂了 `onDidChange('settings')` 兜底，任何写入（含将来新增的写点）都会让缓存作废，
 *   而 conf（electron-store 底层）的变更事件是**同步 emit** 的，所以"写完立刻读"依然拿到新值。
 * - 结论：缓存与"每次直读"在新鲜度上等价，另有 saveSettings 的显式失效作为第二重保障。
 */

let boundStore: Store<StoreData> | null = null
let settingsCache: SettingsCache<AppSettings> | null = null

/** 解密读取的原始实现（缓存与直读共用同一份取值逻辑） */
function readDecrypted(target: Store<StoreData>): AppSettings {
  return decryptSettingsSecrets(target.get('settings', {}) as AppSettings)
}

/**
 * 绑定 store 实例（在 main.ts 创建 store 之后、任何控制器实例化之前调用一次）。
 */
export function bindSettingsStore(target: Store<StoreData>): void {
  boundStore = target
  settingsCache = createSettingsCache<AppSettings>(() => readDecrypted(target))

  // 兜底失效：不依赖调用方记得 invalidate，任何写点都会让缓存作废。
  // 注意 'settings' 与 AppLifecycle 已 watch 的 'settings.theme' / 'settings.refreshInterval'
  // / 'settings.minimizeToTray' 是不同字符串，不会触发 ConfigWatcher 的重复 watch 告警。
  target.onDidChange('settings', () => {
    settingsCache?.invalidate()
  })
}

function requireCache(): SettingsCache<AppSettings> {
  if (!settingsCache) {
    // fail-fast：未绑定就说明初始化顺序错了，静默回退会让问题更难定位
    throw new Error('[SettingsAccessor] 未调用 bindSettingsStore()，无法读取 settings')
  }
  return settingsCache
}

/**
 * 从缓存读取解密后的 settings（纯 UI 偏好场景）。
 *
 * ⚠️ **禁止就地修改返回值**：返回的对象中 `speedSchedule`、`categoryConfig` 等嵌套字段
 * 与 store 内存值共享引用（解密只做顶层与 secret 字段的浅拷贝）。需要变更请一律走
 * `saveSettings()`，不要直接 push/splice/赋值。
 *
 * 适用：窗口/托盘/主题等 UI 偏好，可容忍"与最后一次写入一致"的语义。
 */
export function getSettings(): AppSettings {
  return requireCache().get()
}

/**
 * 强制直读（不经过缓存，且**不写入缓存**）。
 *
 * 适用场景（共同点是"读到的值会参与正确性或安全判定"）：
 * - 读取 RPC 密钥用于鉴权（`Aria2Controller.getRpcSettings()`、`speedScheduler`、`pluginManager`）；
 * - 读改写（`aria2-update-config`、首启密钥回填）——避免中间态进入缓存；
 * - 回传渲染层（`get-store-value`，渲染层可能刚写入就要回读）；
 * - 参与安全判定（`delete-files` 的下载目录白名单根）。
 */
export function getSettingsFresh(): AppSettings {
  if (!boundStore) {
    throw new Error('[SettingsAccessor] 未调用 bindSettingsStore()，无法读取 settings')
  }
  return readDecrypted(boundStore)
}

/**
 * 统一的 settings 写入口（写与失效原子化）。
 *
 * 写盘前加密（磁盘不落明文），写完直接用入参刷新缓存——避免"写完立刻读"再走一次解密。
 * 即使 `onDidChange` 的回调时序发生变化，此处也不会留下"缓存旧值"的窗口。
 */
export function saveSettings(next: AppSettings): void {
  if (!boundStore) {
    throw new Error('[SettingsAccessor] 未调用 bindSettingsStore()，无法写入 settings')
  }
  boundStore.set('settings', encryptSettingsSecrets(next))
  settingsCache?.set(next)
}
