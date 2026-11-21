import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  VERSION_FILES,
  bump,
  extensionVersionFor,
  main,
  pinnedTagFor,
  rewriteFile
} from './bump-version.mjs'

const tempDirs = []

function makeRepo(version = '1.5.0-beta.3') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bump-version-'))
  tempDirs.push(dir)
  fs.mkdirSync(path.join(dir, 'src/shared'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'extension'), { recursive: true })
  fs.mkdirSync(path.join(dir, '.github'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', version }, null, 2) + '\n')
  fs.writeFileSync(
    path.join(dir, 'package-lock.json'),
    JSON.stringify({ name: 'x', version, lockfileVersion: 3, packages: { '': { name: 'x', version } } }, null, 2) + '\n'
  )
  fs.writeFileSync(
    path.join(dir, 'src/shared/appSettings.ts'),
    "export const PLUGIN_REGISTRY_PINNED_TAG = '" + pinnedTagFor(version) + "'\n"
  )
  fs.writeFileSync(
    path.join(dir, 'extension/manifest.json'),
    JSON.stringify({ manifest_version: 3, version: extensionVersionFor(version) }, null, 2) + '\n'
  )
  fs.writeFileSync(
    path.join(dir, '.github/release-notes.md'),
    '# v' + version + ' 更新日志\n\n比较：https://github.com/o/r/compare/v1.4.0...v' + version + '\n'
  )
  return dir
}

function read(dir, relative) {
  return fs.readFileSync(path.join(dir, relative), 'utf8')
}

afterEach(() => {
  while (tempDirs.length) fs.rmSync(tempDirs.pop(), { recursive: true, force: true })
})

describe('版本派生规则', () => {
  it('注册表固定 tag 带 v 前缀', () => {
    expect(pinnedTagFor('1.5.0-beta.4')).toBe('v1.5.0-beta.4')
    expect(pinnedTagFor(' 1.5.0 ')).toBe('v1.5.0')
  })

  it('扩展版本去掉预发布后缀（商店只接受三段）', () => {
    expect(extensionVersionFor('1.5.0-beta.4')).toBe('1.5.0')
    expect(extensionVersionFor('1.5.0')).toBe('1.5.0')
  })
})

describe('单文件改写', () => {
  it('package.json 只改 version 字段', () => {
    const next = rewriteFile('package.json', JSON.stringify({ name: 'x', version: '1.0.0' }, null, 2) + '\n', '1.5.0')
    expect(JSON.parse(next).version).toBe('1.5.0')
    expect(JSON.parse(next).name).toBe('x')
  })

  it('package-lock.json 同时改顶层与 packages[""]', () => {
    const text = JSON.stringify({ version: '1.0.0', packages: { '': { version: '1.0.0' } } }, null, 2) + '\n'
    const next = JSON.parse(rewriteFile('package-lock.json', text, '1.5.0-beta.4'))
    expect(next.version).toBe('1.5.0-beta.4')
    expect(next.packages[''].version).toBe('1.5.0-beta.4')
  })

  it('package-lock.json 缺少 packages[""] 时报错', () => {
    const text = JSON.stringify({ version: '1.0.0' }, null, 2) + '\n'
    expect(() => rewriteFile('package-lock.json', text, '1.5.0')).toThrow(/packages/)
  })

  it('appSettings.ts 只替换 tag 字面量', () => {
    const text = "// PLUGIN_REGISTRY_PINNED_TAG 说明\nexport const PLUGIN_REGISTRY_PINNED_TAG = 'v1.0.0'\n"
    const next = rewriteFile('src/shared/appSettings.ts', text, '1.5.0-beta.4')
    expect(next).toContain("PLUGIN_REGISTRY_PINNED_TAG = 'v1.5.0-beta.4'")
    expect(next).toContain('// PLUGIN_REGISTRY_PINNED_TAG 说明')
  })

  it('appSettings.ts 找不到字面量时报错', () => {
    expect(() => rewriteFile('src/shared/appSettings.ts', 'const x = 1\n', '1.5.0')).toThrow(/PLUGIN_REGISTRY_PINNED_TAG/)
  })

  it('扩展 manifest 写入三段版本号', () => {
    const text = JSON.stringify({ manifest_version: 3, version: '1.0.0' }, null, 2) + '\n'
    expect(JSON.parse(rewriteFile('extension/manifest.json', text, '1.5.0-beta.4')).version).toBe('1.5.0')
  })

  it('更新日志首行与正文里的 compare 链接一起替换', () => {
    const text = '# v1.5.0-beta.3 更新日志\n\nhttps://github.com/o/r/compare/v1.4.0...v1.5.0-beta.3\n'
    const next = rewriteFile('.github/release-notes.md', text, '1.5.0-beta.4')
    expect(next.split('\n')[0]).toBe('# v1.5.0-beta.4 更新日志')
    expect(next).toContain('...v1.5.0-beta.4')
    expect(next).toContain('compare/v1.4.0')
    expect(next).not.toContain('beta.3')
  })

  it('内容已是最新时返回 null（不写盘）', () => {
    expect(rewriteFile('package.json', JSON.stringify({ version: '1.5.0' }, null, 2) + '\n', '1.5.0')).toBeNull()
    expect(rewriteFile('.github/release-notes.md', '# v1.5.0 更新日志\n', '1.5.0')).toBeNull()
  })

  it('未知文件返回 null', () => {
    expect(rewriteFile('README.md', '# x\n', '1.5.0')).toBeNull()
  })
})

describe('整仓 bump', () => {
  it('五处版本号全部改写到位', () => {
    const dir = makeRepo('1.5.0-beta.3')
    const changed = bump('1.5.0-beta.4', { repoRoot: dir })
    // 预发布号变化不影响扩展版本（商店只接受三段），所以 manifest 不在改动列表里
    expect(changed).toEqual(VERSION_FILES.filter(file => file !== 'extension/manifest.json'))
    expect(JSON.parse(read(dir, 'package.json')).version).toBe('1.5.0-beta.4')
    const lock = JSON.parse(read(dir, 'package-lock.json'))
    expect(lock.version).toBe('1.5.0-beta.4')
    expect(lock.packages[''].version).toBe('1.5.0-beta.4')
    expect(read(dir, 'src/shared/appSettings.ts')).toContain("'v1.5.0-beta.4'")
    expect(JSON.parse(read(dir, 'extension/manifest.json')).version).toBe('1.5.0')
    expect(read(dir, '.github/release-notes.md')).toContain('# v1.5.0-beta.4 更新日志')
  })

  it('dry-run 不改任何文件', () => {
    const dir = makeRepo('1.5.0-beta.3')
    const before = VERSION_FILES.map(file => read(dir, file))
    const changed = bump('1.5.0-beta.4', { repoRoot: dir, dryRun: true })
    expect(changed).toEqual(VERSION_FILES.filter(file => file !== 'extension/manifest.json'))
    expect(VERSION_FILES.map(file => read(dir, file))).toEqual(before)
  })

  it('重复执行是幂等的', () => {
    const dir = makeRepo('1.5.0-beta.3')
    bump('1.5.0-beta.4', { repoRoot: dir })
    expect(bump('1.5.0-beta.4', { repoRoot: dir })).toEqual([])
  })

  it('稳定版发版时扩展版本与 App 一致', () => {
    const dir = makeRepo('1.5.0-beta.4')
    bump('1.5.0', { repoRoot: dir })
    expect(JSON.parse(read(dir, 'extension/manifest.json')).version).toBe('1.5.0')
    expect(read(dir, '.github/release-notes.md')).toContain('# v1.5.0 更新日志')
  })

  it('非法版本号直接抛错且不改文件', () => {
    const dir = makeRepo('1.5.0-beta.3')
    const before = read(dir, 'package.json')
    expect(() => bump('1.5', { repoRoot: dir })).toThrow(/semver/)
    expect(read(dir, 'package.json')).toBe(before)
  })

  it('main() 缺参数时返回 1', () => {
    expect(main([])).toBe(1)
  })
})

describe('脚本入口的收尾分支', () => {
  it('更新日志首行格式不对时报错而不是静默跳过', () => {
    expect(() => rewriteFile('.github/release-notes.md', '## 没有版本号的首行\n', '1.5.0')).toThrow(/# vX\.Y\.Z/)
  })

  it('main() 在 dry-run 下返回 0 且不写盘', () => {
    const before = fs.readFileSync(path.resolve('package.json'), 'utf8')
    expect(main(['1.5.0', '--dry-run'])).toBe(0)
    expect(fs.readFileSync(path.resolve('package.json'), 'utf8')).toBe(before)
  })

  it('main() 遇到非法版本号时返回 1', () => {
    expect(main(['1.5'])).toBe(1)
  })

  it('直接以脚本方式执行时把返回值写进 exitCode', () => {
    const script = path.resolve('scripts/bump-version.mjs')
    const result = spawnSync(process.execPath, [script], { encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('bump:version')
  })
})

