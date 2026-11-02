import { describe, expect, it } from 'vitest'
import type { Aria2File, Aria2Task } from '@/types/aria2'
import { getTaskName } from './taskUtils'

function file(overrides: Partial<Aria2File> = {}): Aria2File {
  return {
    index: '1',
    path: '',
    length: '0',
    completedLength: '0',
    selected: 'true',
    uris: [],
    ...overrides
  }
}

function task(overrides: Partial<Aria2Task> = {}): Aria2Task {
  return {
    gid: '3d0323d2fcf3c6d2',
    status: 'error',
    totalLength: '0',
    completedLength: '0',
    uploadLength: '0',
    downloadSpeed: '0',
    uploadSpeed: '0',
    ...overrides
  } as Aria2Task
}

describe('getTaskName', () => {
  it('BT 任务优先用种子里的名字', () => {
    const name = getTaskName(
      task({
        bittorrent: { info: { name: 'ubuntu.torrent' } },
        files: [file({ path: 'D:/Downloads/ignored.iso' })]
      } as Partial<Aria2Task>)
    )
    expect(name).toBe('ubuntu.torrent')
  })

  it('有保存路径时取路径最后一段', () => {
    const name = getTaskName(task({ files: [file({ path: 'D:/Downloads/report.pdf' })] }))
    expect(name).toBe('report.pdf')
  })

  it('路径带结尾分隔符时不会取到空串', () => {
    const name = getTaskName(task({ files: [file({ path: 'D:/Downloads/folder/' })] }))
    expect(name).toBe('folder')
  })

  it('还没有保存路径时从 URI 里取文件名（失败任务不再显示 GID）', () => {
    const name = getTaskName(
      task({
        files: [
          file({
            uris: [{ status: 'used', uri: 'http://nonexistent-host.invalid/probe-fail.zip' }]
          })
        ]
      })
    )
    expect(name).toBe('probe-fail.zip')
  })

  it('URI 里的百分号编码会被解码', () => {
    const name = getTaskName(
      task({
        files: [
          file({
            uris: [{ status: 'used', uri: 'https://example.com/files/%E6%B5%8B%E8%AF%95.zip' }]
          })
        ]
      })
    )
    expect(name).toBe('测试.zip')
  })

  it('带查询串的 URI 只取路径部分', () => {
    const name = getTaskName(
      task({
        files: [
          file({ uris: [{ status: 'used', uri: 'https://example.com/a/b/video.mp4?token=abc' }] })
        ]
      })
    )
    expect(name).toBe('video.mp4')
  })

  it('磁力链接用 dn 参数作为名字', () => {
    const name = getTaskName(
      task({
        files: [
          file({
            uris: [
              { status: 'used', uri: 'magnet:?xt=urn:btih:abc&dn=Some%20Linux.iso&tr=udp://x' }
            ]
          })
        ]
      })
    )
    expect(name).toBe('Some Linux.iso')
  })

  it('前面几个 URI 都推断不出名字时继续找下一个', () => {
    const name = getTaskName(
      task({
        files: [
          file({
            uris: [
              { status: 'used', uri: 'not a url' },
              { status: 'waiting', uri: 'https://example.com/fallback.bin' }
            ]
          })
        ]
      })
    )
    expect(name).toBe('fallback.bin')
  })

  it('没有任何可用信息时才回落 GID', () => {
    expect(getTaskName(task({ files: [file()] }))).toBe('3d0323d2fcf3c6d2')
    expect(getTaskName(task())).toBe('3d0323d2fcf3c6d2')
  })
})
