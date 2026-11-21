/**
 * 设置页 schema 转换单测。
 *
 * 重点覆盖「aria2 范围型数值选项」这条曾经把配置写坏的真实链路：
 * aria2 的 dht-listen-port / listen-port 默认返回 "6881-6999"，
 * 旧实现直接 Number() 得到 NaN，表单显示 NaN，保存后写出 "NaN"，
 * 下次启动 aria2 报 `errorCode=1 Bad range NaN` 拒绝启动。
 */
import { describe, it, expect } from 'vitest'
import { reactive } from 'vue'

import { useSettingSchema } from '@/composables/useSettingSchema'
import type { SettingSchema } from '@/types/settingSchema'

interface PortForm {
  dhtListenPort: number
  listenPort: number
  maxTries: number
}

function makeSchema(): SettingSchema {
  return {
    fields: [
      { key: 'dhtListenPort', aria2Key: 'dht-listen-port', type: 'number', default: 6881, min: 1024, max: 65535 },
      { key: 'listenPort', aria2Key: 'listen-port', type: 'number', default: 6881, min: 1024, max: 65535 },
      { key: 'maxTries', aria2Key: 'max-tries', type: 'number', default: 5, min: 0 }
    ]
  }
}

function makeForm(): PortForm {
  return reactive<PortForm>({ dhtListenPort: 6881, listenPort: 6881, maxTries: 5 })
}

describe('useSettingSchema：aria2 选项 → 表单', () => {
  it('端口范围字符串取范围下界，不产生 NaN', () => {
    const form = makeForm()
    const { applyOptions } = useSettingSchema(makeSchema(), form)

    applyOptions({ 'dht-listen-port': '6881-6999', 'listen-port': '6881-6999' } as never)

    expect(form.dhtListenPort).toBe(6881)
    expect(form.listenPort).toBe(6881)
    expect(Number.isNaN(form.dhtListenPort)).toBe(false)
    expect(Number.isNaN(form.listenPort)).toBe(false)
  })

  it('多端口列表取第一项的下界', () => {
    const form = makeForm()
    const { applyOptions } = useSettingSchema(makeSchema(), form)

    applyOptions({ 'dht-listen-port': '7000,7001,7002' } as never)

    expect(form.dhtListenPort).toBe(7000)
  })

  it('单端口与普通数值照常解析', () => {
    const form = makeForm()
    const { applyOptions } = useSettingSchema(makeSchema(), form)

    applyOptions({ 'dht-listen-port': '6881', 'max-tries': '3' } as never)

    expect(form.dhtListenPort).toBe(6881)
    expect(form.maxTries).toBe(3)
  })

  it('无法解析的脏值回退字段默认值，而不是 NaN', () => {
    const form = makeForm()
    const { applyOptions } = useSettingSchema(makeSchema(), form)

    applyOptions({ 'dht-listen-port': 'not-a-number' } as never)

    expect(form.dhtListenPort).toBe(6881)
  })

  it('选项缺失时回退默认值并 clamp 到 min/max', () => {
    const form = makeForm()
    const { applyOptions } = useSettingSchema(makeSchema(), form)

    applyOptions({} as never)

    expect(form.dhtListenPort).toBe(6881)
    expect(form.listenPort).toBe(6881)
  })
})

describe('useSettingSchema：表单 → aria2 选项', () => {
  it('范围型选项保存时写回单端口（合法值）', () => {
    const form = makeForm()
    const { toOptions } = useSettingSchema(makeSchema(), form)

    const opts = toOptions()

    expect(opts['dht-listen-port']).toBe('6881')
    expect(opts['listen-port']).toBe('6881')
    expect(opts['dht-listen-port']).not.toBe('NaN')
  })

  it('NaN 值绝不写入（这是配置被写坏的直接原因）', () => {
    const form = makeForm()
    const { toOptions } = useSettingSchema(makeSchema(), form)

    form.dhtListenPort = Number.NaN
    form.maxTries = Number.NaN
    const opts = toOptions()

    expect(opts['dht-listen-port']).toBeUndefined()
    expect(opts['max-tries']).toBeUndefined()
    // 未受影响的字段仍正常写入
    expect(opts['listen-port']).toBe('6881')
  })

  it('Infinity 值同样不写入', () => {
    const form = makeForm()
    const { toOptions } = useSettingSchema(makeSchema(), form)

    form.maxTries = Number.POSITIVE_INFINITY
    const opts = toOptions()

    expect(opts['max-tries']).toBeUndefined()
  })

  it('0 仍然写入（0 在 aria2 里表示无限制，不能被当成空值丢掉）', () => {
    const form = makeForm()
    const { toOptions } = useSettingSchema(makeSchema(), form)

    form.maxTries = 0
    const opts = toOptions()

    expect(opts['max-tries']).toBe('0')
  })
})

describe('useSettingSchema：默认值（重置表单用）', () => {
  it('优先用字段声明的 default，而不是类型空值', () => {
    const { defaults } = useSettingSchema(makeSchema(), makeForm())

    expect(defaults()).toEqual({ dhtListenPort: 6881, listenPort: 6881, maxTries: 5 })
  })

  it('未声明 default 时按类型给空值：布尔 false、数值 0、文本空串', () => {
    const schema: SettingSchema = {
      fields: [
        { key: 'enabled', aria2Key: 'enable-x', type: 'boolean' },
        { key: 'count', aria2Key: 'count', type: 'number' },
        { key: 'size', aria2Key: 'size', type: 'size' },
        { key: 'label', aria2Key: 'label', type: 'string' },
        { key: 'mode', aria2Key: 'mode', type: 'select' }
      ]
    }
    const { defaults } = useSettingSchema(schema, {})

    expect(defaults()).toEqual({ enabled: false, count: 0, size: 0, label: '', mode: '' })
  })

  it('default 为 0 或 false 时不会被当成"没写默认值"', () => {
    const schema: SettingSchema = {
      fields: [
        { key: 'enabled', aria2Key: 'enable-x', type: 'boolean', default: false },
        { key: 'count', aria2Key: 'count', type: 'number', default: 0 }
      ]
    }
    const { defaults } = useSettingSchema(schema, {})

    expect(defaults()).toEqual({ enabled: false, count: 0 })
  })
})
