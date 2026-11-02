import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 语言包的静态一致性检查。
 *
 * 三条规矩：
 * 1. 两种语言键集合必须完全相同——少一条，另一种语言的用户就会看到 key 本身；
 * 2. 代码里写死的 t('...') 键必须真的存在——拼错了 vue-i18n 不会报错，只在界面上原样显示；
 * 3. 同一条文案在两个语言里占位符必须一致——{name} 漏一个，用户会看到裸露的花括号。
 *
 * 动态拼出来的键（如 `t('status.' + task.status)`）按前缀处理：前缀下至少要有一条键。
 */

const ROOT = process.cwd()
const LOCALES = ['zh-CN', 'en-US']

const localeOf = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, `src/locales/${name}.json`), 'utf8'))

function flatten(node, prefix = '') {
  return Object.entries(node).flatMap(([key, value]) => {
    const full = prefix ? `${prefix}.${key}` : key
    return value && typeof value === 'object' ? flatten(value, full) : [[full, String(value)]]
  })
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!['node_modules', 'dist', '.git'].includes(entry.name)) walk(path.join(dir, entry.name), out)
    } else if (/\.(ts|vue|mjs)$/.test(entry.name)) {
      out.push(path.join(dir, entry.name))
    }
  }
  return out
}

/** 抓 t('...') / $t('...') / te('...') 的字面量键（含中文模板里的 t( 调用） */
function literalKeys() {
  const pattern = /(?<![A-Za-z0-9_$])(?:\$?t|te)\(\s*['"`]([\w.-]+)['"`]/g
  const found = new Map()
  for (const file of [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'electron'))]) {
    const source = fs.readFileSync(file, 'utf8')
    for (const match of source.matchAll(pattern)) {
      const key = match[1]
      if (!key.includes('.')) continue
      if (!found.has(key)) found.set(key, new Set())
      found.get(key).add(path.relative(ROOT, file))
    }
  }
  return found
}

const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')

describe('语言包', () => {
  const zh = new Map(flatten(localeOf('zh-CN')))
  const en = new Map(flatten(localeOf('en-US')))

  it('两种语言的键集合完全相同', () => {
    const missingInEn = [...zh.keys()].filter((k) => !en.has(k))
    const missingInZh = [...en.keys()].filter((k) => !zh.has(k))

    expect(missingInEn).toEqual([])
    expect(missingInZh).toEqual([])
  })

  it('同一条文案在两种语言里的占位符一致', () => {
    const mismatched = [...zh.keys()]
      .filter((key) => en.has(key) && placeholders(zh.get(key)) !== placeholders(en.get(key)))
      .map((key) => `${key}: zh={${placeholders(zh.get(key))}} en={${placeholders(en.get(key))}}`)

    expect(mismatched).toEqual([])
  })

  it('代码里写死的翻译键都能在语言包里找到', () => {
    const broken = []
    for (const [key, files] of literalKeys()) {
      // 动态拼接的键（`t('status.' + x)`）：只要求前缀下存在键，具体取值由运行时决定
      if (key.endsWith('.')) {
        const hasPrefix = (map) => [...map.keys()].some((k) => k.startsWith(key))
        if (!hasPrefix(zh) || !hasPrefix(en)) broken.push(`${key}* → ${[...files].join(', ')}`)
        continue
      }
      if (!zh.has(key) || !en.has(key)) broken.push(`${key} → ${[...files].join(', ')}`)
    }

    expect(broken).toEqual([])
  })

  it('两种语言都有内容，且不是空文件', () => {
    for (const name of LOCALES) {
      expect(flatten(localeOf(name)).length).toBeGreaterThan(500)
    }
  })

  it('分类映射表里的每个文案键都存在', () => {
    // src/shared/updateError.ts 用 `t(`generalSettings.${key}`)` 拼接，静态扫描看不见
    const source = fs.readFileSync(path.join(ROOT, 'src/shared/updateError.ts'), 'utf8')
    const start = source.indexOf('UPDATE_ERROR_MESSAGE_KEYS')
    expect(start, 'src/shared/updateError.ts 里找不到 UPDATE_ERROR_MESSAGE_KEYS').toBeGreaterThan(-1)
    const block = source.slice(start, source.indexOf('}', start))
    const keys = [...block.matchAll(/:\s*'(\w+)'/g)].map((m) => m[1])
    expect(keys.length, '映射表看起来是空的').toBeGreaterThan(5)

    const missing = keys.flatMap((key) =>
      LOCALES.filter((name) => !localeOf(name).generalSettings?.[key]).map((name) => `${name}: generalSettings.${key}`)
    )
    expect(missing).toEqual([])
  })
})
