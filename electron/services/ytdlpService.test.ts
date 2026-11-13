import { describe, expect, it, vi } from 'vitest'

// ytdlpService 的依赖链（logger→electron-log、appEnv/ytdlpAssets→electron、downloader→electron net）
// 在 node 测试环境全都起不来：桩掉后只测纯映射函数，不触发任何 spawn。
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '', getName: () => 'test' }
}))
vi.mock('electron-log/main', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), transports: { file: {}, console: {} } }
}))

const { mapPlaylistEntries, PLAYLIST_ENTRIES_LIMIT } = await import('./ytdlpService')

/**
 * 播放列表 flat JSON → 条目列表的映射测试。
 *
 * 只测 mapPlaylistEntries 纯函数（不 spawn yt-dlp）：覆盖字段回退、
 * YouTube 链接还原、500 条上限与占位 URL 标记。getPlaylistInfo 的
 * URL 校验/spawn 行为由真实环境承担，单测不碰。
 */

describe('mapPlaylistEntries：正常映射', () => {
  it('flat JSON 的 entries 映射为条目列表（id/title/url/duration/index 齐全时原样保留）', () => {
    const raw = {
      title: '我的收藏',
      entries: [
        { id: 'abc123', title: '第一集', url: 'https://www.youtube.com/watch?v=abc123', duration: 61, playlist_index: 1 },
        { id: 'def456', title: '第二集', url: 'https://www.youtube.com/watch?v=def456', duration: 3600, playlist_index: 2 }
      ]
    }
    const info = mapPlaylistEntries(raw, 'https://www.youtube.com/playlist?list=PL123')
    expect(info).not.toBeNull()
    expect(info?.title).toBe('我的收藏')
    expect(info?.count).toBe(2)
    expect(info?.entries).toEqual([
      { id: 'abc123', title: '第一集', url: 'https://www.youtube.com/watch?v=abc123', duration: 61, index: 1 },
      { id: 'def456', title: '第二集', url: 'https://www.youtube.com/watch?v=def456', duration: 3600, index: 2 }
    ])
    expect(info?.hasPlaceholderUrls).toBeFalsy()
  })

  it('duration 与 playlist_index 缺失或非法（NaN/Infinity/字符串）时不携带该字段', () => {
    const raw = {
      title: 't',
      entries: [
        { id: 'a', title: 'A', url: 'https://www.youtube.com/watch?v=a', duration: 'x' },
        { id: 'b', title: 'B', url: 'https://www.youtube.com/watch?v=b', playlist_index: Number.NaN },
        { id: 'c', title: 'C', url: 'https://www.youtube.com/watch?v=c', playlist_index: '3' },
        { id: 'd', title: 'D', url: 'https://www.youtube.com/watch?v=d', duration: Number.POSITIVE_INFINITY }
      ]
    }
    const info = mapPlaylistEntries(raw, 'https://www.youtube.com/playlist?list=PL1')
    expect(info?.entries.map(e => ({ hasDuration: e.duration !== undefined, hasIndex: e.index !== undefined })))
      .toEqual([
        { hasDuration: false, hasIndex: false },
        { hasDuration: false, hasIndex: false },
        { hasDuration: false, hasIndex: false },
        { hasDuration: false, hasIndex: false }
      ])
  })
})

describe('mapPlaylistEntries：url 回退链', () => {
  it('YouTube 列表：entry.url 缺失时用 watch?v=<id> 拼回（flat 模式常不给完整 url）', () => {
    const raw = { title: 'yt', entries: [{ id: 'xyz789', title: '视频' }] }
    const info = mapPlaylistEntries(raw, 'https://www.youtube.com/playlist?list=PL1')
    expect(info?.entries[0]?.url).toBe('https://www.youtube.com/watch?v=xyz789')
    expect(info?.hasPlaceholderUrls).toBeFalsy()
  })

  it('非 YouTube 站点：entry.url 存在时原样使用（不套 watch 模板）', () => {
    const raw = {
      title: 'bili',
      entries: [{ id: 'BV1xx', title: 'P1', url: 'https://www.bilibili.com/video/BV1xx?p=1' }]
    }
    const info = mapPlaylistEntries(raw, 'https://www.bilibili.com/video/BV1xx')
    expect(info?.entries[0]?.url).toBe('https://www.bilibili.com/video/BV1xx?p=1')
  })

  it('非 YouTube 且 url 也缺失：用 id 占位并标记 hasPlaceholderUrls（UI 据此提示）', () => {
    const raw = { title: 'site', entries: [{ id: 'entry-9', title: 'E9' }] }
    const info = mapPlaylistEntries(raw, 'https://example.com/list')
    expect(info?.entries[0]?.url).toBe('entry-9')
    expect(info?.hasPlaceholderUrls).toBe(true)
  })

  it('YouTube 短链（youtu.be）也按 YouTube 拼回 watch 链接', () => {
    const raw = { title: 'yt', entries: [{ id: 'short1', title: 'S' }] }
    const info = mapPlaylistEntries(raw, 'https://youtu.be/playlist?list=PL1')
    expect(info?.entries[0]?.url).toBe('https://www.youtube.com/watch?v=short1')
  })

  it('相对 url（非 http 开头）不直接使用，走 id 回退', () => {
    const raw = { title: 'yt', entries: [{ id: 'rel1', title: 'R', url: '/watch?v=rel1' }] }
    const info = mapPlaylistEntries(raw, 'https://www.youtube.com/playlist?list=PL1')
    // 相对路径不满足 https?:// 判定，但站点是 YouTube → 走 watch?v= 拼回
    expect(info?.entries[0]?.url).toBe('https://www.youtube.com/watch?v=rel1')
  })
})

describe('mapPlaylistEntries：上限与边界', () => {
  it('超过 500 条时截断到 PLAYLIST_ENTRIES_LIMIT（500）', () => {
    const entries = Array.from({ length: 600 }, (_, i) => ({
      id: `v${i}`,
      title: `第${i}集`,
      playlist_index: i + 1
    }))
    const info = mapPlaylistEntries({ title: 'big', entries }, 'https://www.youtube.com/playlist?list=PL1')
    expect(info?.entries.length).toBe(PLAYLIST_ENTRIES_LIMIT)
    expect(info?.entries.length).toBe(500)
    // 截断保留前面的条目
    expect(info?.entries[0]?.id).toBe('v0')
    expect(info?.entries[499]?.id).toBe('v499')
  })

  it('缺 id 的条目被跳过（id 是条目的唯一硬依赖）', () => {
    const raw = {
      title: 't',
      entries: [
        { title: '无 id' },
        { id: 123, title: '数字 id 也可（转字符串）' },
        { id: '', title: '空 id 也跳过' }
      ]
    }
    const info = mapPlaylistEntries(raw, 'https://example.com/list')
    expect(info?.entries.length).toBe(1)
    expect(info?.entries[0]?.id).toBe('123')
  })

  it('title 缺失回退到 id', () => {
    const raw = { title: 't', entries: [{ id: 'tid1' }] }
    const info = mapPlaylistEntries(raw, 'https://example.com/list')
    expect(info?.entries[0]?.title).toBe('tid1')
  })

  it('列表标题缺失回退 Unknown；entries 为空返回 null', () => {
    expect(mapPlaylistEntries({ entries: [] }, 'https://example.com/list')).toBeNull()
    expect(mapPlaylistEntries({ title: null, entries: [{ id: 'a', title: 'A' }] }, 'https://example.com/list')?.title).toBe('Unknown')
  })

  it('rawEntries 不是数组返回 null（页面级 JSON 解析失败兜底）', () => {
    expect(mapPlaylistEntries({ title: 't' }, 'https://example.com/list')).toBeNull()
    expect(mapPlaylistEntries('not an object', 'https://example.com/list')).toBeNull()
    expect(mapPlaylistEntries(null, 'https://example.com/list')).toBeNull()
  })
})
