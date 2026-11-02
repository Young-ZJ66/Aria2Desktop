/**
 * "把这个任务从引擎里摘掉"的判定（纯逻辑，便于单测）。
 *
 * 背景：aria2 的 removeDownloadResult / remove 都会在任务不存在时抛错
 * （`GID xxx is not found`），而"任务不存在"恰恰是删除成功后的常态——
 * 引擎重启过、会话被清空、或者上一次其实已经删掉了。所以不能简单把
 * "抛错"等同于"删除失败"。
 *
 * 但反过来，两个接口都失败、任务却还在引擎里（RPC 超时、引擎正忙）时，
 * 如果照样报成功，界面会说"已删除"，下一次刷新又从引擎把这一行拉回来，
 * 用户看到的是"删了又回来"。
 *
 * 判定顺序：
 * 1. removeDownloadResult 成功 → 删掉了；
 * 2. 否则 remove 成功 → 删掉了；
 * 3. 两个都失败 → 有 tellStatus 就问一次引擎：
 *    - 还能查到 → 真的没删掉（保留错误）；
 *    - 查不到（抛错）→ 任务确实不在，视为已删除；
 *    没有 tellStatus（旧注入方）→ 保守视为已删除，与旧行为一致。
 */

/** 由调用方（taskStore / 组件）注入的 Aria2 删除能力，避免 service 层反向依赖 store */
export interface TaskRemovalService {
  removeDownloadResult(gid: string): Promise<string>
  remove(gid: string): Promise<string>
  /** 可选：用于确认"两个删除接口都失败"时任务是否还活着 */
  tellStatus?(gid: string): Promise<unknown>
}

export type RemovalOutcome = { ok: true } | { ok: false; error: unknown }

export async function removeFromEngine(service: TaskRemovalService, gid: string): Promise<RemovalOutcome> {
  let firstError: unknown = null

  try {
    await service.removeDownloadResult(gid)
    return { ok: true }
  } catch (error) {
    firstError = error
  }

  try {
    await service.remove(gid)
    return { ok: true }
  } catch (error) {
    const secondError = error

    if (!service.tellStatus) return { ok: true }

    try {
      await service.tellStatus(gid)
      // 还查得到：引擎没答应删除。报第一个错误，信息通常更贴近"任务已停止但不是下载结果"
      return { ok: false, error: firstError ?? secondError }
    } catch {
      // 查不到：任务确实不在引擎里了
      return { ok: true }
    }
  }
}
