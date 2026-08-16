/**
 * 需要重启 Aria2 服务才能生效的选项（aria2 启动时选项）。
 * 这类选项无法通过运行时 changeGlobalOption 修改，保存到配置文件后需重启 Aria2 才生效。
 * 任务级选项（如 dir、split、max-connection-per-server 等）对新任务立即生效，不在此列。
 * 用于：1) 保存成功时提示"部分设置需要重启 Aria2 服务后生效"；2) 设置项问号提示说明。
 */
export const RESTART_REQUIRED_OPTIONS: ReadonlySet<string> = new Set([
  // 高级（事件与内存）
  'event-poll',
  'enable-mmap',
  'max-mmap-limit',
  // 日志与输出
  'console-log-level',
  'summary-interval',
  'enable-color',
  'human-readable',
  // DHT
  'enable-dht',
  'enable-dht6',
  'dht-listen-port',
  'dht-file-path',
  'dht-file-path6',
  'dht-entry-point',
  'dht-entry-point6',
  // BT 网络
  'bt-enable-lpd',
  'listen-port',
  'bt-external-ip',
  // 客户端标识
  'peer-id-prefix',
  'peer-agent'
])

/** 判断选项集是否包含需要重启 Aria2 生效的选项 */
export function hasRestartRequiredOption(options: Record<string, unknown>): boolean {
  return Object.keys(options).some((key) => RESTART_REQUIRED_OPTIONS.has(key))
}
