/**
 * 跨控制器共享的应用状态
 * 替代以往通过类型断言挂到 app 对象上的隐式全局状态。
 * 通过方法封装写入，避免多处直接修改裸属性。
 */

/** 内部可变状态（模块私有，仅经 appState 方法访问） */
const state = {
  /** 是否正在真正退出应用（区别于最小化到托盘） */
  isQuiting: false,
  /** 是否已启动过优雅关闭（before-quit 中 preventDefault 后置位，用于放行后续 quit） */
  shutdownStarted: false
}

export const appState = {
  /** 标记应用正在真正退出（区别于最小化到托盘）。托盘"退出"菜单在 app.quit() 前调用，用于放行窗口 close 拦截 */
  markQuitting(): void {
    state.isQuiting = true
  },

  /** 应用是否正在真正退出 */
  isQuitting(): boolean {
    return state.isQuiting
  },

  /** 标记已进入优雅关闭流程（仅 before-quit 置位，保证 shutdown 只执行一次） */
  markShutdownStarted(): void {
    state.shutdownStarted = true
  },

  /** 是否已启动优雅关闭 */
  hasShutdownStarted(): boolean {
    return state.shutdownStarted
  }
}
