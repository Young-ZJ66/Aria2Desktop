import { describe, expect, it } from 'vitest'
import { RECENT_SAVE_DIRS_MAX, pushRecentSaveDir } from './recentSaveDirs'

describe('pushRecentSaveDir', () => {
  it('新目录插入头部', () => {
    expect(pushRecentSaveDir(['D:/a', 'D:/b'], 'D:/c')).toEqual(['D:/c', 'D:/a', 'D:/b'])
  })

  it('已存在的目录提升到最前（原位置移除）', () => {
    expect(pushRecentSaveDir(['D:/a', 'D:/b', 'D:/c'], 'D:/b')).toEqual(['D:/b', 'D:/a', 'D:/c'])
  })

  it('同一目录不同写法（反斜杠/大小写/尾斜杠）视为同一条', () => {
    const next = pushRecentSaveDir(['D:\\Data'], 'd:/data/')
    expect(next).toHaveLength(1)
    expect(next[0]).toBe('d:/data/')
  })

  it('空串/纯空白忽略，返回原数组', () => {
    const recent = ['D:/a']
    expect(pushRecentSaveDir(recent, '  ')).toBe(recent)
    expect(pushRecentSaveDir(recent, '')).toBe(recent)
  })

  it('超过上限截断（保最新的 8 条）', () => {
    let recent: string[] = []
    for (let i = 0; i < RECENT_SAVE_DIRS_MAX + 3; i++) {
      recent = pushRecentSaveDir(recent, `D:/dir-${i}`)
    }
    expect(recent).toHaveLength(RECENT_SAVE_DIRS_MAX)
    expect(recent[0]).toBe('D:/dir-10')
    expect(recent[recent.length - 1]).toBe('D:/dir-3')
  })

  it('不修改入参数组', () => {
    const recent = ['D:/a']
    pushRecentSaveDir(recent, 'D:/b')
    expect(recent).toEqual(['D:/a'])
  })
})
