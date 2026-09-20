#!/usr/bin/env node
/**
 * 生成扩展的上架 zip（`npm run pack:extension-zip`）
 *
 * 为什么不直接用系统 zip：Windows 无内置 zip 命令、PowerShell 5.1 的 Compress-Archive
 * 会用反斜杠做路径分隔符（部分平台/商店校验不认）、Add-Type 在受限环境被禁。
 * 因此用 Node 内置 zlib 手写最小 ZIP（CRC32 + deflate，正斜杠分隔），产出与商店要求一致：
 * manifest.json 在压缩包根目录、只含运行时必需文件（无 README 等）。
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const extensionDir = path.join(root, 'extension')
const outDir = path.join(root, 'release')

const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'))
const outFile = path.join(outDir, `Aria2Desktop-Extension-v${manifest.version}.zip`)

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
  const data = fs.readFileSync(entry.file)
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
console.log(`已生成 ${outFile}（${entries.length} 个文件，${fs.statSync(outFile).size} 字节，manifest 在根目录）`)
