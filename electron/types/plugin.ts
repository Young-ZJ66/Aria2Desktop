/**
 * 插件 API 类型定义
 * 插件通过这些接口与 Aria2Desktop 交互
 */

/** 插件元数据 */
export interface PluginManifest {
  /** 插件唯一标识（如 "com.example.my-plugin"） */
  id: string
  /** 插件显示名称 */
  name: string
  /** 插件版本（语义化版本） */
  version: string
  /** 插件描述 */
  description?: string
  /** 插件作者 */
  author?: string
  /** 入口文件名（相对于插件目录，默认 "index.js"） */
  main?: string
  /** 插件所需的权限 */
  permissions?: PluginPermission[]
}

/** 插件权限类型 */
export type PluginPermission =
  | 'aria2:read'      // 读取下载状态
  | 'aria2:write'     // 控制下载任务
  | 'settings:read'   // 读取应用设置
  | 'settings:write'  // 修改应用设置
  | 'network'         // 网络请求
  | 'notify'          // 发送通知

/** 插件运行时上下文（注入到沙箱中的 API） */
export interface PluginContext {
  /** 控制台（仅 warn/error，防止日志刷屏） */
  console: {
    log: (...args: unknown[]) => void
    warn: (...args: unknown[]) => void
    error: (...args: unknown[]) => void
  }
  /** Aria2 RPC 调用接口 */
  aria2: {
    /** 获取全局统计 */
    getGlobalStat: () => Promise<Record<string, string>>
    /** 获取活动任务列表 */
    getActiveTasks: () => Promise<unknown[]>
    /** 获取等待任务列表 */
    getWaitingTasks: () => Promise<unknown[]>
    /** 获取已停止任务列表 */
    getStoppedTasks: () => Promise<unknown[]>
    /** 添加下载任务 */
    addUri: (uris: string[], options?: Record<string, string>) => Promise<string>
    /** 暂停任务 */
    pause: (gid: string) => Promise<string>
    /** 恢复任务 */
    unpause: (gid: string) => Promise<string>
    /** 删除任务 */
    remove: (gid: string) => Promise<string>
  }
  /** 应用设置接口 */
  settings: {
    /** 获取设置值 */
    get: (key: string) => unknown
  }
  /** 通知接口 */
  notify: {
    /** 发送系统通知 */
    send: (title: string, body: string) => void
  }
}

/** 插件实例接口 */
export interface PluginInstance {
  /** 插件激活时调用 */
  onActivate?: () => void | Promise<void>
  /** 插件停用时调用 */
  onDeactivate?: () => void | Promise<void>
  /** 下载任务完成时调用 */
  onDownloadComplete?: (task: { gid: string; name: string }) => void | Promise<void>
  /** 下载任务开始时调用 */
  onDownloadStart?: (task: { gid: string; name: string }) => void | Promise<void>
}

/** 插件运行时信息 */
export interface PluginInfo {
  manifest: PluginManifest
  enabled: boolean
  path: string
  error?: string
}
