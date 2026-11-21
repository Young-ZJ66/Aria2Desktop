import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
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

interface FakeResponse {
  status: number
  ok?: boolean
  headers: { get: (name: string) => string | null }
  body: null
}

/** 构造最小 fetch 响应：探测器只读 status / headers / body */
function fakeResponse(status: number, headers: Record<string, string> = {}): FakeResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    body: null
  }
}

describe('probeDownloadFileName 网络行为', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('从 Content-Disposition 取到真实文件名，并按 Range 只请求首字节', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init: { method: string; headers: Record<string, string>; redirect: string }) =>
        fakeResponse(206, { 'content-disposition': 'attachment; filename="真实文件.rar"' })
    )
    vi.stubGlobal('fetch', fetchMock)

    const name = await probeDownloadFileName('https://pan.example.com/file/abc123')

    expect(name).toBe('真实文件.rar')
    const init = fetchMock.mock.calls[0]?.[1] as { method: string; headers: Record<string, string>; redirect: string }
    expect(init.method).toBe('GET')
    expect(init.headers.Range).toBe('bytes=0-0')
    // 必须自己跟跳：redirect: 'follow' 只挡首跳，后续跳转可能指向内网
    expect(init.redirect).toBe('manual')
  })

  it('跟随 302 到同主机的新路径，用相对地址解析出绝对地址', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse(302, { location: '/real/abc123.zip' }))
      .mockResolvedValueOnce(fakeResponse(200, { 'content-disposition': 'attachment; filename="pkg.zip"' }))
    vi.stubGlobal('fetch', fetchMock)

    const name = await probeDownloadFileName('https://pan.example.com/file/abc123')

    expect(name).toBe('pkg.zip')
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://pan.example.com/real/abc123.zip')
  })

  it('跳转到回环地址时立即放弃（防止被 302 到本机服务）', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse(302, { location: 'http://127.0.0.1:8080/admin' }))
    vi.stubGlobal('fetch', fetchMock)

    const name = await probeDownloadFileName('https://pan.example.com/file/abc123')

    expect(name).toBe('')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('跳转到云元数据地址时立即放弃', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse(302, { location: 'http://169.254.169.254/latest/meta-data/' }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await probeDownloadFileName('https://pan.example.com/file/abc123')).toBe('')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('重定向次数超过上限时放弃，不再继续请求', async () => {
    const fetchMock = vi.fn(async () => fakeResponse(302, { location: '/loop' }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await probeDownloadFileName('https://pan.example.com/file/abc123')).toBe('')
    // MAX_PROBE_REDIRECTS = 5：首跳 + 5 次跟随，第 6 次重定向后返回空串
    expect(fetchMock).toHaveBeenCalledTimes(6)
  })

  it('3xx 但缺少 Location 时返回空串', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse(302)))

    expect(await probeDownloadFileName('https://pan.example.com/file/abc123')).toBe('')
  })

  it('非 2xx 响应返回空串（不把错误页当文件名来源）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse(404)))

    expect(await probeDownloadFileName('https://pan.example.com/file/abc123')).toBe('')
  })

  it('没有 Content-Disposition 时返回空串', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse(200)))

    expect(await probeDownloadFileName('https://pan.example.com/file/abc123')).toBe('')
  })

  it('fetch 抛错时返回空串，不阻塞任务创建', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ECONNRESET')
    }))

    expect(await probeDownloadFileName('https://pan.example.com/file/abc123')).toBe('')
  })

  it('超时后中止请求并返回空串', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('aborted')))
        })
    )
    vi.stubGlobal('fetch', fetchMock)

    const pending = probeDownloadFileName('https://pan.example.com/file/abc123', 50)
    await vi.advanceTimersByTimeAsync(60)

    await expect(pending).resolves.toBe('')
    vi.useRealTimers()
  })
})

describe('probeDownloadFileName 的地址解析兜底', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('Location 头无法解析成 URL 时放弃探测（不抛错、不再跟跳）', async () => {
    const fetchMock = vi.fn(async () => fakeResponse(302, { location: 'http://[' }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await probeDownloadFileName('https://pan.example.com/file/abc123')).toBe('')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('resolveConflictingFileName 的序号耗尽', () => {
  it('(1) 到 (999) 全被占用时退回原名且不标记冲突（避免无限循环）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aria2-conflict-full-'))
    try {
      fs.writeFileSync(path.join(dir, 'a.rar'), 'x')
      for (let i = 1; i < 1000; i += 1) fs.writeFileSync(path.join(dir, `a (${i}).rar`), 'x')

      expect(resolveConflictingFileName(dir, 'a.rar')).toEqual({ fileName: 'a.rar', conflict: false })
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }, 30_000)
})
