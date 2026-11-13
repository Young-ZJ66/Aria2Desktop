/**
 * 为 electron-builder 产出的 AppImage 补写更新信息（.upd_info ELF 节区）并生成 .zsync。
 *
 * 为什么需要：本项目用的 app-builder-lib 分支不经过 appimagetool 打包路径，
 * 生成的 AppImage 没有 .upd_info 内容（AppImageUpdate/appimageupdatetool 据此判断可否更新），
 * AppImageHub 收录测试也因此报 "contains no update information" 警告。
 * appimagetool -u 的做法（AppImageKit src/appimagetool.c）是把形如
 *   gh-releases-zsync|<owner>|<repo>|<channel>|<filename-pattern>
 * 的字符串直接写进 runtime ELF 的 .upd_info 节区偏移处；这里在构建产物上做同样的事，
 * 无需重新打包，也不改变 squashfs 内容（.upd_info 属于 runtime ELF，位于 squashfs 之前）。
 *
 * 用法：
 *   node scripts/embed-appimage-update-info.mjs <AppImage 文件> <owner> <repo> [--channel=latest]
 *
 * 步骤：
 *   1. 从 ELF 节头表定位 .upd_info 的文件偏移与长度（纯 JS 解析，不依赖 readelf）。
 *   2. 校验 update information 字符串能放下（runtime 的 .upd_info 节区为 1024 字节）。
 *   3. 原地覆写该区间（写后余量清零），其余字节不动。
 *   4. 调 zsyncmake 生成 <AppImage>.zsync（内容指向 AppImage 自身文件名）。
 *
 * 校验：scripts/embed-appimage-update-info.test.mjs 用合成 ELF 验证偏移定位、写入与读取。
 */

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

/** 解析 ELF64 节头表，返回 [{ name, offset, size }]。仅支持 little-endian ELF64（AppImage runtime 全部如此）。 */
export function readElfSections(filePath) {
  const fd = fs.openSync(filePath, 'r')
  try {
    const header = Buffer.alloc(64)
    fs.readSync(fd, header, 0, 64, 0)
    if (header.readUInt32BE(0) !== 0x7f454c46) throw new Error('不是 ELF 文件（magic 不匹配）')
    if (header[4] !== 2) throw new Error('仅支持 ELF64（AppImage runtime 为 ELF64）')
    if (header[5] !== 1) throw new Error('仅支持 little-endian ELF')
    const e_shoff = Number(header.readBigUInt64LE(0x28))
    const e_shentsize = header.readUInt16LE(0x3a)
    const e_shnum = header.readUInt16LE(0x3c)
    const e_shstrndx = header.readUInt16LE(0x3e)
    if (e_shoff === 0 || e_shentsize < 64) throw new Error('ELF 节头表缺失')
    const shstrHeader = Buffer.alloc(e_shentsize)
    fs.readSync(fd, shstrHeader, 0, e_shentsize, e_shoff + e_shstrndx * e_shentsize)
    const shstrOffset = Number(shstrHeader.readBigUInt64LE(0x18))
    const shstrSize = Number(shstrHeader.readBigUInt64LE(0x20))
    const shstr = Buffer.alloc(shstrSize)
    fs.readSync(fd, shstr, 0, shstrSize, shstrOffset)

    const sections = []
    for (let i = 0; i < e_shnum; i++) {
      const entry = Buffer.alloc(e_shentsize)
      fs.readSync(fd, entry, 0, e_shentsize, e_shoff + i * e_shentsize)
      const nameOffset = entry.readUInt32LE(0)
      const size = Number(entry.readBigUInt64LE(0x20))
      const offset = Number(entry.readBigUInt64LE(0x18))
      const end = shstr.indexOf(0, nameOffset)
      sections.push({ name: shstr.toString('utf8', nameOffset, end === -1 ? shstr.length : end), offset, size })
    }
    return sections
  } finally {
    fs.closeSync(fd)
  }
}

/** 从 AppImage 文件名推导 zsync 通配模式：Aria2Desktop-1.3.5-x86_64.AppImage → Aria2Desktop-*-x86_64.AppImage.zsync */
export function zsyncPatternFor(fileName) {
  const archMatch = fileName.match(/-(x86_64|arm64|aarch64|i386|i686)\.AppImage$/)
  const arch = archMatch ? archMatch[1] : 'x86_64'
  return `Aria2Desktop-*-${arch}.AppImage.zsync`
}

/** 生成 gh-releases-zsync 更新信息字符串。 */
export function buildUpdateInfo({ owner, repo, channel, zsyncPattern }) {
  const parts = [owner, repo, channel, zsyncPattern]
  if (parts.some((p) => p == null || p === '' || p.includes('|'))) {
    throw new Error('update information 各段不能为空或包含「|」')
  }
  return ['gh-releases-zsync', owner, repo, channel, zsyncPattern].join('|')
}

/** 把 updateInfo 写入 AppImage 的 .upd_info 节区（原地覆写，余量清零，其余字节不动）。 */
export function writeUpdateInfo(filePath, updateInfo) {
  const section = readElfSections(filePath).find((s) => s.name === '.upd_info')
  if (!section) throw new Error('AppImage runtime 中未找到 .upd_info 节区（runtime 太旧或不是 AppImage？）')
  const encoded = Buffer.from(updateInfo, 'utf8')
  if (encoded.length > section.size) {
    throw new Error(`update information ${encoded.length} 字节超出 .upd_info 节区 ${section.size} 字节`)
  }
  const fd = fs.openSync(filePath, 'r+')
  try {
    fs.writeSync(fd, encoded, 0, encoded.length, section.offset)
    if (encoded.length < section.size) {
      const zero = Buffer.alloc(section.size - encoded.length)
      fs.writeSync(fd, zero, 0, zero.length, section.offset + encoded.length)
    }
  } finally {
    fs.closeSync(fd)
  }
  return { sectionOffset: section.offset, sectionSize: section.size, bytesWritten: encoded.length }
}

/** 读取 .upd_info 节区现有内容（截到首个 NUL），用于写入后校验；无内容或无节区返回 null。 */
export function readUpdateInfo(filePath) {
  const section = readElfSections(filePath).find((s) => s.name === '.upd_info')
  if (!section) return null
  const fd = fs.openSync(filePath, 'r')
  try {
    const buf = Buffer.alloc(section.size)
    fs.readSync(fd, buf, 0, section.size, section.offset)
    const end = buf.indexOf(0)
    const text = buf.toString('utf8', 0, end === -1 ? buf.length : end)
    return text.length === 0 ? null : text
  } finally {
    fs.closeSync(fd)
  }
}

/** CLI 入口。 */
function main(argv) {
  const [filePath, owner, repo, ...rest] = argv
  if (!filePath || !owner || !repo) {
    console.error('用法：node scripts/embed-appimage-update-info.mjs <AppImage> <owner> <repo> [--channel=latest]')
    process.exit(1)
  }
  const channelArg = rest.find((a) => a.startsWith('--channel='))
  const channel = channelArg ? channelArg.slice('--channel='.length) : 'latest'
  const updateInfo = buildUpdateInfo({ owner, repo, channel, zsyncPattern: zsyncPatternFor(path.basename(filePath)) })
  const result = writeUpdateInfo(filePath, updateInfo)
  console.log(`已写入 update information：${updateInfo}`)
  console.log(`  .upd_info 节区 offset=${result.sectionOffset} size=${result.sectionSize} written=${result.bytesWritten}`)
  const written = readUpdateInfo(filePath)
  if (written !== updateInfo) throw new Error(`写入后回读不一致：${written ?? '(空)'}`)

  try {
    execFileSync('zsyncmake', ['-u', path.basename(filePath), '-o', `${filePath}.zsync`, filePath], { stdio: 'inherit' })
    console.log(`已生成 ${filePath}.zsync`)
  } catch (error) {
    console.error(`WARN zsyncmake 不可用或失败，未生成 .zsync（${error.message}）`)
    process.exitCode = 2
  }
}

if (process.argv[1] && process.argv[1].endsWith('embed-appimage-update-info.mjs')) {
  main(process.argv.slice(2))
}
