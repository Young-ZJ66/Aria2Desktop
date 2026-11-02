import { describe, expect, it } from 'vitest'
import { undoDuplicatedSegment } from './pathRepair'

describe('undoDuplicatedSegment', () => {
  it('修掉盘符后相邻两段完全相同的情况', () => {
    expect(undoDuplicatedSegment('D:\\Downloads\\Downloads\\file.zip')).toBe('D:\\Downloads\\file.zip')
  })

  it('重复段后面直接结束也照样处理', () => {
    expect(undoDuplicatedSegment('D:\\Downloads\\Downloads')).toBe('D:\\Downloads')
  })

  it('层级更深时保留剩余部分', () => {
    expect(undoDuplicatedSegment('C:\\dir\\dir\\sub\\a.txt')).toBe('C:\\dir\\sub\\a.txt')
  })

  it('混用斜杠也能识别', () => {
    expect(undoDuplicatedSegment('D:/Downloads\\Downloads/file.zip')).toBe('D:\\Downloads\\file.zip')
  })

  it('没有重复段时不改写（普通路径原样返回 null）', () => {
    expect(undoDuplicatedSegment('D:\\Downloads\\file.zip')).toBeNull()
    // 只有名字相似、实际不同段
    expect(undoDuplicatedSegment('D:\\Downloads\\Backup\\file.zip')).toBeNull()
  })

  it('不处理非 Windows 绝对路径与非法输入', () => {
    expect(undoDuplicatedSegment('/home/user/user/file.zip')).toBeNull()
    expect(undoDuplicatedSegment('')).toBeNull()
    expect(undoDuplicatedSegment('relative\\relative\\a.txt')).toBeNull()
  })
})
