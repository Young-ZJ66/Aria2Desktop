/**
 * embed-appimage-update-info 的单元测试。
 *
 * 用合成的最小 ELF64（含 .upd_info 与 .digest_md5 两个命名节区）验证：
 * 节头表解析、update information 生成、写入与回读、超长拒绝。
 * 不依赖真实 AppImage（数百 MB），真实产物的验证交给 release CI 的回读断言。
 */

import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  buildUpdateInfo,
  readElfSections,
  readUpdateInfo,
  writeUpdateInfo,
  zsyncPatternFor
} from './embed-appimage-update-info.mjs'

/** 构造最小 ELF64 镜像：header + 两个数据节 + 节头表 + 字符串表。 */
function buildFakeElf({ includeUpdInfo = true }) {
  const dataSections = includeUpdInfo
    ? [{ name: '.upd_info', size: 1024 }, { name: '.digest_md5', size: 16 }]
    : [{ name: '.digest_md5', size: 16 }]
  const e_shentsize = 64
  // 布局：64 字节 ELF 头 | 各节数据 | 字符串表 | 节头表
  let cursor = 64
  const placed = dataSections.map((s) => {
    const at = cursor
    cursor += s.size
    return { ...s, offset: at }
  })
  // 字符串表：起始 NUL + 每个名字
  const nameOffsets = new Map()
  let shstr = Buffer.from([0])
  for (const s of [...dataSections.map((x) => x.name), '.shstrtab']) {
    nameOffsets.set(s, shstr.length)
    shstr = Buffer.concat([shstr, Buffer.from(s, 'utf8'), Buffer.from([0])])
  }
  const shstrOffset = cursor
  cursor += shstr.length
  const e_shoff = cursor
  const e_shnum = dataSections.length + 1 // 数据节 + 字符串表节头

  const header = Buffer.alloc(64)
  header.writeUInt32BE(0x7f454c46, 0)
  header[4] = 2 // ELF64
  header[5] = 1 // little-endian
  header.writeUInt16LE(e_shentsize, 0x3a)
  header.writeUInt16LE(e_shnum, 0x3c)
  header.writeUInt16LE(e_shnum - 1, 0x3e)
  header.writeBigUInt64LE(BigInt(e_shoff), 0x28)

  const total = e_shoff + e_shnum * e_shentsize
  const image = Buffer.alloc(total)
  header.copy(image, 0)

  let shIndex = 0
  for (const s of placed) {
    const sh = Buffer.alloc(e_shentsize)
    sh.writeUInt32LE(nameOffsets.get(s.name) ?? 0, 0)
    sh.writeBigUInt64LE(BigInt(s.offset), 0x18)
    sh.writeBigUInt64LE(BigInt(s.size), 0x20)
    sh.copy(image, e_shoff + shIndex * e_shentsize)
    shIndex++
  }
  const shstrHeader = Buffer.alloc(e_shentsize)
  shstrHeader.writeUInt32LE(nameOffsets.get('.shstrtab') ?? 0, 0)
  shstrHeader.writeBigUInt64LE(BigInt(shstrOffset), 0x18)
  shstrHeader.writeBigUInt64LE(BigInt(shstr.length), 0x20)
  shstrHeader.copy(image, e_shoff + shIndex * e_shentsize)
  shstr.copy(image, shstrOffset)
  return image
}

function withTempElf(fn, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'updinfo-'))
  const file = path.join(dir, 'fake.AppImage')
  fs.writeFileSync(file, buildFakeElf(options))
  try {
    return fn(file)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

describe('readElfSections', () => {
  it('定位 .upd_info 节区', () => {
    withTempElf((file) => {
      const upd = readElfSections(file).find((s) => s.name === '.upd_info')
      expect(upd).toBeDefined()
      expect(upd.size).toBe(1024)
    })
  })
  it('拒绝非 ELF 文件', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'updinfo-'))
    const file = path.join(dir, 'plain.bin')
    fs.writeFileSync(file, Buffer.alloc(64, 1))
    try {
      expect(() => readElfSections(file)).toThrow(/ELF/)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('buildUpdateInfo', () => {
  it('生成 gh-releases-zsync 串', () => {
    expect(
      buildUpdateInfo({
        owner: 'Young-ZJ66',
        repo: 'Aria2Desktop',
        channel: 'latest',
        zsyncPattern: 'Aria2Desktop-*-x86_64.AppImage.zsync'
      })
    ).toBe('gh-releases-zsync|Young-ZJ66|Aria2Desktop|latest|Aria2Desktop-*-x86_64.AppImage.zsync')
  })
  it('拒绝含管道符或空段', () => {
    expect(() => buildUpdateInfo({ owner: 'a|b', repo: 'r', channel: 'latest', zsyncPattern: 'x' })).toThrow()
    expect(() => buildUpdateInfo({ owner: '', repo: 'r', channel: 'latest', zsyncPattern: 'x' })).toThrow()
  })
})

describe('zsyncPatternFor', () => {
  it('按架构生成通配模式', () => {
    expect(zsyncPatternFor('Aria2Desktop-1.3.5-x86_64.AppImage')).toBe('Aria2Desktop-*-x86_64.AppImage.zsync')
    expect(zsyncPatternFor('Aria2Desktop-1.3.5-arm64.AppImage')).toBe('Aria2Desktop-*-arm64.AppImage.zsync')
  })
  it('未识别出架构时回退 x86_64', () => {
    expect(zsyncPatternFor('weird.AppImage')).toBe('Aria2Desktop-*-x86_64.AppImage.zsync')
  })
})

describe('writeUpdateInfo / readUpdateInfo', () => {
  const info = 'gh-releases-zsync|Young-ZJ66|Aria2Desktop|latest|Aria2Desktop-*-x86_64.AppImage.zsync'

  it('写入后能回读，且不越界改其它字节', () => {
    withTempElf((file) => {
      const before = fs.readFileSync(file)
      const result = writeUpdateInfo(file, info)
      expect(result.bytesWritten).toBe(info.length)
      expect(readUpdateInfo(file)).toBe(info)
      const after = fs.readFileSync(file)
      expect(after.subarray(0, result.sectionOffset).equals(before.subarray(0, result.sectionOffset))).toBe(true)
      const sectionEnd = result.sectionOffset + result.sectionSize
      expect(after.subarray(sectionEnd).equals(before.subarray(sectionEnd))).toBe(true)
    })
  })
  it('重复写入覆盖旧值（无残留）', () => {
    withTempElf((file) => {
      writeUpdateInfo(file, 'zsync|https://example.com/old-very-long-name-0123456789.zsync')
      const next = 'zsync|https://example.com/new.zsync'
      writeUpdateInfo(file, next)
      expect(readUpdateInfo(file)).toBe(next)
    })
  })
  it('超长字符串被拒绝且文件不被修改', () => {
    withTempElf((file) => {
      const before = fs.readFileSync(file)
      expect(() => writeUpdateInfo(file, 'zsync|' + 'x'.repeat(2000))).toThrow(/超出/)
      expect(fs.readFileSync(file).equals(before)).toBe(true)
    })
  })
  it('无 .upd_info 节区时报错', () => {
    withTempElf(
      (file) => {
        expect(() => writeUpdateInfo(file, 'zsync|x')).toThrow(/upd_info/)
      },
      { includeUpdInfo: false }
    )
  })
})
