/**
 * 跨控制器共享的应用状态
 * 替代以往通过类型断言挂到 app 对象上的隐式全局状态
 */
export const appState = {
  /** 是否正在真正退出应用（区别于最小化到托盘） */
  isQuiting: false
}
