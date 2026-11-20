/**
 * 从 .metalink / .meta4 文本解析文件清单（创建任务前展示与校验用）。
 *
 * 只取创建任务需要的两部分：文件名与文件大小，不解析镜像/校验和。
 * Metalink 4.0 用属性写法 `<file name="a.iso" size="123">`，
 * Metalink 3.0（.meta4）用子元素写法 `<file name="a.iso"><size>123</size></file>`，
 * 两种都兼容；不引入 XML 解析依赖，按标签扫描即可。
 */

export interface MetalinkFileEntry {
  /** 文件名（Metalink 允许带目录，原样保留） */
  name: string
  /** 字节数；文件未声明大小时为 0 */
  size: number
}

export interface MetalinkFileList {
  files: MetalinkFileEntry[]
  totalSize: number
}

/** 最小 XML 实体反转义（文件名里常见 &amp;） */
function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** 取出标签属性，键去掉命名空间前缀（metalink:name → name） */
function parseAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const pattern = /([a-zA-Z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(raw)) !== null) {
    const key = match[1]!.split(':').pop()!
    const value = match[3] ?? match[4] ?? ''
    attrs[key] = decodeEntities(value)
  }
  return attrs
}

/**
 * 解析 Metalink 文本。
 *
 * 根节点不是 <metalink> 或没有声明任何文件时抛错，错误文案直接用于界面提示。
 */
export function parseMetalinkFiles(text: string): MetalinkFileList {
  if (!/<metalink\b/i.test(text)) {
    throw new Error('不是有效的 Metalink 文件：缺少 metalink 根节点')
  }

  const files: MetalinkFileEntry[] = []
  const pattern = /<file\b([^>]*?)(\/>|>([\s\S]*?)<\/file\s*>)/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    const attrs = parseAttributes(match[1] ?? '')
    const name = attrs.name ?? ''
    if (!name) continue
    const body = match[3] ?? ''
    let size = Number(attrs.size)
    if (!Number.isFinite(size) || size < 0) {
      // Metalink 3.0 把大小写成子元素 <size>123</size>
      const sizeMatch = /<size\b[^>]*>\s*(\d+)\s*<\/size\s*>/i.exec(body)
      size = sizeMatch ? Number(sizeMatch[1]) : 0
    }
    files.push({ name, size: Number.isFinite(size) && size > 0 ? size : 0 })
  }

  if (files.length === 0) throw new Error('Metalink 未声明任何文件')

  const totalSize = files.reduce((sum, item) => sum + item.size, 0)
  return { files, totalSize }
}
