import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 语言包一致性护栏
 *
 * i18n fallback 是 zh-CN，漏 key 时界面会突然冒出一句中文，
 * 在 20 种其它语言里非常刺眼，但运行时不会报错、CI 也不会红。
 * 这个测试把「漏 key」变成一次可复现的失败。
 */

const LOCALE_DIR = path.resolve(process.cwd(), 'src/locales')
const BASE = 'zh-CN'

interface Json { [key: string]: string | Json }

function flatten(obj: Json, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object') {
      for (const [kk, vv] of flatten(v as Json, key)) out.set(kk, vv)
    } else {
      out.set(key, String(v))
    }
  }
  return out
}

function load(name: string): Map<string, string> {
  const raw = fs.readFileSync(path.join(LOCALE_DIR, `${name}.json`), 'utf8')
  return flatten(JSON.parse(raw) as Json)
}

const localeFiles = fs
  .readdirSync(LOCALE_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''))

const base = load(BASE)

describe('locales', () => {
  it('至少加载到全部 21 种语言', () => {
    expect(localeFiles.length).toBeGreaterThanOrEqual(21)
  })

  it('每种语言都覆盖 zh-CN 的全部 key（缺 key 会回落成中文）', () => {
    const missing: string[] = []
    for (const name of localeFiles) {
      if (name === BASE) continue
      const dict = load(name)
      for (const key of base.keys()) {
        if (!dict.has(key)) missing.push(`${name}: ${key}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('没有空文案', () => {
    const empty: string[] = []
    for (const name of localeFiles) {
      for (const [key, value] of load(name)) {
        if (!value.trim()) empty.push(`${name}: ${key}`)
      }
    }
    expect(empty).toEqual([])
  })

  it('同一 key 在两种语言里不是完全相同的串（防止漏翻）', () => {
    // 只校验本次 v2 新增的、最容易漏翻的几句；数字与专有名词不参与
    const watch = [
      'common.loading',
      'automation.loadErrorTitle',
      'automation.loadErrorHint',
      'queue.settings',
      'queue.emptyHint',
      'queue.disconnectedHint',
      'statusPage.trafficCollecting',
      'instances.add'
    ]
    const zh = load(BASE)
    const en = load('en-US')
    const same: string[] = []
    for (const key of watch) {
      const zhValue = zh.get(key)
      expect(zhValue, `zh-CN 缺少 ${key}`).toBeTruthy()
      const enValue = en.get(key)
      expect(enValue, `en-US 缺少 ${key}`).toBeTruthy()
      if (zhValue === enValue) same.push(key)
    }
    expect(same).toEqual([])
  })
})
