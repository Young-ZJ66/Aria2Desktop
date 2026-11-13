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
  PLAYLIST_ITEM_ID_PATTERN,
  PLAYLIST_ITEMS_MAX,
  PLAYLIST_ITEMS_VALUE_MAX,
  PROGRESS_MARKER,
  parseProgressLine,
  SUBTITLE_LANG_PATTERN,
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
      '--newline', '--progress', '--progress-delta', '0.2', '--progress-template', expect.any(String),
      '--no-warnings', '--no-playlist', '--no-simulate',
      '--print-to-file', 'after_move:filepath', '/tmp/final.txt',
      '-f', 'bestvideo*+bestaudio/best',
      '-o', path.join(BASE_REQUEST.outputDir, '%(title)s.%(ext)s'),
      '--ffmpeg-location', '/ff',
      BASE_REQUEST.url
    ])
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
      '--newline', '--progress', '--progress-delta', '0.2', '--progress-template', expect.any(String),
      '--no-warnings', '--playlist-items', '2,4', '--no-simulate',
      '--print-to-file', 'after_move:filepath', '/tmp/final.txt',
      '-f', 'bestaudio/best',
      '--write-subs', '--write-auto-subs', '--sub-langs', 'en', '--convert-subs', 'srt',
      '-x', '--audio-format', 'mp3',
      '--cookies', 'C:/tmp/cookies.txt',
      '-o', path.join(BASE_REQUEST.outputDir, '%(title)s.%(ext)s'),
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

  it('播放列表行：带序号/总数/标题', () => {
    const result = parseProgressLine(line([' 10.5%', '100', '1000', 'NA', '500KiB/s', '00:02', '512000', '3', '12', '第三个视频']))
    expect(result?.entryIndex).toBe(3)
    expect(result?.entryCount).toBe(12)
    expect(result?.entryTitle).toBe('第三个视频')
  })

  it('标题含 "|"：重新拼回不丢内容', () => {
    const result = parseProgressLine(line([' 10.5%', '100', '1000', 'NA', '500KiB/s', '00:02', '512000', '1', '2', 'A | B | C']))
    expect(result?.entryTitle).toBe('A | B | C')
  })

  it('列表字段为 NA（单视频在列表页上的退化情况）：不携带', () => {
    const result = parseProgressLine(line([' 10.5%', '100', '1000', 'NA', '500KiB/s', '00:02', '512000', 'NA', 'NA', 'NA']))
    expect(result?.entryIndex).toBeUndefined()
    expect(result?.entryCount).toBeUndefined()
    expect(result?.entryTitle).toBeUndefined()
  })

  it('序号 0 或负数不携带（yt-dlp 语义序号 1 起，0 视为缺省）', () => {
    const zero = parseProgressLine(line([' 10.5%', '100', '1000', 'NA', '500KiB/s', '00:02', '512000', '0', '5', 'T']))
    expect(zero?.entryIndex).toBeUndefined()
    expect(zero?.entryCount).toBe(5)
    const neg = parseProgressLine(line([' 10.5%', '100', '1000', 'NA', '500KiB/s', '00:02', '512000', '-1', '5', 'T']))
    expect(neg?.entryIndex).toBeUndefined()
  })

  it('非模板行（无 marker 前缀长度不足）返回 null', () => {
    expect(parseProgressLine('random yt-dlp output')).toBeNull()
    expect(parseProgressLine(`${PROGRESS_MARKER}only|two|three`)).toBeNull()
  })
})
