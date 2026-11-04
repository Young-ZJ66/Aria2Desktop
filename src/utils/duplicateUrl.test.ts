import { describe, expect, it } from 'vitest'
import type { Aria2Task } from '@/types/aria2'
import { findDuplicateUris, findMagnetDuplicates, normalizeUrlForCompare } from './duplicateUrl'

function makeTask(overrides: Partial<Aria2Task> = {}): Aria2Task {
  return {
    gid: 'g',
    status: 'active',
    totalLength: '0',
    completedLength: '0',
    uploadLength: '0',
    downloadSpeed: '0',
    uploadSpeed: '0',
    connections: '1',
    dir: '',
    files: [],
    ...overrides
  }
}

function uriTask(uri: string, overrides: Partial<Aria2Task> = {}): Aria2Task {
  return makeTask({
    files: [{ index: '1', path: '/dl/a.zip', length: '0', completedLength: '0', selected: 'true', uris: [{ uri, status: 'used' }] }],
    ...overrides
  })
}

describe('normalizeUrlForCompare', () => {
  it('scheme 与 host 小写化、去 fragment', () => {
    expect(normalizeUrlForCompare('HTTPS://Example.COM/f.zip#anchor')).toBe(
      'https://example.com/f.zip'
    )
  })

  it('去无 query 的尾部斜杠；有 query 时保留原样', () => {
    expect(normalizeUrlForCompare('https://a.com/f.zip/')).toBe('https://a.com/f.zip')
    expect(normalizeUrlForCompare('https://a.com/redirect?url=https://b.com/x/')).toBe(
      'https://a.com/redirect?url=https://b.com/x/'
    )
  })

  it('magnet 按 xt 的 infoHash 归一：换 tracker / 改 dn 等价', () => {
    const a = normalizeUrlForCompare('magnet:?xt=urn:btih:ABCDEF&dn=name&tr=udp%3A%2F%2Ft1')
    const b = normalizeUrlForCompare('magnet:?xt=urn:btih:abcdef&tr=udp%3A%2F%2Ft2')
    expect(a).toBe(b)
    expect(a).toBe('magnet:urn:btih:abcdef')
  })

  it('magnet 无 xt 或非法输入时安全回落', () => {
    expect(normalizeUrlForCompare('magnet:?dn=only')).toBe('magnet:?dn=only')
    expect(normalizeUrlForCompare('not a url')).toBe('not a url')
  })

  it('路径大小写保留（区分），查询串保留', () => {
    expect(normalizeUrlForCompare('https://a.com/File.zip?v=1')).toBe(
      'https://a.com/File.zip?v=1'
    )
  })
})

describe('findDuplicateUris', () => {
  it('命中进行中任务（规范化后等价）', () => {
    const tasks = [uriTask('https://cdn.example.com/files/big.zip')]
    const matches = findDuplicateUris(
      ['https://cdn.example.com/files/big.zip#top'],
      tasks
    )
    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({ gid: 'g', status: 'active', name: 'a.zip' })
  })

  it('完成与出错的任务不视为重复（重下/重试是有意行为）', () => {
    const tasks = [
      uriTask('https://a.com/f.zip', { gid: 'done', status: 'complete' }),
      uriTask('https://b.com/g.zip', { gid: 'err', status: 'error' })
    ]
    expect(
      findDuplicateUris(['https://a.com/f.zip', 'https://b.com/g.zip'], tasks)
    ).toEqual([])
  })

  it('暂停与排队中的任务算重复', () => {
    const tasks = [
      uriTask('https://a.com/f.zip', { gid: 'p', status: 'paused' }),
      uriTask('https://b.com/g.zip', { gid: 'w', status: 'waiting' })
    ]
    const matches = findDuplicateUris(['https://a.com/f.zip/', 'https://b.com/g.zip'], tasks)
    expect(matches.map(m => m.gid)).toEqual(['p', 'w'])
  })

  it('（防御性）任务记录若带 magnet URI 仍按 infoHash 判重——实测引擎磁力任务 uris 为空，此路径不可达但无害', () => {
    const tasks = [
      makeTask({
        gid: 'bt1',
        bittorrent: { mode: 'multi', info: { name: 'Ubuntu 24.04' } },
        files: [
          { index: '1', path: '/dl/Ubuntu 24.04.iso', length: '0', completedLength: '0', selected: 'true', uris: [{ uri: 'magnet:?xt=urn:btih:abcdef&dn=old&tr=udp%3A%2F%2Ft1', status: 'used' }] }
        ]
      })
    ]
    const matches = findDuplicateUris(['magnet:?xt=urn:BTIH:ABCDEF&dn=new&tr=udp%3A%2F%2Ft2'], tasks)
    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({ gid: 'bt1', name: 'Ubuntu 24.04' })
  })

  it('真实引擎形状：磁力任务 files[].uris 为空数组 → findDuplicateUris 不命中（磁力走 findMagnetDuplicates）', () => {
    const tasks = [
      makeTask({
        gid: 'mag1',
        status: 'paused',
        files: [{ index: '1', path: '', length: '0', completedLength: '0', selected: 'true', uris: [] }]
      })
    ]
    expect(findDuplicateUris(['magnet:?xt=urn:btih:abc'], tasks)).toEqual([])
  })

  it('同一输入只报一条，不因多文件多 URI 重复罗列', () => {
    const task = makeTask({
      files: [
        { index: '1', path: '/dl/a.zip', length: '0', completedLength: '0', selected: 'true', uris: [{ uri: 'https://a.com/a.zip', status: 'used' }, { uri: 'https://mirror.com/a.zip', status: 'waiting' }] },
        { index: '2', path: '/dl/b.zip', length: '0', completedLength: '0', selected: 'true', uris: [{ uri: 'https://a.com/a.zip', status: 'used' }] }
      ]
    })
    const matches = findDuplicateUris(['https://a.com/a.zip'], [task])
    expect(matches).toHaveLength(1)
    expect(matches[0]?.name).toBe('a.zip')
  })

  it('输入列表内部重复的 URI 只提示一次', () => {
    const tasks = [uriTask('https://a.com/a.zip')]
    const matches = findDuplicateUris(
      ['https://a.com/a.zip', 'https://a.com/a.zip'],
      tasks
    )
    expect(matches).toHaveLength(1)
  })

  it('空任务列表返回空数组', () => {
    expect(findDuplicateUris(['https://a.com/a.zip'], [])).toEqual([])
  })
})

describe('findMagnetDuplicates', () => {
  const magnetTask = makeTask({
    gid: 'mag1',
    status: 'paused',
    bittorrent: { mode: 'multi', info: { name: 'Ubuntu 24.04' } },
    files: [{ index: '1', path: '/dl/Ubuntu 24.04.iso', length: '0', completedLength: '0', selected: 'true', uris: [] }]
  })

  it('索引命中且任务进行中 → 判重（换 tracker / 改 dn 同 infoHash 仍命中）', () => {
    const index = new Map([['magnet:urn:btih:abcdef', 'mag1']])
    const matches = findMagnetDuplicates(
      ['magnet:?xt=urn:BTIH:ABCDEF&dn=renamed&tr=udp%3A%2F%2Fother'],
      index,
      [magnetTask]
    )
    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({ gid: 'mag1', status: 'paused', name: 'Ubuntu 24.04' })
  })

  it('任务已完成 / 已不在列表 → 不拦', () => {
    const index = new Map([['magnet:urn:btih:abcdef', 'mag1']])
    const done = { ...magnetTask, status: 'complete' as const }
    expect(findMagnetDuplicates(['magnet:?xt=urn:btih:abcdef'], index, [done])).toEqual([])
    expect(findMagnetDuplicates(['magnet:?xt=urn:btih:abcdef'], index, [])).toEqual([])
  })

  it('非 magnet 输入跳过；输入重复只报一次', () => {
    const index = new Map([['magnet:urn:btih:abcdef', 'mag1']])
    expect(findMagnetDuplicates(['https://a.com/f.zip'], index, [magnetTask])).toEqual([])
    expect(
      findMagnetDuplicates(
        ['magnet:?xt=urn:btih:abcdef', 'magnet:?xt=urn:btih:abcdef'],
        index,
        [magnetTask]
      )
    ).toHaveLength(1)
  })

  it('空索引直接返回空', () => {
    expect(findMagnetDuplicates(['magnet:?xt=urn:btih:abc'], new Map(), [magnetTask])).toEqual([])
  })
})
