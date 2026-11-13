/**
 * RSS/Atom 订阅与监听文件夹自动导入的共享契约类型。
 *
 * 主进程（rssSubscriptionService / watchFolderService）与渲染层 UI 共用，
 * 是这些结构的唯一事实来源：改字段必须只改这一处，两侧 tsconfig 均直接引用本文件
 *（主进程产物是 CJS，不能解析 @/ 别名，因此服务侧用相对路径引入）。
 */

/** 一条 RSS/Atom 订阅（持久化在 store 顶层键 rssSubscriptions） */
export interface RssSubscription {
  /** 订阅 id（保存时无 id 则由主进程生成 UUID） */
  id: string
  /** 用户可见名称，非空且 ≤100 字符 */
  name: string
  /** 订阅源地址，必须 http/https */
  url: string
  /** 是否参与自动轮询 */
  enabled: boolean
  /** 拉取间隔（分钟），缺省 30；保存时钳制到 [5, 10080] */
  intervalMinutes?: number
  /** 标题包含过滤（正则，匹配 item 标题；空 = 不过滤） */
  includePattern?: string
  /** 标题排除过滤（正则，命中则跳过；空 = 不排除） */
  excludePattern?: string
  /** 单次拉取最多添加的条数，缺省 5；保存时钳制到 [1, 50] */
  maxPerFetch?: number
  /** 下载保存目录（绝对路径）；空 = 用 aria2 当前默认目录 */
  dir?: string
  /** 上次拉取时间（ISO 字符串；null = 从未拉过，下一轮立即到期） */
  lastFetchAt?: string | null
  /** 上次拉取结果：ok / error / null（从未拉取） */
  lastStatus?: 'ok' | 'error' | null
  /** 上次拉取失败的错误文本（成功时为 null） */
  lastError?: string | null
  /** 上次拉取实际添加成功的条数 */
  lastAddedCount?: number
}

/** 一个监听文件夹（持久化在 store 顶层键 watchFolders） */
export interface WatchFolderConfig {
  /** 配置 id（保存时无 id 则由主进程生成 UUID） */
  id: string
  /** 监听的目录（绝对路径；只扫顶层，不递归） */
  path: string
  /** 是否参与自动扫描 */
  enabled: boolean
  /** 关心的扩展名（小写、含点，如 ['.torrent']）；缺省 ['.torrent', '.metalink', '.txt'] */
  extensions?: string[]
  /** 导入成功后删除源文件；false（缺省）时移动到 <path>/imported/ */
  deleteAfterImport?: boolean
  /** 下载保存目录（绝对路径）；空 = 用 aria2 当前默认目录 */
  dir?: string
  /** 上次扫描时间（ISO 字符串；null = 从未扫描） */
  lastScanAt?: string | null
  /** 上次扫描失败的错误文本（成功时为 null） */
  lastError?: string | null
}

/** 自动导入来源类型（日志条目用它区分 RSS 与监听文件夹） */
export type AutoImportSourceKind = 'rss' | 'watch-folder'

/** 一条自动导入日志（store 顶层键 autoImportLog，上限 200 条，新的在前） */
export interface AutoImportLogEntry {
  /** 日志条目 id（UUID） */
  id: string
  /** 来源类型：rss / watch-folder */
  kind: AutoImportSourceKind
  /** 来源配置 id（订阅 id 或监听文件夹 id） */
  sourceId: string
  /** 来源配置名称（删除配置后日志仍可读） */
  sourceName: string
  /** 条目标题（RSS 条目标题 / 文件名 / 磁力行首段） */
  title: string
  /** 添加成功时对应的 aria2 gid */
  gid?: string
  /** added = 已添加 / skipped = 去重跳过 / error = 添加失败 */
  status: 'added' | 'skipped' | 'error'
  /** 附加信息（失败原因等） */
  message?: string
  /** 记录时间（ISO 字符串） */
  importedAt: string
}

/** 「立即拉取」返回给 UI 的条目预览（本次匹配到的条目，≤20 条） */
export interface RssFeedItemPreview {
  title: string
  link: string
}
