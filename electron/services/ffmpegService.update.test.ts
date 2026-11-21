import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

// 这个文件补 ffmpegService 里两块此前完全没覆盖的决策：
//   1. checkFfmpegUpdate —— 滚动构建没有语义化版本，只能拿构建日期和资产更新时间比；
//   2. performInstall 的成功路径与「新装跑不起来就回滚旧版」。
// 下载/校验/解压全部打桩，spawn 用可控的假子进程，避免 CI 上真的去拉 90 MB。
const h = vi.hoisted(() => ({
  state: {
    userData: '',
    temp: '',
    behavior: { code: 0, stdout: '', stderr: '', hang: false, errorCode: '' },
    spawnCalls: [] as string[][]
  },
  fetchText: vi.fn(),
  downloadToFile: vi.fn(),
  computeFileSha256: vi.fn(),
  extractArchiveTo: vi.fn(),
  asset: { fileName: 'ffmpeg-test.zip', archive: 'zip' as const, approxSizeMB: 80 }
}))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'userData' ? h.state.userData : h.state.temp)
  }
}))
vi.mock('../utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
}))
vi.mock('../utils/mainLocaleRuntime', () => ({ runtimeMainLocale: () => 'zh' }))
vi.mock('../utils/mainErrorCopy', () => ({
  mainError: (_locale: string, key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key
}))
vi.mock('../utils/ffmpegAssets', () => ({
  resolveFfmpegAsset: (platform: string) => (platform === 'darwin' ? null : h.asset)
}))
vi.mock('../utils/downloader', () => ({
  fetchText: h.fetchText,
  downloadToFile: h.downloadToFile
}))
vi.mock('../utils/fileHash', () => ({ computeFileSha256: h.computeFileSha256 }))
vi.mock('./archiveService', () => ({ extractArchiveTo: h.extractArchiveTo }))
vi.mock('child_process', async () => {
  const { EventEmitter } = await import('node:events')
  type Emitter = InstanceType<typeof EventEmitter>
  return {
    spawn: (command: string, args: string[]) => {
      h.state.spawnCalls.push([command, ...args])
      const child = new EventEmitter() as Emitter & {
        stdout: Emitter
        stderr: Emitter
        kill: () => void
      }
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      child.kill = vi.fn()
      const behavior = h.state.behavior
      if (!behavior.hang) {
        setImmediate(() => {
          if (behavior.errorCode) {
            child.emit('error', Object.assign(new Error(behavior.errorCode), { code: behavior.errorCode }))
            return
          }
          if (behavior.stdout) child.stdout.emit('data', Buffer.from(behavior.stdout))
          if (behavior.stderr) child.stderr.emit('data', Buffer.from(behavior.stderr))
          child.emit('exit', behavior.code)
        })
      }
      return child
    }
  }
})

const { checkFfmpegUpdate, installFfmpeg } = await import('./ffmpegService')

const ASSET_NAME = h.asset.fileName

function sha256Line(name: string, hash: string): string {
  return `${hash}  ${name}`
}

/** 让 runFfmpegVersion 返回带构建日期的版本串 */
function versionOutput(buildDate: string): string {
  return `ffmpeg version N-128251-g6d1bfd7609-${buildDate} Copyright (c) 2000-2026 the FFmpeg developers\n`
}

/** 解压桩：在目标目录里造出 `<build>/bin/ffmpeg`，模拟官方归档的层级 */
function stubExtractWithBinary(): void {
  h.extractArchiveTo.mockImplementation(async (_archive: string, dest: string) => {
    const bin = path.join(dest, 'build', 'bin')
    fs.mkdirSync(bin, { recursive: true })
    fs.writeFileSync(path.join(bin, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'), 'binary')
    return { success: true }
  })
}

function installedDir(): string {
  return path.join(h.state.userData, 'ffmpeg')
}

function installedBinary(): string {
  return path.join(installedDir(), process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
}

beforeEach(() => {
  h.state.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aria2-ffu-user-'))
  h.state.temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aria2-ffu-tmp-'))
  h.state.behavior = { code: 0, stdout: versionOutput('20261001'), stderr: '', hang: false, errorCode: '' }
  h.state.spawnCalls = []
  h.fetchText.mockReset()
  h.downloadToFile.mockReset()
  h.computeFileSha256.mockReset()
  h.extractArchiveTo.mockReset()
})

afterEach(() => {
  fs.rmSync(h.state.userData, { recursive: true, force: true })
  fs.rmSync(h.state.temp, { recursive: true, force: true })
})

describe('checkFfmpegUpdate', () => {
  it('本机没有 ffmpeg 时直接报未检测到，且不可检查更新', async () => {
    // ENOENT 会被 runFfmpegVersion 换成面向用户的「未检测到 ffmpeg」文案
    h.state.behavior = { code: 0, stdout: '', stderr: '', hang: false, errorCode: 'ENOENT' }
    const result = await checkFfmpegUpdate()
    expect(result.success).toBe(false)
    expect(result.checkable).toBe(false)
    expect(result.updateAvailable).toBe(false)
    expect(result.error).toContain('ffmpeg.notDetected')
  })

  it('ffmpeg 存在但执行报错时把 stderr 原样带出，不做二次包装', async () => {
    h.state.behavior = { code: 1, stdout: '', stderr: 'segmentation fault', hang: false, errorCode: '' }
    const result = await checkFfmpegUpdate()
    expect(result.success).toBe(false)
    expect(result.checkable).toBe(false)
    expect(result.error).toBe('segmentation fault')
  })

  it('版本串里没有构建日期时无法比较，明确告知而不是猜', async () => {
    h.state.behavior = { code: 0, stdout: 'ffmpeg version 6.0 Copyright\n', stderr: '', hang: false, errorCode: '' }
    const result = await checkFfmpegUpdate()
    expect(result.success).toBe(false)
    expect(result.checkable).toBe(false)
    expect(result.currentVersion).toBe('6.0')
    expect(result.error).toContain('ffmpeg.noBuildDate')
  })

  it('当前平台没有官方构建（macOS）时返回不支持，且不发网络请求', async () => {
    fs.mkdirSync(installedDir(), { recursive: true })
    fs.writeFileSync(installedBinary(), 'binary')
    const original = process.platform
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    try {
      const result = await checkFfmpegUpdate()
      expect(result.success).toBe(false)
      expect(result.checkable).toBe(false)
      expect(result.error).toContain('ffmpeg.updateUnsupported')
      expect(h.fetchText).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(process, 'platform', { value: original, configurable: true })
    }
  })

  it('远端构建日期更新时报告有更新，并把日期格式化成 YYYY-MM-DD', async () => {
    fs.mkdirSync(installedDir(), { recursive: true })
    fs.writeFileSync(installedBinary(), 'binary')
    h.fetchText.mockResolvedValue(JSON.stringify({
      assets: [{ name: ASSET_NAME, updated_at: '2026-10-31T04:12:00Z' }]
    }))
    const result = await checkFfmpegUpdate()
    expect(result.success).toBe(true)
    expect(result.checkable).toBe(true)
    expect(result.updateAvailable).toBe(true)
    expect(result.latestVersion).toBe('2026-10-31')
    expect(result.currentVersion).toBe('N-128251-g6d1bfd7609-20261001')
  })

  it('远端构建日期不新于本地时不提示更新', async () => {
    fs.mkdirSync(installedDir(), { recursive: true })
    fs.writeFileSync(installedBinary(), 'binary')
    h.fetchText.mockResolvedValue(JSON.stringify({
      assets: [{ name: ASSET_NAME, updated_at: '2026-09-30T04:12:00Z' }]
    }))
    const result = await checkFfmpegUpdate()
    expect(result.success).toBe(true)
    expect(result.updateAvailable).toBe(false)
    expect(result.latestVersion).toBe('2026-09-30')
  })

  it('Release 里没有匹配资产或更新时间缺失时报告无法比较（checkable 仍为 true）', async () => {
    fs.mkdirSync(installedDir(), { recursive: true })
    fs.writeFileSync(installedBinary(), 'binary')
    h.fetchText.mockResolvedValue(JSON.stringify({ assets: [{ name: 'other.zip' }] }))
    const result = await checkFfmpegUpdate()
    expect(result.success).toBe(false)
    expect(result.checkable).toBe(true)
    expect(result.error).toContain('ffmpeg.latestUnavailable')
  })

  it('网络失败时把错误带回去，不抛给界面', async () => {
    fs.mkdirSync(installedDir(), { recursive: true })
    fs.writeFileSync(installedBinary(), 'binary')
    h.fetchText.mockRejectedValue(new Error('getaddrinfo ENOTFOUND api.github.com'))
    const result = await checkFfmpegUpdate()
    expect(result.success).toBe(false)
    expect(result.checkable).toBe(true)
    expect(result.error).toContain('ENOTFOUND')
  })
})

describe('installFfmpeg 的成功路径', () => {
  it('校验通过后解压、搬运整个 bin 目录，并真正执行一次自检', async () => {
    h.fetchText.mockResolvedValue(sha256Line(ASSET_NAME, 'e'.repeat(64)))
    h.downloadToFile.mockResolvedValue(undefined)
    h.computeFileSha256.mockResolvedValue('e'.repeat(64))
    stubExtractWithBinary()

    const result = await installFfmpeg()

    expect(result.success).toBe(true)
    expect(result.version).toBe('N-128251-g6d1bfd7609-20261001')
    expect(fs.existsSync(installedBinary())).toBe(true)
    // 备份位必须清掉，否则下次安装会误以为还有旧版可回滚
    expect(fs.existsSync(installedDir() + '.backup')).toBe(false)
    expect(h.state.spawnCalls[0]?.[1]).toBe('-version')
  })

  it('非 Windows 上把 ffmpeg 与同目录的 ffprobe 都补成可执行', async () => {
    if (process.platform === 'win32') return
    h.fetchText.mockResolvedValue(sha256Line(ASSET_NAME, 'f'.repeat(64)))
    h.downloadToFile.mockResolvedValue(undefined)
    h.computeFileSha256.mockResolvedValue('f'.repeat(64))
    h.extractArchiveTo.mockImplementation(async (_archive: string, dest: string) => {
      const bin = path.join(dest, 'build', 'bin')
      fs.mkdirSync(bin, { recursive: true })
      fs.writeFileSync(path.join(bin, 'ffmpeg'), 'binary', { mode: 0o644 })
      fs.writeFileSync(path.join(bin, 'ffprobe'), 'binary', { mode: 0o644 })
      return { success: true }
    })

    const result = await installFfmpeg()

    expect(result.success).toBe(true)
    expect(fs.statSync(path.join(installedDir(), 'ffmpeg')).mode & 0o777).toBe(0o755)
    expect(fs.statSync(path.join(installedDir(), 'ffprobe')).mode & 0o777).toBe(0o755)
  })

  it('覆盖安装时旧版先挪到备份位，新版自检失败就回滚，旧版继续可用', async () => {
    fs.mkdirSync(installedDir(), { recursive: true })
    fs.writeFileSync(installedBinary(), 'old-binary')
    h.fetchText.mockResolvedValue(sha256Line(ASSET_NAME, 'a'.repeat(64)))
    h.downloadToFile.mockResolvedValue(undefined)
    h.computeFileSha256.mockResolvedValue('a'.repeat(64))
    stubExtractWithBinary()
    // 自检失败：新装的可执行文件跑不起来
    h.state.behavior = { code: 1, stdout: '', stderr: 'cannot execute binary file', hang: false, errorCode: '' }

    const result = await installFfmpeg()

    expect(result.success).toBe(false)
    expect(result.error).toContain('cannot execute binary file')
    expect(fs.readFileSync(installedBinary(), 'utf8')).toBe('old-binary')
    expect(fs.existsSync(installedDir() + '.backup')).toBe(false)
  })

  it('自检超时也走回滚，不会留下半成品', async () => {
    h.fetchText.mockResolvedValue(sha256Line(ASSET_NAME, 'b'.repeat(64)))
    h.downloadToFile.mockResolvedValue(undefined)
    h.computeFileSha256.mockResolvedValue('b'.repeat(64))
    stubExtractWithBinary()
    h.state.behavior = { code: 0, stdout: '', stderr: '', hang: true, errorCode: '' }

    vi.useFakeTimers()
    try {
      const pending = installFfmpeg()
      await vi.advanceTimersByTimeAsync(11000)
      const result = await pending
      expect(result.success).toBe(false)
      expect(result.error).toContain('ffmpeg.timeout')
      expect(fs.existsSync(installedDir())).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('下载失败时清理临时目录，不留归档残片', async () => {
    h.fetchText.mockResolvedValue(sha256Line(ASSET_NAME, 'c'.repeat(64)))
    h.downloadToFile.mockRejectedValue(new Error('socket hang up'))

    const result = await installFfmpeg()

    expect(result.success).toBe(false)
    expect(result.error).toContain('socket hang up')
    expect(fs.existsSync(installedDir())).toBe(false)
    // tempRoot 是 `aria2-ffmpeg-<时间戳>`，finally 里必须整个删掉
    expect(fs.readdirSync(h.state.temp)).toEqual([])
  })

  it('可执行文件不在归档里时失败（解压成功不等于装好）', async () => {
    h.fetchText.mockResolvedValue(sha256Line(ASSET_NAME, 'd'.repeat(64)))
    h.downloadToFile.mockResolvedValue(undefined)
    h.computeFileSha256.mockResolvedValue('d'.repeat(64))
    h.extractArchiveTo.mockResolvedValue({ success: true })

    const result = await installFfmpeg()

    expect(result.success).toBe(false)
    expect(result.error).toContain('ffmpeg.binaryMissing')
    expect(fs.existsSync(installedDir())).toBe(false)
  })
})
