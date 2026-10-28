/**
 * 校验目标平台的 aria2 引擎二进制是否就位（打包前的一步）。
 *
 * 历史：这里原先是 `prepare-aria2c.mjs`，把 `resources/aria2c-<arch>.exe` 复制成
 * `resources/aria2c.exe` 供 electron-builder 打包。改成按 `平台/架构` 的目录布局后
 * 不再需要复制——`package.json` 的 `extraResources.from` 直接指向对应目录，
 * 因此本脚本只做校验，并在缺失时给出**可执行**的补救说明。
 *
 * 用法：
 *   node scripts/verify-engine.mjs <win32|darwin|linux> <x64|ia32|arm64|armv7l>
 *   省略参数时按当前机器（process.platform / process.arch）推断。
 *
 * 目录约定（与 electron-builder 配置、ResourceManager 三方一致）：
 *   resources/aria2/<platform>/<arch>/aria2c       (darwin/linux)
 *   resources/aria2/<platform>/<arch>/aria2c.exe   (win32)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

/** 平台 → 引擎文件名 */
const ENGINE_FILE = { win32: 'aria2c.exe', darwin: 'aria2c', linux: 'aria2c' }

/** Node 架构 → 目录名（ia32/arm 需归一，与其他三方配置保持一致） */
const ARCH_DIR = {
  win32: { x64: 'x64', ia32: 'ia32', arm64: 'x64' },
  darwin: { x64: 'x64', arm64: 'arm64' },
  linux: { x64: 'x64', arm64: 'arm64', arm: 'armv7l' }
}

const platform = process.argv[2] || process.platform
const arch = process.argv[3] || process.arch

const supported = ARCH_DIR[platform]
if (!supported) {
  console.error(`不支持的平台: ${platform}（支持 win32 / darwin / linux）`)
  process.exit(1)
}

const archDir = supported[arch]
if (!archDir) {
  console.error(`不支持的架构: ${arch}（${platform} 支持 ${Object.keys(supported).join(' / ')}）`)
  process.exit(1)
}

const relative = path.join('resources', 'aria2', platform, archDir, ENGINE_FILE[platform])
const absolute = path.join(root, relative)

if (!fs.existsSync(absolute)) {
  console.error(`[verify-engine] 缺少 ${platform}/${archDir} 的 aria2 引擎：${relative}`)
  console.error('  引擎二进制随仓库分发（与 Motrix 同策略），不入库就无法打包该平台。')
  console.error('  编译方式见 resources/aria2/README.md；Windows 版已随仓库提供。')
  process.exit(1)
}

// 太小基本可以断定是占位文件/残留指针（真实 aria2 静态二进制在 3 MB 以上）
const size = fs.statSync(absolute).size
if (size < 1024 * 1024) {
  console.error(`[verify-engine] ${relative} 只有 ${size} 字节，疑似占位文件，请替换为真实二进制`)
  process.exit(1)
}

console.log(`[verify-engine] 引擎就位: ${relative} (${(size / 1024 / 1024).toFixed(1)} MB)`)
