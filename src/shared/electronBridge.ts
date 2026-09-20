/**
 * 渲染层 → 主进程 IPC 边界共享类型。
 * preload.ts 暴露的 API 签名与 src/types/electron.d.ts 的 ElectronAPI 应保持一致，
 * 涉及结构化参数的类型定义收拢在本文件，避免各处手写漂移。
 */

/** aria2.updateConfig 参数（本地引擎配置） */
export interface Aria2UpdateConfig {
  port?: number
  secret?: string
  downloadDir?: string
  autoStart?: boolean
  /**
   * 是否显式清除 RPC 密钥（仅在用户确实清空密钥输入框时置 true）。
   * 用作意图信号：secret 为空且本标志为假时，主进程保留原有密钥，
   * 避免"表单尚未加载出密钥就保存"导致密钥被静默清空、RPC 访问保护被关闭。
   */
  clearSecret?: boolean
}
