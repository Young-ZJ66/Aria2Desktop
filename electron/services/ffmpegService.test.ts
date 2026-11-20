import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

// ffmpeg 是「按需安装」的组件：装错了就是让用户跑一个来路不明的可执行文件。
// 这里把下载/校验/解压全打桩，只验证「校验不过绝不落盘」「并发安装只跑一次」这类决策，
// 真解压与真执行交给手动验证（安装路径在 CI 里没有网络也没有 ffmpeg 二进制）。
const mocks = vi.hoisted(() => ({
  fetchText: vi.fn(),
  downloadToFile: vi.fn(),
  computeFileSha256: vi.fn(),
  extractArchiveTo: vi.fn(),
  userData: '',
  temp: ''
}))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'userData' ? mocks.userData : mocks.temp)
  }
}))
vi.mock('../utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
}))
vi.mock('../utils/mainLocaleRuntime', () => ({ runtimeMainLocale: () => 'zh' }))
vi.mock('../utils/ffmpegAssets', () => ({
  resolveFfmpegAsset: (platform: string, arch: string) =>
    platform === 'darwin'
      ? null
      : { fileName: `ffmpeg-${platform}-${arch}.zip`, approxSizeMB: 80, downloadUrl: 'https://example.invalid/x.zip' }
}))
vi.mock('../utils/downloader', () => ({
  fetchText: mocks.fetchText,
  downloadToFile: mocks.downloadToFile
}))
vi.mock('../utils/fileHash', () => ({ computeFileSha256: mocks.computeFileSha256 }))
vi.mock('./archiveService', () => ({ extractArchiveTo: mocks.extractArchiveTo }))

const { checkFfmpegAvailable, getFfmpegLocation, installFfmpeg } = await import('./ffmpegService')

function sha256Line(name: string, hash: string) {
  return `${hash}  ${name}`
}

beforeEach(() => {
  mocks.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aria2-ff-user-'))
  mocks.temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aria2-ff-tmp-'))
  mocks.fetchText.mockReset()
  mocks.downloadToFile.mockReset()
  mocks.computeFileSha256.mockReset()
  mocks.extractArchiveTo.mockReset()
})

afterEach(() => {
  fs.rmSync(mocks.userData, { recursive: true, force: true })
  fs.rmSync(mocks.temp, { recursive: true, force: true })
})

describe('getFfmpegLocation', () => {
  it('应用内未安装时返回空串（让 yt-dlp 用 PATH 里的 ffmpeg）', () => {
    expect(getFfmpegLocation()).toBe('')
  })

  it('应用内已安装时返回所在目录而不是可执行文件路径（共享库构建的 DLL 必须同目录）', () => {
    const dir = path.join(mocks.userData, 'ffmpeg')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'), 'binary')
    expect(getFfmpegLocation()).toBe(dir)
  })
})

describe('checkFfmpegAvailable', () => {
  it('PATH 里没有 ffmpeg 时返回不可用，并带上当前平台是否支持自动安装', async () => {
    const result = await checkFfmpegAvailable()
    expect(result.available).toBe(false)
    expect(result.source).toBe('path')
    expect(result.installable).toBe(process.platform === 'darwin' ? false : true)
    expect(typeof result.error).toBe('string')
  })

  it('不可用时仍给出安装包大小，界面才能提示「约 80 MB」', async () => {
    const result = await checkFfmpegAvailable()
    if (process.platform === 'darwin') expect(result.approxSizeMB).toBeUndefined()
    else expect(result.approxSizeMB).toBe(80)
  })
})

describe('installFfmpeg 的失败路径', () => {
  it('拿不到官方校验和时拒绝安装（绝不安装未校验的可执行文件）', async () => {
    if (process.platform === 'darwin') return
    mocks.fetchText.mockResolvedValue('0000  other-file.zip')
    const result = await installFfmpeg()
    expect(result.success).toBe(false)
    expect(mocks.downloadToFile).not.toHaveBeenCalled()
    expect(fs.existsSync(path.join(mocks.userData, 'ffmpeg'))).toBe(false)
  })

  it('下载内容与官方校验和不一致时拒绝安装且不落盘', async () => {
    if (process.platform === 'darwin') return
    const asset = `ffmpeg-${process.platform}-${process.arch}.zip`
    mocks.fetchText.mockResolvedValue(sha256Line(asset, 'a'.repeat(64)))
    mocks.downloadToFile.mockResolvedValue(undefined)
    mocks.computeFileSha256.mockResolvedValue('b'.repeat(64))
    const result = await installFfmpeg()
    expect(result.success).toBe(false)
    expect(result.error).toContain('a'.repeat(12))
    expect(mocks.extractArchiveTo).not.toHaveBeenCalled()
    expect(fs.existsSync(path.join(mocks.userData, 'ffmpeg'))).toBe(false)
  })

  it('解压失败时不留下半成品目录', async () => {
    if (process.platform === 'darwin') return
    const asset = `ffmpeg-${process.platform}-${process.arch}.zip`
    mocks.fetchText.mockResolvedValue(sha256Line(asset, 'c'.repeat(64)))
    mocks.downloadToFile.mockResolvedValue(undefined)
    mocks.computeFileSha256.mockResolvedValue('c'.repeat(64))
    mocks.extractArchiveTo.mockResolvedValue({ success: false, reason: 'tar_not_available' })
    const result = await installFfmpeg()
    expect(result.success).toBe(false)
    expect(fs.existsSync(path.join(mocks.userData, 'ffmpeg'))).toBe(false)
  })

  it('解压成功但归档里没有 ffmpeg 可执行文件时失败', async () => {
    if (process.platform === 'darwin') return
    const asset = `ffmpeg-${process.platform}-${process.arch}.zip`
    mocks.fetchText.mockResolvedValue(sha256Line(asset, 'd'.repeat(64)))
    mocks.downloadToFile.mockResolvedValue(undefined)
    mocks.computeFileSha256.mockResolvedValue('d'.repeat(64))
    mocks.extractArchiveTo.mockResolvedValue({ success: true })
    const result = await installFfmpeg()
    expect(result.success).toBe(false)
    expect(fs.existsSync(path.join(mocks.userData, 'ffmpeg'))).toBe(false)
  })

  it('并发调用共享同一次安装（避免同时下两份 80 MB 并互相覆盖目录）', async () => {
    if (process.platform === 'darwin') return
    let release: (value: string) => void = () => {}
    mocks.fetchText.mockImplementation(
      () => new Promise<string>((resolve) => { release = resolve })
    )
    const first = installFfmpeg()
    const second = installFfmpeg()
    expect(second).toBe(first)
    release('0000  none.zip')
    const [a, b] = await Promise.all([first, second])
    expect(a).toEqual(b)
    expect(mocks.fetchText).toHaveBeenCalledTimes(1)
  })

  it('失败后允许再次安装（单飞状态必须释放）', async () => {
    if (process.platform === 'darwin') return
    mocks.fetchText.mockResolvedValue('0000  none.zip')
    const first = await installFfmpeg()
    expect(first.success).toBe(false)
    const second = await installFfmpeg()
    expect(second.success).toBe(false)
    expect(mocks.fetchText).toHaveBeenCalledTimes(2)
  })
})
