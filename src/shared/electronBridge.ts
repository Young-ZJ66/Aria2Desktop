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
}
