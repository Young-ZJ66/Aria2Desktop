import { describe, expect, it } from 'vitest'
import { isPathInside } from './pathContainment'

describe('isPathInside', () => {
  it('普通目录下的文件算在内部', () => {
    expect(isPathInside('D:\\Downloads\\a.zip', 'D:\\Downloads')).toBe(true)
    expect(isPathInside('D:\\Downloads\\sub\\a.zip', 'D:\\Downloads')).toBe(true)
  })

  it('下载目录就是盘符根时也成立（结尾分隔符不能拼两次）', () => {
    expect(isPathInside('D:\\Downloads\\a.zip', 'D:\\')).toBe(true)
    expect(isPathInside('D:\\', 'D:\\')).toBe(true)
    expect(isPathInside('/home/user/a.zip', '/')).toBe(true)
  })

  it('同名前缀不算在内部', () => {
    expect(isPathInside('C:\\Downloads2\\a.zip', 'C:\\Downloads')).toBe(false)
    expect(isPathInside('/data/downloads-old/a.zip', '/data/downloads')).toBe(false)
  })

  it('根目录自身与其斜杠混用也能判定', () => {
    expect(isPathInside('D:/Downloads/a.zip', 'D:\\Downloads')).toBe(true)
    expect(isPathInside('D:\\Downloads', 'D:\\Downloads\\')).toBe(true)
    expect(isPathInside('D:\\Other\\a.zip', 'D:\\Downloads')).toBe(false)
  })

  it('Windows 下大小写不敏感，其他平台区分', () => {
    expect(isPathInside('D:\\downloads\\a.zip', 'D:\\Downloads', true)).toBe(true)
    expect(isPathInside('/Data/Downloads/a.zip', '/data/downloads', false)).toBe(false)
  })

  it('空值一律不放行', () => {
    expect(isPathInside('', 'D:\\Downloads')).toBe(false)
    expect(isPathInside('D:\\Downloads\\a.zip', '')).toBe(false)
  })
})
