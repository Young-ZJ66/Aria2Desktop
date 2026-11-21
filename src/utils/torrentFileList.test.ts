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
/**
 * 恶意/损坏种子的边界：解析器跑在渲染进程，任何一处漏判都可能让页面卡死或抛未捕获异常，
 * 因此每一种非法结构都必须抛出可读错误而不是死循环或越界读取。
 */
describe('parseTorrentFiles 的损坏数据边界', () => {
  const bytes = (text: string) => new TextEncoder().encode(text)

  it('根结构不是字典时拒绝解析', () => {
    expect(() => parseTorrentFiles(bytes('i1e'))).toThrow('根结构非法')
  })

  it('字符串缺少冒号分隔符时报错', () => {
    expect(() => parseTorrentFiles(bytes('d4'))).toThrow('字符串缺少分隔符')
  })

  it('字符串长度不是数字时报错', () => {
    expect(() => parseTorrentFiles(bytes('d1a:xyz'))).toThrow('字符串长度非法')
  })

  it('字符串长度超出数据范围时报错', () => {
    expect(() => parseTorrentFiles(bytes('d5:ab'))).toThrow('字符串越界')
  })

  it('整数缺少结束符时报错', () => {
    expect(() => parseTorrentFiles(bytes('di5'))).toThrow('整数缺少结束符')
  })

  it('整数不是有限数时报错', () => {
    expect(() => parseTorrentFiles(bytes('diInfinitye'))).toThrow('整数非法')
  })

  it('列表没有结束符时报错', () => {
    expect(() => parseTorrentFiles(bytes('dl'))).toThrow('列表未结束')
  })

  it('字典的键不是字符串时报错', () => {
    expect(() => parseTorrentFiles(bytes('dli1ee'))).toThrow('字典键必须是字符串')
  })

  it('字典没有结束符时报错', () => {
    expect(() => parseTorrentFiles(bytes('d1:ai1e'))).toThrow('字典未结束')
  })

  it('遇到不支持的标记时报错', () => {
    expect(() => parseTorrentFiles(bytes('dx'))).toThrow('数据格式不受支持')
  })

  it('files 里的非字典条目被跳过，缺路径时用种子名补位', () => {
    const result = parseTorrentFiles(torrent({ name: 'pack', files: [1, { length: 7 }] }))
    expect(result.files).toEqual([{ index: 2, path: 'pack/2', length: 7 }])
  })
})

