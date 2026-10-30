/**
 * 安装包产物校验（CI 与本地共用）。
 *
 * 用法：
 *   node scripts/verify-dist.mjs win x64 [--require-blocks]
 *   node scripts/verify-dist.mjs win ia32 [--require-blocks]
 *   node scripts/verify-dist.mjs mac
 *   node scripts/verify-dist.mjs linux
 *
 * 为什么需要：electron-builder 在缺资源/传输失败时可能"命令成功但产物不全"，
 * 而 Release 一旦发出就无法撤回重发。这里把"该有的文件都在、体积合理、
 * 版本号与 package.json 一致"变成可执行断言。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const releaseDir = path.join(root, pkg.build?.directories?.output ?? 'release')
const version = pkg.version

const [, , platform, arch, ...flags] = process.argv
const requireBlocks = flags.includes('--require-blocks')

/** 每个平台的必需产物：{ label, test(fileName), minBytes } */
const installerMin = 5 * 1024 * 1024
const blocksMin = 1024

function winSuffix(archName) {
  if (archName === 'x64') return 'x64'
  if (archName === 'ia32') return 'x86'
  return null
}

function buildRequirements() {
  if (platform === 'win') {
    const suffix = winSuffix(arch)
    if (!suffix) throw new Error('Windows 需要指定架构：x64 或 ia32')
    const requirements = [
      { label: `NSIS 安装包（${suffix}）`, test: (f) => f.includes(`-${version}-`) && f.endsWith(`-${suffix}-Setup.exe`), min: installerMin },
      { label: `便携版 zip（${suffix}）`, test: (f) => f.includes(`-${version}-`) && f.endsWith(`-${suffix}-portable.zip`), min: installerMin }
    ]
    if (requireBlocks) {
      requirements.push({
        label: `差量块表（${suffix}）`,
        test: (f) => f.includes(`-${version}-`) && f.endsWith(`-${suffix}-Setup.exe.blocks.json`),
        min: blocksMin
      })
    }
    return requirements
  }

  if (platform === 'mac') {
    return ['x64', 'arm64'].flatMap((archName) => [
      { label: `dmg（${archName}）`, test: (f) => f === `Aria2Desktop-${version}-${archName}.dmg`, min: installerMin },
      { label: `zip（${archName}）`, test: (f) => f === `Aria2Desktop-${version}-${archName}.zip`, min: installerMin }
    ])
  }

  if (platform === 'linux') {
    // electron-builder 对 Linux 的 ${arch} 宏按目标格式映射：AppImage→x86_64、deb→amd64
    // （见 builder-util 的 getArtifactArchName），不是 Windows 的 x64。
    return [
      { label: 'AppImage（x86_64）', test: (f) => f === `Aria2Desktop-${version}-x86_64.AppImage`, min: installerMin },
      { label: 'deb（amd64）', test: (f) => f === `Aria2Desktop-${version}-amd64.deb`, min: installerMin }
    ]
  }

  throw new Error(`未知平台「${platform}」，可选：win / mac / linux`)
}

function formatSize(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function main() {
  if (!fs.existsSync(releaseDir)) {
    console.error(`FAIL 产物目录不存在：${releaseDir}`)
    process.exit(1)
  }

  const files = fs.readdirSync(releaseDir).filter((name) => !name.endsWith('.sha256'))
  const requirements = buildRequirements()
  const failures = []

  console.log(`产物目录：${releaseDir}`)
  console.log(`应用版本：${version}（平台 ${platform}${arch ? ` / ${arch}` : ''}）\n`)

  for (const requirement of requirements) {
    const matched = files.filter((name) => requirement.test(name))
    if (matched.length === 0) {
      failures.push(`${requirement.label}：未找到`)
      console.log(`FAIL ${requirement.label} :: 未找到`)
      continue
    }
    for (const name of matched) {
      const size = fs.statSync(path.join(releaseDir, name)).size
      if (size < requirement.min) {
        failures.push(`${requirement.label}：${name} 体积异常（${formatSize(size)}）`)
        console.log(`FAIL ${requirement.label} :: ${name} 体积异常 ${formatSize(size)}`)
      } else {
        console.log(`PASS ${requirement.label} :: ${name}（${formatSize(size)}）`)
      }
    }
  }

  if (failures.length) {
    console.error(`\n结果：${failures.length} 项失败`)
    // 失败时打印目录内容：命名规则（尤其 Linux 的 x86_64/amd64）变化时无需再盲猜一轮
    console.error('产物目录内容：')
    for (const name of files.sort()) {
      const size = fs.statSync(path.join(releaseDir, name)).size
      console.error(`  - ${name}（${formatSize(size)}）`)
    }
    process.exit(1)
  }
  console.log(`\n结果：${requirements.length} 类产物全部就位`)
}

main()
