#!/usr/bin/env node
/**
 * 一次性把版本号写到全部五处，避免"只 bump 了一部分"。
 *
 * 为什么需要它：版本号散在 package.json、package-lock.json（两处）、
 * src/shared/appSettings.ts 的 PLUGIN_REGISTRY_PINNED_TAG、extension/manifest.json、
 * .github/release-notes.md 首行。漏改任意一处的后果都要等 tag 推上去之后才暴露，
 * 而 tag 不可移动。手工改五次、其中两次是 lockfile 里看着一样的行，很容易漏。
 *
 * 与 check-versions.mjs 的分工：这里负责**改对**，那里负责**验对**（CI 会跑）。
 *
 * 用法：
 *   npm run bump:version -- 1.5.0            # 写到全部五处
 *   npm run bump:version -- 1.5.0-beta.4     # 预发布
 *   npm run bump:version -- 1.5.0 --dry-run  # 只打印将要改什么
 *
 * 注意：扩展版本始终取三段稳定号（浏览器商店不接受 -beta 后缀），
 * 所以 App 是 1.5.0-beta.4 时扩展写 1.5.0。
 */

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')

const ANY_SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

/** 注册表固定 tag = v + 完整版本 */
export function pinnedTagFor(version) {
  return 'v' + String(version || '').trim()
}

/** 扩展版本 = 去掉预发布后缀（商店只接受三段稳定号） */
export function extensionVersionFor(version) {
  return String(version || '').trim().split('-')[0]
}

/**
 * 纯函数：给定文件内容与目标版本，返回改写后的内容。
 * 未知文件返回 null（调用方据此跳过），内容已是最新时返回 null（无需写盘）。
 */
export function rewriteFile(fileName, text, version) {
  const next = String(version).trim()
  if (fileName === 'package.json' || fileName === 'package-lock.json') {
    const data = JSON.parse(text)
    if (fileName === 'package-lock.json') {
      if (!data.packages || !data.packages['']) throw new Error('package-lock.json 缺少 packages[""]')
      if (data.version === next && data.packages[''].version === next) return null
      data.version = next
      data.packages[''].version = next
    } else {
      if (data.version === next) return null
      data.version = next
    }
    return JSON.stringify(data, null, 2) + '\n'
  }

  if (fileName === 'extension/manifest.json') {
    const data = JSON.parse(text)
    const nextExtension = extensionVersionFor(next)
    if (data.version === nextExtension) return null
    data.version = nextExtension
    return JSON.stringify(data, null, 2) + '\n'
  }

  if (fileName === 'src/shared/appSettings.ts') {
    const tag = pinnedTagFor(next)
    const pattern = /(PLUGIN_REGISTRY_PINNED_TAG\s*=\s*')([^']*)(')/
    const match = pattern.exec(text)
    if (!match) throw new Error('src/shared/appSettings.ts 里找不到 PLUGIN_REGISTRY_PINNED_TAG')
    if (match[2] === tag) return null
    return text.replace(pattern, (_all, before, _old, after) => before + tag + after)
  }

  if (fileName === '.github/release-notes.md') {
    // 首行版本 + 正文里的 compare 链接都指向同一个 tag，整份替换最稳
    const current = /^# v(\S+)/.exec(text)
    if (!current) throw new Error('.github/release-notes.md 首行不是 "# vX.Y.Z 更新日志" 形式')
    if (current[1] === next) return null
    const oldTag = 'v' + current[1]
    const newTag = pinnedTagFor(next)
    return text.split(oldTag).join(newTag)
  }

  return null
}

/** 需要改的文件清单（顺序即输出顺序） */
export const VERSION_FILES = [
  'package.json',
  'package-lock.json',
  'src/shared/appSettings.ts',
  'extension/manifest.json',
  '.github/release-notes.md'
]

export function bump(version, options = {}) {
  const dryRun = options.dryRun === true
  const root = options.repoRoot || repoRoot
  const next = String(version || '').trim()
  if (!ANY_SEMVER.test(next)) {
    throw new Error('版本号不是合法 semver: ' + (next || '(空)'))
  }

  const changed = []
  for (const relative of VERSION_FILES) {
    const absolute = path.join(root, relative)
    const text = fs.readFileSync(absolute, 'utf8')
    const rewritten = rewriteFile(relative, text, next)
    if (rewritten === null) {
      const target = relative === 'extension/manifest.json' ? extensionVersionFor(next) : next
      console.log('· ' + relative + ' 已是 ' + target)
      continue
    }
    changed.push(relative)
    if (!dryRun) fs.writeFileSync(absolute, rewritten)
    console.log((dryRun ? '→ ' : '✓ ') + relative)
  }
  return changed
}

export function main(argv) {
  const args = argv.slice()
  const dryRun = args.includes('--dry-run')
  const version = args.find(arg => !arg.startsWith('-'))
  if (!version) {
    console.error('用法: npm run bump:version -- <版本号> [--dry-run]')
    return 1
  }
  try {
    const changed = bump(version, { dryRun })
    console.log((dryRun ? '（dry-run）将改动 ' : '已改动 ') + changed.length + ' 个文件')
    return 0
  } catch (error) {
    console.error('✗ ' + (error && error.message))
    return 1
  }
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1].replace(/\\/g, '/')).href) {
  process.exitCode = main(process.argv.slice(2))
}
