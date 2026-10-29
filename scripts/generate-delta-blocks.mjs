/**
 * 为安装包生成差量块表（`<安装包>.blocks.json`）。
 *
 * 用法：node scripts/generate-delta-blocks.mjs <Setup.exe 路径>
 *
 * 分块算法是内容定义分块（CDC），实现见 electron/utils/deltaChunker.ts。
 * 本脚本直接复用编译产物，保证"生成端切点"与单元测试使用的实现完全一致；
 * 因此运行前需要 `npm run build:electron`（CI 工作流在打包前已经执行过）。
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
import { pathToFileURL, fileURLToPath } from 'node:url'

const target = process.argv[2]
if (!target || !fs.existsSync(target)) {
  console.error('用法: node scripts/generate-delta-blocks.mjs <Setup.exe 路径>')
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

const chunkerPath = fileURLToPath(new URL('../dist/electron/electron/utils/deltaChunker.js', import.meta.url))
if (!fs.existsSync(chunkerPath)) {
  console.error('缺少编译后的分块器（dist/electron/electron/utils/deltaChunker.js）。请先执行 npm run build:electron')
  process.exit(1)
}
const chunkerModule = await import(pathToFileURL(chunkerPath).href)
const computeChunkSpans = chunkerModule.computeChunkSpans ?? chunkerModule.default?.computeChunkSpans
const avgBlockSize = chunkerModule.CDC_AVG_SIZE ?? chunkerModule.default?.CDC_AVG_SIZE
if (typeof computeChunkSpans !== 'function' || typeof avgBlockSize !== 'number') {
  console.error('分块器导出不符合预期（computeChunkSpans / CDC_AVG_SIZE），请重新编译主进程')
  process.exit(1)
}

const size = fs.statSync(target).size
const buffer = fs.readFileSync(target)

const spans = computeChunkSpans(buffer)
const blocks = spans.map((span) => ({
  offset: span.offset,
  size: span.size,
  sha256: crypto.createHash('sha256').update(buffer.subarray(span.offset, span.offset + span.size)).digest('hex')
}))

const table = {
  version: versionMatch[1],
  size,
  format: 2,
  chunking: 'cdc',
  avgBlockSize,
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

const avgMB = (size / blocks.length / 1048576).toFixed(2)
console.log(
  `已生成 ${path.basename(outPath)}：${blocks.length} 块（CDC，平均 ${avgMB}MB），总 ${size} 字节，v${table.version}`
)
