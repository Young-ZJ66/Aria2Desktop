import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

// 补的是「安装链路的收尾」：平台不支持、解压失败的三种原因、回滚失败、
// 以及非 Windows 下补执行位。这些分支一旦走错，用户装到的就是一个跑不起来的 ffmpeg。
const h = vi.hoisted(() => ({
  state: {
    userData: '',
    temp: '',
    asset: { fileName: 'ffmpeg-test.zip', approxSizeMB: 80 } as null | { fileName: string; approxSizeMB: number },
    behavior: { code: 0, stdout: '', stderr: '', errorCode: '' },
    readdirThrows: false,
    renameThrowsFromBackup: false,
    chmodCalls: [] as string[],
    spawnCalls: [] as string[][]
  },
  fetchText: vi.fn(),
  downloadToFile: vi.fn(),
  computeFileSha256: vi.fn(),
  extractArchiveTo: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'userData' ? h.state.userData : h.state.temp) }
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
  resolveFfmpegAsset: () => h.state.asset
}))
vi.mock('../utils/downloader', () => ({
  fetchText: h.fetchText,
  downloadToFile: h.downloadToFile
}))
vi.mock('../utils/fileHash', () => ({ computeFileSha256: h.computeFileSha256 }))
vi.mock('./archiveService', () => ({ extractArchiveTo: h.extractArchiveTo }))

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  const patched = {
    ...actual,
    readdirSync: (dir: fs.PathLike, options?: unknown) => {
      if (h.state.readdirThrows) throw new Error('readdir boom')
      return (actual.readdirSync as (...args: unknown[]) => unknown)(dir, options)
    },
    renameSync: (from: fs.PathLike, to: fs.PathLike) => {
      if (h.state.renameThrowsFromBackup && String(from).endsWith('.backup')) {
        throw new Error('rename boom')
      }
      return actual.renameSync(from, to)
    },
    chmodSync: (target: fs.PathLike, mode: fs.Mode) => {
      h.state.chmodCalls.push(String(target))
      return actual.chmodSync(target, mode)
    }
  }
  return { ...patched, default: patched }
})

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
      setImmediate(() => {
        if (behavior.errorCode) {
          child.emit('error', Object.assign(new Error(behavior.errorCode), { code: behavior.errorCode }))
          return
        }
        if (behavior.stdout) child.stdout.emit('data', Buffer.from(behavior.stdout))
        if (behavior.stderr) child.stderr.emit('data', Buffer.from(behavior.stderr))
        child.emit('exit', behavior.code)
      })
      return child
    }
  }
})

const { installFfmpeg } = await import('./ffmpegService')

const ASSET_NAME = 'ffmpeg-test.zip'
const HASH = 'a'.repeat(64)
const EXECUTABLE = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'

/** 解压桩：在目标目录下造出 `<build>/bin/ffmpeg`，模拟真实归档结构 */
function extractWithBinary() {
  h.extractArchiveTo.mockImplementation(async (_archive: string, dest: string) => {
    const binDir = path.join(dest, 'ffmpeg-build', 'bin')
    fs.mkdirSync(binDir, { recursive: true })
    fs.writeFileSync(path.join(binDir, EXECUTABLE), 'binary')
    return { success: true }
  })
}

beforeEach(() => {
  h.state.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aria2-ffcov-user-'))
  h.state.temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aria2-ffcov-tmp-'))
  h.state.asset = { fileName: ASSET_NAME, approxSizeMB: 80 }
  h.state.behavior = { code: 0, stdout: 'ffmpeg version N-128251-g6d1bfd7609-20261031 Copyright', stderr: '', errorCode: '' }
  h.state.readdirThrows = false
  h.state.renameThrowsFromBackup = false
  h.state.chmodCalls = []
  h.state.spawnCalls = []
  h.fetchText.mockReset()
  h.downloadToFile.mockReset()
  h.computeFileSha256.mockReset()
  h.extractArchiveTo.mockReset()
  h.fetchText.mockResolvedValue(`${HASH}  ${ASSET_NAME}`)
  h.downloadToFile.mockResolvedValue(undefined)
  h.computeFileSha256.mockResolvedValue(HASH)
  extractWithBinary()
})

afterEach(() => {
  fs.rmSync(h.state.userData, { recursive: true, force: true })
  fs.rmSync(h.state.temp, { recursive: true, force: true })
})

describe('平台不支持自动安装', () => {
  it('没有对应资产时直接返回 platformUnsupported，且不下载任何东西', async () => {
    h.state.asset = null
    const result = await installFfmpeg()
    expect(result.success).toBe(false)
    expect(result.error).toBe('ffmpeg.platformUnsupported')
    expect(h.fetchText).not.toHaveBeenCalled()
    expect(h.downloadToFile).not.toHaveBeenCalled()
  })
})

describe('解压失败的原因归类', () => {
  it('解压超时归到 extractTimeout', async () => {
    h.extractArchiveTo.mockResolvedValue({ success: false, reason: 'extract_timeout' })
    const result = await installFfmpeg()
    expect(result.success).toBe(false)
    expect(result.error).toBe('ffmpeg.extractTimeout')
  })

  it('其它失败原因带上原始 reason', async () => {
    h.extractArchiveTo.mockResolvedValue({ success: false, reason: 'extract_failed' })
    const result = await installFfmpeg()
    expect(result.success).toBe(false)
    expect(result.error).toBe('ffmpeg.extractFailed:{"detail":"extract_failed"}')
  })

  it('失败原因缺失时回落到 unknownReason', async () => {
    h.extractArchiveTo.mockResolvedValue({ success: false })
    const result = await installFfmpeg()
    expect(result.error).toBe('ffmpeg.extractFailed:{"detail":"ffmpeg.unknownReason"}')
  })

  it('解压成功但归档里没有可执行文件时返回 binaryMissing', async () => {
    h.extractArchiveTo.mockResolvedValue({ success: true })
    const result = await installFfmpeg()
    expect(result.success).toBe(false)
    expect(result.error).toBe('ffmpeg.binaryMissing')
    expect(fs.existsSync(path.join(h.state.userData, 'ffmpeg'))).toBe(false)
  })

  it('解压目录不可读时按找不到可执行文件处理', async () => {
    h.state.readdirThrows = true
    const result = await installFfmpeg()
    expect(result.success).toBe(false)
    expect(result.error).toBe('ffmpeg.binaryMissing')
  })
})

describe('自检失败与回滚', () => {
  it('自检进程报非 ENOENT 错误时按原始错误返回', async () => {
    h.state.behavior = { code: 0, stdout: '', stderr: '', errorCode: 'EACCES' }
    const result = await installFfmpeg()
    expect(result.success).toBe(false)
    expect(result.error).toBe('EACCES')
    expect(fs.existsSync(path.join(h.state.userData, 'ffmpeg'))).toBe(false)
  })

  it('自检进程以非零码退出时把 stderr 当作错误原因', async () => {
    h.state.behavior = { code: 3, stdout: '', stderr: 'cannot execute binary', errorCode: '' }
    const result = await installFfmpeg()
    expect(result.success).toBe(false)
    expect(result.error).toBe('cannot execute binary')
  })

  it('旧版存在时自检失败要回滚到旧版，且保留旧版文件', async () => {
    const target = path.join(h.state.userData, 'ffmpeg')
    fs.mkdirSync(target, { recursive: true })
    fs.writeFileSync(path.join(target, EXECUTABLE), 'old-binary')
    h.state.behavior = { code: 1, stdout: '', stderr: 'broken build', errorCode: '' }
    const result = await installFfmpeg()
    expect(result.success).toBe(false)
    expect(result.error).toBe('broken build')
    expect(fs.readFileSync(path.join(target, EXECUTABLE), 'utf8')).toBe('old-binary')
    expect(fs.existsSync(target + '.backup')).toBe(false)
  })

  it('回滚本身失败时只记录日志，仍把原始安装错误抛出', async () => {
    const target = path.join(h.state.userData, 'ffmpeg')
    fs.mkdirSync(target, { recursive: true })
    fs.writeFileSync(path.join(target, EXECUTABLE), 'old-binary')
    h.state.renameThrowsFromBackup = true
    h.state.behavior = { code: 1, stdout: '', stderr: 'broken build', errorCode: '' }
    const result = await installFfmpeg()
    expect(result.success).toBe(false)
    expect(result.error).toBe('broken build')
  })
})

describe('非 Windows 的收尾', () => {
  it('补上可执行位并顺带修正 ffprobe，成功后删除备份目录', async () => {
    const target = path.join(h.state.userData, 'ffmpeg')
    fs.mkdirSync(target, { recursive: true })
    fs.writeFileSync(path.join(target, EXECUTABLE), 'old-binary')
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    h.extractArchiveTo.mockImplementation(async (_archive: string, dest: string) => {
      const binDir = path.join(dest, 'ffmpeg-build', 'bin')
      fs.mkdirSync(binDir, { recursive: true })
      fs.writeFileSync(path.join(binDir, 'ffmpeg'), 'binary')
      fs.writeFileSync(path.join(binDir, 'ffprobe'), 'probe-binary')
      return { success: true }
    })
    try {
      const result = await installFfmpeg()
      expect(result.success).toBe(true)
      expect(result.version).toBe('N-128251-g6d1bfd7609-20261031')
      expect(h.state.chmodCalls.some(item => item.endsWith(path.join('ffmpeg', 'ffmpeg')))).toBe(true)
      expect(h.state.chmodCalls.some(item => item.endsWith('ffprobe'))).toBe(true)
      expect(fs.existsSync(target + '.backup')).toBe(false)
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
    }
  })
})
