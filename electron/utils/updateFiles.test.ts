import { describe, expect, it } from 'vitest'
import { isStaleUpdateFile } from './updateFiles'

describe('isStaleUpdateFile', () => {
  const keep = 'Aria2Desktop-1.4.0-x64-Setup.exe'

  it('清理其它版本的半截下载与已完成安装包', () => {
    expect(isStaleUpdateFile('Aria2Desktop-1.3.8-x64-Setup.exe.download', keep)).toBe(true)
    expect(isStaleUpdateFile('Aria2Desktop-1.3.8-x64-Setup.exe', keep)).toBe(true)
    expect(isStaleUpdateFile('Aria2Desktop-1.3.8-x64.dmg', keep)).toBe(true)
    expect(isStaleUpdateFile('Aria2Desktop-1.3.8-x86_64.AppImage', keep)).toBe(true)
  })

  it('保留当前版本的目标文件与续传文件', () => {
    expect(isStaleUpdateFile(keep, keep)).toBe(false)
    expect(isStaleUpdateFile(`${keep}.download`, keep)).toBe(false)
  })

  it('只处理更新器自己的文件', () => {
    expect(isStaleUpdateFile('other-app-1.3.8.exe', keep)).toBe(false)
    expect(isStaleUpdateFile('Aria2Desktop-notes.txt', keep)).toBe(false)
    expect(isStaleUpdateFile('Aria2Desktop-1.3.8-x64.portable.zip', keep)).toBe(false)
  })
})
