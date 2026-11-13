#!/usr/bin/env node
/**
 * 生成扩展的 Firefox 上架 zip（`npm run pack:extension-firefox`）
 *
 * 与 pack-extension-zip.mjs 同一套手写 ZIP 实现（zlib CRC32 + deflateRaw、正斜杠路径、
 * UTF-8 文件名标志）——原因相同：Windows 无内置 zip 命令、Compress-Archive 用反斜杠
 * 路径分隔符（AMO 校验不认）、Add-Type 在受限环境被禁；且本项目零新增依赖。
 * 与 Chromium 包的唯一差别：压缩包内的 manifest.json 被替换为 buildFirefoxManifest
 * 产出的 Firefox 变体（background.scripts 事件页 + gecko 设置），其余文件原样打入。
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { buildFirefoxManifest } from './extension-firefox-manifest.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const extensionDir = path.join(root, 'extension')
const outDir = path.join(root, 'release')

const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'))
// 变换自带合法性校验：manifest 不合格时在此抛错、不产出任何 zip（宁缺毋滥，别带着装不上的包去提审）
const firefoxManifest = buildFirefoxManifest(manifest)
// 打进压缩包的新 manifest 字节（2 空格缩进 + 末尾换行，与源文件风格一致，方便 AMO 审核 diff）
const firefoxManifestBytes = Buffer.from(JSON.stringify(firefoxManifest, null, 2) + '\n', 'utf8')
const outFile = path.join(outDir, `Aria2Desktop-Extension-Firefox-v${manifest.version}.zip`)

/** 递归收集全部文件（相对路径用正斜杠，zip 规范要求）；跳过 README 等非运行时文件 */
function walk(dir, prefix = '') {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'README.md' || entry.name === 'Icon.ico') continue
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), rel))
    else out.push({ name: rel, file: path.join(dir, entry.name) })
  }
  return out
}

const entries = walk(extensionDir).sort((a, b) => a.name.localeCompare(b.name))

const localParts = []
const centralParts = []
let offset = 0

for (const entry of entries) {
  // manifest.json 用 Firefox 变体字节，其余文件读磁盘
  const data = entry.name === 'manifest.json' ? firefoxManifestBytes : fs.readFileSync(entry.file)
  const name = Buffer.from(entry.name, 'utf8')
  const crc = zlib.crc32(data) >>> 0
  const compressed = zlib.deflateRawSync(data)

  const localHeader = Buffer.alloc(30)
  localHeader.writeUInt32LE(0x04034b50, 0)
  localHeader.writeUInt16LE(20, 4)          // 解压所需版本
  localHeader.writeUInt16LE(0x0800, 6)      // 标志位：UTF-8 文件名
  localHeader.writeUInt16LE(8, 8)           // 压缩方法 deflate
  localHeader.writeUInt16LE(0, 10)          // 时间
  localHeader.writeUInt16LE(0x21, 12)       // 日期 = 1980-01-01
  localHeader.writeUInt32LE(crc, 14)
  localHeader.writeUInt32LE(compressed.length, 18)
  localHeader.writeUInt32LE(data.length, 22)
  localHeader.writeUInt16LE(name.length, 26)
  localHeader.writeUInt16LE(0, 28)
  localParts.push(localHeader, name, compressed)

  const centralHeader = Buffer.alloc(46)
  centralHeader.writeUInt32LE(0x02014b50, 0)
  centralHeader.writeUInt16LE(20, 4)        // 创建版本
  centralHeader.writeUInt16LE(20, 6)
  centralHeader.writeUInt16LE(0x0800, 8)
  centralHeader.writeUInt16LE(8, 10)
  centralHeader.writeUInt16LE(0, 12)
  centralHeader.writeUInt16LE(0x21, 14)
  centralHeader.writeUInt32LE(crc, 16)
  centralHeader.writeUInt32LE(compressed.length, 20)
  centralHeader.writeUInt32LE(data.length, 24)
  centralHeader.writeUInt16LE(name.length, 28)
  centralHeader.writeUInt16LE(0, 30)
  centralHeader.writeUInt16LE(0, 32)
  centralHeader.writeUInt16LE(0, 34)
  centralHeader.writeUInt16LE(0, 36)
  centralHeader.writeUInt32LE(0x20, 38)     // 外部属性：普通文件
  centralHeader.writeUInt32LE(offset, 42)
  centralParts.push(centralHeader, name)

  offset += localHeader.length + name.length + compressed.length
}

const central = Buffer.concat(centralParts)
const eocd = Buffer.alloc(22)
eocd.writeUInt32LE(0x06054b50, 0)
eocd.writeUInt16LE(0, 4)
eocd.writeUInt16LE(0, 6)
eocd.writeUInt16LE(entries.length, 8)
eocd.writeUInt16LE(entries.length, 10)
eocd.writeUInt32LE(central.length, 12)
eocd.writeUInt32LE(offset, 16)
eocd.writeUInt16LE(0, 20)

fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(outFile, Buffer.concat([...localParts, central, eocd]))

console.log(`已生成 ${outFile}（${entries.length} 个文件，${fs.statSync(outFile).size} 字节，Firefox manifest 在根目录）`)
// 文件清单与字节数：提审前肉眼核对打包内容（语言包/图标齐全、manifest 已替换为 Firefox 变体）
for (const entry of entries) {
  const bytes = entry.name === 'manifest.json' ? firefoxManifestBytes.length : fs.statSync(entry.file).size
  console.log(`  ${entry.name.padEnd(36)} ${bytes} 字节`)
}
