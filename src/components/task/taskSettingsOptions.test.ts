import { describe, expect, it } from 'vitest'
import {
  EMPTY_TASK_SETTINGS_FORM,
  MAX_CONNECTION_PER_SERVER_LIMIT,
  buildTaskOptions,
  mergeTaskSourceOptions,
  parseTaskSettings
} from './taskSettingsOptions'

describe('parseTaskSettings', () => {
  it('把 aria2 的限速 / 连接数 / 代理解析成表单值', () => {
    const form = parseTaskSettings({
      'max-download-limit': '2048K',
      'max-upload-limit': '512K',
      'max-connection-per-server': '5',
      'all-proxy': 'http://127.0.0.1:7890'
    })
    expect(form).toEqual({
      maxDownloadLimitKB: 2048,
      maxUploadLimitKB: 512,
      maxConnectionPerServer: 5,
      allProxy: 'http://127.0.0.1:7890'
    })
  })

  it('"0" 表示不限速，表单里显示 0 而不是 NaN', () => {
    const form = parseTaskSettings({
      'max-download-limit': '0',
      'max-upload-limit': '0',
      'max-connection-per-server': '1'
    })
    expect(form.maxDownloadLimitKB).toBe(0)
    expect(form.maxUploadLimitKB).toBe(0)
    expect(form.allProxy).toBe('')
  })

  it('缺少 option 或传 null 时回落到默认表单', () => {
    expect(parseTaskSettings(null)).toEqual(EMPTY_TASK_SETTINGS_FORM)
    expect(parseTaskSettings(undefined)).toEqual(EMPTY_TASK_SETTINGS_FORM)
    expect(parseTaskSettings({})).toEqual(EMPTY_TASK_SETTINGS_FORM)
  })

  it('数组形式的 option 取第一项', () => {
    const form = parseTaskSettings({
      'max-download-limit': ['1024K', '2048K'],
      'max-connection-per-server': ['3']
    })
    expect(form.maxDownloadLimitKB).toBe(1024)
    expect(form.maxConnectionPerServer).toBe(3)
  })

  it('连接数超过 aria2 上限时夹到上限，非法值回落到 1', () => {
    expect(
      parseTaskSettings({ 'max-connection-per-server': '99' }).maxConnectionPerServer
    ).toBe(MAX_CONNECTION_PER_SERVER_LIMIT)
    expect(
      parseTaskSettings({ 'max-connection-per-server': 'abc' }).maxConnectionPerServer
    ).toBe(1)
    expect(
      parseTaskSettings({ 'max-connection-per-server': '0' }).maxConnectionPerServer
    ).toBe(1)
  })

  it('限速带 M 单位时换算成 KB', () => {
    expect(parseTaskSettings({ 'max-download-limit': '2M' }).maxDownloadLimitKB).toBe(2048)
  })
})

describe('buildTaskOptions', () => {
  it('限速大于 0 时写成 K 后缀，等于 0 时写 "0"（清除限速）', () => {
    const options = buildTaskOptions({
      maxDownloadLimitKB: 1024,
      maxUploadLimitKB: 0,
      maxConnectionPerServer: 4,
      allProxy: ''
    })
    expect(options['max-download-limit']).toBe('1024K')
    // 必须显式写 "0"：省略这个 key 不会清掉之前设过的限速
    expect(options['max-upload-limit']).toBe('0')
    expect(options['max-connection-per-server']).toBe('4')
    // 空串是 aria2 清除代理的写法
    expect(options['all-proxy']).toBe('')
  })

  it('代理前后空格会被裁掉', () => {
    const options = buildTaskOptions({
      ...EMPTY_TASK_SETTINGS_FORM,
      allProxy: '  http://127.0.0.1:1080  '
    })
    expect(options['all-proxy']).toBe('http://127.0.0.1:1080')
  })

  it('连接数夹在 [1, 上限] 之间', () => {
    expect(
      buildTaskOptions({ ...EMPTY_TASK_SETTINGS_FORM, maxConnectionPerServer: 0 })[
        'max-connection-per-server'
      ]
    ).toBe('1')
    expect(
      buildTaskOptions({ ...EMPTY_TASK_SETTINGS_FORM, maxConnectionPerServer: 100 })[
        'max-connection-per-server'
      ]
    ).toBe(String(MAX_CONNECTION_PER_SERVER_LIMIT))
  })

  it('负数限速按 0 处理，不产生 "-5K" 这种非法值', () => {
    const options = buildTaskOptions({ ...EMPTY_TASK_SETTINGS_FORM, maxDownloadLimitKB: -5 })
    expect(options['max-download-limit']).toBe('0')
  })
})

describe('mergeTaskSourceOptions', () => {
  it('保留来源记录里的其他 option，只覆盖本次修改的四个键', () => {
    const merged = mergeTaskSourceOptions(
      { header: ['Referer: https://example.com'], 'max-download-limit': '100K' },
      { 'max-download-limit': '200K', 'all-proxy': 'http://proxy' }
    )
    expect(merged.header).toEqual(['Referer: https://example.com'])
    expect(merged['max-download-limit']).toBe('200K')
    expect(merged['all-proxy']).toBe('http://proxy')
  })

  it('没有既有记录时直接返回本次修改', () => {
    expect(mergeTaskSourceOptions(undefined, { 'all-proxy': '' })).toEqual({ 'all-proxy': '' })
  })
})
