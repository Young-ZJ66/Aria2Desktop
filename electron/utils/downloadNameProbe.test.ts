import { afterAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { parseContentDisposition, probeDownloadFileName, resolveConflictingFileName } from './downloadNameProbe'

/**
 * 网盘直链/跳转链接的 URL 里没有文件名，自动分类依赖从 Content-Disposition 探测真实文件名，
 * 解析逻辑必须覆盖服务器们的各种写法（RFC 5987 / 带引号 / 无引号 / 原始 UTF-8 字节）。
 */
describe('parseContentDisposition', () => {
  it('解析带引号的普通 filename', () => {
    expect(parseContentDisposition('attachment; filename="PPT.rar"')).toBe('PPT.rar')
  })

  it('解析无引号的 filename', () => {
    expect(parseContentDisposition('attachment; filename=PPT.rar')).toBe('PPT.rar')
  })

  it('优先解析 RFC 5987 的 filename*（百分号编码的中文）', () => {
    expect(parseContentDisposition("attachment; filename*=UTF-8''%E6%96%87%E4%BB%B6.zip"))
      .toBe('文件.zip')
  })

  it('filename="..." 里是百分号编码时也能解码', () => {
    expect(parseContentDisposition('attachment; filename="%E6%96%87%E4%BB%B6.zip"')).toBe('文件.zip')
  })

  it('修复按 latin1 误读的原始 UTF-8 字节（乱码修复）', () => {
    // 服务器直接把 UTF-8 字节写进头里，Node 按 latin1 解码后得到乱码
    const raw = Buffer.from('文件.zip', 'utf8').toString('latin1')
    expect(parseContentDisposition(`attachment; filename="${raw}"`)).toBe('文件.zip')
  })

  it('去掉文件名里的路径分隔符（防止 out 越目录）', () => {
    expect(parseContentDisposition('attachment; filename="..\\..\\evil.rar"')).toBe('....evil.rar')
    expect(parseContentDisposition('attachment; filename="/etc/passwd"')).toBe('etcpasswd')
  })

  it('无 filename / 空头返回空串', () => {
    expect(parseContentDisposition('attachment')).toBe('')
    expect(parseContentDisposition('')).toBe('')
  })

  it('扩展名大小写不影响后续分类（保留原始大小写返回）', () => {
    // 探测器不负责小写化：分类链路（getFileExtension）统一转小写，这里保持文件名原样
    expect(parseContentDisposition('attachment; filename="Movie.MKV"')).toBe('Movie.MKV')
  })
})

describe('probeDownloadFileName', () => {
  it('非 http(s) 链接直接返回空串（不发起请求）', async () => {
    expect(await probeDownloadFileName('magnet:?xt=urn:btih:abc')).toBe('')
    expect(await probeDownloadFileName('ftp://example.com/a.zip')).toBe('')
    expect(await probeDownloadFileName('not a url')).toBe('')
  })
})

describe('resolveConflictingFileName', () => {
  const madeDirs: string[] = []
  const makeDir = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aria2-conflict-'))
    madeDirs.push(dir)
    return dir
  }
  afterAll(() => {
    for (const dir of madeDirs) fs.rmSync(dir, { recursive: true, force: true })
  })

  it('目标不存在时原样返回（无冲突）', () => {
    const dir = makeDir()
    expect(resolveConflictingFileName(dir, '资料.rar')).toEqual({ fileName: '资料.rar', conflict: false })
  })

  it('同名文件已存在时分配浏览器风格的带序号新名字', () => {
    const dir = makeDir()
    fs.writeFileSync(path.join(dir, '资料.rar'), 'x')
    expect(resolveConflictingFileName(dir, '资料.rar').fileName).toBe('资料 (1).rar')
    fs.writeFileSync(path.join(dir, '资料 (1).rar'), 'x')
    expect(resolveConflictingFileName(dir, '资料.rar').fileName).toBe('资料 (2).rar')
  })

  it('存在 .aria2 控制文件时保持原名（上次中断，交给 aria2 断点续传）', () => {
    const dir = makeDir()
    fs.writeFileSync(path.join(dir, 'a.rar'), 'partial')
    fs.writeFileSync(path.join(dir, 'a.rar.aria2'), 'control')
    expect(resolveConflictingFileName(dir, 'a.rar')).toEqual({ fileName: 'a.rar', conflict: false })
  })

  it('候选名被占用（含控制文件）时继续向后找', () => {
    const dir = makeDir()
    fs.writeFileSync(path.join(dir, 'a.rar'), 'x')
    fs.writeFileSync(path.join(dir, 'a (1).rar'), 'x')
    fs.writeFileSync(path.join(dir, 'a (1).rar.aria2'), 'control')
    expect(resolveConflictingFileName(dir, 'a.rar').fileName).toBe('a (2).rar')
  })

  it('目录或文件名为空时原样返回', () => {
    expect(resolveConflictingFileName('', 'a.rar')).toEqual({ fileName: 'a.rar', conflict: false })
    expect(resolveConflictingFileName('D:\\x', '')).toEqual({ fileName: '', conflict: false })
  })
})
