/**
 * 文件类型图标映射工具
 * 统一文件扩展名到图标的映射逻辑，避免多处重复定义
 */

/** 文件类型分类 */
export type FileCategory = 'video' | 'audio' | 'image' | 'archive' | 'document' | 'code' | 'default'

/** 扩展名到分类的映射（小写，不含点） */
const EXTENSION_MAP: Record<string, FileCategory> = {
  // 视频
  mp4: 'video', mkv: 'video', avi: 'video', mov: 'video', wmv: 'video',
  flv: 'video', webm: 'video', m4v: 'video', '3gp': 'video',
  // 音频
  mp3: 'audio', wav: 'audio', flac: 'audio', aac: 'audio', ogg: 'audio',
  wma: 'audio', m4a: 'audio', opus: 'audio',
  // 图片
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', bmp: 'image',
  webp: 'image', svg: 'image', ico: 'image', tiff: 'image', psd: 'image',
  // 压缩包
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive',
  gz: 'archive', bz2: 'archive', xz: 'archive', iso: 'archive',
  // 文档
  pdf: 'document', doc: 'document', docx: 'document', xls: 'document',
  xlsx: 'document', ppt: 'document', pptx: 'document', txt: 'document',
  md: 'document', csv: 'document',
  // 代码
  js: 'code', ts: 'code', py: 'code', java: 'code', cpp: 'code', c: 'code',
  h: 'code', css: 'code', html: 'code', vue: 'code', json: 'code',
  xml: 'code', yaml: 'code', yml: 'code', sh: 'code', bat: 'code',
  go: 'code', rs: 'code', php: 'code', rb: 'code'
}

/**
 * 根据文件名获取文件类型分类
 */
export function getFileCategory(fileName: string): FileCategory {
  const name = fileName.toLowerCase()
  const ext = name.split('.').pop() || ''
  return EXTENSION_MAP[ext] || 'default'
}
