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

const { buildExtractArgs, extractArchive, extractArchiveTo, isExtractableArchive, pickTarCommand, resolveArchiveArg } =
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
 */

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
    expect(pickTarCommand('win32', 'C:\\Windows', always)).toBe(path.join('C:\\Windows', 'System32', 'tar.exe'))
  })

  it('System32 下没有 tar.exe 时回退到 PATH', () => {
    expect(pickTarCommand('win32', 'C:\\Windows', never)).toBe('tar.exe')
  })

  it('拿不到 SystemRoot 时回退到 PATH', () => {
    expect(pickTarCommand('win32', undefined, always)).toBe('tar.exe')
  })

  it('POSIX 平台直接用 PATH 里的 tar', () => {
    expect(pickTarCommand('darwin', '/Users/x', always)).toBe('tar')
    expect(pickTarCommand('linux', '/home/x', always)).toBe('tar')
  })
})

describe('buildExtractArgs', () => {
  it('只传文件名，不传绝对路径、不带 -C', () => {
    const args = buildExtractArgs('我的 归档.zip')
    expect(args).toEqual(['-x', '-f', '我的 归档.zip'])
    // 回归护栏：出现盘符或绝对路径就会踩到 GNU tar 的远程主机解析
    for (const arg of args) {
      expect(arg).not.toMatch(/^[A-Za-z]:/)
      expect(arg.startsWith('/')).toBe(false)
      expect(arg).not.toBe('-C')
    }
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

describe('extractArchive', () => {
  let workDir: string

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aria2-archive-'))
  })

  afterEach(() => {
    fs.rmSync(workDir, { recursive: true, force: true })
  })

  /** 用系统 tar 建一个 tar 归档（相对名 + cwd，两种 tar 实现都接受） */
  function createArchive(fileName: string, entryName: string, content: string): void {
    fs.writeFileSync(path.join(workDir, entryName), content)
    const result = spawnSync('tar', ['-c', '-f', fileName, entryName], { cwd: workDir })
    if (result.status !== 0) throw new Error(`建归档失败: ${result.stderr?.toString()}`)
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

describe('extractArchiveTo', () => {
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

    const built = spawnSync('tar', ['-c', '-f', 'ffmpeg.zip.tar', 'ffmpeg.txt'], { cwd: downloadDir })
    if (built.status !== 0) throw new Error(`建归档失败: ${built.stderr?.toString()}`)
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
