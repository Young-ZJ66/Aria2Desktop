import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

// streamDownloadService 顶层 import electron（app/Notification）并注册进程退出钩子；
// ytdlpService/ffmpegService 也各自 import electron。node 测试环境全部桩掉，
// 只测纯函数与校验逻辑（buildStreamArgs/validateStreamExtras/validateCookieFile/parseProgressLine）。
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '' },
  Notification: class {
    static isSupported(): boolean { return false }
  }
}))
vi.mock('electron-log/main', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), transports: { file: {}, console: {} } }
}))
vi.mock('./ytdlpService', () => ({ getYtdlpExecutablePath: vi.fn(() => '/fake/yt-dlp') }))
vi.mock('./ffmpegService', () => ({
  checkFfmpegAvailable: vi.fn(async () => ({ available: true })),
  getFfmpegLocation: vi.fn(() => '/fake/ffmpeg')
}))

const {
  buildStreamArgs,
  COOKIE_FILE_MAX_BYTES,
  FORMAT_EXPR_PATTERN,
  forgetStreamTask,
  getStreamTask,
  listStreamTasks,
  PLAYLIST_ITEM_ID_PATTERN,
  PLAYLIST_ITEMS_MAX,
  PLAYLIST_ITEMS_VALUE_MAX,
  PROGRESS_MARKER,
  parseProgressLine,
  readFinalPaths,
  registerStreamTask,
  SUBTITLE_LANG_PATTERN,
  updateStreamTask,
  validateCookieFile,
  validateStreamExtras
} = await import('./streamDownloadService')

/**
 * 流媒体下载服务的参数构造/请求校验回归测试。
 *
 * 只测纯函数（不 spawn yt-dlp）：核心是三件事——
 * 1. buildStreamArgs 在列表/字幕/Cookie/提取音频各组合下产出正确的 yt-dlp 参数；
 * 2. validateStreamExtras/validateCookieFile 把非法输入挡在 spawn 之前（坏一项拒整单）；
 * 3. FORMAT_EXPR_PATTERN 放行 yt-dlp 选择器语法同时排除危险字符。
 */

const BASE_REQUEST = {
  url: 'https://example.com/watch?v=1',
  outputDir: path.join(os.tmpdir(), 'stream-test'),
  formatId: 'bestvideo*[height<=1080]+bestaudio/best[height<=1080]',
  merge: true
}

describe('FORMAT_EXPR_PATTERN：格式选择器表达式', () => {
  it('放行 yt-dlp 完整选择器语法（预设表达式与单 id）', () => {
    expect(FORMAT_EXPR_PATTERN.test('bestvideo*+bestaudio/best')).toBe(true)
    expect(FORMAT_EXPR_PATTERN.test('bestvideo*[height<=1080]+bestaudio/best[height<=1080]')).toBe(true)
    expect(FORMAT_EXPR_PATTERN.test('bv*[ext=mp4]+ba/b')).toBe(true)
    expect(FORMAT_EXPR_PATTERN.test('137+140')).toBe(true)
    expect(FORMAT_EXPR_PATTERN.test('bestvideo*[height<=720][ext=webm]+bestaudio/best')).toBe(true)
  })

  it('拒绝空串、超长与危险字符（引号/分号/反引号/换行/美元）', () => {
    expect(FORMAT_EXPR_PATTERN.test('')).toBe(false)
    expect(FORMAT_EXPR_PATTERN.test('a'.repeat(257))).toBe(false)
    expect(FORMAT_EXPR_PATTERN.test('best"audio')).toBe(false)
    expect(FORMAT_EXPR_PATTERN.test("best'audio")).toBe(false)
    expect(FORMAT_EXPR_PATTERN.test('best;rm -rf')).toBe(false)
    expect(FORMAT_EXPR_PATTERN.test('best' + String.fromCharCode(96) + 'audio')).toBe(false)
    expect(FORMAT_EXPR_PATTERN.test('best\naudio')).toBe(false)
    expect(FORMAT_EXPR_PATTERN.test('best$audio')).toBe(false)
  })
})

describe('PLAYLIST_ITEM_ID_PATTERN / SUBTITLE_LANG_PATTERN', () => {
  it('条目 id：字母数字下划线连字符，1..64 字符', () => {
    expect(PLAYLIST_ITEM_ID_PATTERN.test('dQw4w9WgXcQ')).toBe(true)
    expect(PLAYLIST_ITEM_ID_PATTERN.test('BV1xx411c7mD-2')).toBe(true)
    expect(PLAYLIST_ITEM_ID_PATTERN.test('')).toBe(false)
    expect(PLAYLIST_ITEM_ID_PATTERN.test('a'.repeat(65))).toBe(false)
    expect(PLAYLIST_ITEM_ID_PATTERN.test('has space')).toBe(false)
    expect(PLAYLIST_ITEM_ID_PATTERN.test('id;rm')).toBe(false)
  })

  it('字幕语言：en、zh-Hans、pt-BR、en.* 通配，拒绝空/超长/怪字符', () => {
    expect(SUBTITLE_LANG_PATTERN.test('en')).toBe(true)
    expect(SUBTITLE_LANG_PATTERN.test('zh-Hans')).toBe(true)
    expect(SUBTITLE_LANG_PATTERN.test('pt-BR')).toBe(true)
    expect(SUBTITLE_LANG_PATTERN.test('en.*')).toBe(true)
    expect(SUBTITLE_LANG_PATTERN.test('')).toBe(false)
    expect(SUBTITLE_LANG_PATTERN.test('a'.repeat(21))).toBe(false)
    expect(SUBTITLE_LANG_PATTERN.test('en;rm')).toBe(false)
    expect(SUBTITLE_LANG_PATTERN.test('en us')).toBe(false)
  })
})

describe('validateStreamExtras：playlist 校验', () => {
  it('合法 ids 通过（1..500 且每项过 pattern）', () => {
    expect(validateStreamExtras({ ...BASE_REQUEST, playlist: { ids: ['1'] } })).toBeNull()
    expect(validateStreamExtras({ ...BASE_REQUEST, playlist: { ids: ['1', '2', '50'] } })).toBeNull()
    expect(
      validateStreamExtras({ ...BASE_REQUEST, playlist: { ids: Array.from({ length: PLAYLIST_ITEMS_MAX }, (_, i) => String(i)) } })
    ).toBeNull()
  })

  it('空数组 / 超过 500 / 非法 id / 拼接过长 → 拒绝整单', () => {
    expect(validateStreamExtras({ ...BASE_REQUEST, playlist: { ids: [] } })).toMatch(/1-500/)
    expect(
      validateStreamExtras({ ...BASE_REQUEST, playlist: { ids: Array.from({ length: PLAYLIST_ITEMS_MAX + 1 }, (_, i) => `v${i}`) } })
    ).toMatch(/1-500/)
    expect(validateStreamExtras({ ...BASE_REQUEST, playlist: { ids: ['ok', 'bad id'] } })).toBe('Invalid playlist item id')
    expect(validateStreamExtras({ ...BASE_REQUEST, playlist: { ids: ['ok', ''] } })).toBe('Invalid playlist item id')
  })

  it('拼接后超过 2000 字符拒绝（防命令行超长）', () => {
    // 65 字符 id 过单项 pattern 上限是 64，用 60 字符 id 构造：34 个 ≈ 2074 字符
    const longIds = Array.from({ length: 34 }, (_, i) => `${'x'.repeat(59)}${i}`)
    expect(longIds.join(',').length).toBeGreaterThan(PLAYLIST_ITEMS_VALUE_MAX)
    expect(validateStreamExtras({ ...BASE_REQUEST, playlist: { ids: longIds } })).toMatch(/超长/)
  })

  it('playlist 非对象 / ids 非数组拒绝', () => {
    expect(validateStreamExtras({ ...BASE_REQUEST, playlist: null as unknown as { ids: string[] } })).toBe('Invalid playlist request')
    expect(validateStreamExtras({ ...BASE_REQUEST, playlist: { ids: 'nope' as unknown as string[] } })).toBe('Invalid playlist request')
  })
})

describe('validateStreamExtras：subtitle 校验', () => {
  it('合法配置通过（含/不含 includeAuto）', () => {
    expect(validateStreamExtras({ ...BASE_REQUEST, subtitle: { enabled: true, languages: ['en'] } })).toBeNull()
    expect(validateStreamExtras({ ...BASE_REQUEST, subtitle: { enabled: true, languages: ['en', 'zh-Hans'], includeAuto: true } })).toBeNull()
    expect(validateStreamExtras({ ...BASE_REQUEST, subtitle: { enabled: false, languages: ['en'] } })).toBeNull()
  })

  it('enabled 非布尔 / languages 非数组 / 空 / 超 10 项 / 非法语言 → 拒绝', () => {
    expect(
      validateStreamExtras({ ...BASE_REQUEST, subtitle: { enabled: 'yes' as unknown as boolean, languages: ['en'] } })
    ).toBe('Invalid subtitle request')
    expect(
      validateStreamExtras({ ...BASE_REQUEST, subtitle: { enabled: true, languages: 'en' as unknown as string[] } })
    ).toBe('Invalid subtitle request')
    expect(validateStreamExtras({ ...BASE_REQUEST, subtitle: { enabled: true, languages: [] } })).toMatch(/1-10/)
    expect(
      validateStreamExtras({ ...BASE_REQUEST, subtitle: { enabled: true, languages: Array.from({ length: 11 }, (_, i) => `l${i}`) } })
    ).toMatch(/1-10/)
    expect(validateStreamExtras({ ...BASE_REQUEST, subtitle: { enabled: true, languages: ['en', 'bad lang!'] } })).toBe('Invalid subtitle language')
  })

  it('includeAuto 非布尔拒绝', () => {
    expect(
      validateStreamExtras({ ...BASE_REQUEST, subtitle: { enabled: true, languages: ['en'], includeAuto: 1 as unknown as boolean } })
    ).toBe('Invalid subtitle request')
  })
})

describe('validateCookieFile', () => {
  let tmpFile: string

  beforeEach(() => {
    tmpFile = path.join(os.tmpdir(), 'cookies-' + Math.random().toString(36).slice(2) + '.txt')
    fs.writeFileSync(tmpFile, '# Netscape HTTP Cookie File\n', 'utf8')
  })
  afterEach(() => {
    try { fs.unlinkSync(tmpFile) } catch { /* 清理失败忽略 */ }
  })

  it('undefined（未选择）通过——向后兼容不传 Cookie 的旧调用方', () => {
    expect(validateCookieFile(undefined)).toBeNull()
  })

  it('存在的绝对路径小文件通过', () => {
    expect(validateCookieFile(tmpFile)).toBeNull()
  })

  it('相对路径拒绝（yt-dlp 的工作目录与 UI 上下文不一致，相对路径会指错文件）', () => {
    expect(validateCookieFile('cookies.txt')).toMatch(/绝对路径/)
    expect(validateCookieFile(path.join('..', 'cookies.txt'))).toMatch(/绝对路径/)
  })

  it('空串与不存在的文件拒绝', () => {
    expect(validateCookieFile('')).toBe('Invalid cookie file')
    expect(validateCookieFile(path.join(os.tmpdir(), 'no-such-cookie-file.txt'))).toMatch(/不存在/)
  })

  it('目录拒绝（stat 是目录不是普通文件）', () => {
    expect(validateCookieFile(os.tmpdir())).toMatch(/不是普通文件/)
  })

  it('超过 5MB 拒绝', () => {
    const bigFile = `${tmpFile}.big`
    const fd = fs.openSync(bigFile, 'w')
    try {
      fs.writeSync(fd, Buffer.alloc(COOKIE_FILE_MAX_BYTES + 1))
    } finally {
      fs.closeSync(fd)
    }
    try {
      expect(validateCookieFile(bigFile)).toMatch(/5MB/)
    } finally {
      try { fs.unlinkSync(bigFile) } catch { /* 清理失败忽略 */ }
    }
  })
})

describe('buildStreamArgs：参数构造', () => {
  it('单视频（无扩展字段）：保持既有参数面（--no-playlist 基本盘不变）', () => {
    const args = buildStreamArgs({ ...BASE_REQUEST }, 'bestvideo*+bestaudio/best', { ffmpegLocation: '/ff', finalPathFile: '/tmp/final.txt' })
    expect(args).toEqual([
      '--newline', '--encoding', 'utf-8', '--progress', '--progress-delta', '0.2', '--progress-template', expect.any(String),
      '--no-warnings', '--no-playlist', '--no-simulate',
      '--print-to-file', 'after_move:filepath', '/tmp/final.txt',
      '-f', 'bestvideo*+bestaudio/best',
      '--paths', 'home:' + BASE_REQUEST.outputDir,
      '-o', '%(title)s.%(ext)s',
      '--ffmpeg-location', '/ff',
      BASE_REQUEST.url
    ])
  })

  it('输出路径：-o 只用相对模板，下载目录走 --paths home:，否则 --paths temp: 会失效', () => {
    const args = buildStreamArgs({ ...BASE_REQUEST }, 'best', { tempDir: 'C:/tmp/aria2desktop-stream-1' })
    expect(args[args.indexOf('--encoding') + 1]).toBe('utf-8')
    expect(args[args.indexOf('-o') + 1]).toBe('%(title)s.%(ext)s')
    const homePos = args.indexOf('home:' + BASE_REQUEST.outputDir)
    expect(homePos).toBeGreaterThan(0)
    expect(args[homePos - 1]).toBe('--paths')
    expect(args[homePos + 1]).toBe('--paths')
    expect(args[homePos + 2]).toBe('temp:C:/tmp/aria2desktop-stream-1')
    // 两个 --paths 都在 -o 之前：yt-dlp 只按出现顺序解析路径
    expect(homePos).toBeLessThan(args.indexOf('-o'))
  })

  it('标题文件：--print-to-file video:%(title)s（进度行的标题是 GBK 乱码，不能用）', () => {
    const args = buildStreamArgs({ ...BASE_REQUEST }, 'best', { titleFile: '/tmp/title.txt' })
    const pos = args.indexOf('/tmp/title.txt')
    expect(pos).toBeGreaterThan(0)
    expect(args[pos - 2]).toBe('--print-to-file')
    expect(args[pos - 1]).toBe('video:%(title)s')
    expect(args.join(' ')).not.toContain('%(info.title)s')
  })

  it('播放列表：--playlist-items 替换 --no-playlist，值为逗号连接的 id', () => {
    const args = buildStreamArgs(
      { ...BASE_REQUEST, playlist: { ids: ['1', '5', '9'] } },
      'bestvideo*[height<=720]+bestaudio/best[height<=720]',
      {}
    )
    const playlistPos = args.indexOf('--playlist-items')
    expect(playlistPos).toBeGreaterThanOrEqual(0)
    expect(args[playlistPos + 1]).toBe('1,5,9')
    expect(args).not.toContain('--no-playlist')
  })

  it('字幕：enabled 时 --write-subs/--sub-langs/--convert-subs srt，includeAuto 加 --write-auto-subs', () => {
    const withAuto = buildStreamArgs(
      { ...BASE_REQUEST, subtitle: { enabled: true, languages: ['en', 'zh-Hans'], includeAuto: true } },
      'bv*+ba/b',
      {}
    )
    expect(withAuto).toContain('--write-subs')
    expect(withAuto).toContain('--write-auto-subs')
    expect(withAuto).toContain('--sub-langs')
    expect(withAuto[withAuto.indexOf('--sub-langs') + 1]).toBe('en,zh-Hans')
    expect(withAuto).toContain('--convert-subs')
    expect(withAuto[withAuto.indexOf('--convert-subs') + 1]).toBe('srt')

    const noAuto = buildStreamArgs(
      { ...BASE_REQUEST, subtitle: { enabled: true, languages: ['en'] } },
      'bv*+ba/b',
      {}
    )
    expect(noAuto).toContain('--write-subs')
    expect(noAuto).not.toContain('--write-auto-subs')

    // enabled=false 不写任何字幕参数
    const disabled = buildStreamArgs(
      { ...BASE_REQUEST, subtitle: { enabled: false, languages: ['en'] } },
      'bv*+ba/b',
      {}
    )
    expect(disabled).not.toContain('--write-subs')
    expect(disabled).not.toContain('--sub-langs')
  })

  it('extractAudio：-x --audio-format mp3', () => {
    const args = buildStreamArgs({ ...BASE_REQUEST, extractAudio: true }, 'bestaudio/best', {})
    expect(args).toContain('-x')
    expect(args[args.indexOf('--audio-format') + 1]).toBe('mp3')
  })

  it('cookieFile：--cookies <path> 放在 -o 之前、url 之前', () => {
    const args = buildStreamArgs({ ...BASE_REQUEST, cookieFile: 'C:/tmp/cookies.txt' }, 'bv*+ba/b', {})
    const cookiePos = args.indexOf('--cookies')
    expect(cookiePos).toBeGreaterThan(0)
    expect(args[cookiePos + 1]).toBe('C:/tmp/cookies.txt')
    expect(args.indexOf('--cookies')).toBeLessThan(args.indexOf('-o'))
    expect(args[args.length - 1]).toBe(BASE_REQUEST.url)
  })

  it('merge=false 时不加 --ffmpeg-location（纯单流下载不需要 ffmpeg）', () => {
    const args = buildStreamArgs({ ...BASE_REQUEST, merge: false }, 'bestaudio/best', { ffmpegLocation: '/ff' })
    expect(args).not.toContain('--ffmpeg-location')
  })

  it('全局限速：limitRateBytes 为正时加 --limit-rate（取整），0 或未给时不出现', () => {
    const limited = buildStreamArgs({ ...BASE_REQUEST }, 'best', { limitRateBytes: 1048576.4 })
    const limitPos = limited.indexOf('--limit-rate')
    expect(limitPos).toBeGreaterThan(0)
    expect(limited[limitPos + 1]).toBe('1048576')
    // 必须放在 url 之前，否则 yt-dlp 会把它当成待下载地址的一部分
    expect(limited[limited.length - 1]).toBe(BASE_REQUEST.url)

    expect(buildStreamArgs({ ...BASE_REQUEST }, 'best', { limitRateBytes: 0 })).not.toContain('--limit-rate')
    expect(buildStreamArgs({ ...BASE_REQUEST }, 'best', {})).not.toContain('--limit-rate')
  })

  it('组合：播放列表 + 字幕 + Cookie + 提取音频 + ffmpeg 全叠加且顺序稳定', () => {
    const args = buildStreamArgs(
      {
        ...BASE_REQUEST,
        playlist: { ids: ['2', '4'] },
        subtitle: { enabled: true, languages: ['en'], includeAuto: true },
        cookieFile: 'C:/tmp/cookies.txt',
        extractAudio: true
      },
      'bestaudio/best',
      { ffmpegLocation: '/ff', finalPathFile: '/tmp/final.txt' }
    )
    expect(args).toEqual([
      '--newline', '--encoding', 'utf-8', '--progress', '--progress-delta', '0.2', '--progress-template', expect.any(String),
      '--no-warnings', '--playlist-items', '2,4', '--no-simulate',
      '--print-to-file', 'after_move:filepath', '/tmp/final.txt',
      '-f', 'bestaudio/best',
      '--write-subs', '--write-auto-subs', '--sub-langs', 'en', '--convert-subs', 'srt',
      '-x', '--audio-format', 'mp3',
      '--cookies', 'C:/tmp/cookies.txt',
      '--paths', 'home:' + BASE_REQUEST.outputDir,
      '-o', '%(title)s.%(ext)s',
      '--ffmpeg-location', '/ff',
      BASE_REQUEST.url
    ])
  })
})

describe('parseProgressLine：播放列表字段', () => {
  /** 按模板字段顺序构造一行进度输出（前缀 marker + 竖线分隔） */
  function line(fields: string[]): string {
    return `${PROGRESS_MARKER}${fields.join('|')}`
  }

  it('单视频行（无列表字段）：不携带 entryTitle/entryIndex/entryCount', () => {
    const result = parseProgressLine(line([' 42.0%', '1000', '2400', '2500', '1.2MiB/s', '00:10', '1200000']))
    expect(result).not.toBeNull()
    expect(result?.entryTitle).toBeUndefined()
    expect(result?.entryIndex).toBeUndefined()
    expect(result?.entryCount).toBeUndefined()
    expect(result?.percent).toBe(42)
    expect(result?.totalBytes).toBe(2400)
    expect(result?.speedBytes).toBe(1200000)
  })

  it('播放列表行：带序号/总数（标题不解析，进度行里是 GBK）', () => {
    const result = parseProgressLine(line([' 10.5%', '100', '1000', 'NA', '500KiB/s', '00:02', '512000', '3', '12']))
    expect(result?.entryIndex).toBe(3)
    expect(result?.entryCount).toBe(12)
    expect(result?.entryTitle).toBeUndefined()
  })

  it('列表字段为 NA（单视频在列表页上的退化情况）：不携带', () => {
    const result = parseProgressLine(line([' 10.5%', '100', '1000', 'NA', '500KiB/s', '00:02', '512000', 'NA', 'NA']))
    expect(result?.entryIndex).toBeUndefined()
    expect(result?.entryCount).toBeUndefined()
    expect(result?.entryTitle).toBeUndefined()
  })

  it('序号 0 或负数不携带（yt-dlp 语义序号 1 起，0 视为缺省）', () => {
    const zero = parseProgressLine(line([' 10.5%', '100', '1000', 'NA', '500KiB/s', '00:02', '512000', '0', '5']))
    expect(zero?.entryIndex).toBeUndefined()
    expect(zero?.entryCount).toBe(5)
    const neg = parseProgressLine(line([' 10.5%', '100', '1000', 'NA', '500KiB/s', '00:02', '512000', '-1', '5']))
    expect(neg?.entryIndex).toBeUndefined()
  })

  it('非模板行（无 marker 前缀长度不足）返回 null', () => {
    expect(parseProgressLine('random yt-dlp output')).toBeNull()
    expect(parseProgressLine(`${PROGRESS_MARKER}only|two|three`)).toBeNull()
  })
})

describe('流媒体任务快照：扩展下载列表的数据源', () => {
  /**
   * 这些快照是扩展「下载列表」唯一能看到 yt-dlp 任务的途径（yt-dlp 不进 aria2 队列），
   * 所以列表可见性、状态流转与移除语义都在这里锁定。
   */
  function record(url: string, title?: string) {
    return {
      proc: null,
      cancelled: false,
      paused: false,
      request: { url, title, outputDir: path.join(os.tmpdir(), 'stream-registry') },
      selector: 'bv*+ba/b',
      ffmpegLocation: '',
      finalPathFile: '',
      tempDir: '',
      titleFile: '',
      onEvent: () => {}
    } as never
  }

  it('登记后可见，且默认是 active/0%（列表能立刻显示"刚发起"的任务）', () => {
    registerStreamTask('sd-test-a', record('https://example.com/a', '标题 A'))
    const task = getStreamTask('sd-test-a')
    expect(task?.status).toBe('active')
    expect(task?.title).toBe('标题 A')
    expect(task?.percent).toBe(0)
    expect(task?.speedBytes).toBe(0)
    expect(task?.outputDir).toBe(path.join(os.tmpdir(), 'stream-registry'))
    expect(listStreamTasks().some(item => item.id === 'sd-test-a')).toBe(true)
    forgetStreamTask('sd-test-a')
  })

  it('无标题时退回 URL（扩展列表不能出现空白行）', () => {
    registerStreamTask('sd-test-b', record('https://example.com/b'))
    expect(getStreamTask('sd-test-b')?.title).toBe('https://example.com/b')
    forgetStreamTask('sd-test-b')
  })

  it('进度更新合并字段，updatedAt 前移', () => {
    registerStreamTask('sd-test-c', record('https://example.com/c', 'C'))
    const before = getStreamTask('sd-test-c')!.updatedAt
    updateStreamTask('sd-test-c', { percent: 42.5, speedBytes: 1024, downloadedBytes: 2048, totalBytes: 4096 })
    const task = getStreamTask('sd-test-c')!
    expect(task.percent).toBe(42.5)
    expect(task.speedBytes).toBe(1024)
    expect(task.downloadedBytes).toBe(2048)
    expect(task.totalBytes).toBe(4096)
    expect(task.status).toBe('active')
    expect(task.updatedAt).toBeGreaterThanOrEqual(before)
    forgetStreamTask('sd-test-c')
  })

  it('更新不存在的任务不创建幽灵条目', () => {
    updateStreamTask('sd-test-missing', { percent: 10 })
    expect(getStreamTask('sd-test-missing')).toBeUndefined()
  })

  it('listStreamTasks 过滤已取消，并按创建时间新→旧排序', () => {
    registerStreamTask('sd-test-d1', record('https://example.com/d1'))
    registerStreamTask('sd-test-d2', record('https://example.com/d2'))
    updateStreamTask('sd-test-d1', { status: 'cancelled' })
    const ids = listStreamTasks().map(item => item.id).filter(id => id.startsWith('sd-test-d'))
    expect(ids).toEqual(['sd-test-d2'])
    forgetStreamTask('sd-test-d1')
    forgetStreamTask('sd-test-d2')
  })

  it('listStreamTasks 返回副本：外部改动不会污染内部状态', () => {
    registerStreamTask('sd-test-e', record('https://example.com/e', 'E'))
    const snapshot = listStreamTasks().find(item => item.id === 'sd-test-e')!
    snapshot.percent = 99
    expect(getStreamTask('sd-test-e')?.percent).toBe(0)
    forgetStreamTask('sd-test-e')
  })

  it('forgetStreamTask 只影响可见性，返回是否真的删掉了一条', () => {
    registerStreamTask('sd-test-f', record('https://example.com/f'))
    expect(forgetStreamTask('sd-test-f')).toBe(true)
    expect(getStreamTask('sd-test-f')).toBeUndefined()
    expect(forgetStreamTask('sd-test-f')).toBe(false)
  })
})

describe('readFinalPaths：completed 事件的全部输出文件（D-38）', () => {
  /**
   * 播放列表/多字幕一次会产出多个文件，主进程用 --print-to-file 把所有最终路径写进
   * 同一个文件。渲染层靠这份列表逐个删除文件，所以这里锁定三件事：
   * 只收磁盘上真实存在的文件、去重保序、文件缺失/读失败时安全返回空数组。
   */
  const tmpDir = path.join(os.tmpdir(), 'stream-final-paths-test')

  function writePrintFile(lines: string[]): string {
    fs.mkdirSync(tmpDir, { recursive: true })
    const file = path.join(tmpDir, 'final-paths-' + Math.random().toString(36).slice(2) + '.txt')
    fs.writeFileSync(file, lines.join('\n'), 'utf8')
    return file
  }

  function touch(name: string): string {
    fs.mkdirSync(tmpDir, { recursive: true })
    const file = path.join(tmpDir, name)
    fs.writeFileSync(file, 'x')
    return file
  }

  it('返回全部存在的文件路径（保持顺序）', () => {
    const first = touch('01.mp4')
    const second = touch('02.mp4')
    const printFile = writePrintFile([first, second])
    expect(readFinalPaths(printFile)).toEqual([first, second])
  })

  it('忽略空行与不存在的路径（yt-dlp 部分条目失败时会打印幽灵路径）', () => {
    const real = touch('03.mp4')
    const ghost = path.join(tmpDir, 'missing-' + Date.now() + '.mp4')
    const printFile = writePrintFile(['', real, '   ', ghost, ''])
    expect(readFinalPaths(printFile)).toEqual([real])
  })

  it('重复路径只保留一次', () => {
    const real = touch('04.mp4')
    expect(readFinalPaths(writePrintFile([real, real]))).toEqual([real])
  })

  it('文件不存在或读失败时返回空数组（调用方按单文件兜底）', () => {
    expect(readFinalPaths(path.join(tmpDir, 'no-such-file.txt'))).toEqual([])
  })
})
