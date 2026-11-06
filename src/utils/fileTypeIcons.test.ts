import { describe, expect, it } from 'vitest'
import { getFileCategory } from './fileTypeIcons'

describe('getFileCategory', () => {
  it('按扩展名分类', () => {
    expect(getFileCategory('movie.mkv')).toBe('video')
    expect(getFileCategory('song.flac')).toBe('audio')
    expect(getFileCategory('cover.png')).toBe('image')
    expect(getFileCategory('backup.7z')).toBe('archive')
    expect(getFileCategory('manual.pdf')).toBe('document')
    expect(getFileCategory('main.ts')).toBe('code')
  })

  it('安装包与可执行文件单独分类（不再落到通用文档图标）', () => {
    expect(getFileCategory('Aria2Desktop-1.2.5-x64-Setup.exe')).toBe('app')
    expect(getFileCategory('资料汇总.MSI')).toBe('app')
    expect(getFileCategory('app.appimage')).toBe('app')
    expect(getFileCategory('package.deb')).toBe('app')
  })

  it('大小写与多点文件名都能识别', () => {
    expect(getFileCategory('VIDEO.MP4')).toBe('video')
    expect(getFileCategory('archive.tar.gz')).toBe('archive')
  })

  it('未知扩展名与无扩展名回退到 default', () => {
    expect(getFileCategory('README')).toBe('default')
    expect(getFileCategory('something.unknownext')).toBe('default')
    expect(getFileCategory('')).toBe('default')
  })
})
