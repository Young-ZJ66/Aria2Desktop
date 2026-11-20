#!/usr/bin/env node
/**
 * 版本一致性校验：确认「仓库里所有写着版本号的地方」互相吻合。
 *
 * 背景：发版链路上真正会出事的不是"忘了 bump"，而是**只 bump 了一部分**。
 * 版本号散在 5 个位置，各自被不同环节消费：
 *
 *   package.json                     → electron-builder 产物命名、release.yml 的 tag 校验
 *   package-lock.json（两处）        → npm ci 的 lockfile 版本
 *   src/shared/appSettings.ts        → 插件市场注册表固定的 tag（用户实际拉哪一份清单）
 *   extension/manifest.json          → 扩展商店版本（只接受三段稳定号，不能带 -beta）
 *   .github/release-notes.md 首行    → release.yml 校验更新日志是否属于本次 tag
 *
 * 漏掉任何一处都要等**打上 tag 之后**才在 release.yml 里炸——那时 tag 已经推上去，
 * 而 tag 不可移动（ruleset 拒绝强推），只能发下一个版本补救。beta.2 就这么踩过一次：
 * 本地 git add -A 后索引里 package.json 仍是旧版本，git status 却是干净的。
 *
 * 所以在 CI 与本地（推 tag 之前）都要跑这一步。它不依赖 tag，只看工作树内部是否自洽。
 *
 * 用法：
 *   npm run verify:versions
 *   node scripts/check-versions.mjs            # 同上
 */

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')

/** 三段稳定号（扩展商店只接受这种） */
const STABLE_SEMVER = /^\d+\.\d+\.\d+$/
/** 允许 -beta.1 这类预发布后缀 */
const ANY_SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

/** 注册表固定 tag 应为 package.json 版本的 v 前缀形式 */
export function expectedPinnedTag(version) {
  return 'v' + String(version || '').trim()
}

/**
 * 扩展版本：去掉预发布后缀。
 *
 * Chrome / Edge 商店不接受 1.5.0-beta.1 这种版本号，而扩展与 App 同批发版，
 * 所以扩展始终跟 App 的**主版本**走：App 是 1.5.0-beta.3 时扩展写 1.5.0。
 */
export function extensionVersionFor(version) {
  return String(version || '').trim().split('-')[0]
}

/**
 * 纯函数校验：只吃字符串，不碰文件系统，便于用构造用例钉死每条规则。
 *
 * @param {object} input
 * @param {string} input.pkgVersion            package.json 的 version
 * @param {string} input.lockRootVersion       package-lock.json 顶层 version
 * @param {string} input.lockPackageVersion    package-lock.json 的 packages[""].version
 * @param {string} input.pinnedTag             PLUGIN_REGISTRY_PINNED_TAG
 * @param {string} input.extensionVersion      extension/manifest.json 的 version
 * @param {string} input.releaseNotesFirstLine .github/release-notes.md 首行
 * @returns {string[]} 失败项（空数组表示一致）
 */
export function checkVersions(input) {
  const failures = []
  const version = String((input && input.pkgVersion) || '').trim()

  if (!ANY_SEMVER.test(version)) {
    // 版本号本身不合法时后面的推导全无意义，直接返回这一条
    failures.push('package.json 的 version 不是合法 semver: ' + (version || '(空)'))
    return failures
  }

  const lockRoot = String((input && input.lockRootVersion) || '').trim()
  if (lockRoot !== version) {
    failures.push('package-lock.json 顶层 version 与 package.json 不一致: ' + (lockRoot || '(空)') + ' ≠ ' + version)
  }

  const lockPkg = String((input && input.lockPackageVersion) || '').trim()
  if (lockPkg !== version) {
    failures.push('package-lock.json 的 packages[""].version 与 package.json 不一致: ' + (lockPkg || '(空)') + ' ≠ ' + version)
  }

  const expectedTag = expectedPinnedTag(version)
  const pinnedTag = String((input && input.pinnedTag) || '').trim()
  if (pinnedTag !== expectedTag) {
    // 这条最隐蔽：不一致时用户拉到的是上一版注册表，而本地一切正常
    failures.push('PLUGIN_REGISTRY_PINNED_TAG 与 package.json 版本不一致: ' +
      (pinnedTag || '(空)') + ' ≠ ' + expectedTag + '（升级版本时必须同步 src/shared/appSettings.ts）')
  }

  const expectedExt = extensionVersionFor(version)
  const extVersion = String((input && input.extensionVersion) || '').trim()
  if (!STABLE_SEMVER.test(extVersion)) {
    failures.push('extension/manifest.json 的 version 必须是三段稳定号（商店不接受预发布后缀）: ' + (extVersion || '(空)'))
  } else if (extVersion !== expectedExt) {
    failures.push('扩展版本与 App 主版本不一致: ' + extVersion + ' ≠ ' + expectedExt)
  }

  const firstLine = String((input && input.releaseNotesFirstLine) || '').trim()
  if (!firstLine.includes(version)) {
    failures.push('.github/release-notes.md 首行没有本次版本号 ' + version + '（release.yml 会拒绝创建 Release）: ' + (firstLine || '(空)'))
  }

  return failures
}

/** 从 appSettings.ts 源码里取固定 tag（不加载 TS 模块，避免依赖 --experimental-strip-types） */
export function extractPinnedTag(source) {
  const match = /PLUGIN_REGISTRY_PINNED_TAG\s*=\s*'([^']+)'/.exec(String(source || ''))
  return match ? match[1] : ''
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'))
}

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

export function collectVersions() {
  const pkg = readJson('package.json')
  const lock = readJson('package-lock.json')
  const lockRoot = lock && typeof lock.version === 'string' ? lock.version : ''
  const lockPackage = lock && lock.packages && lock.packages[''] && typeof lock.packages[''].version === 'string'
    ? lock.packages[''].version
    : ''
  const manifest = readJson('extension/manifest.json')
  const releaseNotes = readText('.github/release-notes.md')
  return {
    pkgVersion: pkg.version,
    lockRootVersion: lockRoot,
    lockPackageVersion: lockPackage,
    pinnedTag: extractPinnedTag(readText('src/shared/appSettings.ts')),
    extensionVersion: manifest && manifest.version,
    releaseNotesFirstLine: releaseNotes.split(/\r?\n/)[0] || ''
  }
}

export function main() {
  const versions = collectVersions()
  const failures = checkVersions(versions)

  console.log('package.json           ' + versions.pkgVersion)
  console.log('package-lock.json      ' + versions.lockRootVersion + ' / ' + versions.lockPackageVersion)
  console.log('PLUGIN_REGISTRY_TAG    ' + versions.pinnedTag)
  console.log('extension/manifest     ' + versions.extensionVersion)
  console.log('release-notes 首行     ' + versions.releaseNotesFirstLine)

  if (failures.length > 0) {
    for (const failure of failures) console.error('✗ ' + failure)
    return 1
  }
  console.log('版本一致性校验通过')
  return 0
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1].replace(/\\/g, '/')).href) {
  process.exitCode = main()
}
