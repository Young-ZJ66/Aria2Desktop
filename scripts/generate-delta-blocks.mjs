/**
 * 为安装包生成差量块表（`<安装包>.blocks.json`）。
 *
 * 用法：node scripts/generate-delta-blocks.mjs <Setup.exe 路径> [块大小MB，默认 4]
 *
 * 输出与该文件同目录、同名的 `.blocks.json`，由 release 工作流上传到 Release。
 * 应用端（electron/services/deltaUpdater.ts）下载后与本地缓存的上版块表对比，
 * hash 命中的块从旧安装包复制、未命中的才用 Range 请求下载——详见 utils/deltaBlocks.ts。
 *
 * 格式与校验口径的唯一事实来源是 electron/utils/deltaBlocks.ts 的 isDeltaBlockTable；
 * 本脚本只负责"生成"，两端通过上传/下载的同一份 JSON 对齐。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const target = process.argv[2]
if (!target || !fs.existsSync(target)) {
  console.error(`用法: node scripts/generate-delta-blocks.mjs <Setup.exe 路径> [块大小MB]`)
  process.exit(1)
}

const blockSizeMB = Number(process.argv[3] || 4)
if (!Number.isInteger(blockSizeMB) || blockSizeMB <= 0 || blockSizeMB > 64) {
  console.error(`块大小需为 1-64 之间的整数 MB：${blockSizeMB}`)
  process.exit(1)
}

// 版本从文件名解析（Aria2Desktop-1.2.3-x64-Setup.exe → 1.2.3）。
// 应用端会拿它与自己请求的版本号严格比对（deltaUpdater 的 blocks_version_mismatch）
const baseName = path.basename(target)
const versionMatch = /^Aria2Desktop-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)-.*-Setup\.exe$/.exec(baseName)
if (!versionMatch) {
  console.error(`无法从文件名解析版本号: ${baseName}（期望 Aria2Desktop-<version>-<arch>-Setup.exe）`)
  process.exit(1)
}

const blockSize = blockSizeMB * 1024 * 1024
const size = fs.statSync(target).size

const blocks = []
let offset = 0
// 顺序分块流式计算 SHA-256：100MB 量级整读会占大内存，分块读的峰值只是一个块的缓冲
const fd = fs.openSync(target, 'r')
try {
  const buffer = Buffer.allocUnsafe(blockSize)
  while (offset < size) {
    const want = Math.min(blockSize, size - offset)
    const bytesRead = fs.readSync(fd, buffer, 0, want, offset)
    if (bytesRead !== want) {
      console.error(`读取不完整（${bytesRead}/${want} @ ${offset}），文件可能在生成期间被修改`)
      process.exit(1)
    }
    blocks.push({ offset, size: bytesRead, sha256: crypto.createHash('sha256').update(buffer.subarray(0, bytesRead)).digest('hex') })
    offset += bytesRead
  }
} finally {
  fs.closeSync(fd)
}

const table = {
  version: versionMatch[1],
  size,
  blockSize,
  blocks
}

const outPath = `${target}.blocks.json`
fs.writeFileSync(outPath, JSON.stringify(table), 'utf-8')

// 自校验：生成的表必须能被应用端的结构校验接受（关键属性就地复核，防止两端口径漂移）
const covered = blocks.reduce((sum, b) => sum + b.size, 0)
if (covered !== size || blocks[0]?.offset !== 0) {
  console.error('生成的块表自校验失败：块覆盖与文件大小不一致')
  process.exit(1)
}

const remoteBytesHint = blocks.length
console.log(`已生成 ${path.basename(outPath)}：${remoteBytesHint} 块 × ${blockSizeMB}MB，总 ${size} 字节，v${table.version}`)
