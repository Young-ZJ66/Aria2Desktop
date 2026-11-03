/**
 * 校验设置页里声明的 aria2 选项名都是 aria2 真实支持的。
 *
 * 为什么要测：写错的选项名不会被 aria2 报错，它只会在启动时说一句 `Unknown option`
 * 然后忽略——界面上开关点得动、提示"已保存"，实际什么都没发生。这个项目里真的发生过
 * 两次：「BT 最大分片长度」（max-piece-length）和「Metalink 首选服务器」（metalink-servers），
 * 前者甚至被特判成"永不写入"，用户改了却什么都不会变。
 *
 * 快照来自 aria2c --help=#all（见 fixture 头部注释），离线可跑，不依赖二进制。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function readAria2Options() {
  const file = path.join(ROOT, 'scripts', 'fixtures', 'aria2-global-options.txt')
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#'))
}

/** 收集所有设置页里 `aria2Key: 'xxx'` 的声明 */
function collectDeclaredKeys() {
  const dir = path.join(ROOT, 'src', 'views', 'settings')
  const declared = new Map()
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.vue')) continue
    const text = fs.readFileSync(path.join(dir, name), 'utf8')
    for (const m of text.matchAll(/aria2Key:\s*'([a-z0-9-]+)'/g)) {
      const list = declared.get(m[1]) ?? []
      list.push(name)
      declared.set(m[1], list)
    }
  }
  return declared
}

describe('设置页的 aria2 选项名', () => {
  const supported = new Set(readAria2Options())

  it('快照文件本身是完整的', () => {
    // 少读一半会让后面的断言全部空转，所以先钉住规模（aria2 1.37 有接近 200 个长选项）
    expect(supported.size).toBeGreaterThan(150)
    expect(supported.has('max-overall-download-limit')).toBe(true)
    expect(supported.has('bt-tracker')).toBe(true)
  })

  it('声明数量不为零（正则失效时不至于悄悄通过）', () => {
    expect(collectDeclaredKeys().size).toBeGreaterThan(50)
  })

  it('每个 aria2Key 都是 aria2 支持的选项', () => {
    const unknown = [...collectDeclaredKeys()]
      .filter(([key]) => !supported.has(key))
      .map(([key, files]) => `${key} <- ${files.join(', ')}`)
    expect(unknown).toEqual([])
  })
})
