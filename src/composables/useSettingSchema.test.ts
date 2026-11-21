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

describe('useSettingSchema：未知类型走默认转换', () => {
  it('optionToValue 对未知类型直接用原始字符串，缺失时回退字段默认值', () => {
    const schema = {
      fields: [
        { key: 'custom', aria2Key: 'custom-opt', type: 'custom' as never, default: 'fallback' }
      ]
    }
    const form = reactive<Record<string, unknown>>({ custom: '' })
    const { applyOptions } = useSettingSchema(schema as never, form)
    applyOptions({ 'custom-opt': 'raw-value' } as never)
    expect(form.custom).toBe('raw-value')
    applyOptions({} as never)
    expect(form.custom).toBe('fallback')
  })

  it('valueToOption 对未知类型只在有值时才写入', () => {
    const schema = {
      fields: [{ key: 'custom', aria2Key: 'custom-opt', type: 'custom' as never }]
    }
    const form = reactive<Record<string, unknown>>({ custom: 42 })
    const { toOptions } = useSettingSchema(schema as never, form)
    expect(toOptions()).toEqual({ 'custom-opt': '42' })
    form.custom = null
    expect(toOptions()).toEqual({})
    form.custom = undefined
    expect(toOptions()).toEqual({})
  })
})

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

describe('useSettingSchema：布尔字段的默认值语义', () => {
  it('默认 true 的字段：aria2 没返回或返回非 "false" 都算启用', () => {
    const schema: SettingSchema = {
      fields: [{ key: 'continue', aria2Key: 'continue', type: 'boolean', default: true }]
    }
    const form = reactive<Record<string, unknown>>({ continue: false })
    const { applyOptions } = useSettingSchema(schema, form)

    applyOptions({} as never)
    expect(form.continue).toBe(true)
    applyOptions({ continue: 'true' } as never)
    expect(form.continue).toBe(true)
    applyOptions({ continue: 'false' } as never)
    expect(form.continue).toBe(false)
  })

  it('默认 false 的字段：只有明确返回 "true" 才算启用', () => {
    const schema: SettingSchema = {
      fields: [{ key: 'rpcSecure', aria2Key: 'rpc-secure', type: 'boolean', default: false }]
    }
    const form = reactive<Record<string, unknown>>({ rpcSecure: true })
    const { applyOptions } = useSettingSchema(schema, form)

    applyOptions({} as never)
    expect(form.rpcSecure).toBe(false)
    applyOptions({ 'rpc-secure': 'yes' } as never)
    expect(form.rpcSecure).toBe(false)
    applyOptions({ 'rpc-secure': 'true' } as never)
    expect(form.rpcSecure).toBe(true)
  })

  it('布尔字段写回时永远是 "true"/"false"，不会是 "0"/"1"', () => {
    const schema: SettingSchema = {
      fields: [{ key: 'enabled', aria2Key: 'enable-x', type: 'boolean', default: false }]
    }
    const form = reactive<Record<string, unknown>>({ enabled: true })
    const { toOptions } = useSettingSchema(schema, form)

    expect(toOptions()).toEqual({ 'enable-x': 'true' })
    form.enabled = 0
    expect(toOptions()).toEqual({ 'enable-x': 'false' })
  })
})

describe('useSettingSchema：size 字段', () => {
  const schema = (): SettingSchema => ({
    fields: [{ key: 'pieceLength', aria2Key: 'piece-length', type: 'size', unit: 'M', default: 1, min: 1, max: 1024 }]
  })

  it('字节数按目标单位换算后填进表单', () => {
    const form = reactive<Record<string, unknown>>({ pieceLength: 0 })
    const { applyOptions } = useSettingSchema(schema(), form)

    applyOptions({ 'piece-length': '2097152' } as never)
    expect(form.pieceLength).toBe(2)
    applyOptions({ 'piece-length': '2M' } as never)
    expect(form.pieceLength).toBe(2)
    applyOptions({ 'piece-length': '1048576' } as never)
    expect(form.pieceLength).toBe(1)
  })

  it('aria2 没返回时用字段默认值，并 clamp 到 min/max', () => {
    const form = reactive<Record<string, unknown>>({ pieceLength: 0 })
    const { applyOptions } = useSettingSchema(schema(), form)

    applyOptions({} as never)
    expect(form.pieceLength).toBe(1)
    // 小于 min 的原始值被抬到 min，大于 max 的被压到 max
    applyOptions({ 'piece-length': '1024' } as never)
    expect(form.pieceLength).toBe(1)
    applyOptions({ 'piece-length': '10G' } as never)
    expect(form.pieceLength).toBe(1024)
  })

  it('写回时带单位后缀，0 表示无限制写成 "0"', () => {
    const form = reactive<Record<string, unknown>>({ pieceLength: 4 })
    const { toOptions } = useSettingSchema(schema(), form)

    expect(toOptions()).toEqual({ 'piece-length': '4M' })
    form.pieceLength = 0
    expect(toOptions()).toEqual({ 'piece-length': '0' })
  })
})

describe('useSettingSchema：文本与下拉字段', () => {
  it('空串回退字段默认值，非空原样保留', () => {
    const schema: SettingSchema = {
      fields: [
        { key: 'userAgent', aria2Key: 'user-agent', type: 'string', default: 'aria2/1.37.0' },
        { key: 'mode', aria2Key: 'mode', type: 'select', default: 'auto' }
      ]
    }
    const form = reactive<Record<string, unknown>>({ userAgent: '', mode: '' })
    const { applyOptions } = useSettingSchema(schema, form)

    applyOptions({} as never)
    expect(form.userAgent).toBe('aria2/1.37.0')
    expect(form.mode).toBe('auto')
    applyOptions({ 'user-agent': 'custom/1.0', mode: 'manual' } as never)
    expect(form.userAgent).toBe('custom/1.0')
    expect(form.mode).toBe('manual')
  })

  it('空值不写入 aria2 选项，让引擎保留旧值', () => {
    const schema: SettingSchema = {
      fields: [
        { key: 'userAgent', aria2Key: 'user-agent', type: 'string' },
        { key: 'mode', aria2Key: 'mode', type: 'select' }
      ]
    }
    const form = reactive<Record<string, unknown>>({ userAgent: '', mode: '' })
    const { toOptions } = useSettingSchema(schema, form)

    expect(toOptions()).toEqual({})
    form.userAgent = 'custom/1.0'
    expect(toOptions()).toEqual({ 'user-agent': 'custom/1.0' })
  })
})

describe('useSettingSchema：自定义转换与数组选项', () => {
  it('字段级 optionToValue / valueToOption 覆盖默认转换', () => {
    const schema: SettingSchema = {
      fields: [
        {
          key: 'levels',
          aria2Key: 'log-level',
          type: 'string',
          optionToValue: (raw) => (raw ?? '').toUpperCase(),
          valueToOption: (value) => (value ? String(value).toLowerCase() : undefined)
        }
      ]
    }
    const form = reactive<Record<string, unknown>>({ levels: '' })
    const { applyOptions, toOptions } = useSettingSchema(schema, form)

    applyOptions({ 'log-level': 'debug' } as never)
    expect(form.levels).toBe('DEBUG')
    expect(toOptions()).toEqual({ 'log-level': 'debug' })
    form.levels = ''
    expect(toOptions()).toEqual({})
  })

  it('数组型选项折叠为首项（设置页只处理标量）', () => {
    const schema: SettingSchema = {
      fields: [{ key: 'header', aria2Key: 'header', type: 'string' }]
    }
    const form = reactive<Record<string, unknown>>({ header: '' })
    const { applyOptions } = useSettingSchema(schema, form)

    applyOptions({ header: ['X-A: 1', 'X-B: 2'] } as never)
    expect(form.header).toBe('X-A: 1')
  })
})
