import { describe, expect, it } from 'vitest'
import type { Aria2File, Aria2Task } from '@/types/aria2'
import {
  filterAndSortTasks,
  filterBySize,
  filterByStatus,
  formatSize,
  formatSpeed,
  formatTime,
  getTaskName,
  getTaskProgress,
  getTaskRemainingTime,
  getTaskSize,
  getTaskSpeed,
  getTaskStats,
  searchTasks,
  sortTasks
} from './taskUtils'

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

describe('getTaskSpeed', () => {
  it('只有 active 任务算速度：暂停后行内与头部总速度一起归零', () => {
    expect(getTaskSpeed(task({ status: 'active', downloadSpeed: '2048' }))).toBe(2048)
    // aria2 暂停后仍保留上一次的 downloadSpeed，不能让它继续计入总速度
    expect(getTaskSpeed(task({ status: 'paused', downloadSpeed: '2048' }))).toBe(0)
    expect(getTaskSpeed(task({ status: 'waiting', downloadSpeed: '2048' }))).toBe(0)
    expect(getTaskSpeed(task({ status: 'complete', downloadSpeed: '2048' }))).toBe(0)
    expect(getTaskSpeed(task({ status: 'error', downloadSpeed: '2048' }))).toBe(0)
  })

  it('非数字速度按 0 处理', () => {
    expect(getTaskSpeed(task({ status: 'active', downloadSpeed: '' }))).toBe(0)
  })

  it('getTaskStats 汇总时同样跳过暂停任务', () => {
    const stats = getTaskStats([
      task({ gid: 'a', status: 'active', downloadSpeed: '1000' }),
      task({ gid: 'b', status: 'paused', downloadSpeed: '1000' })
    ])
    expect(stats.totalSpeed).toBe(1000)
  })
})

function sized(gid: string, totalBytes: number, completedBytes = 0, overrides: Partial<Aria2Task> = {}): Aria2Task {
  return task({
    gid,
    status: 'active',
    totalLength: String(totalBytes),
    completedLength: String(completedBytes),
    ...overrides
  } as Partial<Aria2Task>)
}

describe('getTaskSize / getTaskProgress / getTaskRemainingTime', () => {
  it('大小取 totalLength，缺失或非法按 0', () => {
    expect(getTaskSize(task({ totalLength: '1048576' }))).toBe(1048576)
    expect(getTaskSize(task({ totalLength: '' }))).toBe(0)
    expect(getTaskSize(task({ totalLength: 'abc' }))).toBe(0)
  })

  it('进度按 completed/total 取整，越界与非法数据都被夹住', () => {
    expect(getTaskProgress(sized('p1', 1000, 500))).toBe(50)
    expect(getTaskProgress(sized('p2', 1000, 1000))).toBe(100)
    // completed > total 时不能出现 150%
    expect(getTaskProgress(sized('p3', 1000, 1500))).toBe(100)
    // total 为 0 / 非数字时不能出现 NaN%
    expect(getTaskProgress(sized('p4', 0, 0))).toBe(0)
    expect(getTaskProgress(task({ totalLength: 'x', completedLength: 'y' }))).toBe(0)
  })

  it('剩余时间按剩余字节除以速度四舍五入', () => {
    expect(getTaskRemainingTime(sized('r1', 1000, 0, { downloadSpeed: '100' } as Partial<Aria2Task>))).toBe(10)
    expect(getTaskRemainingTime(sized('r2', 1000, 250, { downloadSpeed: '100' } as Partial<Aria2Task>))).toBe(8)
  })

  it('速度为 0 或已完成时剩余时间为 0（不返回 Infinity）', () => {
    expect(getTaskRemainingTime(sized('r3', 1000, 0, { downloadSpeed: '0' } as Partial<Aria2Task>))).toBe(0)
    expect(getTaskRemainingTime(sized('r4', 1000, 1000, { downloadSpeed: '100' } as Partial<Aria2Task>))).toBe(0)
  })
})

describe('格式化函数', () => {
  it('formatSize 按 1024 进位并保留一位小数', () => {
    expect(formatSize(0)).toBe('0 B')
    expect(formatSize(-1)).toBe('0 B')
    expect(formatSize(Number.NaN)).toBe('0 B')
    expect(formatSize(512)).toBe('512 B')
    expect(formatSize(1024)).toBe('1 KB')
    expect(formatSize(1536)).toBe('1.5 KB')
    expect(formatSize(1024 * 1024)).toBe('1 MB')
    expect(formatSize(1024 ** 3)).toBe('1 GB')
    // 超过 TB 不再进位，避免出现 PB 这种列表里没定义的档位
    expect(formatSize(1024 ** 5)).toBe('1024 TB')
  })

  it('formatSpeed 在大小后面加 /s', () => {
    expect(formatSpeed(2048)).toBe('2 KB/s')
    expect(formatSpeed(0)).toBe('0 B/s')
  })

  it('formatTime 固定三段 H:MM:SS，非法值给 --', () => {
    // 不足一小时也补 0 小时，避免「44:10」到底是 44 分钟还是 44 小时靠猜
    expect(formatTime(44 * 60 + 10)).toBe('0:44:10')
    expect(formatTime(4 * 3600 + 43 * 60 + 27)).toBe('4:43:27')
    expect(formatTime(0)).toBe('--')
    expect(formatTime(-5)).toBe('--')
    expect(formatTime(Number.POSITIVE_INFINITY)).toBe('--')
  })
})

describe('过滤', () => {
  const list = [
    task({ gid: 'aaa1', status: 'active', totalLength: String(50 * 1024 * 1024), files: [file({ path: 'D:/Downloads/movie.mkv' })] }),
    task({ gid: 'bbb2', status: 'complete', totalLength: String(500 * 1024 * 1024), files: [file({ path: 'D:/Downloads/album.zip' })] }),
    task({ gid: 'ccc3', status: 'error', totalLength: String(3 * 1024 * 1024 * 1024), files: [file({ path: 'D:/Downloads/backup.iso' })] })
  ]

  it('空搜索词原样返回，非空时大小写不敏感匹配名称与 gid', () => {
    expect(searchTasks(list, '   ')).toBe(list)
    expect(searchTasks(list, 'MOVIE').map(t => t.gid)).toEqual(['aaa1'])
    expect(searchTasks(list, 'bbb2').map(t => t.gid)).toEqual(['bbb2'])
  })

  it('搜索也覆盖文件路径与 URI', () => {
    expect(searchTasks(list, 'backup').map(t => t.gid)).toEqual(['ccc3'])
    const withUri = [task({ gid: 'u1', files: [file({ uris: [{ status: 'used', uri: 'https://example.com/rare-name.bin' }] })] })]
    expect(searchTasks(withUri, 'rare-name').map(t => t.gid)).toEqual(['u1'])
  })

  it('URI 字段缺失时搜索不抛错', () => {
    const broken = [task({ gid: 'b1', files: [{ index: '1' } as Aria2File] })]
    expect(() => searchTasks(broken, 'x')).not.toThrow()
    expect(searchTasks(broken, 'x')).toEqual([])
  })

  it('filterByStatus 空值不过滤', () => {
    expect(filterByStatus(list, '')).toBe(list)
    expect(filterByStatus(list, 'complete').map(t => t.gid)).toEqual(['bbb2'])
  })

  it('filterBySize 四档边界', () => {
    expect(filterBySize(list, '').length).toBe(3)
    // small < 100MB
    expect(filterBySize(list, 'small').map(t => t.gid)).toEqual(['aaa1'])
    // medium 100MB~1GB
    expect(filterBySize(list, 'medium').map(t => t.gid)).toEqual(['bbb2'])
    // large 1GB~10GB
    expect(filterBySize(list, 'large').map(t => t.gid)).toEqual(['ccc3'])
    expect(filterBySize(list, 'huge')).toEqual([])
    // 未知档位不丢任务
    expect(filterBySize(list, 'weird').length).toBe(3)
  })
})

describe('排序', () => {
  it('按名称排序，方向可切换', () => {
    const list = [task({ gid: '1', files: [file({ path: 'D:/b.zip' })] }), task({ gid: '2', files: [file({ path: 'D:/a.zip' })] })]
    expect(sortTasks(list, 'name', 'asc').map(t => t.gid)).toEqual(['2', '1'])
    expect(sortTasks(list, 'name', 'desc').map(t => t.gid)).toEqual(['1', '2'])
  })

  it('按大小、进度、速度、剩余时间排序', () => {
    const a = sized('a', 100, 100, { downloadSpeed: '10' } as Partial<Aria2Task>)
    const b = sized('b', 200, 50, { downloadSpeed: '20' } as Partial<Aria2Task>)
    expect(sortTasks([b, a], 'size', 'asc').map(t => t.gid)).toEqual(['a', 'b'])
    expect(sortTasks([b, a], 'progress', 'asc').map(t => t.gid)).toEqual(['b', 'a'])
    expect(sortTasks([b, a], 'speed', 'asc').map(t => t.gid)).toEqual(['a', 'b'])
    expect(sortTasks([b, a], 'remaining', 'asc').map(t => t.gid)).toEqual(['a', 'b'])
  })

  it('默认按 GID 当添加时间，用 BigInt 比较不丢精度', () => {
    // 这两个 16 位十六进制数用 Number 解析会得到同一个值（超出 2^53）
    const low = task({ gid: '0000000000000001' })
    const high = task({ gid: 'ffffffffffffffff' })
    expect(sortTasks([high, low], 'addTime', 'asc').map(t => t.gid)).toEqual(['0000000000000001', 'ffffffffffffffff'])
    expect(sortTasks([low, high], 'addTime', 'desc').map(t => t.gid)).toEqual(['ffffffffffffffff', '0000000000000001'])
  })

  it('GID 非法时回退为 0，排序不抛错', () => {
    const bad = task({ gid: 'not-hex' })
    const good = task({ gid: '0000000000000010' })
    expect(() => sortTasks([bad, good], 'addTime', 'asc')).not.toThrow()
    expect(sortTasks([bad, good], 'addTime', 'asc').map(t => t.gid)).toEqual(['not-hex', '0000000000000010'])
  })

  it('排序返回新数组，不改动入参顺序', () => {
    const list = [task({ gid: '2' }), task({ gid: '1' })]
    const sorted = sortTasks(list, 'addTime', 'asc')
    expect(sorted).not.toBe(list)
    expect(list.map(t => t.gid)).toEqual(['2', '1'])
  })
})

describe('filterAndSortTasks / getTaskStats', () => {
  const list = [
    task({ gid: 'a1', status: 'active', totalLength: '1000', files: [file({ path: 'D:/alpha.zip' })] }),
    task({ gid: 'a2', status: 'complete', totalLength: String(2 * 1024 ** 3), files: [file({ path: 'D:/beta.zip' })] }),
    task({ gid: 'a3', status: 'error', totalLength: '3000', files: [file({ path: 'D:/alpha.iso' })] })
  ]

  it('搜索、状态、大小、排序依次叠加', () => {
    const result = filterAndSortTasks(list, {
      searchText: 'alpha',
      statusFilter: '',
      sizeFilter: '',
      sortBy: 'name',
      sortOrder: 'desc'
    })
    // 名称降序：'alpha.zip' > 'alpha.iso'
    expect(result.map(t => t.gid)).toEqual(['a1', 'a3'])

    const filtered = filterAndSortTasks(list, {
      searchText: '',
      statusFilter: 'complete',
      sizeFilter: 'large',
      sortBy: 'size',
      sortOrder: 'asc'
    })
    expect(filtered.map(t => t.gid)).toEqual(['a2'])
  })

  it('全空条件只做默认排序', () => {
    const result = filterAndSortTasks(list, {
      searchText: '',
      statusFilter: '',
      sizeFilter: '',
      sortBy: 'addTime',
      sortOrder: 'asc'
    })
    expect(result.map(t => t.gid)).toEqual(['a1', 'a2', 'a3'])
  })

  it('getTaskStats 分类计数并累加大小与速度', () => {
    const stats = getTaskStats([
      task({ gid: 's1', status: 'active', totalLength: '100', completedLength: '40', downloadSpeed: '10' }),
      task({ gid: 's2', status: 'waiting', totalLength: '200', completedLength: '0' }),
      task({ gid: 's3', status: 'paused', totalLength: '300', completedLength: '100' }),
      task({ gid: 's4', status: 'complete', totalLength: '400', completedLength: '400' }),
      task({ gid: 's5', status: 'error', totalLength: '500', completedLength: '50' })
    ])

    expect(stats).toMatchObject({
      total: 5,
      active: 1,
      waiting: 1,
      paused: 1,
      complete: 1,
      error: 1,
      totalSize: 1500,
      completedSize: 590
    })
    // 只有 active 任务计入总速度
    expect(stats.totalSpeed).toBe(10)
  })
})

describe('getTaskName 的 URI 推断边界', () => {
  it('magnet 里没有 dn 时继续看下一条 URI', () => {
    const t = task({
      files: [file({ uris: [
        { status: 'used', uri: 'magnet:?xt=urn:btih:abc' },
        { status: 'waiting', uri: 'https://example.com/Second.iso' }
      ] })]
    })
    expect(getTaskName(t)).toBe('Second.iso')
  })

  it('magnet 的 dn 是非法百分号编码时退回未解码原文', () => {
    const t = task({ files: [file({ uris: [{ status: 'used', uri: 'magnet:?xt=urn:btih:aa&dn=100%' }] })] })
    expect(getTaskName(t)).toBe('100%')
  })

  it('URL 没有路径末段（根路径）时继续下一条', () => {
    const t = task({
      files: [file({ uris: [
        { status: 'used', uri: 'https://example.com/' },
        { status: 'waiting', uri: 'https://example.com/b.zip' }
      ] })]
    })
    expect(getTaskName(t)).toBe('b.zip')
  })

  it('路径末段是非法百分号编码时退回未解码原文', () => {
    const t = task({ files: [file({ uris: [{ status: 'used', uri: 'http://example.com/100%.zip' }] })] })
    expect(getTaskName(t)).toBe('100%.zip')
  })

  it('URI 是空串时跳过（不当成文件名）', () => {
    const t = task({ gid: 'empty-uri-gid', files: [file({ uris: [{ status: 'used', uri: '' }] })] })
    expect(getTaskName(t)).toBe('empty-uri-gid')
  })
})

describe('searchTasks 的文件与 URI 命中', () => {
  it('任务名不含关键词但完整路径含时也能搜到', () => {
    const list = [task({ gid: 'p1', files: [file({ path: 'D:/dl/reports/rare-report.pdf' })] })]
    expect(searchTasks(list, 'reports').map(t => t.gid)).toEqual(['p1'])
  })

  it('任务名与路径都不含关键词、只有 URI 含时也能搜到', () => {
    const list = [task({
      gid: 'u2',
      files: [file({ path: 'D:/dl/a.zip', uris: [{ status: 'used', uri: 'https://example.com/special-keyword.bin' }] })]
    })]
    expect(searchTasks(list, 'special-keyword').map(t => t.gid)).toEqual(['u2'])
  })
})
