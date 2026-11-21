/**
 * embed-appimage-update-info 的单元测试。
 *
 * 用合成的最小 ELF64（含 .upd_info 与 .digest_md5 两个命名节区）验证：
 * 节头表解析、update information 生成、写入与回读、超长拒绝。
 * 不依赖真实 AppImage（数百 MB），真实产物的验证交给 release CI 的回读断言。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  buildUpdateInfo,
  main,
  readElfSections,
  readUpdateInfo,
  writeUpdateInfo,
  zsyncPatternFor
} from './embed-appimage-update-info.mjs'

/**
 * zsyncmake 只在发布机（Linux CI）上存在，本地与 Windows 都没有。
 * 所以 CLI 用例把 execFileSync 换掉，只验证"参数怎么传、失败怎么降级"。
 */
const holder = vi.hoisted(() => ({ zsyncThrows: null, zsyncCalls: [] }))

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    default: actual,
    execFileSync: (command, args) => {
      holder.zsyncCalls.push({ command, args })
      if (holder.zsyncThrows) throw new Error(holder.zsyncThrows)
      return Buffer.alloc(0)
    }
  }
})

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


describe('readElfSections 的镜像头校验', () => {
  function withMutatedElf(mutate, fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'updinfo-'))
    const file = path.join(dir, 'fake.AppImage')
    const image = buildFakeElf({})
    mutate(image)
    fs.writeFileSync(file, image)
    try {
      return fn(file)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }

  it('ELF32 被拒绝（AppImage runtime 一定是 ELF64）', () => {
    withMutatedElf((image) => { image[4] = 1 }, (file) => {
      expect(() => readElfSections(file)).toThrow(/ELF64/)
    })
  })

  it('大端镜像被拒绝', () => {
    withMutatedElf((image) => { image[5] = 2 }, (file) => {
      expect(() => readElfSections(file)).toThrow(/little-endian/)
    })
  })

  it('节头表偏移为 0 时报错而不是死循环', () => {
    withMutatedElf((image) => { image.writeBigUInt64LE(BigInt(0), 0x28) }, (file) => {
      expect(() => readElfSections(file)).toThrow(/节头表缺失/)
    })
  })
})

describe('readUpdateInfo 的缺省返回值', () => {
  it('没有 .upd_info 节区时返回 null', () => {
    withTempElf(
      (file) => {
        expect(readUpdateInfo(file)).toBeNull()
      },
      { includeUpdInfo: false }
    )
  })
})

describe('脚本入口', () => {
  it('直接执行脚本且缺参数时以退出码 1 结束并打印用法', () => {
    const script = path.join(process.cwd(), 'scripts', 'embed-appimage-update-info.mjs')
    const result = spawnSync(process.execPath, [script], { encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('用法')
  })
})

describe('写入后回读的一致性断言', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // 回读断言是这条链路上最后一道防线：写进去的和读出来的不一致，
  // 发布出去的 AppImage 就会带着一个客户端认不出的 update information。
  it('回读结果与写入值不一致时直接抛错，而不是静默放过', () => {
    withTempElf((file) => {
      vi.spyOn(console, 'log').mockImplementation(() => {})
      const section = readElfSections(file).find((s) => s.name === '.upd_info')
      const realReadSync = fs.readSync
      // 只篡改读 .upd_info 那一次：让回读拿到别的字符串，模拟写盘被截断/错位
      const readSpy = vi.spyOn(fs, 'readSync').mockImplementation((fd, buffer, offset, length, position) => {
        const read = realReadSync(fd, buffer, offset, length, position)
        if (position === section.offset) {
          buffer.fill(0, offset, offset + length)
          buffer.write('gh-releases-zsync|other|repo|latest|other.AppImage.zsync', offset, 'utf8')
        }
        return read
      })
      expect(() => main([file, 'Young-ZJ66', 'Aria2Desktop'])).toThrow('写入后回读不一致')
      readSpy.mockRestore()
    })
  })
})

describe('CLI 入口 main', () => {
  afterEach(() => {
    holder.zsyncThrows = null
    holder.zsyncCalls = []
    process.exitCode = undefined
    vi.restoreAllMocks()
  })

  it('缺参数时打印用法并以退出码 1 结束', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error('exit:' + code)
    })
    expect(() => main(['only-one-arg'])).toThrow('exit:1')
    expect(String(error.mock.calls[0][0])).toContain('用法')
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('写入成功时回读一致，并按文件名推导 zsync 通配模式', () => {
    withTempElf((file) => {
      const named = path.join(path.dirname(file), 'Aria2Desktop-1.5.0-arm64.AppImage')
      fs.copyFileSync(file, named)
      const log = vi.spyOn(console, 'log').mockImplementation(() => {})
      main([named, 'Young-ZJ66', 'Aria2Desktop'])
      expect(readUpdateInfo(named)).toBe(
        'gh-releases-zsync|Young-ZJ66|Aria2Desktop|latest|Aria2Desktop-*-arm64.AppImage.zsync'
      )
      const text = log.mock.calls.map((call) => String(call[0])).join('\n')
      expect(text).toContain('已写入 update information')
      expect(text).toContain('.upd_info 节区 offset=')
      expect(text).toContain('已生成')
      // zsyncmake 的参数：-u 指向 AppImage 自身文件名，-o 输出 .zsync
      expect(holder.zsyncCalls).toEqual([
        {
          command: 'zsyncmake',
          args: ['-u', 'Aria2Desktop-1.5.0-arm64.AppImage', '-o', named + '.zsync', named]
        }
      ])
      expect(process.exitCode).toBeUndefined()
    })
  })

  it('--channel 覆盖默认发布通道', () => {
    withTempElf((file) => {
      const named = path.join(path.dirname(file), 'Aria2Desktop-1.5.0-x86_64.AppImage')
      fs.copyFileSync(file, named)
      vi.spyOn(console, 'log').mockImplementation(() => {})
      main([named, 'Young-ZJ66', 'Aria2Desktop', '--channel=beta'])
      expect(readUpdateInfo(named)).toContain('|beta|')
    })
  })

  it('zsyncmake 不可用时只告警并把退出码设为 2，AppImage 已写入的部分保留', () => {
    withTempElf((file) => {
      const named = path.join(path.dirname(file), 'Aria2Desktop-1.5.0-x86_64.AppImage')
      fs.copyFileSync(file, named)
      vi.spyOn(console, 'log').mockImplementation(() => {})
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      holder.zsyncThrows = 'spawnSync zsyncmake ENOENT'
      main([named, 'Young-ZJ66', 'Aria2Desktop'])
      expect(String(error.mock.calls[0][0])).toContain('WARN zsyncmake')
      expect(process.exitCode).toBe(2)
      expect(readUpdateInfo(named)).toContain('gh-releases-zsync|Young-ZJ66|Aria2Desktop|latest|')
    })
  })
})
