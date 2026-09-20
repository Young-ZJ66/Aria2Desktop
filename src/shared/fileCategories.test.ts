import { describe, expect, it } from 'vitest'
import {
  CATEGORY_AUTO,
  CATEGORY_GENERAL,
  DEFAULT_CATEGORIES,
  getFileExtension,
  getFileNameHintFromUri,
  mergeCategoryRules,
  resolveCategory,
  resolveDownloadDir,
  resolveTargetDir
} from './fileCategories'

/**
 * 文件分类逻辑决定"下载到哪个子目录"，直接影响用户文件落盘位置，
 * 因此把扩展名解析、分类归属与目录拼接的边界都锁死。
 */
describe('getFileExtension', () => {
  it('返回小写扩展名（不含点）', () => {
    expect(getFileExtension('Movie.MP4')).toBe('mp4')
    expect(getFileExtension('a.tar.gz')).toBe('gz')
  })

  it('兼容 Windows 与 POSIX 路径分隔符', () => {
    expect(getFileExtension('C:\\Users\\me\\Downloads\\file.MKV')).toBe('mkv')
    expect(getFileExtension('/home/me/file.MKV')).toBe('mkv')
  })

  it('无扩展名 / 隐藏文件 / 以点结尾时返回空字符串', () => {
    expect(getFileExtension('noext')).toBe('')
    expect(getFileExtension('.gitignore')).toBe('')
    expect(getFileExtension('trailing.')).toBe('')
  })
})

describe('getFileNameHintFromUri', () => {
  it('取 pathname 最后一段并去掉查询串', () => {
    expect(getFileNameHintFromUri('https://example.com/a/b/file.mp4?token=1')).toBe('file.mp4')
  })

  it('对编码字符做解码', () => {
    expect(getFileNameHintFromUri('https://example.com/a/my%20movie.mp4')).toBe('my movie.mp4')
  })

  it('非法 URL 返回空字符串', () => {
    expect(getFileNameHintFromUri('not a url')).toBe('')
  })
})

describe('resolveCategory', () => {
  it('按扩展名匹配到具体分类', () => {
    expect(resolveCategory('a.mp4', DEFAULT_CATEGORIES).id).toBe('video')
    expect(resolveCategory('a.MP3', DEFAULT_CATEGORIES).id).toBe('music')
    expect(resolveCategory('a.zip', DEFAULT_CATEGORIES).id).toBe('compressed')
  })

  it('无法识别时回落到 general', () => {
    expect(resolveCategory('a.unknown', DEFAULT_CATEGORIES).id).toBe(CATEGORY_GENERAL)
    expect(resolveCategory('noext', DEFAULT_CATEGORIES).id).toBe(CATEGORY_GENERAL)
  })

  it('不会把 general 自身当匹配项（即使 general 带有扩展名）', () => {
    const categories = [
      { id: CATEGORY_GENERAL, dir: '', extensions: ['mp4'] },
      { id: 'video', dir: 'Video', extensions: ['mkv'] }
    ]
    expect(resolveCategory('a.mp4', categories).id).toBe(CATEGORY_GENERAL)
  })

  it('默认分类表的扩展名必须全为小写（回归：programs 曾把 AppImage 写成大写，导致永不命中）', () => {
    const notLowercase = DEFAULT_CATEGORIES.flatMap(c =>
      c.extensions.filter(ext => ext !== ext.toLowerCase()).map(ext => `${c.id}:${ext}`)
    )
    expect(notLowercase).toEqual([])
  })

  it('大写扩展名的文件也能正确归类', () => {
    expect(resolveCategory('tool.AppImage', DEFAULT_CATEGORIES).id).toBe('programs')
    expect(resolveCategory('tool.APPIMAGE', DEFAULT_CATEGORIES).id).toBe('programs')
    expect(getFileExtension('tool.AppImage')).toBe('appimage')
  })
})

describe('resolveTargetDir', () => {
  const video = { id: 'video', dir: 'Video', extensions: ['mp4'] }
  const general = { id: CATEGORY_GENERAL, dir: '', extensions: [] }

  it('具体分类拼接到子目录（分隔符跟随基目录风格）', () => {
    expect(resolveTargetDir('D:\\Downloads', video)).toBe('D:\\Downloads\\Video')
    expect(resolveTargetDir('D:/Downloads', video)).toBe('D:/Downloads/Video')
  })

  it('去掉基目录结尾的重复分隔符', () => {
    expect(resolveTargetDir('D:\\Downloads\\', video)).toBe('D:\\Downloads\\Video')
    expect(resolveTargetDir('D:/Downloads//', video)).toBe('D:/Downloads/Video')
  })

  it('customDir 优先于默认子目录', () => {
    expect(resolveTargetDir('D:\\Downloads', { ...video, customDir: 'E:\\Movies' })).toBe('E:\\Movies')
  })

  it('general 或基目录为空时直接返回基目录', () => {
    expect(resolveTargetDir('D:\\Downloads', general)).toBe('D:\\Downloads')
    expect(resolveTargetDir('', video)).toBe('')
  })

  it('子目录名为空时回落到内置英文名', () => {
    expect(resolveTargetDir('D:\\Downloads', { id: 'video', dir: '', extensions: ['mp4'] }))
      .toBe('D:\\Downloads\\Video')
  })
})

describe('resolveDownloadDir', () => {
  it('智能识别 + 自动分类开启时按文件名归类', () => {
    expect(resolveDownloadDir('D:\\D', CATEGORY_AUTO, 'movie.mp4', DEFAULT_CATEGORIES, true))
      .toBe('D:\\D\\Video')
  })

  it('智能识别但关闭自动分类时落到主目录', () => {
    expect(resolveDownloadDir('D:\\D', CATEGORY_AUTO, 'movie.mp4', DEFAULT_CATEGORIES, false))
      .toBe('D:\\D')
  })

  it('智能识别但拿不到文件名线索时落到主目录', () => {
    expect(resolveDownloadDir('D:\\D', CATEGORY_AUTO, '', DEFAULT_CATEGORIES, true)).toBe('D:\\D')
  })

  it('显式选择分类时按该分类落目录', () => {
    expect(resolveDownloadDir('D:\\D', 'music', '', DEFAULT_CATEGORIES, false)).toBe('D:\\D\\Music')
  })

  it('基目录为空时返回空（交由上层回退默认目录）', () => {
    expect(resolveDownloadDir('', 'video', 'a.mp4', DEFAULT_CATEGORIES, true)).toBe('')
  })
})

describe('mergeCategoryRules', () => {
  it('空输入回落到内置默认分类（含 general 且为首位）', () => {
    const merged = mergeCategoryRules(undefined)
    expect(merged[0]?.id).toBe(CATEGORY_GENERAL)
    expect(merged.map((c) => c.id)).toEqual(DEFAULT_CATEGORIES.map((c) => c.id))
  })

  it('扩展名清洗：去点、去空白、转小写', () => {
    const merged = mergeCategoryRules([{ id: 'video', dir: ' Video ', extensions: ['.MP4', ' MKV '] }])
    const video = merged.find((c) => c.id === 'video')
    expect(video?.extensions).toEqual(['mp4', 'mkv'])
    expect(video?.dir).toBe('Video')
  })

  it('general 缺失时自动补入并置于首位', () => {
    const merged = mergeCategoryRules([{ id: 'video', dir: 'V', extensions: ['mp4'] }])
    expect(merged[0]?.id).toBe(CATEGORY_GENERAL)
    expect(merged).toHaveLength(2)
  })

  it('general 不在首位时被移动到首位', () => {
    const merged = mergeCategoryRules([
      { id: 'video', dir: 'V', extensions: ['mp4'] },
      { id: CATEGORY_GENERAL, dir: '', extensions: [] }
    ])
    expect(merged[0]?.id).toBe(CATEGORY_GENERAL)
  })

  it('未知 id 标记为自定义规则；general 的 dir 强制为空', () => {
    const merged = mergeCategoryRules([
      { id: 'ebooks', dir: 'Ebooks', extensions: ['epub'] },
      { id: CATEGORY_GENERAL, dir: 'ShouldBeCleared', extensions: [] }
    ])
    expect(merged.find((c) => c.id === 'ebooks')?.custom).toBe(true)
    expect(merged[0]?.id).toBe(CATEGORY_GENERAL)
    expect(merged[0]?.dir).toBe('')
  })

  it('不修改传入的默认分类对象（返回的是副本）', () => {
    const merged = mergeCategoryRules(undefined)
    merged[1]?.extensions.push('should-not-leak')
    expect(DEFAULT_CATEGORIES[1]?.extensions.includes('should-not-leak')).toBe(false)
  })
})
