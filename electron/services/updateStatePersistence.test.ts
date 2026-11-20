import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => process.env.TEMP || '/tmp' },
  BrowserWindow: class {},
  shell: { openPath: vi.fn() }
}))
vi.mock('../utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  getLogFilePaths: () => ({ main: '', renderer: '' })
}))

import { parsePersistedUpdateState } from '../controllers/UpdateController'

describe('parsePersistedUpdateState', () => {
  it('解析完整状态（下载路径、版本、更新日志、保存时间）', () => {
    const state = parsePersistedUpdateState(
      JSON.stringify({
        downloadedPath: 'C:/Users/test/AppData/Local/Temp/Aria2Desktop-1.5.0-Setup.exe',
        downloadedVersion: '1.5.0',
        notes: '### 修复\n- D-01',
        savedAt: 1730000000000
      })
    )

    expect(state).toEqual({
      downloadedPath: 'C:/Users/test/AppData/Local/Temp/Aria2Desktop-1.5.0-Setup.exe',
      downloadedVersion: '1.5.0',
      notes: '### 修复\n- D-01',
      savedAt: 1730000000000
    })
  })

  it('notes 缺失时补空串，savedAt 非数字时归零', () => {
    const state = parsePersistedUpdateState(
      JSON.stringify({ downloadedPath: 'C:/tmp/setup.exe', downloadedVersion: '1.5.0', savedAt: 'yesterday' })
    )

    expect(state).toMatchObject({ downloadedVersion: '1.5.0', notes: '', savedAt: 0 })
  })

  it.each([
    ['空字符串', ''],
    ['损坏的 JSON', '{not json'],
    ['不是对象', 'null'],
    ['缺少下载路径', JSON.stringify({ downloadedVersion: '1.5.0' })],
    ['下载路径为空', JSON.stringify({ downloadedPath: '  ', downloadedVersion: '1.5.0' })],
    ['缺少版本', JSON.stringify({ downloadedPath: 'C:/tmp/setup.exe' })]
  ])('%s 时返回 null（不阻塞更新检查）', (_label, raw) => {
    expect(parsePersistedUpdateState(raw)).toBeNull()
  })
})
