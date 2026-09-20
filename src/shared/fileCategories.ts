/**
 * 文件分类共享常量与解析逻辑（渲染层与主进程共用）。
 *
 * 分类结构固定为 general + 6 个具体分类；general 代表"常规/不归入子目录"。
 * 目录名（dir）与扩展名（extensions）允许用户在设置中自定义，
 * 因此默认值通过 mergeCategoryRule 与用户配置合并后使用，不直接引用本文件的宿主要求不可变。
 */
import type { CategoryRule } from './appSettings'

/** general 分类固定标识（常规：不归入任何子目录） */
export const CATEGORY_GENERAL = 'general'
/** 新建任务分类下拉中"智能识别"的特殊值（非持久化分类 id） */
export const CATEGORY_AUTO = '__auto__'

export const CATEGORY_IDS = [
  CATEGORY_GENERAL,
  'video',
  'music',
  'images',
  'documents',
  'compressed',
  'programs'
] as const

/** 默认分类规则（general 恒为首项，dir 为空表示不归入子目录） */
export const DEFAULT_CATEGORIES: CategoryRule[] = [
  { id: CATEGORY_GENERAL, dir: '', extensions: [] },
  { id: 'video', dir: 'Video', extensions: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mpg', 'mpeg', 'ts', '3gp', 'rmvb', 'rm', 'f4v'] },
  { id: 'music', dir: 'Music', extensions: ['mp3', 'flac', 'wav', 'aac', 'ogg', 'opus', 'm4a', 'wma', 'ape', 'mid', 'midi'] },
  { id: 'images', dir: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tif', 'tiff', 'psd', 'raw', 'heic'] },
  { id: 'documents', dir: 'Documents', extensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'epub', 'mobi', 'azw3', 'csv', 'rtf', 'odt'] },
  { id: 'compressed', dir: 'Compressed', extensions: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso', 'br', 'zst', 'tgz'] },
  { id: 'programs', dir: 'Programs', extensions: ['exe', 'msi', 'apk', 'deb', 'rpm', 'dmg', 'pkg', 'appx', 'bat', 'sh', 'appimage'] }
]

/**
 * 将用户自定义分类与默认结构合并。
 * 信任用户传入的列表作为唯一依据（支持删除内置规则、新增自定义规则），仅做清洗：
 * - 清理扩展名 / 目录 / customDir / name（去空白、小写、去点）
 * - 保证 general 恒存在且在首位（general 不归入子目录）
 * 传空列表或仅 general 时回落到内置默认分类。
 */
export function mergeCategoryRules(custom: CategoryRule[] | undefined): CategoryRule[] {
  if (!Array.isArray(custom) || custom.length === 0) {
    return DEFAULT_CATEGORIES.map((c) => ({ ...c, extensions: [...c.extensions] }))
  }

  const cleanExt = (e: string) => String(e).trim().toLowerCase().replace(/^\./, '')
  const sanitized: CategoryRule[] = []
  for (const c of custom) {
    if (!c || !c.id) continue
    sanitized.push({
      id: c.id,
      dir: c.id === CATEGORY_GENERAL ? '' : (c.dir && c.dir.trim() ? c.dir.trim() : ''),
      extensions: Array.isArray(c.extensions)
        ? c.extensions.map(cleanExt).filter(Boolean)
        : [],
      customDir: c.customDir && c.customDir.trim() ? c.customDir.trim() : undefined,
      name: c.name && c.name.trim() ? c.name.trim() : undefined,
      custom: c.id !== CATEGORY_GENERAL &&
        !DEFAULT_CATEGORIES.some((d) => d.id === c.id) ? true : undefined
    })
  }

  // general 恒存在且置为首位
  const gi = sanitized.findIndex((s) => s.id === CATEGORY_GENERAL)
  if (gi === -1) {
    sanitized.unshift({ id: CATEGORY_GENERAL, dir: '', extensions: [], customDir: undefined })
  } else if (gi !== 0) {
    const [g] = sanitized.splice(gi, 1)
    if (g) sanitized.unshift(g)
  }
  return sanitized
}

/** 提取文件名中的扩展名（小写、不含点），无扩展名返回空字符串 */
export function getFileExtension(fileName: string): string {
  // 反斜杠/正斜杠统一为去掉路径部分
  const base = fileName.split(/[\\/]/).pop() || fileName
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return ''
  return base.slice(dot + 1).toLowerCase()
}

/** 从 URL 提取可能作为文件名的最后一段（去掉查询串），无则返回空字符串 */
export function getFileNameHintFromUri(uri: string): string {
  try {
    const u = new URL(uri)
    const seg = u.pathname.split('/').pop() || ''
    return decodeURIComponent(seg)
  } catch {
    return ''
  }
}

/**
 * 根据文件名解析出所属分类（不含 general）。
 * @returns 匹配到具体分类则返回其规则，否则返回 general 规则
 */
export function resolveCategory(fileName: string, categories: CategoryRule[]): CategoryRule {
  const ext = getFileExtension(fileName)
  if (ext) {
    for (const c of categories) {
      if (c.id !== CATEGORY_GENERAL && c.extensions.includes(ext)) return c
    }
  }
  return categories.find((c) => c.id === CATEGORY_GENERAL) || { id: CATEGORY_GENERAL, dir: '', extensions: [] }
}

/** 取某分类未配置自定义目录时的默认目标子目录名（未改子目录名时回落到内置英文名） */
export function getCategoryTargetDirname(ruleId: string, dir: string): string {
  return (dir && dir.trim()) ? dir.trim() : (DEFAULT_CATEGORIES.find((c) => c.id === ruleId)?.dir || '')
}

/**
 * 计算单个分类（已确定归属）的最终目标目录：
 * - 配置了 customDir → 直接使用自定义完整目录
 * - general（或非 general 但基目录为空）→ 返回主下载目录 baseDir
 * - 其他分类 → baseDir/子目录名（子目录名未设置时回落内置英文名）
 */
export function resolveTargetDir(baseDir: string, rule: CategoryRule): string {
  if (rule.customDir && rule.customDir.trim()) return rule.customDir.trim()
  if (rule.id === CATEGORY_GENERAL || !baseDir) return baseDir
  const dirname = getCategoryTargetDirname(rule.id, rule.dir)
  if (!dirname) return baseDir
  // 分隔符跟随机器的本地习惯，统一为一种，避免 D:\Downloads/Video 这类混用
  const sep = baseDir.includes('\\') ? '\\' : '/'
  return `${baseDir.replace(/[/\\]+$/, '')}${sep}${dirname}`
}

/**
 * 新建任务的基础下载目录（分类子目录都挂在它下面）：下载设置 → 引擎设置 → 空串。
 *
 * 两个设置项历史上不同步（老用户的 download.defaultDir 常为空、只看它会静默不分类），
 * 而渲染层 store、主进程删除白名单、扩展本地接口都要用同一口径判断"基础目录是谁"，
 * 因此抽到这里作为唯一实现，不要再各写一份。
 */
export function resolveBaseDownloadDir(settings: {
  download?: { defaultDir?: string } | undefined
  aria2?: { downloadDir?: string } | undefined
} | undefined): string {
  return settings?.download?.defaultDir || settings?.aria2?.downloadDir || ''
}

/**
 * 计算最终下载目录（新建任务时按所选分类解析）：
 * - 选择"智能识别"且自动分类开启：按文件名估算分类；否则视为常规
 * - 最终目录遵循 resolveTargetDir 的 customDir / 默认子目录 规则
 */
export function resolveDownloadDir(
  baseDir: string,
  selectedCategory: string,
  fileNameHint: string,
  categories: CategoryRule[],
  autoClassify: boolean
): string {
  if (!baseDir) return ''
  let rule: CategoryRule
  if (selectedCategory === CATEGORY_AUTO) {
    // 智能识别：仅当能取到文件名线索且开启自动分类时才尝试归类，否则视为常规
    rule = autoClassify && fileNameHint ? resolveCategory(fileNameHint, categories) : resolveCategory('', categories)
  } else {
    rule = categories.find((c) => c.id === selectedCategory) || resolveCategory(fileNameHint, categories)
  }
  return resolveTargetDir(baseDir, rule)
}
