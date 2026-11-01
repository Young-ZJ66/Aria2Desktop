import { describe, expect, it } from 'vitest'
import type { Aria2Task } from '@/types/aria2'
import { detectTaskKind } from './taskKind'

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

describe('detectTaskKind', () => {
  it('流媒体任务优先归类为 stream', () => {
    expect(detectTaskKind(makeTask(), true)).toBe('stream')
  })

  it('带 bittorrent 字段的任务归类为 bt', () => {
    const task = makeTask({ bittorrent: { mode: 'multi' } })
    expect(detectTaskKind(task)).toBe('bt')
  })

  it('磁力链接任务归类为 magnet', () => {
    const task = makeTask({
      files: [{ index: '1', path: '', length: '0', completedLength: '0', selected: 'true', uris: [{ uri: 'magnet:?xt=urn:btih:abc', status: 'used' }] }]
    })
    expect(detectTaskKind(task)).toBe('magnet')
  })

  it('ftp / sftp 链接归类为 ftp', () => {
    const task = makeTask({
      files: [{ index: '1', path: '', length: '0', completedLength: '0', selected: 'true', uris: [{ uri: 'sftp://example.com/a.zip', status: 'used' }] }]
    })
    expect(detectTaskKind(task)).toBe('ftp')
  })

  it('默认归类为 http', () => {
    const task = makeTask({
      files: [{ index: '1', path: '', length: '0', completedLength: '0', selected: 'true', uris: [{ uri: 'https://example.com/a.zip', status: 'used' }] }]
    })
    expect(detectTaskKind(task)).toBe('http')
  })
})
