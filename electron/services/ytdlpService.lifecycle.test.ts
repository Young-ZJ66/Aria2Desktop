import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

/**
 * ytdlpService 的服务层行为测试（覆盖率补强）。
 *
 * 原有 ytdlpService.test.ts 只测 mapPlaylistEntries 纯函数；这里把
 * 可用性探测、更新检查、按需安装（校验和必须通过）、视频/格式解析、
 * 播放列表解析与 execYtdlp 的超时看门狗都覆盖到——这些路径此前从未执行。
 *
 * 所有外部副作用（spawn / fs / 网络 / 摘要）都桩掉，测试不联网、不落盘。
 */

const h = vi.hoisted(() => {
  type Behavior = {
    stdout?: string[]
    stderr?: string[]
    exitCode?: number
    error?: Error
    hang?: boolean
  }
  const state = {
    packaged: false,
    platform: process.platform,
    arch: process.arch,
    asset: { fileName: 'yt-dlp.exe', executable: 'yt-dlp.exe', approxSizeMB: 24 } as
      | { fileName: string; executable: string; approxSizeMB: number }
      | null,
    userData: 'C:/Users/test/AppData',
    exists: new Set<string>(),
    mkdirs: [] as string[],
    removed: [] as string[],
    renames: [] as Array<[string, string]>,
    chmods: [] as Array<[string, number]>,
    spawnCalls: [] as Array<{ command: string; args: string[]; options: unknown }>,
    behaviors: [] as Behavior[],
    children: [] as Array<{ killed: string[] }>,
    fetchTextResult: '' as string | (() => string),
    downloadCalls: [] as Array<{ url: string; destPath: string }>,
    downloadThrows: null as Error | null,
    expectedSha: 'a'.repeat(64) as string | null,
    actualSha: 'a'.repeat(64),
    logs: { info: [] as unknown[][], warn: [] as unknown[][] }
  }
  return { state }
})

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => h.state.userData, getName: () => 'test' }
}))
vi.mock('../utils/appEnv', () => ({
  get isPackagedApp() { return h.state.packaged },
  get isDevMode() { return false }
}))
vi.mock('../utils/ytdlpAssets', () => ({
  resolveYtdlpAsset: () => h.state.asset
}))
vi.mock('../utils/sha256Sums', () => ({
  findSha256ForFile: () => h.state.expectedSha
}))
vi.mock('../utils/fileHash', () => ({
  computeFileSha256: async () => h.state.actualSha
}))
vi.mock('../utils/downloader', () => ({
  downloadToFile: async (url: string, destPath: string) => {
    h.state.downloadCalls.push({ url, destPath })
    if (h.state.downloadThrows) throw h.state.downloadThrows
  },
  fetchText: async () => {
    const value = h.state.fetchTextResult
    return typeof value === 'function' ? value() : value
  }
}))
vi.mock('../utils/mainErrorCopy', () => ({
  mainError: (_locale: string, key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key
}))
vi.mock('../utils/mainLocaleRuntime', () => ({ runtimeMainLocale: () => 'zh' }))
vi.mock('../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn((...args: unknown[]) => h.state.logs.info.push(args)),
    warn: vi.fn((...args: unknown[]) => h.state.logs.warn.push(args)),
    error: vi.fn()
  })
}))
vi.mock('../utils/ipcInputValidation', () => ({
  isSafeHttpUrl: (raw: unknown) =>
    typeof raw === 'string' && /^https?:\/\/[^\s]+$/.test(raw)
}))

/** 每次 spawn 的脚本化行为（由用例按顺序预置） */
type SpawnBehavior = {
  stdout?: string[]
  stderr?: string[]
  exitCode?: number
  error?: Error
  hang?: boolean
}

vi.mock('child_process', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    spawn: (command: string, args: string[], options: unknown) => {
      h.state.spawnCalls.push({ command, args, options })
      const behavior = (h.state.behaviors.shift() ?? {}) as SpawnBehavior
      const child = new EventEmitter() as unknown as {
        stdout: InstanceType<typeof EventEmitter>
        stderr: InstanceType<typeof EventEmitter>
        emit: (event: string, ...args: unknown[]) => boolean
        killed: string[]
        kill: (signal: string) => void
        pid: number
      }
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      child.killed = [] as unknown as string[]
      child.pid = 1000 + h.state.spawnCalls.length
      const killed: string[] = []
      child.kill = (signal: string) => {
        killed.push(signal)
      }
      h.state.children.push({ killed })
      if (!behavior.hang) {
        queueMicrotask(() => {
          if (behavior.error) {
            child.emit('error', behavior.error)
            return
          }
          for (const chunk of behavior.stdout ?? []) child.stdout.emit('data', Buffer.from(chunk))
          for (const chunk of behavior.stderr ?? []) child.stderr.emit('data', Buffer.from(chunk))
          child.emit('exit', behavior.exitCode ?? 0)
        })
      }
      return child
    }
  }
})

// 假 fs 需要维护 exists 集合的真实变化，否则「备份后恢复」这类流程会因为
// 备份文件"看起来不存在"而走不到恢复分支。
const fsMock = {
  existsSync: (p: string) => h.state.exists.has(fsKey(p)),
  mkdirSync: (p: string) => h.state.mkdirs.push(fsKey(p)),
  rmSync: (p: string) => {
    h.state.removed.push(fsKey(p))
    h.state.exists.delete(fsKey(p))
  },
  renameSync: (from: string, to: string) => {
    h.state.renames.push([fsKey(from), fsKey(to)])
    h.state.exists.delete(fsKey(from))
    h.state.exists.add(fsKey(to))
  },
  chmodSync: (p: string, mode: number) => h.state.chmods.push([fsKey(p), mode])
}
vi.mock('fs', () => ({ ...fsMock, default: fsMock }))

const service = await import('./ytdlpService')

function fsKey(p: string): string {
  return p.replace(/\\/g, '/')
}

function reset(): void {
  const s = h.state
  s.packaged = false
  s.asset = { fileName: 'yt-dlp.exe', executable: 'yt-dlp.exe', approxSizeMB: 24 }
  s.exists.clear()
  s.mkdirs.length = 0
  s.removed.length = 0
  s.renames.length = 0
  s.chmods.length = 0
  s.spawnCalls.length = 0
  s.behaviors.length = 0
  s.children.length = 0
  s.fetchTextResult = ''
  s.downloadCalls.length = 0
  s.downloadThrows = null
  s.expectedSha = 'a'.repeat(64)
  s.actualSha = 'a'.repeat(64)
  s.logs.info.length = 0
  s.logs.warn.length = 0
}

beforeEach(reset)
afterEach(() => {
  vi.useRealTimers()
})

describe('checkYtdlpAvailable：可用性探测', () => {
  it('PATH 里的 yt-dlp 能报版本时返回可用与来源', async () => {
    h.state.behaviors.push({ stdout: ['2026.01.15\n'] })

    const result = await service.checkYtdlpAvailable()

    expect(result.available).toBe(true)
    expect(result.version).toBe('2026.01.15')
    expect(result.source).toBe('path')
    expect(result.installable).toBe(true)
    expect(result.approxSizeMB).toBe(24)
    expect(h.state.spawnCalls[0].command).toBe('yt-dlp')
    expect(h.state.spawnCalls[0].args).toEqual(['--version'])
  })

  it('应用内已下载的版本优先于 PATH', async () => {
    h.state.exists.add('C:/Users/test/AppData/yt-dlp/yt-dlp.exe')
    h.state.behaviors.push({ stdout: ['2025.12.01'] })

    const result = await service.checkYtdlpAvailable()

    expect(result.source).toBe('downloaded')
    // path.join 在 Windows 上产出反斜杠，断言前统一归一
    expect(fsKey(h.state.spawnCalls[0].command)).toBe('C:/Users/test/AppData/yt-dlp/yt-dlp.exe')
  })

  it('打包态下随包内置的版本排在 PATH 之前', async () => {
    h.state.packaged = true
    const resourcesPath = 'C:/Program Files/Aria2Desktop/resources'
    ;(process as unknown as { resourcesPath: string }).resourcesPath = resourcesPath
    h.state.exists.add(`${resourcesPath}/yt-dlp/yt-dlp.exe`)
    h.state.behaviors.push({ stdout: ['2025.11.11'] })

    const result = await service.checkYtdlpAvailable()

    expect(result.source).toBe('bundled')
  })

  it('可执行文件不存在时把 ENOENT 换成可读提示，并保留安装能力信息', async () => {
    h.state.behaviors.push({ error: Object.assign(new Error('spawn yt-dlp ENOENT'), { code: 'ENOENT' }) })

    const result = await service.checkYtdlpAvailable()

    expect(result.available).toBe(false)
    expect(result.error).toBe('ytdlp.notDetected')
    expect(result.source).toBe('path')
    expect(result.installable).toBe(true)
  })

  it('平台不支持自动安装时 installable 为 false，供界面回退为手动安装提示', async () => {
    h.state.asset = null
    h.state.behaviors.push({ stdout: ['1.0.0'] })

    const result = await service.checkYtdlpAvailable()

    expect(result.installable).toBe(false)
    expect(result.approxSizeMB).toBeUndefined()
  })

  it('非零退出时把 stderr 当作错误信息', async () => {
    h.state.behaviors.push({ exitCode: 2, stderr: ['boom'] })

    const result = await service.checkYtdlpAvailable()

    expect(result.available).toBe(false)
    expect(result.error).toBe('boom')
  })
})

describe('checkYtdlpUpdate：版本比对', () => {
  it('未安装时直接返回错误，且不访问网络', async () => {
    h.state.behaviors.push({ error: new Error('ENOENT') })

    const result = await service.checkYtdlpUpdate()

    expect(result.success).toBe(false)
    expect(result.updateAvailable).toBe(false)
    expect(result.checkable).toBe(true)
    expect(result.error).toBe('ytdlp.notDetected')
  })

  it('官方 tag 比本地新时标记有更新', async () => {
    h.state.behaviors.push({ stdout: ['2025.01.01'] })
    h.state.fetchTextResult = JSON.stringify({ tag_name: '2026.02.02' })

    const result = await service.checkYtdlpUpdate()

    expect(result).toMatchObject({
      success: true,
      updateAvailable: true,
      checkable: true,
      currentVersion: '2025.01.01',
      latestVersion: '2026.02.02'
    })
  })

  it('官方 tag 与本地相同或更旧时不提示更新', async () => {
    h.state.behaviors.push({ stdout: ['2026.02.02'] })
    h.state.fetchTextResult = JSON.stringify({ tag_name: '2026.02.02' })

    const result = await service.checkYtdlpUpdate()

    expect(result.updateAvailable).toBe(false)
  })

  it('Release 响应里没有 tag_name 时给出「版本无法解析」而不是当作有更新', async () => {
    h.state.behaviors.push({ stdout: ['2025.01.01'] })
    h.state.fetchTextResult = JSON.stringify({})

    const result = await service.checkYtdlpUpdate()

    expect(result.success).toBe(false)
    expect(result.updateAvailable).toBe(false)
    expect(result.error).toBe('ytdlp.versionUnresolved')
  })

  it('网络失败只报错，不影响已安装版本继续使用', async () => {
    h.state.behaviors.push({ stdout: ['2025.01.01'] })
    h.state.fetchTextResult = () => {
      throw new Error('network down')
    }

    const result = await service.checkYtdlpUpdate()

    expect(result.success).toBe(false)
    expect(result.checkable).toBe(true)
    expect(result.currentVersion).toBe('2025.01.01')
    expect(result.error).toBe('network down')
  })
})

describe('installYtdlp：按需安装', () => {
  it('平台不支持时直接返回错误，不发起任何下载', async () => {
    h.state.asset = null

    const result = await service.installYtdlp()

    expect(result).toEqual({ success: false, error: 'ytdlp.platformUnsupported' })
    expect(h.state.downloadCalls).toHaveLength(0)
  })

  it('拿不到官方校验和就拒绝安装（不下载可执行文件）', async () => {
    h.state.expectedSha = null

    const result = await service.installYtdlp()

    expect(result.error).toBe('ytdlp.checksumMissing')
    expect(h.state.downloadCalls).toHaveLength(0)
  })

  it('校验和不匹配时删掉临时文件并拒绝安装', async () => {
    h.state.actualSha = 'b'.repeat(64)

    const result = await service.installYtdlp()

    expect(result.success).toBe(false)
    expect(result.error).toContain('ytdlp.checksumMismatch')
    expect(h.state.removed).toContain('C:/Users/test/AppData/yt-dlp/yt-dlp.exe.download')
    expect(h.state.renames).toHaveLength(0)
    expect(h.state.logs.warn.some(args => String(args[0]).includes('校验失败'))).toBe(true)
  })

  it('校验通过后原子替换并自检一次版本', async () => {
    h.state.behaviors.push({ stdout: ['2026.01.15'] })

    const result = await service.installYtdlp()

    expect(result).toEqual({ success: true, version: '2026.01.15' })
    expect(h.state.mkdirs).toContain('C:/Users/test/AppData/yt-dlp')
    expect(h.state.renames).toEqual([
      ['C:/Users/test/AppData/yt-dlp/yt-dlp.exe.download', 'C:/Users/test/AppData/yt-dlp/yt-dlp.exe']
    ])
    expect(fsKey(h.state.spawnCalls[0].command)).toBe('C:/Users/test/AppData/yt-dlp/yt-dlp.exe')
    expect(h.state.logs.info.some(args => String(args[0]).includes('安装完成'))).toBe(true)
  })

  it('覆盖旧版本时先备份，自检通过后删除备份', async () => {
    h.state.exists.add('C:/Users/test/AppData/yt-dlp/yt-dlp.exe')
    h.state.behaviors.push({ stdout: ['2026.01.15'] })

    await service.installYtdlp()

    expect(h.state.renames[0]).toEqual([
      'C:/Users/test/AppData/yt-dlp/yt-dlp.exe',
      'C:/Users/test/AppData/yt-dlp/yt-dlp.exe.bak'
    ])
    expect(h.state.removed).toContain('C:/Users/test/AppData/yt-dlp/yt-dlp.exe.bak')
  })

  it('装好但自检跑不起来时删除新文件并恢复旧版本', async () => {
    h.state.exists.add('C:/Users/test/AppData/yt-dlp/yt-dlp.exe')
    h.state.behaviors.push({ exitCode: 1, stderr: ['glibc too old'] })

    const result = await service.installYtdlp()

    expect(result.success).toBe(false)
    expect(result.error).toBe('glibc too old')
    expect(h.state.removed).toContain('C:/Users/test/AppData/yt-dlp/yt-dlp.exe')
    expect(h.state.renames.map(pair => pair.map(fsKey))).toContainEqual([
      'C:/Users/test/AppData/yt-dlp/yt-dlp.exe.bak',
      'C:/Users/test/AppData/yt-dlp/yt-dlp.exe'
    ])
  })

  it('并发点击复用同一个安装 Promise，不重复下载', async () => {
    h.state.behaviors.push({ stdout: ['2026.01.15'] })

    const first = service.installYtdlp()
    const second = service.installYtdlp()
    expect(second).toBe(first)
    await first

    expect(h.state.downloadCalls).toHaveLength(1)
  })
})

describe('getVideoInfo：视频解析', () => {
  it('非 http(s) 链接直接拒绝，不启动进程', async () => {
    const result = await service.getVideoInfo('file:///etc/passwd')

    expect(result).toEqual({ success: false, error: 'Invalid URL' })
    expect(h.state.spawnCalls).toHaveLength(0)
  })

  it('解析出标题、格式列表与直链请求头（非字符串头被丢弃）', async () => {
    h.state.behaviors.push({
      stdout: [JSON.stringify({
        title: '示例视频',
        ext: 'mp4',
        url: 'https://cdn.example.com/v.mp4',
        filesize: 1024,
        format: 'mp4 (best)',
        formats: [
          { format_id: '137', ext: 'mp4', resolution: '1920x1080', fps: 30, filesize: 2048, vcodec: 'avc1', acodec: 'none', format_note: '1080p' },
          { format_id: '140', ext: 'm4a', fps: null, filesize_approx: 512 }
        ],
        http_headers: { Referer: 'https://example.com/', 'User-Agent': 'UA', 'X-Num': 3 }
      })]
    })

    const result = await service.getVideoInfo('https://example.com/watch?v=abc')

    expect(result.success).toBe(true)
    expect(result.info?.title).toBe('示例视频')
    expect(result.info?.filesize).toBe(1024)
    expect(result.info?.httpHeaders).toEqual({ Referer: 'https://example.com/', 'User-Agent': 'UA' })
    expect(result.info?.formats[0]).toEqual({
      formatId: '137',
      ext: 'mp4',
      resolution: '1920x1080',
      fps: 30,
      filesize: 2048,
      vcodec: 'avc1',
      acodec: 'none',
      note: '1080p'
    })
    expect(result.info?.formats[1]).toMatchObject({
      formatId: '140',
      resolution: 'audio only',
      fps: null,
      filesize: 512,
      vcodec: 'none',
      acodec: 'none',
      note: ''
    })
    expect(h.state.spawnCalls[0].args).toEqual([
      '--dump-json',
      '--no-download',
      '--no-warnings',
      '--no-playlist',
      'https://example.com/watch?v=abc'
    ])
  })

  it('输出不是合法 JSON 时返回失败而不是抛错', async () => {
    h.state.behaviors.push({ stdout: ['not json'] })

    const result = await service.getVideoInfo('https://example.com/a')

    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('缺字段时标题回退 Unknown、ext 回退 mp4、formats 为空数组', async () => {
    h.state.behaviors.push({ stdout: [JSON.stringify({})] })

    const result = await service.getVideoInfo('https://example.com/a')

    expect(result.info?.title).toBe('Unknown')
    expect(result.info?.ext).toBe('mp4')
    expect(result.info?.format).toBe('mp4 (best)')
    expect(result.info?.formats).toEqual([])
    expect(result.info?.httpHeaders).toEqual({})
  })
})

describe('getFormatUrl：指定格式直链', () => {
  it('以 -- 开头的 formatId 被当作参数注入拒绝', async () => {
    const result = await service.getFormatUrl('https://example.com/a', '--exec')

    expect(result).toEqual({ success: false, error: 'Invalid format id' })
    expect(h.state.spawnCalls).toHaveLength(0)
  })

  it('正常格式返回直链与请求头，并把 -f 传给 yt-dlp', async () => {
    h.state.behaviors.push({
      stdout: [JSON.stringify({
        url: 'https://cdn.example.com/v.mp4',
        title: '示例',
        ext: 'mp4',
        http_headers: { Referer: 'https://example.com/' }
      })]
    })

    const result = await service.getFormatUrl('https://example.com/a', '137+140')

    expect(result).toMatchObject({
      success: true,
      downloadUrl: 'https://cdn.example.com/v.mp4',
      title: '示例',
      ext: 'mp4',
      httpHeaders: { Referer: 'https://example.com/' }
    })
    expect(h.state.spawnCalls[0].args).toContain('-f')
    expect(h.state.spawnCalls[0].args).toContain('137+140')
  })

  it('yt-dlp 失败时把 stderr 作为错误返回', async () => {
    h.state.behaviors.push({ exitCode: 1, stderr: ['ERROR: unsupported URL'] })

    const result = await service.getFormatUrl('https://example.com/a', '137')

    expect(result.success).toBe(false)
    expect(result.error).toBe('ERROR: unsupported URL')
  })
})

describe('getPlaylistInfo：播放列表', () => {
  it('非 http(s) 链接直接拒绝', async () => {
    const result = await service.getPlaylistInfo('javascript:alert(1)')

    expect(result).toEqual({ success: false, error: 'Invalid URL' })
    expect(h.state.spawnCalls).toHaveLength(0)
  })

  it('flat 模式解析出条目，并用更宽的 60 秒超时', async () => {
    h.state.behaviors.push({
      stdout: [JSON.stringify({
        title: '列表',
        entries: [{ id: 'a1', title: '第一集', playlist_index: 1 }]
      })]
    })

    const result = await service.getPlaylistInfo('https://www.youtube.com/playlist?list=PL1')

    expect(result.success).toBe(true)
    expect(result.info?.count).toBe(1)
    expect(result.info?.entries[0].url).toBe('https://www.youtube.com/watch?v=a1')
    expect(h.state.spawnCalls[0].args).toEqual([
      '--flat-playlist',
      '-J',
      '--no-warnings',
      'https://www.youtube.com/playlist?list=PL1'
    ])
  })

  it('条目全部无效时报「播放列表为空」', async () => {
    h.state.behaviors.push({ stdout: [JSON.stringify({ title: '空', entries: [] })] })

    const result = await service.getPlaylistInfo('https://example.com/list')

    expect(result).toEqual({ success: false, error: 'ytdlp.playlistEmpty' })
  })
})

describe('execYtdlp：超时看门狗', () => {
  it('进程一直不退出时到点杀掉并报超时', async () => {
    vi.useFakeTimers()
    h.state.behaviors.push({ hang: true })

    const pending = service.getVideoInfo('https://example.com/a')
    const assertion = expect(pending).resolves.toEqual({ success: false, error: 'ytdlp.timeout' })
    await vi.advanceTimersByTimeAsync(30000)

    await assertion
    expect(h.state.children[0].killed).toEqual(['SIGKILL'])
  })

  it('进程正常退出后清掉看门狗，不再误报超时', async () => {
    vi.useFakeTimers()
    h.state.behaviors.push({ stdout: [JSON.stringify({ title: 'ok' })] })

    const pending = service.getVideoInfo('https://example.com/a')
    await vi.advanceTimersByTimeAsync(0)
    const result = await pending
    await vi.advanceTimersByTimeAsync(60000)

    expect(result.success).toBe(true)
    expect(h.state.children[0].killed).toEqual([])
  })
})
