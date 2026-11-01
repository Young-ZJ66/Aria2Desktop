import { describe, expect, it } from 'vitest'
import { parseTorrentFiles } from './torrentFileList'

type Value = number | string | { [key: string]: Value } | Value[]

/** 测试专用最小 bencode 编码器（不进入生产代码） */
function encode(value: Value): string {
  if (typeof value === 'number') return `i${value}e`
  if (typeof value === 'string') return `${new TextEncoder().encode(value).length}:${value}`
  if (Array.isArray(value)) return `l${value.map(encode).join('')}e`
  const entries = Object.entries(value).map(([key, v]) => `${encode(key)}${encode(v)}`)
  return `d${entries.join('')}e`
}

function torrent(value: Record<string, Value>): Uint8Array {
  return new TextEncoder().encode(encode({ announce: 'http://tracker', info: value }))
}

describe('parseTorrentFiles', () => {
  it('解析单文件种子', () => {
    const result = parseTorrentFiles(torrent({ name: 'movie.mp4', length: 1024 }))
    expect(result.name).toBe('movie.mp4')
    expect(result.files).toEqual([{ index: 1, path: 'movie.mp4', length: 1024 }])
  })

  it('解析多文件种子并优先使用 utf-8 路径', () => {
    const result = parseTorrentFiles(torrent({
      name: 'collection',
      files: [
        { length: 100, 'path.utf-8': ['视频', 'a.mp4'], path: ['video', 'a.mp4'] },
        { length: 200, 'path.utf-8': ['文档', 'b.pdf'] }
      ]
    }))
    expect(result.files).toEqual([
      { index: 1, path: '视频/a.mp4', length: 100 },
      { index: 2, path: '文档/b.pdf', length: 200 }
    ])
  })

  it('缺少 info 时拒绝解析', () => {
    expect(() => parseTorrentFiles(new TextEncoder().encode(encode({ announce: 'x' })))).toThrow()
  })

  it('空文件列表时拒绝解析', () => {
    expect(() => parseTorrentFiles(torrent({ name: 'x', files: [] }))).toThrow()
  })

  it('截断数据不会死循环', () => {
    const bytes = new TextEncoder().encode('d4:info')
    expect(() => parseTorrentFiles(bytes)).toThrow()
  })
})
