import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

// archiveService 经 logger 间接依赖 electron-app / electron-log：桩掉后可在 node 环境直接跑
vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => '' } }))
vi.mock('electron-log/main', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), transports: { file: {}, console: {} } }
}))

const { buildExtractArgs, countSkippedEntries, extractArchive, extractArchiveTo, isExtractableArchive, parseArchiveEntries, pickTarCommand, resolveArchiveArg, resolveTarCommandForTest } =
  await import('./archiveService')

/**
 * 解压服务的回归测试。
 *
 * 重点是两件真实踩过的事：
 * 1. Windows 上 PATH 里的 `tar.exe` 可能是 GNU tar（Git for Windows / MSYS2 / Cygwin），
 *    它把带盘符的绝对路径当远程主机语法，报 `tar: Cannot connect to D: resolve failed`
 *    ——所以必须固定用 `%SystemRoot%\System32\tar.exe`；
 * 2. 归档只传文件名 + `cwd`，不传绝对路径，也不再依赖 `-C`。
 *
 * 最后一个用例是端到端的：真的建一个 tar、真的调 extractArchive，Windows/macOS/Linux
 * 都能跑，用来兜住"参数被改回绝对路径"这类回归。
 *
 * 归档用纯 JS 写 tar 头生成，不依赖外部 `tar` 命令。被测代码本身仍要 spawn 系统 tar
 * 解压；若运行环境完全禁止子进程（部分受限沙箱），端到端用例没有可验证的基础，跳过
 * 而不是报假红——CI/真实桌面上仍会完整执行。
 */

/** 当前环境是否允许 spawn 子进程（探测自身 Node，不用 tar） */
const canSpawnProcess = (() => {
  try {
    const result = spawnSync(process.execPath, ['-e', '0'], { timeout: 5_000 })
    return result.status === 0
  } catch {
    return false
  }
})()

const describeWithSpawn = canSpawnProcess ? describe : describe.skip

/** 生成一个最小的 POSIX ustar 归档（单文件、普通权限） */
function writeTarArchive(archivePath: string, entryName: string, content: string): void {
  const data = Buffer.from(content, 'utf8')
  const header = Buffer.alloc(512)
  header.write(entryName.slice(0, 99), 0, 100, 'utf8')
  header.write('0000644\0', 100, 8, 'ascii')
  header.write('0000000\0', 108, 8, 'ascii')
  header.write('0000000\0', 116, 8, 'ascii')
  header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii')
  header.write(`${Math.floor(Date.now() / 1000).toString(8).padStart(11, '0')}\0`, 136, 12, 'ascii')
  header.write('        ', 148, 8, 'ascii')
  header.write('0', 156, 1, 'ascii')
  header.write('ustar\0', 257, 6, 'ascii')
  header.write('00', 263, 2, 'ascii')
  let checksum = 0
  for (const byte of header) checksum += byte
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii')
  const padding = Buffer.alloc((512 - (data.length % 512)) % 512)
  fs.writeFileSync(archivePath, Buffer.concat([header, data, padding, Buffer.alloc(1024)]))
}

describe('isExtractableArchive', () => {
  it('识别支持的扩展名（含复合后缀、大小写不敏感）', () => {
    for (const name of ['a.zip', 'b.7z', 'c.tar', 'd.tar.gz', 'e.TGZ', 'f.tar.bz2', 'g.txz']) {
      expect(isExtractableArchive(name)).toBe(true)
    }
  })

  it('拒绝非归档与会被误判的后缀', () => {
    for (const name of ['a.rar', 'b.exe', 'c.zip.txt', 'd', 'e.iso']) {
      expect(isExtractableArchive(name)).toBe(false)
    }
  })
})

describe('pickTarCommand', () => {
  const always = () => true
  const never = () => false

  it('Windows 优先用 System32 自带的 bsdtar，绕开 PATH 里的 GNU tar', () => {
    expect(pickTarCommand('win32', ['C:\\Windows\\System32\\tar.exe'], always)).toBe(
      path.win32.join('C:\\Windows', 'System32', 'tar.exe')
    )
  })

  it('回归：resolveTarCommand 候选必须含 WINDOWS 路径段（曾因拼成 C:\\System32\\tar.exe 全部 miss 而静默回退 GNU tar，zip 解压报 not a tar archive）', () => {
    const candidates = resolveTarCommandForTest()
    if (process.platform !== 'win32') {
      // 非 Windows 平台不构造盘符候选，直接使用 PATH 里的 tar
      expect(candidates).toEqual([])
      return
    }
    for (const candidate of candidates) {
      expect(candidate).toMatch(/^[A-Z]:\\Windows\\System32\\tar\.exe$/i)
    }
    // 默认候选至少含 C: 与 D: 两个常见盘
    expect(candidates.length).toBeGreaterThanOrEqual(2)
  })

  it('多个候选按顺序取第一个存在的', () => {
    expect(pickTarCommand('win32', ['D:\\System32\\tar.exe', 'C:\\Windows\\System32\\tar.exe'], always)).toBe(
      'D:\\System32\\tar.exe'
    )
  })

  it('候选全部不存在时回退到 PATH', () => {
    expect(pickTarCommand('win32', ['C:\\Windows\\System32\\tar.exe'], never)).toBe('tar.exe')
  })

  it('候选列表为空时回退到 PATH', () => {
    expect(pickTarCommand('win32', [], always)).toBe('tar.exe')
  })

  it('POSIX 平台直接用 PATH 里的 tar', () => {
    expect(pickTarCommand('darwin', ['/usr/bin/tar'], always)).toBe('tar')
    expect(pickTarCommand('linux', ['/usr/bin/tar'], always)).toBe('tar')
  })
})

describe('buildExtractArgs', () => {
  it('只传文件名，不传绝对路径、不带 -C，并且要求 tar 不覆盖已有文件', () => {
    const args = buildExtractArgs('我的 归档.zip', 'win32')
    expect(args).toEqual(['-x', '-k', '-f', '我的 归档.zip'])
    expect(buildExtractArgs('我的 归档.zip', 'darwin')).toEqual(['-x', '-k', '-f', '我的 归档.zip'])
    // Linux 的 GNU tar 对 -k 冲突会返回退出码 2，必须用 --skip-old-files 跳过且不报错
    expect(buildExtractArgs('我的 归档.zip', 'linux')).toEqual(['-x', '--skip-old-files', '-f', '我的 归档.zip'])
    // 回归护栏：出现盘符或绝对路径就会踩到 GNU tar 的远程主机解析
    for (const arg of [...args, ...buildExtractArgs('我的 归档.zip', 'linux')]) {
      expect(arg).not.toMatch(/^[A-Za-z]:/)
      expect(arg.startsWith('/')).toBe(false)
      expect(arg).not.toBe('-C')
    }
  })
})

describe('parseArchiveEntries', () => {
  it('按行切分并去掉目录尾斜杠与空行', () => {
    const listing = 'dir/\r\ndir/a.txt\n\nfile.txt\r\n'
    expect(parseArchiveEntries(listing)).toEqual(['dir', 'dir/a.txt', 'file.txt'])
  })
})

describe('countSkippedEntries', () => {
  it('只统计已经存在的条目', () => {
    // 用 path.join 构造期望值：Windows 上 join('/t','a.txt') 是 '\\t\\a.txt'
    const root = '/t'
    const existing = new Set([path.join(root, 'a.txt'), path.join(root, 'dir')])
    const skipped = countSkippedEntries(['a.txt', 'b.txt', 'dir'], root, candidate => existing.has(candidate))
    expect(skipped).toBe(2)
  })

  it('目标目录为空时一个也不跳', () => {
    expect(countSkippedEntries(['a.txt', 'dir/b.txt'], '/t', () => false)).toBe(0)
  })
})

describe('resolveArchiveArg', () => {
  it('同目录时退化成文件名', () => {
    expect(resolveArchiveArg('/tmp/a/sample.zip', '/tmp/a')).toBe('sample.zip')
  })

  it('跨目录时给相对路径，仍然不带盘符', () => {
    const arg = resolveArchiveArg('/tmp/a/sample.zip', '/tmp/a/extract')
    expect(arg).toBe(path.join('..', 'sample.zip'))
    expect(arg).not.toMatch(/^[A-Za-z]:/)
    expect(path.isAbsolute(arg)).toBe(false)
  })
})

describeWithSpawn('extractArchive', () => {
  let workDir: string

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aria2-archive-'))
  })

  afterEach(() => {
    fs.rmSync(workDir, { recursive: true, force: true })
  })

  /** 建一个 tar 归档（写入 end-to-end 可用的 ustar 头，不依赖外部 tar 命令） */
  function createArchive(fileName: string, entryName: string, content: string): void {
    fs.writeFileSync(path.join(workDir, entryName), content)
    writeTarArchive(path.join(workDir, fileName), entryName, content)
  }

  it('解压带盘符/绝对路径的归档（Windows 上曾报 Cannot connect to D:）', async () => {
    createArchive('sample.tar', 'hello.txt', 'hello-archive')
    fs.rmSync(path.join(workDir, 'hello.txt'))

    const result = await extractArchive(path.join(workDir, 'sample.tar'))

    expect(result.success).toBe(true)
    expect(result.extracted).toBe(true)
    expect(result.targetDir).toBe(workDir)
    expect(fs.readFileSync(path.join(workDir, 'hello.txt'), 'utf-8')).toBe('hello-archive')
  })

  it('目标目录已有同名文件时不覆盖，并如实回报跳过的数量', async () => {
    createArchive('keep.tar', 'keep.txt', 'new-content')
    fs.writeFileSync(path.join(workDir, 'keep.txt'), 'old-content')

    const result = await extractArchive(path.join(workDir, 'keep.tar'))

    expect(result).toMatchObject({ success: true, extracted: true, targetDir: workDir, skipped: 1 })
    // 核心断言：老文件原样保留（tar -k），用户数据不被静默覆盖
    expect(fs.readFileSync(path.join(workDir, 'keep.txt'), 'utf-8')).toBe('old-content')
  })

  it('目标目录没有冲突时 skipped 为 0', async () => {
    createArchive('fresh.tar', 'fresh.txt', 'fresh-content')
    fs.rmSync(path.join(workDir, 'fresh.txt'))

    const result = await extractArchive(path.join(workDir, 'fresh.tar'))

    expect(result).toMatchObject({ success: true, extracted: true, skipped: 0 })
    expect(fs.readFileSync(path.join(workDir, 'fresh.txt'), 'utf-8')).toBe('fresh-content')
  })

  it('不支持的格式直接跳过，不算失败', async () => {
    const file = path.join(workDir, 'data.rar')
    fs.writeFileSync(file, 'x')
    expect(await extractArchive(file)).toMatchObject({ success: true, extracted: false, reason: 'unsupported_format' })
  })

  it('文件不存在与路径非绝对时如实回报', async () => {
    expect(await extractArchive(path.join(workDir, 'missing.zip'))).toMatchObject({
      success: false,
      reason: 'not_found'
    })
    expect(await extractArchive('relative.zip')).toMatchObject({ success: false, reason: 'invalid_path' })
  })
})

describeWithSpawn('extractArchiveTo', () => {
  let workDir: string

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aria2-archive-to-'))
  })

  afterEach(() => {
    fs.rmSync(workDir, { recursive: true, force: true })
  })

  it('按组件安装的用法解压到另一个目录（归档本身留在原地）', async () => {
    const downloadDir = path.join(workDir, 'download')
    const extractDir = path.join(workDir, 'extract')
    fs.mkdirSync(downloadDir, { recursive: true })
    fs.writeFileSync(path.join(downloadDir, 'ffmpeg.txt'), 'binary-placeholder')

    writeTarArchive(path.join(downloadDir, 'ffmpeg.zip.tar'), 'ffmpeg.txt', 'binary-placeholder')
    fs.rmSync(path.join(downloadDir, 'ffmpeg.txt'))

    const archivePath = path.join(downloadDir, 'ffmpeg.zip.tar')
    const result = await extractArchiveTo(archivePath, extractDir)

    expect(result).toMatchObject({ success: true, extracted: true, targetDir: extractDir })
    expect(fs.readFileSync(path.join(extractDir, 'ffmpeg.txt'), 'utf-8')).toBe('binary-placeholder')
    expect(fs.existsSync(archivePath)).toBe(true)
  })

  it('目标目录不是绝对路径时拒绝执行', async () => {
    const file = path.join(workDir, 'x.zip')
    fs.writeFileSync(file, 'x')
    expect(await extractArchiveTo(file, 'relative-dir')).toMatchObject({ success: false, reason: 'invalid_target' })
  })
})
